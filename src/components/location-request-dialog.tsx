'use client';

import { useState } from 'react';
import { Loader2, MapPin, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LOCATION_REQUEST_BODY_MAX_LENGTH } from '@/lib/inbox-data';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';

const PRESETS = [
  {
    label: 'Delivery address',
    text: 'Please share your delivery location so we can get your order to the right place.',
  },
  {
    label: 'Pickup point',
    text: 'Where should we pick you up? Tap the button below to send your location.',
  },
  {
    label: 'Nearest store',
    text: "Share your location and we'll find the store nearest to you.",
  },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phoneNumber?: string;
  phoneNumberId?: string;
  onMessageSent?: () => void | Promise<void>;
};

export function LocationRequestDialog({
  open,
  onOpenChange,
  phoneNumber,
  phoneNumberId,
  onMessageSent,
}: Props) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmedBody = body.trim();
  const remaining = LOCATION_REQUEST_BODY_MAX_LENGTH - body.length;
  const canSend = Boolean(trimmedBody) && remaining >= 0 && !sending;

  const handleReset = () => {
    setBody('');
    setError(null);
  };

  const handleSend = async () => {
    if (!canSend) return;

    if (!phoneNumber) {
      setError('No conversation selected');
      return;
    }

    setSending(true);
    setError(null);

    try {
      const response = await fetch('/api/messages/location-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phoneNumber, phoneNumberId, body: trimmedBody }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to send location request');
      }

      handleReset();
      onOpenChange(false);
      await onMessageSent?.();
    } catch (err) {
      console.error('Error sending location request:', err);
      setError(err instanceof Error ? err.message : 'Failed to send location request');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (sending) return;
        onOpenChange(nextOpen);
        if (!nextOpen) handleReset();
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-primary/12 text-primary">
              <MapPin aria-hidden="true" className="size-4" />
            </span>
            Request location
          </DialogTitle>
          <DialogDescription>
            The contact gets a Send location button. Their reply shows up here as a map.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="max-h-[min(64dvh,560px)] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="location-request-body" className="text-foreground">
                Message <span className="text-red-500">*</span>
              </Label>
              <span
                className={cn(
                  'text-xs tabular-nums text-muted-foreground',
                  remaining < 0 && 'font-medium text-red-600 dark:text-red-400',
                )}
                aria-live="polite"
              >
                {body.length}/{LOCATION_REQUEST_BODY_MAX_LENGTH}
              </span>
            </div>
            <Textarea
              id="location-request-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Tell the contact why you need their location"
              aria-invalid={remaining < 0 || undefined}
              aria-describedby="location-request-hint"
              className="min-h-[104px] border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-base md:text-sm"
            />
            <div className="flex flex-wrap gap-1.5" aria-label="Suggested messages">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setBody(preset.text)}
                  aria-pressed={body === preset.text}
                  className={cn(
                    'min-h-9 touch-manipulation rounded-full border border-[var(--chat-border-strong)] px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 sm:min-h-8',
                    body === preset.text && 'border-primary/60 bg-primary/10 text-foreground',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <p id="location-request-hint" className="text-xs text-muted-foreground">
              Links are allowed. Name and address are only included if the contact chooses to share them.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
            <div className="rounded-lg bg-[var(--chat-canvas)] p-3 outline outline-1 [outline-color:var(--chat-border)]">
              <div className="ml-auto w-[min(17rem,100%)] overflow-hidden rounded-lg rounded-br-none bg-[var(--chat-bubble-outgoing)] shadow-sm">
                <p
                  className={cn(
                    'whitespace-pre-wrap break-words px-3 pb-1.5 pt-2 text-sm',
                    !trimmedBody && 'italic text-muted-foreground',
                  )}
                >
                  {trimmedBody || 'Your message appears here'}
                </p>
                <div className="flex h-10 items-center justify-center gap-1.5 border-t border-[var(--chat-border)] text-sm font-medium text-[var(--chat-check)]">
                  <MapPin aria-hidden="true" className="size-4" />
                  Send location
                </div>
              </div>
            </div>
          </div>
        </div>

        <Separator />

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="outline" className="h-11 sm:h-9" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground pointer-fine:sm:inline">⌘/Ctrl + Enter</span>
            <Button
              onClick={handleSend}
              disabled={!canSend}
              className="h-11 flex-1 bg-primary hover:bg-[var(--primary-hover)] sm:h-9 sm:flex-none"
            >
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send request
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
