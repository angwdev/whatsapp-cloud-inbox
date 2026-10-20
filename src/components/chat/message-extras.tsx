'use client';

import { useState } from 'react';
import { AlertTriangle, Braces, Check, ClipboardList, Copy, CornerDownRight, Mail, Phone, ShoppingBag, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { InteractiveReply, InteractiveSummary, MessageError, OrderSummary, SharedContact } from '@/lib/inbox-data';
import { describeWhatsAppError } from '@/lib/whatsapp-errors';

export function SharedContactsCard({ contacts }: { contacts: SharedContact[] }) {
  return (
    <div className="mb-1 w-[min(17rem,calc(100vw-7rem))] max-w-full space-y-2">
      {contacts.map((contact, index) => (
        <div key={`${contact.name}:${index}`} className="overflow-hidden rounded-md border border-[var(--chat-media-outline)] bg-[var(--chat-surface)]">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <span className="flex size-10 flex-shrink-0 items-center justify-center rounded-full bg-[var(--chat-avatar)] text-muted-foreground">
              <UserRound aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{contact.name}</p>
              {contact.organization && <p className="truncate text-xs text-muted-foreground">{contact.organization}</p>}
            </div>
          </div>
          {(contact.phones.length > 0 || contact.emails.length > 0) && (
            <ul className="border-t border-[var(--chat-border)]">
              {contact.phones.map((phone) => (
                <li key={phone.phone}>
                  <a
                    href={`tel:${phone.phone.replace(/[^\d+]/g, '')}`}
                    className="flex min-h-10 items-center gap-2 px-3 text-sm text-primary transition-colors hover:bg-[var(--chat-hover)]"
                  >
                    <Phone aria-hidden="true" className="size-3.5" />
                    <span className="truncate tabular-nums">{phone.phone}</span>
                    {phone.type && <span className="ml-auto text-[11px] uppercase text-muted-foreground">{phone.type}</span>}
                  </a>
                </li>
              ))}
              {contact.emails.map((email) => (
                <li key={email}>
                  <a href={`mailto:${email}`} className="flex min-h-10 items-center gap-2 px-3 text-sm text-primary transition-colors hover:bg-[var(--chat-hover)]">
                    <Mail aria-hidden="true" className="size-3.5" />
                    <span className="truncate">{email}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

const REPLY_LABELS: Record<InteractiveReply['kind'], string> = {
  button: 'Tapped a button',
  list: 'Picked from a list',
  template_button: 'Tapped a template button',
};

export function InteractiveReplyChip({ reply }: { reply: InteractiveReply }) {
  return (
    <div className="mb-1">
      <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <CornerDownRight aria-hidden="true" className="size-3" />
        {REPLY_LABELS[reply.kind]}
      </p>
      <p className="inline-flex max-w-full items-center rounded-full border border-[var(--chat-check)]/40 bg-[var(--chat-check)]/10 px-3 py-1 text-sm font-medium text-foreground">
        <span className="truncate">{reply.title}</span>
      </p>
      {reply.description && <p className="mt-1 text-xs text-muted-foreground">{reply.description}</p>}
    </div>
  );
}

/** The buttons an outbound interactive message showed, as the contact saw them. */
export function InteractiveSummaryFooter({ summary }: { summary: InteractiveSummary }) {
  const labels = summary.buttons?.length ? summary.buttons : summary.cta ? [summary.cta] : [];
  if (labels.length === 0) return null;

  return (
    <div className="-mx-3 -mb-2 mt-2 divide-y divide-[var(--chat-border)] border-t border-[var(--chat-border)]">
      {labels.map((label, index) => (
        <div key={`${label}:${index}`} aria-hidden="true" className="flex h-10 items-center justify-center px-3 text-sm font-medium text-[var(--chat-check)]">
          <span className="truncate">{label}</span>
        </div>
      ))}
    </div>
  );
}

function formatPrice(price: number, currency?: string): string {
  try {
    return currency ? new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(price) : String(price);
  } catch {
    return `${price} ${currency ?? ''}`.trim();
  }
}

export function OrderCard({ order }: { order: OrderSummary }) {
  const currency = order.items.find((item) => item.currency)?.currency;
  const total = order.items.reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0);
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="mb-1 w-[min(17rem,calc(100vw-7rem))] max-w-full overflow-hidden rounded-md border border-[var(--chat-media-outline)] bg-[var(--chat-surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--chat-border)] px-3 py-2">
        <ShoppingBag aria-hidden="true" className="size-4 text-primary" />
        <p className="text-sm font-medium">Order · {itemCount} item{itemCount === 1 ? '' : 's'}</p>
      </div>
      <ul className="divide-y divide-[var(--chat-border)] text-sm">
        {order.items.map((item) => (
          <li key={item.productId} className="flex items-center gap-2 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{item.productId}</span>
            <span className="tabular-nums">×{item.quantity}</span>
            {item.price !== undefined && <span className="tabular-nums">{formatPrice(item.price * item.quantity, item.currency)}</span>}
          </li>
        ))}
      </ul>
      {total > 0 && (
        <div className="flex justify-between border-t border-[var(--chat-border)] px-3 py-2 text-sm font-medium">
          <span>Total</span>
          <span className="tabular-nums">{formatPrice(total, currency)}</span>
        </div>
      )}
      {order.text && <p className="border-t border-[var(--chat-border)] px-3 py-2 text-sm">{order.text}</p>}
    </div>
  );
}

const IGNORED_FLOW_KEYS = new Set(['flow_token', 'flowToken']);

/** `screen_0_First_name_0` → `First name`, `appointmentDate` → `Appointment date`. */
function humanizeFlowKey(key: string): string {
  const words = key
    .replace(/^screen_?\d+_?/i, '')
    .replace(/_\d+$/, '')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

function formatFlowValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(formatFlowValue).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      return text.length > 10 ? date.toLocaleString() : date.toLocaleDateString(undefined, { timeZone: 'UTC' });
    }
  }
  return text;
}

export function FlowResponseCard({ response }: { response: Record<string, unknown> }) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const entries = Object.entries(response).filter(([key]) => !IGNORED_FLOW_KEYS.has(key));
  const raw = JSON.stringify(response, null, 2);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      // The raw JSON stays visible to copy by hand.
    }
  };

  return (
    <div className="mb-1 w-[min(19rem,calc(100vw-7rem))] max-w-full overflow-hidden rounded-md border border-[var(--chat-media-outline)] bg-[var(--chat-surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--chat-border)] px-3 py-2">
        <ClipboardList aria-hidden="true" className="size-4 text-primary" />
        <p className="flex-1 text-sm font-medium">Form response</p>
        <button
          type="button"
          onClick={() => setShowRaw((value) => !value)}
          aria-pressed={showRaw}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--chat-hover)] hover:text-foreground"
          aria-label={showRaw ? 'Show answers' : 'Show raw JSON'}
          title={showRaw ? 'Show answers' : 'Show raw JSON'}
        >
          <Braces aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          onClick={copy}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--chat-hover)] hover:text-foreground"
          aria-label="Copy response as JSON"
          title="Copy JSON"
        >
          {copied ? <Check aria-hidden="true" className="size-4 text-primary" /> : <Copy aria-hidden="true" className="size-4" />}
        </button>
      </div>
      {showRaw ? (
        <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-[11px] leading-4">{raw}</pre>
      ) : entries.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">Form submitted</p>
      ) : (
        <dl className="divide-y divide-[var(--chat-border)]">
          {entries.map(([key, value]) => (
            <div key={key} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-3 py-1.5 text-sm">
              <dt className="truncate text-muted-foreground" title={key}>{humanizeFlowKey(key)}</dt>
              <dd className="break-words font-medium">{formatFlowValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function MessageErrorNotice({ errors, tone = 'failed' }: { errors: MessageError[]; tone?: 'failed' | 'unsupported' }) {
  const first = errors[0];
  const description = describeWhatsAppError(first?.code, first?.message || first?.title);

  return (
    <p className={cn('mt-1 flex items-start gap-1.5 text-xs', tone === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 flex-shrink-0" />
      <span>
        {description}
        {first?.code !== undefined && <span className="ml-1 opacity-70">({first.code})</span>}
      </span>
    </p>
  );
}
