import type { ApiErrorBody } from '@/lib/api-errors';

/** An error response from one of the app's API routes. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly category?: string;
  readonly retry?: ApiErrorBody['retry'];
  readonly retryAfterMs?: number;

  constructor(status: number, body: Partial<ApiErrorBody> | null, fallback: string) {
    super(body?.error || fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.code;
    this.category = body?.category;
    this.retry = body?.retry;
    this.retryAfterMs = body?.retryAfterMs;
  }

  /** Sending the same request again can succeed without changes. */
  get isRetryable(): boolean {
    return this.retry === 'retry' || this.retry === 'retry_after' || this.status === 429 || this.status >= 500;
  }
}

type ApiFetchInit = Omit<RequestInit, 'body'> & {
  /** Objects are sent as JSON; FormData and strings are sent as-is. */
  body?: BodyInit | Record<string, unknown> | null;
  errorMessage?: string;
};

export async function apiFetch<T>(input: string, { body, errorMessage, headers, ...init }: ApiFetchInit = {}): Promise<T> {
  const isJsonBody = body !== undefined && body !== null && typeof body === 'object' &&
    !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof URLSearchParams) &&
    !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body);

  const response = await fetch(input, {
    ...init,
    headers: isJsonBody ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: isJsonBody ? JSON.stringify(body) : (body as BodyInit | null | undefined),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(response.status, data, errorMessage ?? `Request failed (${response.status})`);
  }

  return data as T;
}

export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
