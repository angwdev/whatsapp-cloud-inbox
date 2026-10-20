import { NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api-errors';
import { resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { whatsappClient } from '@/lib/whatsapp-client';

const readSchema = z.object({
  messageId: z.string().trim().min(1),
  phoneNumberId: z.string().optional(),
  /** Also show "typing…" to the contact, for up to 25 seconds or until you reply. */
  typing: z.boolean().optional(),
});

/**
 * Marks an inbound message (and every earlier one) as read, which shows blue
 * ticks to the contact, optionally with a typing indicator.
 */
export async function POST(request: Request) {
  try {
    const parsed = readSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'messageId is required' }, { status: 400 });
    }

    const { messageId, phoneNumberId: requestedPhoneNumberId, typing } = parsed.data;
    const phoneNumber = await resolvePhoneNumberContext(requestedPhoneNumberId);

    await whatsappClient.messages.markRead({
      phoneNumberId: phoneNumber.phone_number_id,
      messageId,
      ...(typing && { typingIndicator: { type: 'text' } }),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error marking message as read:', error);
    return errorResponse(error);
  }
}
