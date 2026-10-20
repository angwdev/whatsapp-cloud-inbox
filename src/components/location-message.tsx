'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, MapPin, Navigation } from 'lucide-react';
import { cn } from '@/lib/utils';
import { describeLocation, type MessageLocation } from '@/lib/inbox-data';

const TILE_SIZE = 256;
const MAP_ZOOM = 15;
const TILE_OFFSETS = [-1, 0, 1];

function mapsUrl({ latitude, longitude }: MessageLocation): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

function formatCoordinates({ latitude, longitude }: MessageLocation): string {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

/** Web Mercator position of a point, in pixels at the given zoom. */
function projectToWorldPixels(latitude: number, longitude: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const clampedLatitude = Math.max(Math.min(latitude, 85.05112878), -85.05112878);
  const sin = Math.sin((clampedLatitude * Math.PI) / 180);

  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function useMapTiles(location: MessageLocation) {
  return useMemo(() => {
    const tileCount = 2 ** MAP_ZOOM;
    const { x, y } = projectToWorldPixels(location.latitude, location.longitude, MAP_ZOOM);
    const centerTileX = Math.floor(x / TILE_SIZE);
    const centerTileY = Math.floor(y / TILE_SIZE);
    const offsetX = x - centerTileX * TILE_SIZE;
    const offsetY = y - centerTileY * TILE_SIZE;

    return TILE_OFFSETS.flatMap((dy) =>
      TILE_OFFSETS.flatMap((dx) => {
        const tileY = centerTileY + dy;
        if (tileY < 0 || tileY >= tileCount) return [];
        const tileX = (((centerTileX + dx) % tileCount) + tileCount) % tileCount;

        return [{
          key: `${dx}:${dy}`,
          src: `https://tile.openstreetmap.org/${MAP_ZOOM}/${tileX}/${tileY}.png`,
          // Place the point under the center of the frame.
          left: `calc(50% - ${offsetX - dx * TILE_SIZE}px)`,
          top: `calc(50% - ${offsetY - dy * TILE_SIZE}px)`,
        }];
      }),
    );
  }, [location.latitude, location.longitude]);
}

function MapPreview({ location }: { location: MessageLocation }) {
  const tiles = useMapTiles(location);
  const [loadedCount, setLoadedCount] = useState(0);
  const [failed, setFailed] = useState(false);

  return (
    <div className="relative h-36 w-full overflow-hidden bg-[var(--chat-hover)]">
      {failed ? (
        // Offline, blocked by a content policy, or the tile server is down.
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-60 [background-image:linear-gradient(var(--chat-border-strong)_1px,transparent_1px),linear-gradient(90deg,var(--chat-border-strong)_1px,transparent_1px)] [background-size:24px_24px]"
        />
      ) : (
        <div
          aria-hidden="true"
          className={cn(
            'absolute inset-0 transition-opacity duration-300 dark:[filter:invert(0.92)_hue-rotate(180deg)_saturate(0.7)_brightness(0.95)]',
            loadedCount === 0 ? 'opacity-0' : 'opacity-100',
          )}
        >
          {tiles.map((tile) => (
            // eslint-disable-next-line @next/next/no-img-element -- third-party map tiles, sized by the projection
            <img
              key={tile.key}
              src={tile.src}
              alt=""
              width={TILE_SIZE}
              height={TILE_SIZE}
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={() => setLoadedCount((count) => count + 1)}
              onError={() => setFailed(true)}
              className="absolute max-w-none select-none"
              style={{ left: tile.left, top: tile.top, width: TILE_SIZE, height: TILE_SIZE }}
            />
          ))}
        </div>
      )}

      {!failed && loadedCount === 0 && (
        <div aria-hidden="true" className="absolute inset-0 animate-pulse bg-[var(--chat-hover)]" />
      )}

      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2">
        <span className="absolute left-1/2 top-0 h-1.5 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/25 blur-[2px]" />
        <MapPin
          className="absolute left-1/2 top-0 size-9 -translate-x-1/2 -translate-y-full fill-red-500 text-white drop-shadow-md"
          strokeWidth={1.75}
        />
      </div>

      {!failed && (
        <span className="absolute bottom-0 right-0 rounded-tl bg-white/80 px-1 text-[9px] leading-4 text-neutral-700 dark:bg-black/60 dark:text-neutral-300">
          © OpenStreetMap
        </span>
      )}
    </div>
  );
}

type LocationMessageProps = {
  location: MessageLocation;
};

export function LocationMessage({ location }: LocationMessageProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<number | null>(null);
  const title = location.name || location.address ? describeLocation(location) : 'Shared location';
  const subtitle = location.name && location.address ? location.address : null;
  const coordinates = formatCoordinates(location);
  const href = mapsUrl(location);

  useEffect(() => () => {
    if (copiedTimeoutRef.current !== null) window.clearTimeout(copiedTimeoutRef.current);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(coordinates);
      setCopied(true);
      if (copiedTimeoutRef.current !== null) window.clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      // Clipboard access can be denied; the coordinates stay visible to copy by hand.
    }
  };

  return (
    <div className="-mx-1 -mt-0.5 mb-1 w-[min(18rem,calc(100vw-7rem))] max-w-full overflow-hidden rounded-md border border-[var(--chat-media-outline)] bg-[var(--chat-surface)]">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${title} in Google Maps`}
        className="block outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
      >
        <MapPreview location={location} />
      </a>

      <div className="space-y-0.5 px-3 pt-2">
        <p className="flex items-start gap-1.5 text-sm font-medium leading-5 text-foreground">
          <MapPin aria-hidden="true" className="mt-0.5 size-3.5 flex-shrink-0 text-red-500" />
          <span className="line-clamp-2 break-words">{title}</span>
        </p>
        {subtitle && (
          <p className="line-clamp-2 break-words pl-5 text-xs leading-4 text-muted-foreground">{subtitle}</p>
        )}
        <p className="pl-5 font-mono text-[11px] tabular-nums leading-4 text-muted-foreground/90">{coordinates}</p>
      </div>

      <div className="mt-2 grid grid-cols-2 border-t border-[var(--chat-border)]">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-10 items-center justify-center gap-1.5 text-xs font-medium text-primary transition-colors hover:bg-[var(--chat-hover)] focus-visible:bg-[var(--chat-hover)] focus-visible:outline-none"
        >
          <Navigation aria-hidden="true" className="size-3.5" />
          Directions
          <ExternalLink aria-hidden="true" className="size-3 opacity-60" />
        </a>
        <button
          type="button"
          onClick={handleCopy}
          className="flex h-10 items-center justify-center gap-1.5 border-l border-[var(--chat-border)] text-xs font-medium text-primary transition-colors hover:bg-[var(--chat-hover)] focus-visible:bg-[var(--chat-hover)] focus-visible:outline-none"
        >
          {copied ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
          <span aria-live="polite">{copied ? 'Copied' : 'Copy coordinates'}</span>
        </button>
      </div>
    </div>
  );
}

type LocationRequestFooterProps = {
  answeredByMessageId?: string;
  onShowAnswer?: (messageId: string) => void;
};

/**
 * Mirrors the "Send location" button the contact sees, plus whether they answered.
 */
export function LocationRequestFooter({ answeredByMessageId, onShowAnswer }: LocationRequestFooterProps) {
  return (
    <div className="-mx-3 mt-2 border-t border-[var(--chat-border)]">
      <div
        aria-hidden="true"
        className="flex h-10 items-center justify-center gap-1.5 text-sm font-medium text-[var(--chat-check)]"
      >
        <MapPin className="size-4" />
        Send location
      </div>
      <div className="flex items-center justify-center border-t border-[var(--chat-border)] px-3 py-1.5">
        {answeredByMessageId ? (
          <button
            type="button"
            onClick={() => onShowAnswer?.(answeredByMessageId)}
            className="inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-primary hover:bg-[var(--chat-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <Check aria-hidden="true" className="size-3" />
            Location received · View
          </button>
        ) : (
          <span className="inline-flex min-h-8 items-center gap-1.5 text-[11px] text-muted-foreground">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-muted-foreground/50" />
            No location shared yet
          </span>
        )}
      </div>
    </div>
  );
}
