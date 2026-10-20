'use client';

import { useSyncExternalStore } from 'react';
import { CheckCheck } from 'lucide-react';
import { readReceiptsEnabled, setReadReceiptsEnabled, subscribeToPreferences } from '@/lib/preferences';

/** Per-browser messaging preferences shown on the settings page. */
export function MessagingPreferences() {
  const readReceipts = useSyncExternalStore(subscribeToPreferences, readReceiptsEnabled, () => true);

  const toggle = () => setReadReceiptsEnabled(!readReceipts);

  return (
    <section className="mb-6 rounded-lg border border-[var(--chat-border-strong)] bg-[var(--chat-surface)]">
      <h2 className="border-b border-[var(--chat-border)] px-4 py-3 text-sm font-semibold">Messaging</h2>
      <div className="flex items-start justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 gap-3">
          <CheckCheck aria-hidden="true" className="mt-0.5 size-4 flex-shrink-0 text-[var(--chat-tick-read)]" />
          <div>
            <p id="read-receipts-label" className="text-sm font-medium">Send read receipts and typing indicator</p>
            <p id="read-receipts-hint" className="mt-0.5 text-xs text-muted-foreground">
              Opening a conversation shows blue ticks to the contact, and typing shows them “typing…”. Applies to this browser.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={readReceipts}
          aria-labelledby="read-receipts-label"
          aria-describedby="read-receipts-hint"
          onClick={toggle}
          className="relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 aria-checked:bg-primary bg-muted-foreground/30"
        >
          <span className="inline-block size-5 translate-x-1 rounded-full bg-white shadow transition-transform duration-200 [[aria-checked=true]_&]:translate-x-6" />
        </button>
      </div>
    </section>
  );
}
