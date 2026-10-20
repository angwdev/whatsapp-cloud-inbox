import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api-errors';
import { isSendableFlowStatus, type FlowSummary } from '@/lib/flows';
import { resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { whatsappClient } from '@/lib/whatsapp-client';

const FLOWS_CACHE_TTL_MS = 60_000;
const MAX_PAGES = 5;

type FlowListResponse = {
  data?: Array<{ id?: unknown; name?: unknown; status?: unknown; categories?: unknown }>;
  paging?: { cursors?: { after?: string }; next?: string };
};

const flowsCache = new Map<string, { expiresAt: number; data: FlowSummary[] }>();

async function listFlows(wabaId: string): Promise<FlowSummary[]> {
  const cached = flowsCache.get(wabaId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const flows: FlowSummary[] = [];
  let after: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await whatsappClient.flows.list<FlowListResponse>({ wabaId, limit: 100, after });

    for (const flow of response.data ?? []) {
      if (typeof flow.id !== 'string' || typeof flow.name !== 'string') continue;
      flows.push({
        id: flow.id,
        name: flow.name,
        status: typeof flow.status === 'string' ? flow.status : 'DRAFT',
        categories: Array.isArray(flow.categories)
          ? flow.categories.filter((category): category is string => typeof category === 'string')
          : [],
      });
    }

    after = response.paging?.next ? response.paging.cursors?.after : undefined;
    if (!after) break;
  }

  flowsCache.set(wabaId, { expiresAt: Date.now() + FLOWS_CACHE_TTL_MS, data: flows });
  return flows;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const phoneNumber = await resolvePhoneNumberContext(searchParams.get('phoneNumberId') ?? undefined);
    const wabaId = phoneNumber.business_account_id || process.env.WABA_ID;

    if (!wabaId) {
      return NextResponse.json({ error: 'WABA_ID not configured' }, { status: 500 });
    }

    const flows = await listFlows(wabaId);

    return NextResponse.json(
      { data: flows.filter((flow) => isSendableFlowStatus(flow.status)) },
      { headers: { 'Cache-Control': 'private, max-age=30' } }
    );
  } catch (error) {
    console.error('Error fetching flows:', error);
    return errorResponse(error);
  }
}
