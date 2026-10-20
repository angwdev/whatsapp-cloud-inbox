import { NextResponse } from 'next/server';
import { configurationErrorResponse, resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { whatsappClient } from '@/lib/whatsapp-client';
import { LOCATION_REQUEST_BODY_MAX_LENGTH, LOCATION_REQUEST_INTERACTIVE_TYPE } from '@/lib/inbox-data';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const to = typeof body?.to === 'string' ? body.to.trim() : '';
    const bodyText = typeof body?.body === 'string' ? body.body.trim() : '';
    const contextMessageId = typeof body?.contextMessageId === 'string'
      ? body.contextMessageId.trim() || undefined
      : undefined;

    if (!to || !bodyText) {
      return NextResponse.json(
        { error: 'Missing required fields: to, body' },
        { status: 400 }
      );
    }

    if (bodyText.length > LOCATION_REQUEST_BODY_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Body must be ${LOCATION_REQUEST_BODY_MAX_LENGTH} characters or fewer` },
        { status: 400 }
      );
    }

    const configuredPhoneNumber = await resolvePhoneNumberContext(
      typeof body?.phoneNumberId === 'string' ? body.phoneNumberId : undefined
    );
    const phoneNumberId = configuredPhoneNumber.phone_number_id;

    // Built as a raw payload: the SDK's sendInteractiveLocationRequest names the
    // action `location_request_message`, while the Cloud API expects `send_location`.
    const result = await whatsappClient.messages.sendInteractiveRaw({
      phoneNumberId,
      to,
      contextMessageId,
      interactive: {
        type: LOCATION_REQUEST_INTERACTIVE_TYPE,
        body: { text: bodyText },
        action: { name: 'send_location' }
      }
    });

    return NextResponse.json(
      typeof result === 'object' && result !== null
        ? { ...result, contextMessageId }
        : { result, contextMessageId }
    );
  } catch (error) {
    console.error('Error sending location request:', error);
    return configurationErrorResponse(error);
  }
}
