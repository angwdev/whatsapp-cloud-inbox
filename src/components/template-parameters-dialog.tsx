'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Copy,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  MapPin,
  Phone,
  Reply,
  Send,
  Upload,
  Video,
  Workflow,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { apiFetch, errorMessage } from '@/lib/api-client';
import { formatBytes, MEDIA_LIMITS, validateOutboundMedia } from '@/lib/media-limits';
import {
  buildTemplateSendRequest,
  EMPTY_TEMPLATE_FORM,
  evaluateTemplateForm,
  hasDisallowedWhitespace,
  resolveButtonUrl,
  TEMPLATE_LIMITS,
  type TemplateFormValues,
  type TemplateLocationValue,
  type TextSegment,
} from '@/lib/template-parser';
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
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type {
  HeaderMediaFormat,
  Template,
  TemplateMediaHeaderParameter,
  TemplateParameter,
  TemplateParameterInfo,
} from '@/types/whatsapp';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: Template;
  parameterInfo: TemplateParameterInfo;
  phoneNumber: string;
  phoneNumberId?: string;
  onBack: () => void;
  onTemplateSent?: () => void;
};

const FIELD_CLASS = '';
const PLACEHOLDER_SPLIT = /\{\{\s*[A-Za-z0-9_]+\s*\}\}/;

const MEDIA_COPY: Record<HeaderMediaFormat, { noun: string; types: string; icon: typeof ImageIcon }> = {
  IMAGE: { noun: 'image', types: 'JPEG or PNG', icon: ImageIcon },
  VIDEO: { noun: 'video', types: 'MP4 or 3GPP', icon: Video },
  DOCUMENT: { noun: 'document', types: 'PDF, Word, Excel, PowerPoint or text', icon: FileText },
};

const BUTTON_ICONS: Record<string, typeof Reply> = {
  URL: ExternalLink,
  OTP: Copy,
  COPY_CODE: Copy,
  PHONE_NUMBER: Phone,
  VOICE_CALL: Phone,
  QUICK_REPLY: Reply,
  FLOW: Workflow,
};

function domId(prefix: string, key: string): string {
  return `${prefix}-${key.replace(/[^a-z0-9_-]/gi, '-')}`;
}

function Counter({ length, max }: { length: number; max: number }) {
  return (
    <span className={cn('text-xs tabular-nums text-muted-foreground', length > max && 'font-medium text-red-600 dark:text-red-400')}>
      {length}/{max}
    </span>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs font-medium text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}

function FieldLabel({ id, htmlFor, children, badge, trailing }: { id?: string; htmlFor?: string; children: ReactNode; badge?: string; trailing?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Label id={id} htmlFor={htmlFor} className="text-foreground">
          {children} <span className="text-red-500" aria-hidden="true">*</span>
        </Label>
        {badge && (
          <Badge variant="secondary" className="bg-[var(--chat-hover)] text-[11px] text-muted-foreground">
            {badge}
          </Badge>
        )}
      </div>
      {trailing}
    </div>
  );
}

function Segments({ segments }: { segments: TextSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => {
        if (!segment.placeholder) return <span key={index}>{segment.text}</span>;
        return segment.filled ? (
          <span key={index} className="rounded-sm bg-primary/12 px-0.5">{segment.text}</span>
        ) : (
          <span key={index} className="rounded bg-[var(--chat-hover)] px-1 font-mono text-[0.85em] text-muted-foreground">
            {segment.text}
          </span>
        );
      })}
    </>
  );
}

export function TemplateParametersDialog({
  open,
  onOpenChange,
  template,
  parameterInfo,
  phoneNumber,
  phoneNumberId,
  onBack,
  onTemplateSent,
}: Props) {
  const idPrefix = useId();
  const [values, setValues] = useState<TemplateFormValues>(EMPTY_TEMPLATE_FORM);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [uploadedSize, setUploadedSize] = useState<number | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const evaluation = useMemo(
    () => evaluateTemplateForm(template, parameterInfo, values),
    [template, parameterInfo, values],
  );
  const { preview, errors, limitIssues, missing } = evaluation;
  const busy = sending || uploading;
  const canSend = evaluation.canSend && !busy;
  const hasTextParameters = parameterInfo.parameters.some((param) => param.kind === 'text');

  const setText = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, text: { ...prev.text, [key]: value } }));
  };

  const setLocation = (field: keyof TemplateLocationValue, value: string) => {
    setValues((prev) => ({ ...prev, location: { ...prev.location, [field]: value } }));
  };

  const replacePreviewUrl = (url: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setMediaPreviewUrl(url);
  };

  const clearUpload = () => {
    replacePreviewUrl(null);
    setUploadedSize(null);
    setValues((prev) => ({ ...prev, media: { ...prev.media, mediaId: undefined, fileName: undefined } }));
  };

  const handleFile = async (file: File, param: TemplateMediaHeaderParameter) => {
    const expected = MEDIA_COPY[param.format].noun;
    const validation = validateOutboundMedia(file);
    if (!validation.ok) {
      toast.error("Can't use this file", { description: validation.reason });
      return;
    }
    if (validation.mediaType !== expected) {
      toast.error("Can't use this file", { description: `This template's header needs ${MEDIA_COPY[param.format].types} (${expected}).` });
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('expectedType', expected);
      if (phoneNumberId) form.set('phoneNumberId', phoneNumberId);
      const { id } = await apiFetch<{ id: string }>('/api/media/upload', {
        method: 'POST',
        body: form,
        errorMessage: 'Upload failed',
      });
      replacePreviewUrl(param.format === 'DOCUMENT' ? null : URL.createObjectURL(file));
      setUploadedSize(file.size);
      setValues((prev) => ({ ...prev, media: { ...prev.media, source: 'upload', mediaId: id, fileName: file.name } }));
    } catch (uploadError) {
      toast.error("Couldn't upload the file", { description: errorMessage(uploadError) });
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async () => {
    if (!canSend) return;

    setSending(true);
    setError(null);
    try {
      await apiFetch('/api/templates/send', {
        method: 'POST',
        body: buildTemplateSendRequest(template, parameterInfo, values, { to: phoneNumber, phoneNumberId }),
        errorMessage: 'Failed to send template',
      });
      toast.success(`Sent “${template.name}”`);
      onOpenChange(false);
      onTemplateSent?.();
    } catch (sendError) {
      const message = errorMessage(sendError, 'Failed to send template');
      setError(message);
      toast.error("Couldn't send the template", { description: message });
    } finally {
      setSending(false);
    }
  };

  const describedBy = (...ids: Array<string | false | undefined>) => ids.filter(Boolean).join(' ') || undefined;

  const renderField = (param: TemplateParameter) => {
    const id = domId(idPrefix, param.key);
    const errorId = `${id}-error`;
    const hintId = `${id}-hint`;
    const fieldError = errors[param.key];

    switch (param.kind) {
      case 'text': {
        const raw = values.text[param.key] ?? '';
        const isHeader = param.component === 'HEADER';
        return (
          <div key={param.key} className="space-y-2">
            <FieldLabel
              htmlFor={id}
              badge={param.component === 'HEADER' ? 'Header' : 'Body'}
              trailing={isHeader && preview.header?.kind === 'text' && (
                <Counter length={preview.header.length} max={TEMPLATE_LIMITS.headerText} />
              )}
            >
              <span className="font-mono text-[0.9em]">{`{{${param.name}}}`}</span>
            </FieldLabel>
            <Input
              id={id}
              value={raw}
              onChange={(event) => setText(param.key, event.target.value)}
              placeholder={param.example || 'Value'}
              aria-required="true"
              aria-invalid={Boolean(fieldError) || undefined}
              aria-describedby={describedBy(fieldError && errorId, hintId)}
              className={FIELD_CLASS}
            />
            <FieldError id={errorId} message={fieldError} />
            <p id={hintId} className="text-xs text-muted-foreground">
              {param.example && <>Example: {param.example}</>}
              {hasDisallowedWhitespace(raw) && (
                <span className="text-[var(--chat-warning-foreground)]">
                  {param.example ? ' · ' : ''}Line breaks, tabs and long runs of spaces will be replaced with a single space.
                </span>
              )}
            </p>
          </div>
        );
      }

      case 'otp':
      case 'coupon_code': {
        const raw = values.text[param.key] ?? '';
        const max = param.kind === 'otp' ? TEMPLATE_LIMITS.otp : TEMPLATE_LIMITS.couponCode;
        return (
          <div key={param.key} className="space-y-2">
            <FieldLabel htmlFor={id} badge={param.kind === 'otp' ? 'Body + button' : 'Button'} trailing={<Counter length={raw.trim().length} max={max} />}>
              {param.label}
            </FieldLabel>
            <Input
              id={id}
              value={raw}
              onChange={(event) => setText(param.key, event.target.value)}
              placeholder={param.example || (param.kind === 'otp' ? '123456' : 'SAVE20')}
              autoComplete="off"
              autoCapitalize={param.kind === 'coupon_code' ? 'characters' : 'off'}
              spellCheck={false}
              aria-required="true"
              aria-invalid={Boolean(fieldError) || undefined}
              aria-describedby={describedBy(fieldError && errorId, hintId)}
              className={cn(FIELD_CLASS, 'font-mono')}
            />
            <FieldError id={errorId} message={fieldError} />
            <p id={hintId} className="text-xs text-muted-foreground">
              {param.kind === 'otp'
                ? param.buttonIndex !== undefined
                  ? 'Fills the code in the message and in the copy-code button.'
                  : 'Fills the code in the message.'
                : `Copied when the contact taps “${param.buttonText}”.`}
            </p>
          </div>
        );
      }

      case 'url': {
        const raw = values.text[param.key] ?? '';
        const [prefix, ...rest] = param.url.split(PLACEHOLDER_SPLIT);
        const suffixAfter = rest.join('');
        const fullUrl = raw.trim() ? resolveButtonUrl(param.url, raw) : null;
        return (
          <div key={param.key} className="space-y-2">
            <FieldLabel
              htmlFor={id}
              badge="Button"
              trailing={fullUrl && <Counter length={fullUrl.length} max={TEMPLATE_LIMITS.url} />}
            >
              {param.label}
            </FieldLabel>
            <p className="break-all rounded-md bg-[var(--chat-hover)] px-2 py-1.5 font-mono text-xs text-muted-foreground">
              {prefix}
              <mark className="rounded-sm bg-primary/15 px-0.5 text-foreground">{'{{1}}'}</mark>
              {suffixAfter}
            </p>
            <Input
              id={id}
              value={raw}
              onChange={(event) => setText(param.key, event.target.value)}
              placeholder={param.example || 'order-123'}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-required="true"
              aria-invalid={Boolean(fieldError) || undefined}
              aria-describedby={describedBy(fieldError && errorId, hintId)}
              className={cn(FIELD_CLASS, 'font-mono')}
            />
            <FieldError id={errorId} message={fieldError} />
            <p id={hintId} className="break-all text-xs text-muted-foreground">
              {fullUrl ? <>Opens {fullUrl}</> : 'Only the highlighted part is sent. It is URL-encoded for you.'}
            </p>
          </div>
        );
      }

      case 'media': {
        const copy = MEDIA_COPY[param.format];
        const MediaIcon = copy.icon;
        const { media } = values;
        const limit = MEDIA_LIMITS[copy.noun as keyof typeof MEDIA_LIMITS];
        return (
          <fieldset key={param.key} className="space-y-2" aria-labelledby={`${id}-label`} aria-describedby={hintId}>
            <FieldLabel id={`${id}-label`} badge="Header">Header {copy.noun}</FieldLabel>
            <div role="group" aria-label={`${copy.noun} source`} className="grid grid-cols-2 gap-1 rounded-lg bg-[var(--chat-hover)] p-1">
              {(['upload', 'link'] as const).map((source) => (
                <button
                  key={source}
                  type="button"
                  aria-pressed={media.source === source}
                  onClick={() => setValues((prev) => ({ ...prev, media: { ...prev.media, source } }))}
                  disabled={busy}
                  className={cn(
                    'flex h-11 touch-manipulation items-center justify-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 md:h-8',
                    media.source === source && 'bg-background text-foreground shadow-sm',
                  )}
                >
                  {source === 'upload' ? <Upload aria-hidden="true" className="size-4" /> : <Link2 aria-hidden="true" className="size-4" />}
                  {source === 'upload' ? 'Upload file' : 'Use a link'}
                </button>
              ))}
            </div>

            {media.source === 'upload' ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={limit.mimeTypes.join(',')}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void handleFile(file, param);
                  }}
                />
                {media.mediaId ? (
                  <div className="flex items-center gap-3 rounded-lg border border-[var(--chat-border-strong)] p-2">
                    {mediaPreviewUrl && param.format === 'IMAGE' ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
                      <img src={mediaPreviewUrl} alt="" className="size-11 shrink-0 rounded-md object-cover outline outline-1 [outline-color:var(--chat-media-outline)]" />
                    ) : (
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-[var(--chat-hover)] text-muted-foreground">
                        <MediaIcon aria-hidden="true" className="size-5" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{media.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        Uploaded{uploadedSize !== null && ` · ${formatBytes(uploadedSize)}`}
                      </p>
                    </div>
                    <Button variant="ghost" className="h-11 md:h-9" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                      Replace
                    </Button>
                    <Button variant="ghost" size="icon" className="size-11 md:size-9" onClick={clearUpload} disabled={busy} aria-label="Remove file">
                      <X aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="h-11 w-full border-dashed md:h-10"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy}
                  >
                    {uploading ? (
                      <>
                        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                        Uploading…
                      </>
                    ) : (
                      <>
                        <MediaIcon aria-hidden="true" className="size-4" />
                        Choose {copy.noun}
                      </>
                    )}
                  </Button>
                )}
              </>
            ) : (
              <>
                <Label htmlFor={id} className="sr-only">{copy.noun} link</Label>
                <Input
                  id={id}
                  type="url"
                  inputMode="url"
                  value={media.link}
                  onChange={(event) => {
                    const link = event.target.value;
                    setValues((prev) => ({ ...prev, media: { ...prev.media, link } }));
                  }}
                  placeholder={`https://example.com/${copy.noun === 'document' ? 'file.pdf' : copy.noun === 'video' ? 'clip.mp4' : 'photo.jpg'}`}
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-required="true"
                  aria-invalid={Boolean(fieldError) || undefined}
                  aria-describedby={describedBy(fieldError && errorId, hintId)}
                  className={FIELD_CLASS}
                />
                <FieldError id={errorId} message={fieldError} />
              </>
            )}
            <p id={hintId} className="text-xs text-muted-foreground">
              {copy.types}, up to {formatBytes(limit.maxBytes)}.
              {media.source === 'link' && ' The link must be public: WhatsApp downloads it when sending.'}
            </p>
          </fieldset>
        );
      }

      case 'location': {
        const fields = [
          { field: 'latitude', label: 'Latitude', placeholder: '37.4847' },
          { field: 'longitude', label: 'Longitude', placeholder: '-122.1477' },
        ] as const;
        return (
          <fieldset key={param.key} className="space-y-3" aria-labelledby={`${id}-label`}>
            <FieldLabel id={`${id}-label`} badge="Header">Header location</FieldLabel>
            <div className="grid grid-cols-2 gap-3">
              {fields.map(({ field, label, placeholder }) => {
                const fieldId = domId(idPrefix, `location-${field}`);
                const message = errors[`location.${field}`];
                return (
                  <div key={field} className="space-y-1.5">
                    <Label htmlFor={fieldId} className="text-xs text-muted-foreground">{label}</Label>
                    <Input
                      id={fieldId}
                      inputMode="decimal"
                      value={values.location[field]}
                      onChange={(event) => setLocation(field, event.target.value)}
                      placeholder={placeholder}
                      aria-required="true"
                      aria-invalid={Boolean(message) || undefined}
                      aria-describedby={message ? `${fieldId}-error` : undefined}
                      className={cn(FIELD_CLASS, 'tabular-nums')}
                    />
                    <FieldError id={`${fieldId}-error`} message={message} />
                  </div>
                );
              })}
            </div>
            {(['name', 'address'] as const).map((field) => {
              const fieldId = domId(idPrefix, `location-${field}`);
              const message = errors[`location.${field}`];
              return (
                <div key={field} className="space-y-1.5">
                  <Label htmlFor={fieldId} className="text-xs text-muted-foreground">
                    {field === 'name' ? 'Place name' : 'Address'} (optional)
                  </Label>
                  <Input
                    id={fieldId}
                    value={values.location[field]}
                    onChange={(event) => setLocation(field, event.target.value)}
                    placeholder={field === 'name' ? 'Downtown store' : '1 Hacker Way, Menlo Park, CA'}
                    aria-invalid={Boolean(message) || undefined}
                    aria-describedby={message ? `${fieldId}-error` : undefined}
                    className={FIELD_CLASS}
                  />
                  <FieldError id={`${fieldId}-error`} message={message} />
                </div>
              );
            })}
          </fieldset>
        );
      }
    }
  };

  const renderHeaderPreview = () => {
    const header = preview.header;
    if (!header) return null;

    if (header.kind === 'text') {
      return (
        <p className="break-words px-3 pt-2 text-sm font-semibold">
          <Segments segments={header.segments} />
        </p>
      );
    }

    if (header.kind === 'location') {
      return (
        <div className="m-1 mb-0 overflow-hidden rounded-md">
          <div className="flex h-24 items-center justify-center bg-[var(--chat-hover)] text-muted-foreground">
            <MapPin aria-hidden="true" className="size-7" />
          </div>
          {(header.name || header.address) && (
            <div className="px-2 pt-1.5">
              {header.name && <p className="truncate text-sm font-medium">{header.name}</p>}
              {header.address && <p className="truncate text-xs text-muted-foreground">{header.address}</p>}
            </div>
          )}
        </div>
      );
    }

    const copy = MEDIA_COPY[header.format];
    const MediaIcon = copy.icon;
    if (header.format === 'DOCUMENT') {
      return (
        <div className="m-1 mb-0 flex items-center gap-2 rounded-md bg-[var(--chat-hover)] p-2">
          <FileText aria-hidden="true" className="size-6 shrink-0 text-muted-foreground" />
          <span className={cn('truncate text-sm', !header.fileName && 'italic text-muted-foreground')}>
            {header.fileName || 'Document'}
          </span>
        </div>
      );
    }
    if (mediaPreviewUrl && values.media.source === 'upload') {
      return header.format === 'IMAGE' ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
        <img src={mediaPreviewUrl} alt="Header preview" className="m-1 mb-0 aspect-[1.91/1] w-[calc(100%-0.5rem)] rounded-md object-cover" />
      ) : (
        <video src={mediaPreviewUrl} muted playsInline className="m-1 mb-0 aspect-video w-[calc(100%-0.5rem)] rounded-md bg-black object-cover" />
      );
    }
    return (
      <div className="m-1 mb-0 flex aspect-[1.91/1] flex-col items-center justify-center gap-1 rounded-md bg-[var(--chat-hover)] text-muted-foreground">
        <MediaIcon aria-hidden="true" className="size-7" />
        <span className="max-w-[90%] truncate text-xs">{header.fileName || `Header ${copy.noun}`}</span>
      </div>
    );
  };

  const missingCount = missing.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (busy) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              disabled={busy}
              className="size-11 flex-shrink-0 md:size-10"
              aria-label="Back to templates"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 text-left">
              <DialogTitle className="break-words">{template.name}</DialogTitle>
              <DialogDescription>
                {template.language} · fill in the values for {phoneNumber}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="max-h-[min(64dvh,600px)] space-y-5 overflow-y-auto overscroll-contain pr-1">
          {parameterInfo.unsupported && (
            <div role="alert" className="flex gap-2 rounded-md border border-[var(--chat-warning-border)] bg-[var(--chat-warning-background)] px-3 py-2 text-sm text-[var(--chat-warning-foreground)]">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <p>{parameterInfo.unsupported} Send it from WhatsApp Manager or the API instead.</p>
            </div>
          )}

          {parameterInfo.parameters.length > 0 && (
            <div className="space-y-4">
              {parameterInfo.parameters.map(renderField)}
              {hasTextParameters && (
                <p className="text-xs text-muted-foreground">
                  WhatsApp doesn&apos;t allow line breaks, tabs or more than 4 spaces in a row inside parameters, so they are cleaned up before sending.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
              {preview.body && <Counter length={preview.body.length} max={TEMPLATE_LIMITS.body} />}
            </div>
            <div className="rounded-lg bg-[var(--chat-canvas)] p-3 outline outline-1 [outline-color:var(--chat-border)]">
              <div className="ml-auto w-[min(18rem,100%)] overflow-hidden rounded-lg rounded-br-none bg-[var(--chat-bubble-outgoing)] shadow-sm">
                {renderHeaderPreview()}
                {preview.body && (
                  <p className="whitespace-pre-wrap break-words px-3 pb-1.5 pt-2 text-sm">
                    <Segments segments={preview.body.segments} />
                  </p>
                )}
                {preview.footer && (
                  <p className="break-words px-3 pb-2 text-xs text-muted-foreground">{preview.footer.text}</p>
                )}
                {!preview.header && !preview.body && (
                  <p className="px-3 py-2 text-sm italic text-muted-foreground">No preview available</p>
                )}
                {preview.buttons.map((button, index) => {
                  const ButtonIcon = BUTTON_ICONS[button.type] ?? Reply;
                  return (
                    <div
                      key={index}
                      title={button.url}
                      className="flex min-h-10 items-center justify-center gap-1.5 border-t border-[var(--chat-border)] px-3 text-center text-sm font-medium text-[var(--chat-check)]"
                    >
                      <ButtonIcon aria-hidden="true" className="size-4 shrink-0" />
                      <span className="truncate">{button.text}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {limitIssues.length > 0 && (
            <div role="alert" className="flex gap-2 rounded-md border border-[var(--chat-warning-border)] bg-[var(--chat-warning-background)] px-3 py-2 text-sm text-[var(--chat-warning-foreground)]">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <ul className="space-y-1">
                {limitIssues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            </div>
          )}
        </div>

        <Separator />

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="outline" className="h-11 sm:h-9" onClick={onBack} disabled={busy}>
            Back
          </Button>
          <div className="flex items-center gap-3">
            {missingCount > 0 && !parameterInfo.unsupported && (
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {missingCount} required field{missingCount === 1 ? '' : 's'} left
              </span>
            )}
            <Button
              onClick={handleSend}
              disabled={!canSend}
              className="h-11 flex-1 bg-primary hover:bg-[var(--primary-hover)] sm:h-9 sm:flex-none"
            >
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send template
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
