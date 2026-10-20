import { NextResponse } from 'next/server';
import { z } from 'zod';
import { BadRequestError, errorResponse } from '@/lib/api-errors';
import { resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { recipientFields } from '@/lib/recipient';
import { whatsappClient } from '@/lib/whatsapp-client';

// Cloud API limits for interactive messages. Mirrored in src/components/interactive-message-dialog.tsx.
const LIMITS = {
  header: 60,
  footer: 60,
  buttonsBody: 1024,
  listBody: 4096,
  ctaBody: 1024,
  maxButtons: 3,
  buttonTitle: 20,
  buttonId: 256,
  listButton: 20,
  maxSections: 10,
  maxRows: 10,
  sectionTitle: 24,
  rowTitle: 24,
  rowDescription: 72,
  rowId: 200,
  ctaDisplayText: 20,
  url: 2000,
} as const;

const requiredText = (label: string, max: number) =>
  z.string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);

const optionalText = (label: string, max: number) =>
  z.string({ error: `${label} must be text` })
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`)
    .nullish()
    .transform((value) => value || undefined);

const optionalId = (max: number) =>
  z.string({ error: 'ID must be text' })
    .trim()
    .max(max, `ID must be ${max} characters or fewer`)
    .nullish()
    .transform((value) => value || undefined);

function isHttpsUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.includes('.') && !url.hostname.endsWith('.');
  } catch {
    return false;
  }
}

/** Indexes of items whose key already appeared earlier in the list. */
function duplicateIndexes<T>(items: T[], key: (item: T) => string | undefined): number[] {
  const seen = new Set<string>();
  const duplicates: number[] = [];
  items.forEach((item, index) => {
    const value = key(item);
    if (value === undefined) return;
    if (seen.has(value)) duplicates.push(index);
    seen.add(value);
  });
  return duplicates;
}

const sharedFields = {
  phoneNumber: z.string({ error: 'phoneNumber is required' }).trim().min(1, 'phoneNumber is required'),
  phoneNumberId: z.string().trim().nullish().transform((value) => value || undefined),
  conversationId: z.string().nullish(),
  contextMessageId: z.string().trim().nullish().transform((value) => value || undefined),
  header: optionalText('Header', LIMITS.header),
  footer: optionalText('Footer', LIMITS.footer),
};

const buttonsSchema = z.object({
  ...sharedFields,
  kind: z.literal('buttons'),
  body: requiredText('Body', LIMITS.buttonsBody),
  buttons: z.array(
    z.object({
      id: optionalId(LIMITS.buttonId),
      title: requiredText('Title', LIMITS.buttonTitle),
    }),
    { error: 'buttons must be a list' }
  )
    .min(1, 'Add at least one button')
    .max(LIMITS.maxButtons, `Up to ${LIMITS.maxButtons} buttons are allowed`),
}).superRefine((value, ctx) => {
  for (const index of duplicateIndexes(value.buttons, (button) => button.title.toLowerCase())) {
    ctx.addIssue({ code: 'custom', path: ['buttons', index, 'title'], message: 'Title must be unique' });
  }
  for (const index of duplicateIndexes(value.buttons, (button) => button.id)) {
    ctx.addIssue({ code: 'custom', path: ['buttons', index, 'id'], message: 'ID must be unique' });
  }
});

const listSchema = z.object({
  ...sharedFields,
  kind: z.literal('list'),
  body: requiredText('Body', LIMITS.listBody),
  buttonText: requiredText('List button label', LIMITS.listButton),
  sections: z.array(
    z.object({
      title: optionalText('Title', LIMITS.sectionTitle),
      rows: z.array(
        z.object({
          id: optionalId(LIMITS.rowId),
          title: requiredText('Title', LIMITS.rowTitle),
          description: optionalText('Description', LIMITS.rowDescription),
        }),
        { error: 'rows must be a list' }
      ).min(1, 'Add at least one row'),
    }),
    { error: 'sections must be a list' }
  )
    .min(1, 'Add at least one section')
    .max(LIMITS.maxSections, `Up to ${LIMITS.maxSections} sections are allowed`),
}).superRefine((value, ctx) => {
  const totalRows = value.sections.reduce((sum, section) => sum + section.rows.length, 0);
  if (totalRows > LIMITS.maxRows) {
    ctx.addIssue({
      code: 'custom',
      path: ['sections'],
      message: `A list can have at most ${LIMITS.maxRows} rows in total (got ${totalRows})`,
    });
  }

  if (value.sections.length > 1) {
    value.sections.forEach((section, index) => {
      if (!section.title) {
        ctx.addIssue({
          code: 'custom',
          path: ['sections', index, 'title'],
          message: 'Title is required when the list has more than one section',
        });
      }
    });
  }

  const rows = value.sections.flatMap((section, sectionIndex) =>
    section.rows.map((row, rowIndex) => ({ id: row.id, sectionIndex, rowIndex }))
  );
  for (const index of duplicateIndexes(rows, (row) => row.id)) {
    ctx.addIssue({
      code: 'custom',
      path: ['sections', rows[index].sectionIndex, 'rows', rows[index].rowIndex, 'id'],
      message: 'ID must be unique across the list',
    });
  }
});

const ctaUrlSchema = z.object({
  ...sharedFields,
  kind: z.literal('cta_url'),
  body: requiredText('Body', LIMITS.ctaBody),
  displayText: requiredText('Button text', LIMITS.ctaDisplayText),
  url: requiredText('URL', LIMITS.url).refine(isHttpsUrl, 'URL must be a valid https:// link'),
});

const interactiveMessageSchema = z.preprocess(
  (input) => {
    // Older clients send `{ header, body, buttons }` without a kind.
    if (input && typeof input === 'object' && !('kind' in input) && 'buttons' in input) {
      return { ...input, kind: 'buttons' };
    }
    return input;
  },
  z.discriminatedUnion('kind', [buttonsSchema, listSchema, ctaUrlSchema], {
    error: 'kind must be "buttons", "list" or "cta_url"',
  })
);

/** "Section 2, row 3" for nested issues, empty for top-level fields. */
function issueLocation(path: PropertyKey[]): string {
  const labels: Record<string, string> = { buttons: 'Button', sections: 'Section', rows: 'row' };
  const parts: string[] = [];
  path.forEach((key, index) => {
    const next = path[index + 1];
    if (typeof key === 'string' && typeof next === 'number' && labels[key]) {
      parts.push(`${labels[key]} ${next + 1}`);
    }
  });
  return parts.join(', ');
}

function describeIssues(error: z.ZodError): string {
  const messages = error.issues.map((issue) => {
    const location = issueLocation(issue.path);
    return location ? `${location}: ${issue.message}` : issue.message;
  });
  return Array.from(new Set(messages)).join('; ');
}

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json().catch(() => null);
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      throw new BadRequestError('Request body must be a JSON object');
    }

    const parsed = interactiveMessageSchema.safeParse(json);
    if (!parsed.success) {
      throw new BadRequestError(describeIssues(parsed.error));
    }

    const input = parsed.data;
    const configuredPhoneNumber = await resolvePhoneNumberContext(input.phoneNumberId);
    const base = {
      phoneNumberId: configuredPhoneNumber.phone_number_id,
      ...recipientFields(input.phoneNumber),
      contextMessageId: input.contextMessageId,
      header: input.header ? { type: 'text' as const, text: input.header } : undefined,
      bodyText: input.body,
      footerText: input.footer,
    };

    let result;
    switch (input.kind) {
      case 'buttons':
        result = await whatsappClient.messages.sendInteractiveButtons({
          ...base,
          buttons: input.buttons.map((button) => ({
            id: button.id ?? crypto.randomUUID(),
            title: button.title,
          })),
        });
        break;
      case 'list':
        result = await whatsappClient.messages.sendInteractiveList({
          ...base,
          buttonText: input.buttonText,
          sections: input.sections.map((section) => ({
            title: section.title,
            rows: section.rows.map((row) => ({
              id: row.id ?? crypto.randomUUID(),
              title: row.title,
              description: row.description,
            })),
          })),
        });
        break;
      case 'cta_url':
        result = await whatsappClient.messages.sendInteractiveCtaUrl({
          ...base,
          parameters: { displayText: input.displayText, url: input.url },
        });
        break;
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error sending interactive message:', error);
    return errorResponse(error);
  }
}
