import { isRealtimeConfigured, subscribe } from '@/lib/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * Server-sent events for open inbox tabs. Each event names what changed
 * (conversation, message, event type); the tab refetches the data itself.
 */
export async function GET(request: Request) {
  if (!isRealtimeConfigured()) {
    return Response.json({ error: 'Realtime updates are not configured' }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      // Tell EventSource how long to wait before reconnecting.
      send('retry: 5000\n: connected\n\n');

      const unsubscribe = subscribe((event) => send(`event: inbox\ndata: ${JSON.stringify(event)}\n\n`));
      // Comments keep proxies (Traefik, load balancers) from closing an idle stream.
      const heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_INTERVAL_MS);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      request.signal.addEventListener('abort', () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Stops nginx-style proxies from buffering the stream.
      'X-Accel-Buffering': 'no',
    },
  });
}
