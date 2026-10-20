import { NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api-errors';
import { resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { recipientFields } from '@/lib/recipient';
import { sanitizeTextParameter, TEMPLATE_LIMITS } from '@/lib/template-parser';
import { whatsappClient } from '@/lib/whatsapp-client';

type TemplatePayload = Parameters<(typeof whatsappClient.messages)['sendTemplate']>[0]['template'];

// Text parameters can't contain new lines, tabs or 5+ consecutive spaces (132018).
const textParameter = (max: number) => z.string()
  .transform(sanitizeTextParameter)
  .pipe(z.string().min(1, 'must not be empty').max(max));

const parameterName = z.string().trim().regex(/^[a-z0-9_]+$/i, 'must be letters, numbers or underscores').optional();
const httpsLink = z.url({ protocol: /^https$/, error: 'must be a public https:// link' });

const headerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: textParameter(TEMPLATE_LIMITS.headerText), parameterName }),
  z.object({ type: z.literal('image'), id: z.string().trim().min(1).optional(), link: httpsLink.optional() }),
  z.object({ type: z.literal('video'), id: z.string().trim().min(1).optional(), link: httpsLink.optional() }),
  z.object({
    type: z.literal('document'),
    id: z.string().trim().min(1).optional(),
    link: httpsLink.optional(),
    filename: z.string().trim().min(1).max(240).optional(),
  }),
  z.object({
    type: z.literal('location'),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    name: z.string().trim().max(TEMPLATE_LIMITS.locationText).optional(),
    address: z.string().trim().max(TEMPLATE_LIMITS.locationText).optional(),
  }),
]).superRefine((header, ctx) => {
  if (header.type === 'image' || header.type === 'video' || header.type === 'document') {
    if (Boolean(header.id) === Boolean(header.link)) {
      ctx.addIssue({ code: 'custom', message: 'provide either a media id or a link' });
    }
  }
});

const buttonIndex = z.number().int().min(0).max(9);
const buttonSchema = z.discriminatedUnion('subType', [
  z.object({ subType: z.literal('url'), index: buttonIndex, text: z.string().trim().min(1).max(TEMPLATE_LIMITS.url) }),
  z.object({ subType: z.literal('copy_code'), index: buttonIndex, couponCode: z.string().trim().min(1).max(TEMPLATE_LIMITS.couponCode) }),
  z.object({ subType: z.literal('flow'), index: buttonIndex, flowToken: z.string().trim().min(1).max(200).optional() }),
]);

const sendSchema = z.object({
  to: z.string().trim().min(1),
  phoneNumberId: z.string().optional(),
  templateName: z.string().trim().min(1),
  languageCode: z.string().trim().min(1),
  parameterFormat: z.enum(['NAMED', 'POSITIONAL']).default('POSITIONAL'),
  header: headerSchema.optional(),
  body: z.array(z.object({ text: textParameter(TEMPLATE_LIMITS.body), parameterName })).max(100).optional(),
  buttons: z.array(buttonSchema).max(10).optional(),
}).superRefine((input, ctx) => {
  if (input.parameterFormat !== 'NAMED') return;
  if (input.header?.type === 'text' && !input.header.parameterName) {
    ctx.addIssue({ code: 'custom', path: ['header', 'parameterName'], message: 'is required for named templates' });
  }
  input.body?.forEach((param, index) => {
    if (!param.parameterName) {
      ctx.addIssue({ code: 'custom', path: ['body', index, 'parameterName'], message: 'is required for named templates' });
    }
  });
});

type SendInput = z.infer<typeof sendSchema>;

/**
 * Builds Meta's `components` array directly: the SDK's buildTemplateSendPayload
 * strips `filename` from document headers. Keys are already snake_case, so the
 * SDK's deep case conversion leaves them alone.
 */
function buildComponents(input: SendInput): Array<{ type: string } & Record<string, unknown>> {
  const components: Array<{ type: string } & Record<string, unknown>> = [];
  const named = input.parameterFormat === 'NAMED';
  const { header } = input;

  if (header) {
    let parameter: Record<string, unknown>;
    switch (header.type) {
      case 'text':
        parameter = { type: 'text', text: header.text, ...(named && { parameter_name: header.parameterName }) };
        break;
      case 'location':
        parameter = {
          type: 'location',
          location: {
            latitude: header.latitude,
            longitude: header.longitude,
            ...(header.name && { name: header.name }),
            ...(header.address && { address: header.address }),
          },
        };
        break;
      default: {
        const media = header.id ? { id: header.id } : { link: header.link };
        const filename = header.type === 'document' ? header.filename : undefined;
        parameter = { type: header.type, [header.type]: { ...media, ...(filename && { filename }) } };
      }
    }
    components.push({ type: 'header', parameters: [parameter] });
  }

  if (input.body?.length) {
    components.push({
      type: 'body',
      // Positional parameters are matched by order; parameter_name is only for named templates.
      parameters: input.body.map((param) => ({
        type: 'text',
        text: param.text,
        ...(named && { parameter_name: param.parameterName }),
      })),
    });
  }

  for (const button of input.buttons ?? []) {
    const base = { type: 'button', index: String(button.index) };
    switch (button.subType) {
      case 'url':
        components.push({ ...base, sub_type: 'url', parameters: [{ type: 'text', text: button.text }] });
        break;
      case 'copy_code':
        components.push({ ...base, sub_type: 'copy_code', parameters: [{ type: 'coupon_code', coupon_code: button.couponCode }] });
        break;
      case 'flow':
        components.push({
          ...base,
          sub_type: 'flow',
          ...(button.flowToken && { parameters: [{ type: 'action', action: { flow_token: button.flowToken } }] }),
        });
        break;
    }
  }

  return components;
}

export async function POST(request: Request) {
  try {
    const parsed = sendSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ') },
        { status: 400 }
      );
    }

    const input = parsed.data;
    const phoneNumber = await resolvePhoneNumberContext(input.phoneNumberId);
    const components = buildComponents(input);

    const template: TemplatePayload = {
      name: input.templateName,
      language: { code: input.languageCode },
      ...(components.length > 0 && { components }),
    };

    const result = await whatsappClient.messages.sendTemplate({
      phoneNumberId: phoneNumber.phone_number_id,
      ...recipientFields(input.to),
      template,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error sending template:', error);
    return errorResponse(error);
  }
}
