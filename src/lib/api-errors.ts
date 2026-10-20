import { GraphApiError, KapsoProxyRequiredError } from '@kapso/whatsapp-cloud-api';
import { describeWhatsAppError } from '@/lib/whatsapp-errors';

export class InboxConfigurationError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'InboxConfigurationError';
    this.status = status;
  }
}

/** A request the route rejects before calling WhatsApp. */
export class BadRequestError extends InboxConfigurationError {
  constructor(message: string) {
    super(message, 400);
    this.name = 'BadRequestError';
  }
}

export type ApiErrorBody = {
  error: string;
  /** WhatsApp / Graph error code, when the error came from the Cloud API. */
  code?: number;
  category?: string;
  retry?: 'retry' | 'retry_after' | 'fix_and_retry' | 'do_not_retry' | 'refresh_token';
  retryAfterMs?: number;
};

function upstreamStatus(httpStatus: number): number {
  if (httpStatus === 429) return 429;
  if (httpStatus >= 400 && httpStatus < 500) return httpStatus === 401 || httpStatus === 403 ? 502 : 400;
  // Upstream outages are a bad gateway from the browser's point of view.
  return 502;
}

/**
 * Turns any error thrown inside a route into a JSON response with a status the
 * browser can act on and a message an agent can read.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof GraphApiError) {
    const body: ApiErrorBody = {
      error: describeWhatsAppError(error.code, error.details || error.message),
      code: error.code,
      category: error.category,
      retry: error.retry.action,
      ...(error.retry.retryAfterMs !== undefined && { retryAfterMs: error.retry.retryAfterMs }),
    };
    const headers: HeadersInit = error.retry.retryAfterMs !== undefined
      ? { 'Retry-After': String(Math.ceil(error.retry.retryAfterMs / 1000)) }
      : {};

    return Response.json(body, { status: upstreamStatus(error.httpStatus), headers });
  }

  if (error instanceof InboxConfigurationError) {
    return Response.json({ error: error.message } satisfies ApiErrorBody, { status: error.status });
  }

  if (error instanceof KapsoProxyRequiredError) {
    return Response.json({ error: error.message } satisfies ApiErrorBody, { status: 501 });
  }

  // The SDK validates payloads before sending and throws "<context> validation failed: ...".
  if (error instanceof Error && /validation failed/i.test(error.message)) {
    return Response.json({ error: error.message, retry: 'fix_and_retry' } satisfies ApiErrorBody, { status: 400 });
  }

  const message = error instanceof Error ? error.message : 'Unexpected error';
  return Response.json({ error: message } satisfies ApiErrorBody, { status: 500 });
}
