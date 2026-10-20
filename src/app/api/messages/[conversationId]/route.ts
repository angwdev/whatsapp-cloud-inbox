import { NextResponse } from 'next/server';
import { buildKapsoFields, type MetaMessage } from '@kapso/whatsapp-cloud-api';
import { errorResponse } from '@/lib/api-errors';
import { resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { MESSAGE_FIELDS, transformMessage } from '@/lib/message-transform';
import { whatsappClient } from '@/lib/whatsapp-client';

const CURSOR_PATTERN = /^[\w=+/-]{1,512}$/;

function readCursor(value: string | null): string | undefined {
  return value && CURSOR_PATTERN.test(value) ? value : undefined;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
  try {
    const { searchParams } = new URL(request.url);
    const parsedLimit = Number.parseInt(searchParams.get('limit') ?? '', 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 50;
    const phoneNumber = await resolvePhoneNumberContext(searchParams.get('phoneNumberId') ?? undefined);
    const phoneNumberId = phoneNumber.phone_number_id;

    const response = await whatsappClient.messages.listByConversation({
      phoneNumberId,
      conversationId,
      limit,
      after: readCursor(searchParams.get('after')),
      before: readCursor(searchParams.get('before')),
      fields: buildKapsoFields(MESSAGE_FIELDS),
    });

    return NextResponse.json({
      data: response.data.map((message: MetaMessage) => transformMessage(message, phoneNumberId)),
      paging: {
        // History comes newest first, so `after` pages towards older messages.
        olderCursor: response.paging?.next ? response.paging.cursors?.after ?? null : null,
      },
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    return errorResponse(error);
  }
}
