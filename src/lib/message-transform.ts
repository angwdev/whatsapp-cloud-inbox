import 'server-only';
import type { KapsoMessageExtensions, MediaData, MetaMessage } from '@kapso/whatsapp-cloud-api';
import type {
  InteractiveReply,
  InteractiveSummary,
  Message,
  MessageError,
  MessageLocation,
  OrderSummary,
  SharedContact,
} from '@/lib/inbox-data';

/**
 * Turns Kapso's message history (Meta message objects with a `kapso` extension,
 * camelCased by the SDK) into the shape the inbox renders.
 */

type UnknownRecord = Record<string, unknown>;

type MessageTypeData = {
  filename?: string;
  mimeType?: string;
  messageId?: string;
  emoji?: string;
  raw: UnknownRecord;
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown, ...keys: string[]): string | undefined {
  if (!isRecord(value)) return undefined;

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  return undefined;
}

function readNumber(value: unknown): number | undefined {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
}

function toIsoString(timestamp: unknown, fallback?: unknown): string {
  const epochSeconds = readNumber(timestamp);
  if (epochSeconds !== undefined) {
    return new Date(epochSeconds * 1000).toISOString();
  }

  if (typeof fallback === 'string' && !Number.isNaN(Date.parse(fallback))) {
    return new Date(fallback).toISOString();
  }

  // Never "now": that would reorder the thread on every poll and could reopen the 24h window.
  return new Date(0).toISOString();
}

function normaliseKapsoContent(content: KapsoMessageExtensions['content']): string | undefined {
  if (!content) return undefined;
  if (typeof content === 'string') return content;
  return readString(content, 'text');
}

function extractMessageTypeData(value: KapsoMessageExtensions['messageTypeData']): MessageTypeData | undefined {
  if (!isRecord(value)) return undefined;

  return {
    filename: readString(value, 'filename'),
    mimeType: readString(value, 'mimeType'),
    messageId: readString(value, 'messageId'),
    emoji: typeof value.emoji === 'string' ? value.emoji : undefined,
    raw: value,
  };
}

function extractMediaData(mediaData: MediaData | undefined): Pick<MediaData, 'filename' | 'contentType' | 'byteSize'> {
  return {
    filename: typeof mediaData?.filename === 'string' ? mediaData.filename : undefined,
    contentType: typeof mediaData?.contentType === 'string' ? mediaData.contentType : undefined,
    byteSize: typeof mediaData?.byteSize === 'number' ? mediaData.byteSize : undefined,
  };
}

function readCoordinate(value: unknown, limit: number): number | undefined {
  const coordinate = readNumber(value);
  return coordinate !== undefined && Math.abs(coordinate) <= limit ? coordinate : undefined;
}

function extractLocation(location: MetaMessage['location'], messageTypeData: MessageTypeData | undefined): MessageLocation | undefined {
  // Kapso may keep the shared location in message_type_data instead of the Meta field.
  const source = location ?? messageTypeData?.raw;
  if (!isRecord(source)) return undefined;

  const latitude = readCoordinate(source.latitude, 90);
  const longitude = readCoordinate(source.longitude, 180);
  if (latitude === undefined || longitude === undefined) return undefined;

  const url = readString(source, 'url');
  return {
    latitude,
    longitude,
    name: readString(source, 'name'),
    address: readString(source, 'address'),
    url: url && /^https?:\/\//i.test(url) ? url : undefined,
  };
}

function textOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  return readString(value, 'text');
}

type InteractiveData = {
  type?: string;
  bodyText?: string;
  reply?: InteractiveReply;
  summary?: InteractiveSummary;
  flowResponse?: UnknownRecord;
};

function parseFlowResponse(nfmReply: unknown, kapsoFlowResponse: unknown): UnknownRecord | undefined {
  // The raw JSON string keeps the flow's own key names; the SDK camelCases parsed objects.
  const responseJson = readString(nfmReply, 'responseJson');
  if (responseJson) {
    try {
      const parsed = JSON.parse(responseJson);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Fall back to Kapso's parsed copy.
    }
  }
  return isRecord(kapsoFlowResponse) ? kapsoFlowResponse : undefined;
}

function extractInteractive(
  interactive: MetaMessage['interactive'],
  messageTypeData: MessageTypeData | undefined,
  kapsoExtensions: KapsoMessageExtensions | undefined,
): InteractiveData {
  const source = isRecord(interactive) ? interactive : messageTypeData?.raw;
  if (!source) return {};

  const type = readString(source, 'type', 'interactiveType');
  const data: InteractiveData = { type, bodyText: textOf(source.body) };

  if (type === 'button_reply' && isRecord(source.buttonReply)) {
    const title = readString(source.buttonReply, 'title');
    if (title) data.reply = { kind: 'button', title, id: readString(source.buttonReply, 'id') };
  } else if (type === 'list_reply' && isRecord(source.listReply)) {
    const title = readString(source.listReply, 'title');
    if (title) {
      data.reply = {
        kind: 'list',
        title,
        id: readString(source.listReply, 'id'),
        description: readString(source.listReply, 'description'),
      };
    }
  } else if (type === 'nfm_reply') {
    data.flowResponse = parseFlowResponse(source.nfmReply, kapsoExtensions?.flowResponse);
    // nfm_reply.body is just "Sent"; the response card says the rest.
    data.bodyText = undefined;
  }

  // What an outbound interactive message offered.
  const action = isRecord(source.action) ? source.action : undefined;
  const parameters = isRecord(action?.parameters) ? action.parameters : undefined;
  const buttons = Array.isArray(action?.buttons)
    ? action.buttons
        .map((button) => readString(isRecord(button) ? button.reply : undefined, 'title'))
        .filter((title): title is string => Boolean(title))
    : undefined;
  const cta = readString(parameters, 'displayText', 'flowCta') ?? readString(action, 'button');
  const header = textOf(source.header);
  const footer = textOf(source.footer);

  if (buttons?.length || cta || header || footer) {
    data.summary = {
      ...(header && { header }),
      ...(footer && { footer }),
      ...(buttons?.length && { buttons }),
      ...(cta && { cta }),
    };
  }

  return data;
}

function extractContacts(contacts: MetaMessage['contacts']): SharedContact[] | undefined {
  if (!Array.isArray(contacts) || contacts.length === 0) return undefined;

  return contacts.map((contact) => {
    const name = isRecord(contact.name) ? contact.name : undefined;
    const formattedName = readString(name, 'formattedName')
      ?? [readString(name, 'firstName'), readString(name, 'lastName')].filter(Boolean).join(' ');

    return {
      name: formattedName || 'Contact',
      organization: readString(contact.org, 'company'),
      phones: (Array.isArray(contact.phones) ? contact.phones : [])
        .filter(isRecord)
        .map((phone) => ({ phone: readString(phone, 'phone') ?? readString(phone, 'waId') ?? '', waId: readString(phone, 'waId'), type: readString(phone, 'type') }))
        .filter((phone) => phone.phone),
      emails: (Array.isArray(contact.emails) ? contact.emails : [])
        .map((email) => readString(email, 'email'))
        .filter((email): email is string => Boolean(email)),
    };
  });
}

function extractOrder(order: MetaMessage['order'], orderText: unknown): OrderSummary | undefined {
  if (!isRecord(order)) return undefined;

  return {
    catalogId: readString(order, 'catalogId'),
    text: readString(order, 'text') ?? (typeof orderText === 'string' ? orderText : undefined),
    items: (Array.isArray(order.productItems) ? order.productItems : [])
      .filter(isRecord)
      .map((item) => ({
        productId: readString(item, 'productRetailerId') ?? 'item',
        quantity: readNumber(item.quantity) ?? 1,
        price: readNumber(item.itemPrice),
        currency: readString(item, 'currency'),
      })),
  };
}

function extractErrors(...sources: unknown[]): MessageError[] | undefined {
  for (const source of sources) {
    if (!Array.isArray(source) || source.length === 0) continue;
    return source.filter(isRecord).map((error) => ({
      code: readNumber(error.code),
      title: readString(error, 'title'),
      message: readString(error, 'message') ?? readString(error.errorData, 'details'),
    }));
  }
  return undefined;
}

function extractContextMessageId(
  msg: MetaMessage,
  kapsoExtensions: KapsoMessageExtensions | undefined,
  messageTypeData: MessageTypeData | undefined,
): string | undefined {
  return (
    (typeof msg.context?.id === 'string' && msg.context.id) ||
    readString(kapsoExtensions, 'contextMessageId') ||
    readString(messageTypeData?.raw, 'contextMessageId')
  );
}

function isGeneratedMediaAttachmentContent(content: string, mediaUrl?: string): boolean {
  const trimmedContent = content.trim();
  if (!trimmedContent) return false;
  if (mediaUrl && trimmedContent === mediaUrl.trim()) return true;
  if (/^https?:\/\//i.test(trimmedContent)) return true;
  if (/\bURL:\s*https?:\/\//i.test(trimmedContent)) return true;
  return /^(image|audio)\s+attached\b/i.test(trimmedContent);
}

function extractTranscriptContent(content: string): string | undefined {
  const match = content.match(/\bTranscript:\s*[\s\S]*$/i);
  if (!match) return undefined;

  return match[0]
    .replace(/\s+\bURL:\s*https?:\/\/\S+[\s\S]*$/i, '')
    .trim();
}

function normalizeMessageContent(input: { content?: string; messageType: string; mediaUrl?: string }): string {
  if (!input.content) return '';

  if (input.messageType === 'audio') {
    return extractTranscriptContent(input.content) ??
      (isGeneratedMediaAttachmentContent(input.content, input.mediaUrl) ? '' : input.content);
  }

  if (input.messageType === 'image' && isGeneratedMediaAttachmentContent(input.content, input.mediaUrl)) {
    return '';
  }

  return input.content;
}

const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'];

export function transformMessage(msg: MetaMessage, phoneNumberId: string): Omit<Message, 'conversationId'> {
  const { image, video, audio, document, sticker, text, reaction, location, interactive, contacts, order, kapso } = msg;
  const kapsoExtensions = kapso as KapsoMessageExtensions | undefined;
  const messageTypeData = extractMessageTypeData(kapsoExtensions?.messageTypeData);
  const kapsoMediaData = extractMediaData(kapsoExtensions?.mediaData);
  const contextMessageId = extractContextMessageId(msg, kapsoExtensions, messageTypeData);

  const mediaId =
    image?.id ?? video?.id ?? audio?.id ?? document?.id ?? sticker?.id ??
    (typeof kapsoExtensions?.mediaData?.id === 'string' ? kapsoExtensions.mediaData.id : undefined);

  const mediaUrl =
    image?.link ?? video?.link ?? audio?.link ?? document?.link ?? sticker?.link ??
    (typeof kapsoExtensions?.mediaUrl === 'string' ? kapsoExtensions.mediaUrl : undefined) ??
    (typeof kapsoExtensions?.mediaData?.url === 'string' ? kapsoExtensions.mediaData.url : undefined);

  const hasMedia = Boolean(kapsoExtensions?.hasMedia) || Boolean(mediaId) || MEDIA_TYPES.includes(msg.type);

  const resolvedMediaData = mediaUrl
    ? {
        url: mediaUrl,
        filename: document?.filename ?? messageTypeData?.filename ?? kapsoMediaData.filename,
        contentType: messageTypeData?.mimeType ?? kapsoMediaData.contentType,
        byteSize: kapsoMediaData.byteSize,
      }
    : undefined;

  // A reaction without an emoji is the contact (or you) removing it.
  const reactionEmoji = msg.type === 'reaction'
    ? (typeof reaction?.emoji === 'string' ? reaction.emoji : messageTypeData?.emoji ?? '')
    : undefined;
  const locationData = msg.type === 'location' ? extractLocation(location, messageTypeData) : undefined;
  const interactiveData = msg.type === 'interactive' ? extractInteractive(interactive, messageTypeData, kapsoExtensions) : {};
  const templateButton = msg.type === 'button' && isRecord(msg.button) ? msg.button : undefined;
  const templateButtonText = readString(templateButton, 'text');
  const system = msg.type === 'system' && isRecord(msg.system) ? msg.system : undefined;
  const unsupported = msg.type === 'unsupported' && isRecord(msg.unsupported) ? msg.unsupported : undefined;

  const kapsoContent = normaliseKapsoContent(kapsoExtensions?.content);
  const textBody = typeof text?.body === 'string' ? text.body : undefined;
  const content = normalizeMessageContent({
    content: interactiveData.flowResponse
      ? undefined
      : kapsoContent ?? textBody ?? interactiveData.bodyText ?? templateButtonText ?? readString(system, 'body') ?? reactionEmoji,
    messageType: msg.type,
    mediaUrl,
  });

  const fallbackCaption =
    (typeof image?.caption === 'string' && image.caption) ||
    (typeof video?.caption === 'string' && video.caption) ||
    (typeof document?.caption === 'string' && document.caption) ||
    undefined;

  const lastMessageTimestamp = (kapsoExtensions as { lastMessageTimestamp?: unknown } | undefined)?.lastMessageTimestamp;
  const direction = kapsoExtensions?.direction === 'outbound' ? 'outbound' : 'inbound';
  const errors = extractErrors(
    (msg as { errors?: unknown }).errors,
    (kapsoExtensions as { errors?: unknown } | undefined)?.errors,
    messageTypeData?.raw.errors,
    unsupported?.errors,
  );
  const unsupportedType = readString(unsupported, 'type');

  return {
    id: msg.id,
    phoneNumberId,
    direction,
    content: content || (unsupportedType ? `Unsupported message (${unsupportedType.replace(/_/g, ' ')})` : content),
    createdAt: toIsoString(msg.timestamp, lastMessageTimestamp),
    status: typeof kapsoExtensions?.status === 'string' ? kapsoExtensions.status : undefined,
    phoneNumber: typeof kapsoExtensions?.phoneNumber === 'string' ? kapsoExtensions.phoneNumber : (msg.from ?? ''),
    hasMedia,
    mediaData: resolvedMediaData,
    reactionEmoji,
    reactedToMessageId: typeof reaction?.messageId === 'string' ? reaction.messageId : messageTypeData?.messageId,
    contextMessageId,
    filename: document?.filename ?? messageTypeData?.filename ?? kapsoMediaData.filename,
    mimeType: messageTypeData?.mimeType ?? kapsoMediaData.contentType,
    messageType: msg.type,
    caption: fallbackCaption,
    location: locationData,
    interactiveType: interactiveData.type,
    interactiveReply: interactiveData.reply ?? (templateButtonText
      ? { kind: 'template_button', title: templateButtonText, id: readString(templateButton, 'payload') }
      : undefined),
    interactiveSummary: direction === 'outbound' ? interactiveData.summary : undefined,
    contacts: msg.type === 'contacts' ? extractContacts(contacts) : undefined,
    order: msg.type === 'order' ? extractOrder(order, kapsoExtensions?.orderText) : undefined,
    flowResponse: interactiveData.flowResponse,
    errors,
    metadata: { mediaId },
  };
}

/** Kapso fields the transform reads; asking for fewer keeps the history responses small. */
export const MESSAGE_FIELDS = [
  'direction',
  'status',
  'phone_number',
  'has_media',
  'media_data',
  'media_url',
  'message_type_data',
  'content',
  'flow_response',
  'order_text',
] as const;
