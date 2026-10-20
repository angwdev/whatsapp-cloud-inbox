import { NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api-errors';
import { EMOJI_PATTERN, FLOW_LIMITS } from '@/lib/flows';
import { resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { recipientFields } from '@/lib/recipient';
import { whatsappClient } from '@/lib/whatsapp-client';

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((value) => value || undefined);

const flowMessageSchema = z.object({
  to: z.string().trim().min(1),
  phoneNumberId: z.string().optional(),
  flowId: z.string().trim().min(1),
  cta: z.string().trim().min(1).max(FLOW_LIMITS.cta)
    .refine((value) => !EMOJI_PATTERN.test(value), 'The button text cannot contain emoji'),
  body: z.string().trim().min(1).max(FLOW_LIMITS.body),
  header: optionalText(FLOW_LIMITS.header),
  footer: optionalText(FLOW_LIMITS.footer),
  screen: optionalText(200),
  draft: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const parsed = flowMessageSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ') },
        { status: 400 }
      );
    }

    const input = parsed.data;
    const configuredPhoneNumber = await resolvePhoneNumberContext(input.phoneNumberId);

    // Raw payload: the SDK's sendInteractiveFlow caps the CTA at 20 characters (Meta allows 30)
    // and can't send drafts. Keys stay snake_case so the SDK's case conversion leaves them alone.
    const result = await whatsappClient.messages.sendInteractiveRaw({
      phoneNumberId: configuredPhoneNumber.phone_number_id,
      ...recipientFields(input.to),
      interactive: {
        type: 'flow',
        ...(input.header && { header: { type: 'text', text: input.header } }),
        body: { text: input.body },
        ...(input.footer && { footer: { text: input.footer } }),
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_id: input.flowId,
            flow_cta: input.cta,
            flow_token: `inbox_${Date.now().toString(36)}`,
            flow_action: 'navigate',
            ...(input.screen && { flow_action_payload: { screen: input.screen } }),
            ...(input.draft && { mode: 'draft' }),
          },
        },
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error sending flow message:', error);
    return errorResponse(error);
  }
}
