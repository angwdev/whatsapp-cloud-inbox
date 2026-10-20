'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Loader2, Search, Send, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { apiFetch, errorMessage } from '@/lib/api-client';
import { EMOJI_PATTERN, FLOW_LIMITS, type FlowSummary } from '@/lib/flows';
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
import { Skeleton } from '@/components/ui/skeleton';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phoneNumber?: string;
  phoneNumberId?: string;
  onMessageSent?: () => void | Promise<void>;
};

const STATUS_STYLES: Record<string, string> = {
  PUBLISHED: 'bg-primary/12 text-primary',
  THROTTLED: 'bg-[var(--chat-warning-background)] text-[var(--chat-warning-foreground)]',
  DRAFT: 'bg-muted text-muted-foreground',
};

function formatCategory(category: string): string {
  return category.charAt(0) + category.slice(1).toLowerCase().replace(/_/g, ' ');
}

function CharacterCount({ value, max }: { value: string; max: number }) {
  return (
    <span className={cn('text-xs tabular-nums text-muted-foreground', value.length > max && 'font-medium text-red-600 dark:text-red-400')}>
      {value.length}/{max}
    </span>
  );
}

export function FlowMessageDialog({ open, onOpenChange, phoneNumber, phoneNumberId, onMessageSent }: Props) {
  const [search, setSearch] = useState('');
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [cta, setCta] = useState('Open');
  const [body, setBody] = useState('');
  const [header, setHeader] = useState('');
  const [footer, setFooter] = useState('');
  const [sending, setSending] = useState(false);

  const { data: flows = [], isPending, error } = useQuery({
    queryKey: ['flows', phoneNumberId ?? ''],
    queryFn: () => apiFetch<{ data: FlowSummary[] }>(
      `/api/flows${phoneNumberId ? `?phoneNumberId=${encodeURIComponent(phoneNumberId)}` : ''}`,
      { errorMessage: 'Failed to load flows' },
    ).then((response) => response.data),
    enabled: open,
    staleTime: 60_000,
  });

  const filteredFlows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...flows].sort((a, b) => (a.status === 'DRAFT' ? 1 : 0) - (b.status === 'DRAFT' ? 1 : 0));
    return query ? sorted.filter((flow) => flow.name.toLowerCase().includes(query)) : sorted;
  }, [flows, search]);

  const selectedFlow = flows.find((flow) => flow.id === selectedFlowId);
  const ctaError = EMOJI_PATTERN.test(cta) ? 'Emoji are not allowed in the button' : null;
  const canSend = Boolean(
    selectedFlow &&
    cta.trim() && cta.length <= FLOW_LIMITS.cta && !ctaError &&
    body.trim() && body.length <= FLOW_LIMITS.body &&
    header.length <= FLOW_LIMITS.header && footer.length <= FLOW_LIMITS.footer,
  ) && !sending;

  const reset = () => {
    setSearch('');
    setSelectedFlowId(null);
    setCta('Open');
    setBody('');
    setHeader('');
    setFooter('');
  };

  const handleSend = async () => {
    if (!canSend || !selectedFlow || !phoneNumber) return;

    setSending(true);
    try {
      await apiFetch('/api/messages/flow', {
        method: 'POST',
        body: {
          to: phoneNumber,
          phoneNumberId,
          flowId: selectedFlow.id,
          cta: cta.trim(),
          body: body.trim(),
          header: header.trim() || undefined,
          footer: footer.trim() || undefined,
          draft: selectedFlow.status === 'DRAFT',
        },
        errorMessage: 'Failed to send flow',
      });
      toast.success(`Sent “${selectedFlow.name}”`);
      reset();
      onOpenChange(false);
      await onMessageSent?.();
    } catch (sendError) {
      toast.error("Couldn't send the flow", { description: errorMessage(sendError) });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (sending) return;
        onOpenChange(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-primary/12 text-primary">
              <Workflow aria-hidden="true" className="size-4" />
            </span>
            Send flow
          </DialogTitle>
          <DialogDescription>
            Open a WhatsApp Flow form for the contact. Their answers come back here as a response card.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[min(66dvh,600px)] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label htmlFor="flow-search" className="text-foreground">Flow</Label>
            <div className="relative">
              <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="flow-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search flows"
                className="h-11 border-[var(--chat-border-strong)] bg-[var(--chat-input)] pl-9 text-base md:h-10 md:text-sm"
              />
            </div>

            <div role="radiogroup" aria-label="Flows" className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-[var(--chat-border)] p-1">
              {isPending ? (
                [0, 1, 2].map((index) => <Skeleton key={index} className="h-12 w-full rounded-md" />)
              ) : error ? (
                <p role="alert" className="px-3 py-6 text-center text-sm text-red-600 dark:text-red-400">{errorMessage(error)}</p>
              ) : filteredFlows.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {flows.length === 0 ? (
                    <>
                      No flows yet.{' '}
                      <a href="https://app.kapso.ai" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        Create one in Kapso <ExternalLink aria-hidden="true" className="size-3" />
                      </a>
                    </>
                  ) : 'No flows match your search.'}
                </div>
              ) : (
                filteredFlows.map((flow) => {
                  const selected = flow.id === selectedFlowId;
                  return (
                    <button
                      key={flow.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setSelectedFlowId(flow.id)}
                      className={cn(
                        'flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-[var(--chat-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                        selected && 'bg-primary/10 ring-1 ring-primary/40 hover:bg-primary/12',
                      )}
                    >
                      <span className={cn('size-4 flex-shrink-0 rounded-full border-2', selected ? 'border-primary bg-primary shadow-[inset_0_0_0_2px_var(--background)]' : 'border-muted-foreground/40')} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{flow.name}</span>
                        {flow.categories.length > 0 && (
                          <span className="block truncate text-xs text-muted-foreground">{flow.categories.map(formatCategory).join(' · ')}</span>
                        )}
                      </span>
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide', STATUS_STYLES[flow.status] ?? STATUS_STYLES.DRAFT)}>
                        {flow.status === 'DRAFT' ? 'DRAFT · TEST' : flow.status}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {selectedFlow?.status === 'THROTTLED' && (
              <p className="text-xs text-[var(--chat-warning-foreground)]">This flow is throttled: WhatsApp allows about 10 sends per hour.</p>
            )}
            {selectedFlow?.status === 'DRAFT' && (
              <p className="text-xs text-muted-foreground">Drafts are sent in test mode. Publish the flow before using it with customers.</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="flow-cta" className="text-foreground">Button <span className="text-red-500">*</span></Label>
                <CharacterCount value={cta} max={FLOW_LIMITS.cta} />
              </div>
              <Input
                id="flow-cta"
                value={cta}
                onChange={(event) => setCta(event.target.value)}
                maxLength={FLOW_LIMITS.cta}
                aria-invalid={Boolean(ctaError) || undefined}
                className="h-11 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-base md:h-10 md:text-sm"
              />
              {ctaError && <p className="text-xs text-red-600 dark:text-red-400">{ctaError}</p>}
            </div>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="flow-header" className="text-foreground">Header</Label>
                <CharacterCount value={header} max={FLOW_LIMITS.header} />
              </div>
              <Input
                id="flow-header"
                value={header}
                onChange={(event) => setHeader(event.target.value)}
                maxLength={FLOW_LIMITS.header}
                placeholder="Optional"
                className="h-11 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-base md:h-10 md:text-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="flow-body" className="text-foreground">Message <span className="text-red-500">*</span></Label>
              <CharacterCount value={body} max={FLOW_LIMITS.body} />
            </div>
            <Textarea
              id="flow-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Tell the contact what the form is for"
              className="min-h-[88px] border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-base md:text-sm"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="flow-footer" className="text-foreground">Footer</Label>
              <CharacterCount value={footer} max={FLOW_LIMITS.footer} />
            </div>
            <Input
              id="flow-footer"
              value={footer}
              onChange={(event) => setFooter(event.target.value)}
              maxLength={FLOW_LIMITS.footer}
              placeholder="Optional"
              className="h-11 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-base md:h-10 md:text-sm"
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
            <div className="rounded-lg bg-[var(--chat-canvas)] p-3 outline outline-1 [outline-color:var(--chat-border)]">
              <div className="ml-auto w-[min(17rem,100%)] overflow-hidden rounded-lg rounded-br-none bg-[var(--chat-bubble-outgoing)] shadow-sm">
                <div className="space-y-1 px-3 pb-1.5 pt-2">
                  {header.trim() && <p className="text-sm font-semibold">{header.trim()}</p>}
                  <p className={cn('whitespace-pre-wrap break-words text-sm', !body.trim() && 'italic text-muted-foreground')}>
                    {body.trim() || 'Your message appears here'}
                  </p>
                  {footer.trim() && <p className="text-xs text-muted-foreground">{footer.trim()}</p>}
                </div>
                <div className="flex h-10 items-center justify-center gap-1.5 border-t border-[var(--chat-border)] text-sm font-medium text-[var(--chat-check)]">
                  <Workflow aria-hidden="true" className="size-4" />
                  {cta.trim() || 'Open'}
                </div>
              </div>
            </div>
          </div>
        </div>

        <Separator />

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <Button variant="outline" className="h-11 sm:h-9" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={!canSend} className="h-11 bg-primary hover:bg-[var(--primary-hover)] sm:h-9">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? 'Sending' : 'Send flow'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
