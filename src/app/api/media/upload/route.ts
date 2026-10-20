import { NextResponse } from 'next/server';
import { z } from 'zod';
import { BadRequestError, errorResponse } from '@/lib/api-errors';
import { resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { validateOutboundMedia } from '@/lib/media-limits';
import { whatsappClient } from '@/lib/whatsapp-client';

const fieldsSchema = z.object({
  phoneNumberId: z.string().trim().min(1).optional(),
  /** When set, the file must be this kind of media (e.g. a template's IMAGE header). */
  expectedType: z.enum(['image', 'video', 'audio', 'document', 'sticker']).optional(),
});

function readText(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === 'string' && value.trim() ? value : undefined;
}

const withArticle = (word: string) => `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;

/**
 * Uploads a file to WhatsApp and returns its media ID, for use in template
 * headers and other messages that reference media by ID.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData().catch(() => {
      throw new BadRequestError('Expected a multipart/form-data body');
    });

    const fields = fieldsSchema.safeParse({
      phoneNumberId: readText(formData, 'phoneNumberId'),
      expectedType: readText(formData, 'expectedType'),
    });
    if (!fields.success) {
      throw new BadRequestError(fields.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    }

    const fileEntry = formData.get('file');
    if (!(fileEntry instanceof File) || fileEntry.size === 0) {
      throw new BadRequestError('Missing required field: file');
    }

    const validation = validateOutboundMedia(fileEntry);
    if (!validation.ok) throw new BadRequestError(validation.reason);

    const { expectedType } = fields.data;
    if (expectedType && validation.mediaType !== expectedType) {
      throw new BadRequestError(`${fileEntry.name || 'This file'} is ${withArticle(validation.mediaType)}; this needs ${withArticle(expectedType)}.`);
    }

    const phoneNumber = await resolvePhoneNumberContext(fields.data.phoneNumberId);
    const upload = await whatsappClient.media.upload({
      phoneNumberId: phoneNumber.phone_number_id,
      // The Cloud API expects the file's MIME type here.
      type: validation.mimeType,
      file: fileEntry,
      fileName: fileEntry.name || undefined,
    });

    return NextResponse.json({ id: upload.id, mediaType: validation.mediaType });
  } catch (error) {
    console.error('Error uploading media:', error);
    return errorResponse(error);
  }
}
