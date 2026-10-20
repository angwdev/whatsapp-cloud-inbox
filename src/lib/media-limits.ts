/**
 * What the Cloud API accepts for each media message type.
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media#supported-media-types
 */
export type OutboundMediaType = 'image' | 'video' | 'audio' | 'document' | 'sticker';

const MB = 1024 * 1024;

export const MEDIA_LIMITS: Record<OutboundMediaType, { maxBytes: number; mimeTypes: string[] }> = {
  image: { maxBytes: 5 * MB, mimeTypes: ['image/jpeg', 'image/png'] },
  sticker: { maxBytes: 500 * 1024, mimeTypes: ['image/webp'] },
  video: { maxBytes: 16 * MB, mimeTypes: ['video/mp4', 'video/3gpp'] },
  audio: {
    maxBytes: 16 * MB,
    mimeTypes: ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg'],
  },
  document: {
    maxBytes: 100 * MB,
    mimeTypes: [
      'text/plain',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
  },
};

export const TEXT_BODY_MAX_LENGTH = 4096;
export const MEDIA_CAPTION_MAX_LENGTH = 1024;

/** Browsers often leave `File.type` empty for these, so fall back to the extension. */
const EXTENSION_MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  mp4: 'video/mp4', '3gp': 'video/3gpp',
  aac: 'audio/aac', amr: 'audio/amr', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg',
  txt: 'text/plain', pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Value for the file input's `accept` attribute. */
export const MEDIA_ACCEPT = [
  ...Object.values(MEDIA_LIMITS).flatMap((limit) => limit.mimeTypes),
  ...Object.keys(EXTENSION_MIME_TYPES).map((extension) => `.${extension}`),
].join(',');

export function resolveMimeType(file: { type: string; name?: string }): string {
  if (file.type) return file.type;
  const extension = file.name?.split('.').pop()?.toLowerCase();
  return (extension && EXTENSION_MIME_TYPES[extension]) || '';
}

/** Strips parameters such as `audio/ogg; codecs=opus`. */
function baseMimeType(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase();
}

export function mediaTypeForMime(mimeType: string): OutboundMediaType | null {
  const type = baseMimeType(mimeType);
  const entry = (Object.entries(MEDIA_LIMITS) as Array<[OutboundMediaType, (typeof MEDIA_LIMITS)[OutboundMediaType]]>)
    .find(([, limit]) => limit.mimeTypes.includes(type));
  return entry?.[0] ?? null;
}

function formatBytes(bytes: number): string {
  return bytes >= MB ? `${Math.round(bytes / MB)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export type MediaValidation =
  | { ok: true; mediaType: OutboundMediaType; mimeType: string }
  | { ok: false; reason: string };

export function validateOutboundMedia(file: { type: string; size: number; name?: string }): MediaValidation {
  const mediaType = mediaTypeForMime(resolveMimeType(file));
  if (!mediaType) {
    return {
      ok: false,
      reason: `${file.name || 'This file'} isn't a type WhatsApp can send. Use JPEG or PNG images, MP4 video, MP3/AAC/OGG audio, or PDF and Office documents.`,
    };
  }

  const { maxBytes } = MEDIA_LIMITS[mediaType];
  if (file.size > maxBytes) {
    return {
      ok: false,
      reason: `${file.name || 'This file'} is ${formatBytes(file.size)}. WhatsApp allows up to ${formatBytes(maxBytes)} for ${mediaType === 'document' ? 'documents' : `${mediaType}s`}.`,
    };
  }

  return { ok: true, mediaType, mimeType: baseMimeType(resolveMimeType(file)) };
}

export { formatBytes };
