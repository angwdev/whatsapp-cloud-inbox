'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  Send,
  Video,
} from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import type { Template, TemplateParameterInfo } from '@/types/whatsapp';
import { buildTemplateSendRequest, EMPTY_TEMPLATE_FORM, getTemplateParameters, getTemplateParts } from '@/lib/template-parser';
import { TemplateParametersDialog } from './template-parameters-dialog';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phoneNumber: string;
  phoneNumberId?: string;
  onTemplateSent?: () => void;
};

type TemplatesResponse = {
  data: Template[];
  fetchedAt?: string;
  truncated?: boolean;
};

const CATEGORY_ORDER = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];

const CATEGORY_STYLES: Record<string, string> = {
  MARKETING: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  UTILITY: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  AUTHENTICATION: 'bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300',
};

const HEADER_ICONS: Record<string, typeof ImageIcon> = {
  IMAGE: ImageIcon,
  VIDEO: Video,
  DOCUMENT: FileText,
  LOCATION: MapPin,
};

function formatCategory(category: string): string {
  return category ? category.charAt(0) + category.slice(1).toLowerCase().replace(/_/g, ' ') : 'Other';
}

function templatesUrl(phoneNumberId?: string, refresh = false): string {
  const params = new URLSearchParams();
  if (phoneNumberId) params.set('phoneNumberId', phoneNumberId);
  if (refresh) params.set('refresh', 'true');
  return `/api/templates${params.size ? `?${params.toString()}` : ''}`;
}

function TemplateListSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="space-y-2 rounded-lg border border-[var(--chat-border)] p-3">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      ))}
    </div>
  );
}

export function TemplateSelectorDialog({ open, onOpenChange, phoneNumber, phoneNumberId, onTemplateSent }: Props) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['templates', phoneNumberId ?? ''], [phoneNumberId]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // Parameters dialog state
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [parameterInfo, setParameterInfo] = useState<TemplateParameterInfo | null>(null);
  const showParametersDialog = Boolean(selectedTemplate && parameterInfo);

  // When the parent closes the dialog, start from the list next time.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setSelectedTemplate(null);
      setParameterInfo(null);
      setSearch('');
      setSendError(null);
    }
  }

  const { data, isPending, error, refetch } = useQuery({
    queryKey,
    queryFn: () => apiFetch<TemplatesResponse>(templatesUrl(phoneNumberId), { errorMessage: 'Failed to load templates' }),
    enabled: open,
    staleTime: 10 * 60_000,
  });

  const templates = useMemo(() => data?.data ?? [], [data]);

  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = query
      ? templates.filter((template) => {
        const bodyText = getTemplateParts(template).body?.text ?? '';
        return template.name.toLowerCase().includes(query) || bodyText.toLowerCase().includes(query);
      })
      : templates;

    const byCategory = new Map<string, Template[]>();
    for (const template of matches) {
      const category = template.category?.toUpperCase() || 'OTHER';
      byCategory.set(category, [...(byCategory.get(category) ?? []), template]);
    }

    const rank = (category: string) => {
      const index = CATEGORY_ORDER.indexOf(category);
      return index === -1 ? CATEGORY_ORDER.length : index;
    };

    return [...byCategory.entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([category, items]) => ({
        category,
        items: items.sort((a, b) => a.name.localeCompare(b.name) || (a.language ?? '').localeCompare(b.language ?? '')),
      }));
  }, [search, templates]);

  const resultCount = groups.reduce((total, group) => total + group.items.length, 0);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await apiFetch<TemplatesResponse>(templatesUrl(phoneNumberId, true), {
        errorMessage: 'Failed to refresh templates',
      });
      queryClient.setQueryData(queryKey, fresh);
      toast.success(`Loaded ${fresh.data.length} approved template${fresh.data.length === 1 ? '' : 's'}`);
    } catch (refreshError) {
      toast.error("Couldn't refresh templates", { description: errorMessage(refreshError) });
    } finally {
      setRefreshing(false);
    }
  };

  const sendWithoutParameters = async (template: Template, info: TemplateParameterInfo) => {
    setSending(template.id);
    setSendError(null);
    try {
      await apiFetch('/api/templates/send', {
        method: 'POST',
        body: buildTemplateSendRequest(template, info, EMPTY_TEMPLATE_FORM, { to: phoneNumber, phoneNumberId }),
        errorMessage: 'Failed to send template',
      });
      toast.success(`Sent “${template.name}”`);
      setSearch('');
      onOpenChange(false);
      onTemplateSent?.();
    } catch (err) {
      const message = errorMessage(err, 'Failed to send template');
      setSendError(message);
      toast.error("Couldn't send the template", { description: message });
    } finally {
      setSending(null);
    }
  };

  const handleSelectTemplate = (template: Template) => {
    const info = getTemplateParameters(template);

    // Templates with values to fill in (or that can't be sent from here) open the parameters dialog.
    if (info.parameters.length > 0 || info.unsupported) {
      setSendError(null);
      setSelectedTemplate(template);
      setParameterInfo(info);
      return;
    }

    void sendWithoutParameters(template, info);
  };

  const closeParametersDialog = () => {
    setSelectedTemplate(null);
    setParameterInfo(null);
  };

  const handleTemplateWithParametersSent = () => {
    closeParametersDialog();
    setSearch('');
    onOpenChange(false);
    onTemplateSent?.();
  };

  const renderBody = () => {
    if (isPending) return <TemplateListSkeleton />;

    if (error) {
      return (
        <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-6 text-center">
          <AlertCircle aria-hidden="true" className="size-6 text-red-600 dark:text-red-400" />
          <p className="text-sm text-red-700 dark:text-red-300">{errorMessage(error, 'Failed to load templates')}</p>
          <Button variant="outline" className="h-11 md:h-9" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      );
    }

    if (templates.length === 0) {
      return (
        <div className="space-y-1 py-8 text-center">
          <p className="text-sm font-medium text-foreground">No approved templates</p>
          <p className="text-xs text-muted-foreground">
            Templates appear here once Meta approves them. Created one recently? Refresh the list.
          </p>
        </div>
      );
    }

    if (resultCount === 0) {
      return (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No templates match “{search.trim()}”
        </p>
      );
    }

    return (
      <div className="space-y-4">
        {groups.map((group) => (
          <section key={group.category} aria-labelledby={`template-group-${group.category}`} className="space-y-2">
            <h3
              id={`template-group-${group.category}`}
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              {formatCategory(group.category)} · {group.items.length}
            </h3>
            <ul className="space-y-2">
              {group.items.map((template) => {
                const parts = getTemplateParts(template);
                const headerFormat = parts.header?.format?.toUpperCase();
                const HeaderIcon = headerFormat ? HEADER_ICONS[headerFormat] : undefined;
                const info = getTemplateParameters(template);
                const needsInput = info.parameters.length > 0 || Boolean(info.unsupported);
                const isSending = sending === template.id;

                return (
                  <li key={template.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectTemplate(template)}
                      disabled={sending !== null}
                      aria-label={`${needsInput ? 'Fill in' : 'Send'} ${template.name} (${template.language})`}
                      className="flex min-h-11 w-full touch-manipulation items-start gap-3 rounded-lg border border-[var(--chat-border-strong)] p-3 text-left transition-colors hover:bg-[var(--chat-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium text-foreground">{template.name}</span>
                          <Badge variant="secondary" className={cn('text-[11px]', CATEGORY_STYLES[group.category] ?? 'bg-muted text-muted-foreground')}>
                            {formatCategory(group.category)}
                          </Badge>
                          <span className="rounded border border-[var(--chat-border)] px-1.5 text-[11px] uppercase tabular-nums text-muted-foreground">
                            {template.language}
                          </span>
                        </div>
                        {parts.body?.text && (
                          <p className="line-clamp-2 break-words text-xs text-muted-foreground">{parts.body.text}</p>
                        )}
                        {(HeaderIcon || info.parameters.length > 0) && (
                          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            {HeaderIcon && <HeaderIcon aria-hidden="true" className="size-3.5" />}
                            {HeaderIcon && headerFormat && <span>{formatCategory(headerFormat)} header</span>}
                            {HeaderIcon && info.parameters.length > 0 && <span aria-hidden="true">·</span>}
                            {info.parameters.length > 0 && (
                              <span>{info.parameters.length} value{info.parameters.length === 1 ? '' : 's'} to fill in</span>
                            )}
                          </p>
                        )}
                      </div>
                      <span className="flex h-8 shrink-0 items-center gap-1 text-sm font-medium text-primary">
                        {isSending ? (
                          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                        ) : needsInput ? (
                          <>
                            <span className="hidden sm:inline">Fill in</span>
                            <ChevronRight aria-hidden="true" className="size-4" />
                          </>
                        ) : (
                          <>
                            <Send aria-hidden="true" className="size-4" />
                            <span className="hidden sm:inline">Send</span>
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {data?.truncated && (
          <p className="text-center text-xs text-muted-foreground">
            Showing the first {templates.length} templates. Search to narrow the list.
          </p>
        )}
      </div>
    );
  };

  return (
    <>
      <Dialog
        open={open && !showParametersDialog}
        onOpenChange={(nextOpen) => {
          if (sending) return;
          onOpenChange(nextOpen);
          if (!nextOpen) {
            setSearch('');
            setSendError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Send template message</DialogTitle>
            <DialogDescription>
              Pick an approved template to send to {phoneNumber}
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name or text"
                aria-label="Search templates"
                className="border-[var(--chat-border-strong)] bg-[var(--chat-input)] pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void handleRefresh()}
              disabled={refreshing || isPending}
              aria-label="Refresh templates"
              title="Refresh templates"
              className="size-11 shrink-0 md:size-9"
            >
              <RefreshCw aria-hidden="true" className={cn('size-4', refreshing && 'animate-spin')} />
            </Button>
          </div>

          {sendError && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {sendError}
            </div>
          )}

          <div className="max-h-[min(56dvh,440px)] overflow-y-auto overscroll-contain pr-1" aria-busy={isPending || refreshing}>
            {renderBody()}
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {!isPending && !error && templates.length > 0 && (
                search.trim() ? `${resultCount} of ${templates.length}` : `${templates.length} approved`
              )}
            </span>
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => onOpenChange(false)} disabled={sending !== null}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {selectedTemplate && parameterInfo && (
        <TemplateParametersDialog
          key={`${selectedTemplate.id}:${selectedTemplate.language}`}
          open={open && showParametersDialog}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) closeParametersDialog();
          }}
          template={selectedTemplate}
          parameterInfo={parameterInfo}
          phoneNumber={phoneNumber}
          phoneNumberId={phoneNumberId}
          onBack={closeParametersDialog}
          onTemplateSent={handleTemplateWithParametersSent}
        />
      )}
    </>
  );
}
