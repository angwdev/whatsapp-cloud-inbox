'use client';

import { useId, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, ExternalLink, Link2, List, Loader2, MousePointerClick, Plus, Reply, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { apiFetch, errorMessage } from '@/lib/api-client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';

// Cloud API limits. Mirrored in src/app/api/messages/interactive/route.ts, which re-validates them.
const LIMITS = {
  header: 60,
  footer: 60,
  buttonsBody: 1024,
  listBody: 4096,
  ctaBody: 1024,
  maxButtons: 3,
  buttonTitle: 20,
  listButton: 20,
  maxSections: 10,
  maxRows: 10,
  sectionTitle: 24,
  rowTitle: 24,
  rowDescription: 72,
  ctaDisplayText: 20,
} as const;

type Mode = 'buttons' | 'list' | 'cta_url';

type ReplyButton = { id: string; title: string };
type ListRow = { id: string; title: string; description: string };
type ListSection = { id: string; title: string; rows: ListRow[] };

type FieldError = {
  message: string;
  /** Where the field is, for the summary line ("Button 2"). */
  label: string;
  /** Empty required fields only show their error once the field was left. */
  required?: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId?: string;
  phoneNumber?: string;
  phoneNumberId?: string;
  /** WhatsApp message id to send this as a reply to. */
  contextMessageId?: string;
  onMessageSent?: () => void | Promise<void>;
};

const MODES: Array<{ value: Mode; label: string; icon: typeof Reply; hint: string }> = [
  { value: 'buttons', label: 'Buttons', icon: Reply, hint: 'Up to 3 quick-reply buttons. The tapped button comes back as the reply.' },
  { value: 'list', label: 'List', icon: List, hint: 'A menu of up to 10 options, grouped in sections.' },
  { value: 'cta_url', label: 'Link', icon: Link2, hint: 'A single button that opens a website.' },
];

const fieldClassName = 'h-11 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-base focus-visible:ring-primary md:h-10 md:text-sm';

function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID only exists in secure contexts; a LAN dev server over plain http lacks it.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const newButton = (): ReplyButton => ({ id: newId(), title: '' });
const newRow = (): ListRow => ({ id: newId(), title: '', description: '' });
const newSection = (): ListSection => ({ id: newId(), title: '', rows: [newRow()] });

function isHttpsUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.includes('.') && !url.hostname.endsWith('.');
  } catch {
    return false;
  }
}

function CharacterCount({ value, max, className }: { value: string; max: number; className?: string }) {
  const over = value.length > max;
  return (
    <span
      className={cn('text-xs tabular-nums text-muted-foreground', over && 'font-medium text-red-600 dark:text-red-400', className)}
      aria-label={over ? `${value.length} of ${max} characters, ${value.length - max} over the limit` : `${value.length} of ${max} characters`}
    >
      {value.length}/{max}
    </span>
  );
}

function FieldMessage({ id, error }: { id: string; error?: FieldError }) {
  if (!error) return null;
  return <p id={id} className="text-xs text-red-600 dark:text-red-400">{error.message}</p>;
}

/** An input with its character counter inside, for the dense button and row editors. */
function CountedInput({ value, max, className, ...props }: ComponentProps<typeof Input> & { value: string; max: number }) {
  return (
    <div className="relative min-w-0 flex-1">
      <Input value={value} className={cn(fieldClassName, 'pr-14', className)} {...props} />
      <CharacterCount value={value} max={max} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
    </div>
  );
}

function FieldLabel({ htmlFor, children, required, value, max }: {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
  value?: string;
  max?: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <Label htmlFor={htmlFor} className="text-foreground">
        {children}
        {required ? <span className="text-red-500" aria-hidden="true">*</span> : <span className="font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {value !== undefined && max !== undefined && <CharacterCount value={value} max={max} />}
    </div>
  );
}

export function InteractiveMessageDialog({
  open,
  onOpenChange,
  conversationId,
  phoneNumber,
  phoneNumberId,
  contextMessageId,
  onMessageSent,
}: Props) {
  const uid = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [mode, setMode] = useState<Mode>('buttons');
  const [header, setHeader] = useState('');
  const [body, setBody] = useState('');
  const [footer, setFooter] = useState('');
  const [buttons, setButtons] = useState<ReplyButton[]>(() => [newButton()]);
  const [listButton, setListButton] = useState('');
  const [sections, setSections] = useState<ListSection[]>(() => [newSection()]);
  const [displayText, setDisplayText] = useState('');
  const [url, setUrl] = useState('');
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [listPreviewOpen, setListPreviewOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const fieldId = (key: string) => `${uid}-${key.replace(/[^a-zA-Z0-9-]/g, '-')}`;
  const touch = (key: string) => setTouched((current) => (current.has(key) ? current : new Set(current).add(key)));

  const totalRows = sections.reduce((sum, section) => sum + section.rows.length, 0);
  const rowsLeft = LIMITS.maxRows - totalRows;
  const bodyMax = mode === 'list' ? LIMITS.listBody : mode === 'cta_url' ? LIMITS.ctaBody : LIMITS.buttonsBody;

  // Every problem with the current mode, keyed by field. Send stays disabled while any exist.
  const errors = new Map<string, FieldError>();
  const check = (key: string, label: string, value: string, max: number, required: boolean, requiredMessage = 'Required') => {
    if (required && !value.trim()) errors.set(key, { message: requiredMessage, label, required: true });
    else if (value.length > max) errors.set(key, { message: `${value.length - max} characters over the ${max} limit`, label });
  };

  check('header', 'Header', header, LIMITS.header, false);
  check('body', 'Message', body, bodyMax, true, 'Add the message text');
  check('footer', 'Footer', footer, LIMITS.footer, false);

  if (mode === 'buttons') {
    const seenTitles = new Set<string>();
    buttons.forEach((button, index) => {
      const key = `button-${button.id}`;
      check(key, `Button ${index + 1}`, button.title, LIMITS.buttonTitle, true, 'Add a button title');
      const normalized = button.title.trim().toLowerCase();
      if (normalized && seenTitles.has(normalized) && !errors.has(key)) {
        errors.set(key, { message: 'Each button needs a different title', label: `Button ${index + 1}` });
      }
      if (normalized) seenTitles.add(normalized);
    });
  } else if (mode === 'list') {
    check('list-button', 'List button', listButton, LIMITS.listButton, true, 'Add the label of the button that opens the list');
    sections.forEach((section, sectionIndex) => {
      const sectionLabel = `Section ${sectionIndex + 1}`;
      check(`section-${section.id}`, sectionLabel, section.title, LIMITS.sectionTitle, sections.length > 1, 'Sections need a title when there is more than one');
      section.rows.forEach((row, rowIndex) => {
        const rowLabel = `${sectionLabel}, row ${rowIndex + 1}`;
        check(`row-${row.id}-title`, rowLabel, row.title, LIMITS.rowTitle, true, 'Add a row title');
        check(`row-${row.id}-description`, rowLabel, row.description, LIMITS.rowDescription, false);
      });
    });
    if (rowsLeft < 0) errors.set('rows', { message: `Lists can have ${LIMITS.maxRows} rows in total`, label: 'List' });
  } else {
    check('display-text', 'Button text', displayText, LIMITS.ctaDisplayText, true, 'Add the button text');
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      errors.set('url', { message: 'Add the link to open', label: 'URL', required: true });
    } else if (/^http:\/\//i.test(trimmedUrl)) {
      errors.set('url', { message: 'Use a secure https:// link', label: 'URL' });
    } else if (!isHttpsUrl(trimmedUrl)) {
      errors.set('url', { message: 'Enter a full link, like https://example.com', label: 'URL' });
    }
  }

  const visibleError = (key: string) => {
    const error = errors.get(key);
    return error && (!error.required || touched.has(key)) ? error : undefined;
  };
  const invalidProps = (key: string) => {
    const error = visibleError(key);
    return {
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? `${fieldId(key)}-error` : undefined,
      onBlur: () => touch(key),
    };
  };

  const firstError = errors.values().next().value;
  const canSend = errors.size === 0 && Boolean(phoneNumber) && !sending;

  const reset = () => {
    setHeader('');
    setBody('');
    setFooter('');
    setButtons([newButton()]);
    setListButton('');
    setSections([newSection()]);
    setDisplayText('');
    setUrl('');
    setTouched(new Set());
    setListPreviewOpen(false);
  };

  const updateSection = (sectionId: string, update: (section: ListSection) => ListSection) => {
    setSections((current) => current.map((section) => (section.id === sectionId ? update(section) : section)));
  };

  const updateRow = (sectionId: string, rowId: string, patch: Partial<ListRow>) => {
    updateSection(sectionId, (section) => ({
      ...section,
      rows: section.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    }));
  };

  const handleSend = async () => {
    if (!canSend || !phoneNumber) return;

    const content = mode === 'buttons'
      ? { kind: 'buttons', buttons: buttons.map((button) => ({ id: button.id, title: button.title.trim() })) }
      : mode === 'list'
        ? {
          kind: 'list',
          buttonText: listButton.trim(),
          sections: sections.map((section) => ({
            title: section.title.trim() || undefined,
            rows: section.rows.map((row) => ({
              id: row.id,
              title: row.title.trim(),
              description: row.description.trim() || undefined,
            })),
          })),
        }
        : { kind: 'cta_url', displayText: displayText.trim(), url: url.trim() };

    setSending(true);
    try {
      await apiFetch('/api/messages/interactive', {
        method: 'POST',
        body: {
          conversationId,
          phoneNumber,
          phoneNumberId,
          contextMessageId,
          header: header.trim() || undefined,
          body: body.trim(),
          footer: footer.trim() || undefined,
          ...content,
        },
        errorMessage: 'Failed to send interactive message',
      });
      toast.success(mode === 'buttons' ? 'Buttons sent' : mode === 'list' ? 'List sent' : 'Link sent');
      reset();
      onOpenChange(false);
      await onMessageSent?.();
    } catch (sendError) {
      console.error('Error sending interactive message:', sendError);
      toast.error("Couldn't send the message", { description: errorMessage(sendError, 'Failed to send interactive message') });
    } finally {
      setSending(false);
    }
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = MODES.length - 1;
    const target = event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? last
            : null;
    if (target === null) return;
    event.preventDefault();
    setMode(MODES[target].value);
    tabRefs.current[target]?.focus();
  };

  const handleSubmitShortcut = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void handleSend();
    }
  };

  const activeMode = MODES.find((item) => item.value === mode) ?? MODES[0];
  const previewHeader = header.trim();
  const previewBody = body.trim();
  const previewFooter = footer.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (sending) return;
        onOpenChange(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-primary/12 text-primary">
              <MousePointerClick aria-hidden="true" className="size-4" />
            </span>
            Send interactive message
          </DialogTitle>
          <DialogDescription>
            Reply buttons, a list menu or a link button.
            {contextMessageId && ' Sent as a reply to the selected message.'}
          </DialogDescription>
        </DialogHeader>

        <div
          role="tablist"
          aria-label="Message type"
          className="grid grid-cols-3 gap-1 rounded-lg bg-[var(--chat-input)] p-1 outline outline-1 [outline-color:var(--chat-border)]"
        >
          {MODES.map((item, index) => {
            const selected = item.value === mode;
            const Icon = item.icon;
            return (
              <button
                key={item.value}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`${uid}-tab-${item.value}`}
                aria-selected={selected}
                aria-controls={`${uid}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setMode(item.value)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={cn(
                  'flex h-11 touch-manipulation items-center justify-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 md:h-9',
                  selected && 'bg-background text-foreground shadow-sm',
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
                {item.label}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`${uid}-panel`}
          aria-labelledby={`${uid}-tab-${mode}`}
          className="max-h-[min(58dvh,560px)] space-y-4 overflow-y-auto pr-1"
        >
          <p className="text-xs text-muted-foreground">{activeMode.hint}</p>

          <div className="space-y-2">
            <FieldLabel htmlFor={fieldId('header')} value={header} max={LIMITS.header}>Header</FieldLabel>
            <Input
              id={fieldId('header')}
              value={header}
              onChange={(event) => setHeader(event.target.value)}
              placeholder="Bold line above the message"
              className={fieldClassName}
              {...invalidProps('header')}
            />
            <FieldMessage id={`${fieldId('header')}-error`} error={visibleError('header')} />
          </div>

          <div className="space-y-2">
            <FieldLabel htmlFor={fieldId('body')} required value={body} max={bodyMax}>Message</FieldLabel>
            <Textarea
              id={fieldId('body')}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={handleSubmitShortcut}
              placeholder="Enter your message text"
              required
              className="min-h-[104px] border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-base focus-visible:ring-primary md:text-sm"
              {...invalidProps('body')}
            />
            <FieldMessage id={`${fieldId('body')}-error`} error={visibleError('body')} />
          </div>

          <div className="space-y-2">
            <FieldLabel htmlFor={fieldId('footer')} value={footer} max={LIMITS.footer}>Footer</FieldLabel>
            <Input
              id={fieldId('footer')}
              value={footer}
              onChange={(event) => setFooter(event.target.value)}
              placeholder="Small grey line below the message"
              className={fieldClassName}
              {...invalidProps('footer')}
            />
            <FieldMessage id={`${fieldId('footer')}-error`} error={visibleError('footer')} />
          </div>

          {mode === 'buttons' && (
            <div role="group" aria-labelledby={`${uid}-buttons-heading`} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p id={`${uid}-buttons-heading`} className="text-sm font-medium text-foreground">
                  Buttons <span className="text-red-500" aria-hidden="true">*</span>
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setButtons((current) => [...current, newButton()])}
                  disabled={buttons.length >= LIMITS.maxButtons}
                  className="h-11 text-primary hover:bg-[var(--chat-hover)] hover:text-[var(--primary-hover)] sm:h-9"
                >
                  <Plus aria-hidden="true" className="size-4" />
                  Add button
                </Button>
              </div>

              <div className="space-y-2">
                {buttons.map((button, index) => {
                  const key = `button-${button.id}`;
                  return (
                    <div key={button.id} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <CountedInput
                          id={fieldId(key)}
                          value={button.title}
                          max={LIMITS.buttonTitle}
                          onChange={(event) => {
                            const title = event.target.value;
                            setButtons((current) => current.map((item) => (item.id === button.id ? { ...item, title } : item)));
                          }}
                          placeholder={`Button ${index + 1} title`}
                          aria-label={`Button ${index + 1} title`}
                          {...invalidProps(key)}
                        />
                        {buttons.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setButtons((current) => current.filter((item) => item.id !== button.id))}
                            className="size-11 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-red-600 dark:hover:text-red-300 md:size-10"
                            aria-label={`Remove button ${index + 1}`}
                          >
                            <X aria-hidden="true" className="size-4" />
                          </Button>
                        )}
                      </div>
                      <FieldMessage id={`${fieldId(key)}-error`} error={visibleError(key)} />
                    </div>
                  );
                })}
              </div>

              <p className="text-xs text-muted-foreground">
                {buttons.length < LIMITS.maxButtons
                  ? `You can add ${LIMITS.maxButtons - buttons.length} more button${LIMITS.maxButtons - buttons.length === 1 ? '' : 's'}.`
                  : `That's the maximum of ${LIMITS.maxButtons} buttons.`}
                {' '}Titles must be different from each other.
              </p>
            </div>
          )}

          {mode === 'list' && (
            <>
              <div className="space-y-2">
                <FieldLabel htmlFor={fieldId('list-button')} required value={listButton} max={LIMITS.listButton}>
                  List button
                </FieldLabel>
                <Input
                  id={fieldId('list-button')}
                  value={listButton}
                  onChange={(event) => setListButton(event.target.value)}
                  placeholder="e.g. View options"
                  required
                  className={fieldClassName}
                  {...invalidProps('list-button')}
                />
                <FieldMessage id={`${fieldId('list-button')}-error`} error={visibleError('list-button')} />
              </div>

              <div role="group" aria-labelledby={`${uid}-sections-heading`} className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p id={`${uid}-sections-heading`} className="text-sm font-medium text-foreground">
                    Sections <span className="text-red-500" aria-hidden="true">*</span>
                  </p>
                  <span
                    aria-live="polite"
                    className={cn(
                      'rounded-full bg-[var(--chat-input)] px-2 py-0.5 text-xs tabular-nums text-muted-foreground outline outline-1 [outline-color:var(--chat-border)]',
                      rowsLeft <= 0 && 'text-[var(--chat-warning-foreground)]',
                      rowsLeft < 0 && 'text-red-600 dark:text-red-400',
                    )}
                  >
                    {rowsLeft >= 0 ? `${rowsLeft} of ${LIMITS.maxRows} rows left` : `${-rowsLeft} rows over the limit`}
                  </span>
                </div>

                {sections.map((section, sectionIndex) => {
                  const sectionKey = `section-${section.id}`;
                  const sectionRequired = sections.length > 1;
                  return (
                    <div key={section.id} className="space-y-3 rounded-lg border border-[var(--chat-border)] p-3">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor={fieldId(sectionKey)} className="text-foreground">
                            Section {sectionIndex + 1} title
                            {sectionRequired
                              ? <span className="text-red-500" aria-hidden="true">*</span>
                              : <span className="font-normal text-muted-foreground">(optional)</span>}
                          </Label>
                          {sections.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setSections((current) => current.filter((item) => item.id !== section.id))}
                              className="h-11 text-muted-foreground hover:bg-destructive/10 hover:text-red-600 dark:hover:text-red-300 sm:h-8"
                              aria-label={`Remove section ${sectionIndex + 1}`}
                            >
                              <X aria-hidden="true" className="size-4" />
                              Remove
                            </Button>
                          )}
                        </div>
                        <CountedInput
                          id={fieldId(sectionKey)}
                          value={section.title}
                          max={LIMITS.sectionTitle}
                          onChange={(event) => {
                            const title = event.target.value;
                            updateSection(section.id, (item) => ({ ...item, title }));
                          }}
                          placeholder={sectionRequired ? 'e.g. Popular' : 'Shown above the rows'}
                          required={sectionRequired}
                          {...invalidProps(sectionKey)}
                        />
                        <FieldMessage id={`${fieldId(sectionKey)}-error`} error={visibleError(sectionKey)} />
                      </div>

                      <ol className="space-y-3" aria-label={`Section ${sectionIndex + 1} rows`}>
                        {section.rows.map((row, rowIndex) => {
                          const titleKey = `row-${row.id}-title`;
                          const descriptionKey = `row-${row.id}-description`;
                          const rowName = `Section ${sectionIndex + 1}, row ${rowIndex + 1}`;
                          return (
                            <li key={row.id} className="space-y-1.5 border-l-2 border-[var(--chat-border-strong)] pl-3">
                              <div className="flex items-center gap-2">
                                <CountedInput
                                  id={fieldId(titleKey)}
                                  value={row.title}
                                  max={LIMITS.rowTitle}
                                  onChange={(event) => updateRow(section.id, row.id, { title: event.target.value })}
                                  placeholder={`Row ${rowIndex + 1} title`}
                                  aria-label={`${rowName} title`}
                                  required
                                  {...invalidProps(titleKey)}
                                />
                                {section.rows.length > 1 && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => updateSection(section.id, (item) => ({
                                      ...item,
                                      rows: item.rows.filter((candidate) => candidate.id !== row.id),
                                    }))}
                                    className="size-11 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-red-600 dark:hover:text-red-300 md:size-10"
                                    aria-label={`Remove ${rowName}`}
                                  >
                                    <X aria-hidden="true" className="size-4" />
                                  </Button>
                                )}
                              </div>
                              <FieldMessage id={`${fieldId(titleKey)}-error`} error={visibleError(titleKey)} />
                              <CountedInput
                                id={fieldId(descriptionKey)}
                                value={row.description}
                                max={LIMITS.rowDescription}
                                onChange={(event) => updateRow(section.id, row.id, { description: event.target.value })}
                                placeholder="Description (optional)"
                                aria-label={`${rowName} description (optional)`}
                                {...invalidProps(descriptionKey)}
                              />
                              <FieldMessage id={`${fieldId(descriptionKey)}-error`} error={visibleError(descriptionKey)} />
                            </li>
                          );
                        })}
                      </ol>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => updateSection(section.id, (item) => ({ ...item, rows: [...item.rows, newRow()] }))}
                        disabled={rowsLeft <= 0}
                        className="h-11 text-primary hover:bg-[var(--chat-hover)] hover:text-[var(--primary-hover)] sm:h-9"
                      >
                        <Plus aria-hidden="true" className="size-4" />
                        Add row
                      </Button>
                    </div>
                  );
                })}

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSections((current) => [...current, newSection()])}
                  disabled={sections.length >= LIMITS.maxSections || rowsLeft <= 0}
                  className="h-11 w-full border-dashed sm:h-9"
                >
                  <Plus aria-hidden="true" className="size-4" />
                  Add section
                </Button>
                <FieldMessage id={`${fieldId('rows')}-error`} error={visibleError('rows')} />
              </div>
            </>
          )}

          {mode === 'cta_url' && (
            <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div className="space-y-2">
                <FieldLabel htmlFor={fieldId('display-text')} required value={displayText} max={LIMITS.ctaDisplayText}>
                  Button text
                </FieldLabel>
                <Input
                  id={fieldId('display-text')}
                  value={displayText}
                  onChange={(event) => setDisplayText(event.target.value)}
                  placeholder="e.g. Track order"
                  required
                  className={fieldClassName}
                  {...invalidProps('display-text')}
                />
                <FieldMessage id={`${fieldId('display-text')}-error`} error={visibleError('display-text')} />
              </div>
              <div className="space-y-2">
                <FieldLabel htmlFor={fieldId('url')} required>URL</FieldLabel>
                <Input
                  id={fieldId('url')}
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={handleSubmitShortcut}
                  placeholder="https://example.com/orders"
                  required
                  className={fieldClassName}
                  {...invalidProps('url')}
                />
                <FieldMessage id={`${fieldId('url')}-error`} error={visibleError('url')} />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
            <div className="rounded-lg bg-[var(--chat-canvas)] p-3 outline outline-1 [outline-color:var(--chat-border)]">
              <div className="group ml-auto w-[min(17rem,100%)] space-y-1">
                <div
                  className={cn(
                    'overflow-hidden rounded-lg bg-[var(--chat-bubble-outgoing)] shadow-sm',
                    mode !== 'buttons' && 'rounded-br-none',
                  )}
                >
                  <div className="space-y-1 px-3 pb-1.5 pt-2">
                    {previewHeader && <p className="break-words text-sm font-semibold">{previewHeader}</p>}
                    <p className={cn('whitespace-pre-wrap break-words text-sm', !previewBody && 'italic text-muted-foreground')}>
                      {previewBody || 'Your message appears here'}
                    </p>
                    {previewFooter && <p className="break-words text-xs text-muted-foreground">{previewFooter}</p>}
                  </div>

                  {mode === 'list' && (
                    <button
                      type="button"
                      onClick={() => setListPreviewOpen((current) => !current)}
                      aria-expanded={listPreviewOpen}
                      aria-controls={`${uid}-list-preview`}
                      className="flex h-10 w-full items-center justify-center gap-1.5 border-t border-[var(--chat-border)] text-sm font-medium text-[var(--chat-check)] transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 dark:hover:bg-white/5"
                    >
                      <List aria-hidden="true" className="size-4" />
                      <span className="truncate">{listButton.trim() || 'View options'}</span>
                      <ChevronDown aria-hidden="true" className={cn('size-3.5 transition-transform', listPreviewOpen && 'rotate-180')} />
                    </button>
                  )}

                  {mode === 'cta_url' && (
                    <div
                      className="flex h-10 items-center justify-center gap-1.5 border-t border-[var(--chat-border)] text-sm font-medium text-[var(--chat-check)]"
                      title={url.trim() || undefined}
                    >
                      <ExternalLink aria-hidden="true" className="size-4" />
                      <span className="truncate">{displayText.trim() || 'Open link'}</span>
                    </div>
                  )}
                </div>

                {mode === 'buttons' && buttons.map((button, index) => (
                  <div
                    key={button.id}
                    className="flex h-10 items-center justify-center gap-1.5 rounded-lg bg-[var(--chat-bubble-outgoing)] px-3 text-sm font-medium text-[var(--chat-check)] shadow-sm"
                  >
                    <Reply aria-hidden="true" className="size-4 shrink-0" />
                    <span className={cn('truncate', !button.title.trim() && 'italic opacity-70')}>
                      {button.title.trim() || `Button ${index + 1}`}
                    </span>
                  </div>
                ))}

                {mode === 'list' && (
                  <div
                    id={`${uid}-list-preview`}
                    className={cn(
                      'overflow-hidden rounded-lg bg-background shadow-sm outline outline-1 [outline-color:var(--chat-border)]',
                      listPreviewOpen ? 'block' : 'hidden pointer-fine:group-hover:block',
                    )}
                  >
                    <p className="border-b border-[var(--chat-border)] px-3 py-2 text-center text-sm font-semibold">
                      {listButton.trim() || 'View options'}
                    </p>
                    <div className="space-y-2 py-2">
                      {sections.map((section) => (
                        <div key={section.id}>
                          {section.title.trim() && (
                            <p className="px-3 pb-1 text-xs font-medium text-[var(--chat-check)]">{section.title.trim()}</p>
                          )}
                          <ul>
                            {section.rows.map((row, rowIndex) => (
                              <li key={row.id} className="flex items-center gap-3 px-3 py-1.5">
                                <span className="min-w-0 flex-1">
                                  <span className={cn('block truncate text-sm', !row.title.trim() && 'italic text-muted-foreground')}>
                                    {row.title.trim() || `Row ${rowIndex + 1}`}
                                  </span>
                                  {row.description.trim() && (
                                    <span className="block truncate text-xs text-muted-foreground">{row.description.trim()}</span>
                                  )}
                                </span>
                                <span aria-hidden="true" className="size-4 shrink-0 rounded-full border-2 border-muted-foreground/40" />
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            {mode === 'list' && (
              <p className="text-xs text-muted-foreground">Tap the list button in the preview to see the options.</p>
            )}
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          {!phoneNumber ? (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">No conversation selected.</p>
          ) : firstError && (
            <p aria-live="polite" className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{firstError.label}:</span> {firstError.message}
              {errors.size > 1 && ` (+${errors.size - 1} more)`}
            </p>
          )}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => onOpenChange(false)} disabled={sending}>
              Cancel
            </Button>
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-muted-foreground pointer-fine:sm:inline">⌘/Ctrl + Enter</span>
              <Button
                onClick={handleSend}
                disabled={!canSend}
                className="h-11 flex-1 bg-primary hover:bg-[var(--primary-hover)] sm:h-9 sm:flex-none"
              >
                {sending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Send aria-hidden="true" className="size-4" />}
                {sending ? 'Sending' : 'Send'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
