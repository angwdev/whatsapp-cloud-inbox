import { NextResponse } from 'next/server';
import type { SendMessageResponse } from '@kapso/whatsapp-cloud-api';
import { configurationErrorResponse, resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { getWhatsAppClient } from '@/lib/whatsapp-client';

const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

function isSingleEmoji(value: string): boolean {
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)];
  return graphemes.length === 1 && EMOJI_PATTERN.test(value);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const to = typeof body?.to === 'string' ? body.to.trim() : '';
    const messageId = typeof body?.messageId === 'string' ? body.messageId.trim() : '';
    // An empty emoji removes the reaction.
    const emoji = typeof body?.emoji === 'string' ? body.emoji.trim() : '';

    if (!to || !messageId) {
      return NextResponse.json(
        { error: 'Missing required fields: to, messageId' },
        { status: 400 }
      );
    }

    if (emoji && !isSingleEmoji(emoji)) {
      return NextResponse.json(
        { error: 'A reaction must be a single emoji' },
        { status: 400 }
      );
    }

    const configuredPhoneNumber = await resolvePhoneNumberContext(
      typeof body?.phoneNumberId === 'string' ? body.phoneNumberId : undefined
    );
    const phoneNumberId = configuredPhoneNumber.phone_number_id;

    // Sent directly rather than through messages.sendReaction, whose schema caps the
    // emoji at two UTF-16 units and rejects skin tones and other multi-part emoji.
    const result = await getWhatsAppClient().request<SendMessageResponse>('POST', `${phoneNumberId}/messages`, {
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'reaction',
        reaction: {
          message_id: messageId,
          emoji
        }
      },
      responseType: 'json'
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error sending reaction:', error);
    return configurationErrorResponse(error);
  }
}
