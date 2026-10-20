import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { type InboxEvent, markDelivery, publish } from '@/lib/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readId(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = value[key];
  return typeof candidate === 'string' && candidate ? candidate : undefined;
}

/** Kapso signs the exact body with HMAC-SHA256 and sends the hex digest, without a `sha256=` prefix. */
function hasValidSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'), 'utf8');
  const received = Buffer.from(signature.trim().replace(/^sha256=/, ''), 'utf8');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function toInboxEvent(eventName: string, payload: unknown): InboxEvent {
  return {
    event: eventName,
    phoneNumberId: readId(payload, 'phone_number_id') ?? readId(isRecord(payload) ? payload.conversation : undefined, 'phone_number_id'),
    conversationId: readId(isRecord(payload) ? payload.conversation : undefined, 'id'),
    messageId: readId(isRecord(payload) ? payload.message : undefined, 'id'),
    at: Date.now(),
  };
}

/**
 * Receives Kapso phone-number webhooks (payload v2) and tells open inbox tabs
 * what changed, so they refetch right away instead of waiting for the next poll.
 */
export async function POST(request: Request) {
  const secret = process.env.KAPSO_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Webhooks are not configured' }, { status: 404 });
  }

  const rawBody = await request.text();
  if (!hasValidSignature(rawBody, request.headers.get('x-webhook-signature'), secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Acknowledge retries of a delivery we already handled.
  if (!markDelivery(request.headers.get('x-idempotency-key'))) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventName = request.headers.get('x-webhook-event')
    ?? (isRecord(body) && typeof body.type === 'string' ? body.type : 'unknown');
  const isBatch = request.headers.get('x-webhook-batch') === 'true' || (isRecord(body) && body.batch === true);
  const payloads = isBatch && isRecord(body) && Array.isArray(body.data) ? body.data : [body];

  publish(payloads.map((payload) => toInboxEvent(eventName, payload)));

  return NextResponse.json({ received: true });
}
