import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { MessageTemplate } from '@kapso/whatsapp-cloud-api';
import { errorResponse } from '@/lib/api-errors';
import { resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { whatsappClient } from '@/lib/whatsapp-client';

const CACHE_TTL_MS = 10 * 60_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

type TemplateCacheEntry = {
  data: MessageTemplate[];
  fetchedAt: number;
  /** More approved templates exist than MAX_PAGES * PAGE_SIZE. */
  truncated: boolean;
};

// Per-WABA cache shared by requests handled in this server instance.
const templateCache = new Map<string, TemplateCacheEntry>();
const inFlight = new Map<string, Promise<TemplateCacheEntry>>();

const querySchema = z.object({
  phoneNumberId: z.string().trim().min(1).optional(),
  refresh: z.enum(['true', 'false', '1', '0']).optional(),
});

async function fetchApprovedTemplates(businessAccountId: string): Promise<TemplateCacheEntry> {
  const data: MessageTemplate[] = [];
  let after: string | undefined;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await whatsappClient.templates.list({
      businessAccountId,
      status: 'APPROVED',
      limit: PAGE_SIZE,
      ...(after && { after }),
    });
    data.push(...response.data);

    const nextCursor = response.paging?.cursors?.after ?? undefined;
    // Graph omits `next` on the last page; fall back to a full page for proxies that drop it.
    const hasMore = Boolean(nextCursor) && nextCursor !== after && response.data.length > 0 &&
      (Boolean(response.paging?.next) || response.data.length >= PAGE_SIZE);
    if (!hasMore) break;
    if (page === MAX_PAGES - 1) {
      truncated = true;
      break;
    }
    after = nextCursor;
  }

  // Graph filters by status already; this guards against proxies that ignore the filter.
  return {
    data: data.filter((template) => !template.status || template.status === 'APPROVED'),
    fetchedAt: Date.now(),
    truncated,
  };
}

function loadTemplates(businessAccountId: string, refresh: boolean): Promise<TemplateCacheEntry> {
  const cached = templateCache.get(businessAccountId);
  if (!refresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return Promise.resolve(cached);
  }

  const pending = inFlight.get(businessAccountId);
  if (pending) return pending;

  const request = fetchApprovedTemplates(businessAccountId)
    .then((entry) => {
      templateCache.set(businessAccountId, entry);
      return entry;
    })
    .finally(() => {
      inFlight.delete(businessAccountId);
    });
  inFlight.set(businessAccountId, request);
  return request;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      phoneNumberId: searchParams.get('phoneNumberId') || undefined,
      refresh: searchParams.get('refresh') || undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`).join('; ') },
        { status: 400 }
      );
    }

    const phoneNumber = await resolvePhoneNumberContext(parsed.data.phoneNumberId);
    const wabaId = phoneNumber.business_account_id || process.env.WABA_ID;

    if (!wabaId) {
      return NextResponse.json(
        { error: 'WABA_ID not configured' },
        { status: 500 }
      );
    }

    const refresh = parsed.data.refresh === 'true' || parsed.data.refresh === '1';
    const entry = await loadTemplates(wabaId, refresh);

    return NextResponse.json({
      data: entry.data,
      fetchedAt: new Date(entry.fetchedAt).toISOString(),
      truncated: entry.truncated,
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    return errorResponse(error);
  }
}
