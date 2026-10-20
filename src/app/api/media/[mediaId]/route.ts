import { NextResponse } from 'next/server';
import type { MediaMetadataResponse } from '@kapso/whatsapp-cloud-api';
import { errorResponse } from '@/lib/api-errors';
import { resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { whatsappClient } from '@/lib/whatsapp-client';

// Kapso's download_url lives 4 minutes and Meta's url 5; reuse one for a bit less than that.
const DOWNLOAD_URL_TTL_MS = 3 * 60_000;
const MAX_CACHED_URLS = 500;
const MEDIA_ID_PATTERN = /^[\w.-]{1,256}$/;
const FORWARDED_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'etag', 'last-modified'];

type CachedMedia = { url: string; mimeType?: string; expiresAt: number };

const downloadUrls = new Map<string, CachedMedia>();

async function resolveDownload(mediaId: string, phoneNumberId: string, force = false): Promise<CachedMedia> {
  const key = `${phoneNumberId}:${mediaId}`;
  const cached = downloadUrls.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) return cached;

  const metadata: MediaMetadataResponse = await whatsappClient.media.get({ mediaId, phoneNumberId });
  // Prefer Kapso's pre-signed URL: Meta's lookaside URL needs the Meta access token.
  const url = metadata.downloadUrl || metadata.url;
  const expiresAt = Math.min(
    Date.now() + DOWNLOAD_URL_TTL_MS,
    metadata.downloadUrlExpiresAt ? Date.parse(metadata.downloadUrlExpiresAt) - 15_000 : Number.POSITIVE_INFINITY,
  );
  const entry = { url, mimeType: metadata.mimeType, expiresAt };

  if (downloadUrls.size >= MAX_CACHED_URLS) {
    const oldestKey = downloadUrls.keys().next().value;
    if (oldestKey !== undefined) downloadUrls.delete(oldestKey);
  }
  downloadUrls.set(key, entry);
  return entry;
}

function fetchMedia(url: string, range: string | null) {
  return fetch(url, {
    headers: range ? { Range: range } : undefined,
    cache: 'no-store',
  });
}

/**
 * Streams a WhatsApp media file to the browser. The bytes behind a media ID never
 * change, so the browser may keep them; shared caches may not, since the inbox is private.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  const { mediaId } = await params;

  if (!MEDIA_ID_PATTERN.test(mediaId)) {
    return NextResponse.json({ error: 'Invalid media id' }, { status: 400 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const configuredPhoneNumber = await resolvePhoneNumberContext(searchParams.get('phoneNumberId') ?? undefined);
    const phoneNumberId = configuredPhoneNumber.phone_number_id;
    const range = request.headers.get('range');

    let media = await resolveDownload(mediaId, phoneNumberId);
    let upstream = await fetchMedia(media.url, range);

    // A cached URL can expire early; look it up once more before giving up.
    if (upstream.status === 401 || upstream.status === 403 || upstream.status === 404) {
      media = await resolveDownload(mediaId, phoneNumberId, true);
      upstream = await fetchMedia(media.url, range);
    }

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: upstream.status === 404 ? 'Media expired or not found' : 'Media download failed' },
        { status: upstream.status === 404 ? 404 : 502, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const headers = new Headers({ 'Cache-Control': 'private, max-age=86400, immutable' });
    for (const name of FORWARDED_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.has('content-type')) headers.set('content-type', media.mimeType || 'application/octet-stream');
    headers.set('X-Content-Type-Options', 'nosniff');

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    console.error('Error fetching media:', error);
    const response = errorResponse(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
