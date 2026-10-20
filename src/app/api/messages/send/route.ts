import { NextResponse } from 'next/server';
import { BadRequestError, errorResponse } from '@/lib/api-errors';
import { resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { recipientFields } from '@/lib/recipient';
import { MEDIA_CAPTION_MAX_LENGTH, TEXT_BODY_MAX_LENGTH, validateOutboundMedia } from '@/lib/media-limits';
import { whatsappClient } from '@/lib/whatsapp-client';

const URL_PATTERN = /\bhttps?:\/\/\S+/i;

function readText(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const to = readText(formData, 'to')?.trim();
    const body = readText(formData, 'body');
    const fileEntry = formData.get('file');
    const file = fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null;
    const contextMessageId = readText(formData, 'contextMessageId')?.trim();

    if (!to) throw new BadRequestError('Missing required field: to');
    if (!body && !file) throw new BadRequestError('Either body or file is required');

    const configuredPhoneNumber = await resolvePhoneNumberContext(readText(formData, 'phoneNumberId'));
    const phoneNumberId = configuredPhoneNumber.phone_number_id;
    const base = { phoneNumberId, ...recipientFields(to), contextMessageId };

    let result;

    if (file) {
      const validation = validateOutboundMedia(file);
      if (!validation.ok) throw new BadRequestError(validation.reason);

      const { mediaType, mimeType } = validation;
      const caption = body?.trim() || undefined;
      const supportsCaption = mediaType !== 'audio' && mediaType !== 'sticker';
      if (caption && supportsCaption && caption.length > MEDIA_CAPTION_MAX_LENGTH) {
        throw new BadRequestError(`Captions can be up to ${MEDIA_CAPTION_MAX_LENGTH} characters`);
      }

      const upload = await whatsappClient.media.upload({
        phoneNumberId,
        // The Cloud API expects the file's MIME type here.
        type: mimeType,
        file,
        fileName: file.name,
      });

      switch (mediaType) {
        case 'image':
          result = await whatsappClient.messages.sendImage({ ...base, image: { id: upload.id, caption } });
          break;
        case 'video':
          result = await whatsappClient.messages.sendVideo({ ...base, video: { id: upload.id, caption } });
          break;
        case 'audio':
          // OGG/Opus files play as voice notes, with the waveform and "played" receipts.
          result = await whatsappClient.messages.sendAudio({
            ...base,
            audio: { id: upload.id, ...(mimeType === 'audio/ogg' && { voice: true }) },
          });
          break;
        case 'sticker':
          result = await whatsappClient.messages.sendSticker({ ...base, sticker: { id: upload.id } });
          break;
        default:
          result = await whatsappClient.messages.sendDocument({
            ...base,
            document: { id: upload.id, caption, filename: file.name },
          });
      }

      // Audio and stickers can't carry a caption, so the text follows as its own message.
      if (caption && !supportsCaption) {
        await whatsappClient.messages.sendText({ phoneNumberId, ...recipientFields(to), body: caption.slice(0, TEXT_BODY_MAX_LENGTH) });
      }
    } else if (body) {
      if (body.length > TEXT_BODY_MAX_LENGTH) {
        throw new BadRequestError(`Messages can be up to ${TEXT_BODY_MAX_LENGTH} characters`);
      }

      result = await whatsappClient.messages.sendText({
        ...base,
        body,
        // Let WhatsApp render a link preview when the message contains a URL.
        previewUrl: URL_PATTERN.test(body),
      });
    }

    return NextResponse.json(
      typeof result === 'object' && result !== null
        ? { ...result, contextMessageId }
        : { result, contextMessageId }
    );
  } catch (error) {
    console.error('Error sending message:', error);
    return errorResponse(error);
  }
}
