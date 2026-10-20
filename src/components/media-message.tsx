'use client';

import { useState } from 'react';
import { Download, FileText, ImageOff, Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/media-limits';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

type Props = {
  /** Kapso's mirrored copy, when the history has one. */
  url?: string;
  /** WhatsApp media ID, fetched through /api/media when there is no URL or it fails. */
  mediaId?: string;
  phoneNumberId?: string;
  messageType: string;
  contentType?: string;
  caption?: string | null;
  filename?: string | null;
  byteSize?: number;
};

function proxyUrl(mediaId: string, phoneNumberId?: string): string {
  const params = new URLSearchParams();
  if (phoneNumberId) params.set('phoneNumberId', phoneNumberId);
  return `/api/media/${encodeURIComponent(mediaId)}${params.size ? `?${params.toString()}` : ''}`;
}

function kindOf(messageType: string, contentType?: string): 'image' | 'sticker' | 'video' | 'audio' | 'document' {
  if (messageType === 'sticker') return 'sticker';
  if (messageType === 'image' || contentType?.startsWith('image/')) return 'image';
  if (messageType === 'video' || contentType?.startsWith('video/')) return 'video';
  if (messageType === 'audio' || contentType?.startsWith('audio/')) return 'audio';
  return 'document';
}

export function MediaMessage({ url, mediaId, phoneNumberId, messageType, contentType, caption, filename, byteSize }: Props) {
  const sources = [url, mediaId ? proxyUrl(mediaId, phoneNumberId) : undefined].filter((source): source is string => Boolean(source));
  const [sourceIndex, setSourceIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const src = sources[sourceIndex];
  const failed = !src;
  const kind = kindOf(messageType, contentType);

  // The mirrored URL can expire; fall back to the proxy before giving up.
  const handleError = () => {
    setLoaded(false);
    setSourceIndex((index) => index + 1);
  };

  if (failed) {
    return (
      <div className="flex h-24 w-56 max-w-full flex-col items-center justify-center gap-1 rounded-md bg-[var(--chat-hover)] text-muted-foreground">
        <ImageOff aria-hidden="true" className="size-5" />
        <p className="text-xs">Media unavailable or expired</p>
      </div>
    );
  }

  if (kind === 'sticker') {
    // eslint-disable-next-line @next/next/no-img-element -- WhatsApp media through our proxy
    return <img src={src} alt="Sticker" loading="lazy" decoding="async" onError={handleError} className="h-auto max-h-[150px] max-w-[150px]" />;
  }

  if (kind === 'image') {
    const alt = caption || filename || 'Image';
    return (
      <>
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="group/media relative block max-w-full overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Open image"
        >
          {!loaded && <div aria-hidden="true" className="h-48 w-64 max-w-full animate-pulse rounded-md bg-[var(--chat-hover)]" />}
          {/* eslint-disable-next-line @next/next/no-img-element -- WhatsApp media through our proxy */}
          <img
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={handleError}
            className={cn(
              'h-auto max-h-80 max-w-full rounded-md object-cover outline outline-1 [outline-color:var(--chat-media-outline)]',
              !loaded && 'absolute inset-0 opacity-0',
            )}
          />
          {loaded && (
            <span aria-hidden="true" className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white opacity-0 transition-opacity group-hover/media:opacity-100 group-focus-visible/media:opacity-100">
              <Maximize2 className="size-3.5" />
            </span>
          )}
        </button>
        <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
          <DialogContent className="max-w-[min(96vw,64rem)] gap-3 bg-background/95 p-3 sm:max-w-[min(96vw,64rem)] sm:p-4">
            <DialogTitle className="sr-only">{alt}</DialogTitle>
            {/* eslint-disable-next-line @next/next/no-img-element -- full-size view */}
            <img src={src} alt={alt} className="mx-auto max-h-[78dvh] w-auto max-w-full rounded-md object-contain" />
            <div className="flex items-center justify-between gap-3 pr-10">
              <p className="min-w-0 truncate text-sm text-muted-foreground">{caption || filename}</p>
              <a href={src} download={filename || 'image'} className="inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-primary hover:bg-[var(--chat-hover)]">
                <Download aria-hidden="true" className="size-4" />
                Download
              </a>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  if (kind === 'video') {
    return (
      <video
        src={src}
        controls
        preload="metadata"
        playsInline
        onError={handleError}
        className="h-auto max-h-80 max-w-full rounded-md outline outline-1 [outline-color:var(--chat-media-outline)]"
      />
    );
  }

  if (kind === 'audio') {
    return <audio src={src} controls preload="metadata" onError={handleError} className="w-64 max-w-full" />;
  }

  const extension = filename?.split('.').pop()?.toUpperCase();
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      download={filename || undefined}
      className="flex w-64 max-w-full items-center gap-3 rounded-md border border-[var(--chat-media-outline)] bg-[var(--chat-surface)] px-3 py-2.5 transition-colors hover:bg-[var(--chat-hover)]"
    >
      <span className="flex size-10 flex-shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary">
        <FileText aria-hidden="true" className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{filename || 'Document'}</span>
        <span className="block text-xs text-muted-foreground">
          {[extension && extension.length <= 5 ? extension : null, byteSize ? formatBytes(byteSize) : null].filter(Boolean).join(' · ') || 'Open file'}
        </span>
      </span>
      <Download aria-hidden="true" className="size-4 flex-shrink-0 text-muted-foreground" />
    </a>
  );
}
