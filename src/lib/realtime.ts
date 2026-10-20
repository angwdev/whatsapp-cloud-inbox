import 'server-only';
import { EventEmitter } from 'node:events';

/** What the browser needs to know to refetch; no message content leaves the server this way. */
export type InboxEvent = {
  event: string;
  phoneNumberId?: string;
  conversationId?: string;
  messageId?: string;
  at: number;
};

type RealtimeHub = {
  emitter: EventEmitter;
  /** Recent idempotency keys, so Kapso's retries don't fan out twice. */
  seenDeliveries: Map<string, number>;
  lastWebhookAt: number;
};

const SEEN_DELIVERY_TTL_MS = 10 * 60_000;

// One hub per server process; kept on globalThis so dev hot reloads don't orphan listeners.
// Several replicas would need a shared broker (e.g. Redis pub/sub) instead.
const globalHub = globalThis as typeof globalThis & { __inboxRealtimeHub?: RealtimeHub };

function hub(): RealtimeHub {
  if (!globalHub.__inboxRealtimeHub) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    globalHub.__inboxRealtimeHub = { emitter, seenDeliveries: new Map(), lastWebhookAt: 0 };
  }
  return globalHub.__inboxRealtimeHub;
}

export function isRealtimeConfigured(): boolean {
  return Boolean(process.env.KAPSO_WEBHOOK_SECRET);
}

export function lastWebhookAt(): number {
  return hub().lastWebhookAt;
}

/** Returns false when this delivery was already handled. */
export function markDelivery(key: string | null): boolean {
  const { seenDeliveries } = hub();
  const now = Date.now();

  for (const [seenKey, seenAt] of seenDeliveries) {
    if (now - seenAt < SEEN_DELIVERY_TTL_MS) break;
    seenDeliveries.delete(seenKey);
  }

  if (!key) return true;
  if (seenDeliveries.has(key)) return false;
  seenDeliveries.set(key, now);
  return true;
}

export function publish(events: InboxEvent[]) {
  const state = hub();
  state.lastWebhookAt = Date.now();
  for (const event of events) state.emitter.emit('event', event);
}

export function subscribe(listener: (event: InboxEvent) => void): () => void {
  const { emitter } = hub();
  emitter.on('event', listener);
  return () => emitter.off('event', listener);
}
