'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ListTree, MapPin, Paperclip, Plus, Reply, Send, Workflow, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  MEDIA_ACCEPT,
  MEDIA_CAPTION_MAX_LENGTH,
  TEXT_BODY_MAX_LENGTH,
  formatBytes,
  validateOutboundMedia,
} from '@/lib/media-limits';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const DRAFTS_STORAGE_KEY = 'whatsapp-cloud-inbox-drafts';
const MAX_TEXTAREA_HEIGHT_PX = 160;
/** Meta shows a typing indicator for 25 seconds; refresh it a little before that. */
const TYPING_SIGNAL_INTERVAL_MS = 20_000;

type Drafts = Record<string, { text: string; updatedAt: number }>;

function readDrafts(): Drafts {
  try {
    const stored = window.localStorage.getItem(DRAFTS_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeDraft(threadKey: string, text: string) {
  try {
    const drafts = readDrafts();
    if (text.trim()) {
      drafts[threadKey] = { text, updatedAt: Date.now() };
    } else {
      delete drafts[threadKey];
    }
    // Keep the 50 most recent drafts.
    const entries = Object.entries(drafts).sort(([, a], [, b]) => b.updatedAt - a.updatedAt).slice(0, 50);
    window.localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Drafts are a convenience; losing one is fine.
  }
}

export type ComposerReplyTarget = {
  senderLabel: string;
  preview: string;
};

export type ComposerSendInput = {
  text: string;
  file: File | null;
};

export type ComposerHandle = {
  focus: () => void;
  /** Validates and attaches a file, e.g. one dropped on the conversation. */
  attachFile: (file: File) => void;
};

type ComposerProps = {
  threadKey: string;
  disabled?: boolean;
  replyTarget?: ComposerReplyTarget | null;
  onCancelReply: () => void;
  /** Queues the message; the composer clears right away and the thread shows it as sending. */
  onSend: (input: ComposerSendInput) => void;
  onTyping?: () => void;
  onOpenInteractive: () => void;
  onOpenLocationRequest: () => void;
  onOpenFlow: () => void;
};

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    threadKey,
    disabled = false,
    replyTarget,
    onCancelReply,
    onSend,
    onTyping,
    onOpenInteractive,
    onOpenLocationRequest,
    onOpenFlow,
  },
  ref,
) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingSignalRef = useRef(0);
  const draftTimeoutRef = useRef<number | null>(null);
  const maxLength = file ? MEDIA_CAPTION_MAX_LENGTH : TEXT_BODY_MAX_LENGTH;
  const overLimit = text.length > maxLength;
  const canSend = !disabled && !overLimit && Boolean(text.trim() || file);

  // Restore the draft for this thread.
  useEffect(() => {
    setText(readDrafts()[threadKey]?.text ?? '');
    setFile(null);
    lastTypingSignalRef.current = 0;
  }, [threadKey]);

  useEffect(() => () => {
    if (draftTimeoutRef.current !== null) window.clearTimeout(draftTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setFilePreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Grow with the content up to a limit, then scroll.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
  }, [text]);

  const attachFile = useCallback((candidate: File) => {
    const validation = validateOutboundMedia(candidate);
    if (!validation.ok) {
      toast.error("Can't attach this file", { description: validation.reason });
      return;
    }
    setFile(candidate);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    attachFile,
  }), [attachFile]);

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleChange = (value: string) => {
    setText(value);

    if (draftTimeoutRef.current !== null) window.clearTimeout(draftTimeoutRef.current);
    draftTimeoutRef.current = window.setTimeout(() => writeDraft(threadKey, value), 400);

    const now = Date.now();
    if (value.trim() && onTyping && now - lastTypingSignalRef.current > TYPING_SIGNAL_INTERVAL_MS) {
      lastTypingSignalRef.current = now;
      onTyping();
    }
  };

  const submit = () => {
    if (!canSend) return;
    onSend({ text: text.trim(), file });
    setText('');
    writeDraft(threadKey, '');
    clearFile();
    lastTypingSignalRef.current = 0;
    textareaRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    // On phones Enter adds a line break, like WhatsApp; the send button sends.
    if (window.matchMedia('(pointer: coarse)').matches && !event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    submit();
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedFile = Array.from(event.clipboardData.files)[0];
    if (!pastedFile) return;
    event.preventDefault();
    attachFile(pastedFile);
  };

  const actions = [
    { icon: ListTree, label: 'Interactive buttons', description: 'Up to 3 quick-reply buttons', onSelect: onOpenInteractive },
    { icon: MapPin, label: 'Request location', description: 'Ask the contact to share where they are', onSelect: onOpenLocationRequest },
    { icon: Workflow, label: 'Send flow', description: 'Open a WhatsApp Flow form', onSelect: onOpenFlow },
  ];

  return (
    <>
      {replyTarget && (
        <div className="border-b border-[var(--chat-border-strong)] bg-[var(--chat-surface)] px-4 py-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
          <div className="mx-auto flex w-full max-w-[900px] items-center gap-2">
            <Reply aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-primary" />
            <div className="min-w-0 flex-1 border-l-2 border-primary/60 pl-2">
              <p className="truncate text-xs font-medium text-primary">Replying to {replyTarget.senderLabel}</p>
              <p className="truncate text-xs text-muted-foreground">{replyTarget.preview}</p>
            </div>
            <Button
              onClick={onCancelReply}
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 flex-shrink-0 text-muted-foreground md:size-8"
              aria-label="Cancel reply"
              title="Cancel reply (Esc)"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {file && (
        <div className="border-b border-[var(--chat-border-strong)] bg-[var(--chat-surface)] px-4 py-3 animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
          <div className="mx-auto flex w-full max-w-[900px] items-center gap-3">
            {filePreview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
              <img src={filePreview} alt="" className="size-14 rounded-md object-cover outline outline-1 [outline-color:var(--chat-media-outline)]" />
            ) : (
              <div className="flex size-14 items-center justify-center rounded-md bg-[var(--chat-hover)]">
                <Paperclip aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {formatBytes(file.size)} · Add a caption below (optional)
              </p>
            </div>
            <Button
              onClick={clearFile}
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 text-muted-foreground md:size-10"
              aria-label="Remove attachment"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="mx-auto flex w-full max-w-[900px] items-end gap-1.5 px-3 py-2.5 sm:gap-2 sm:p-3"
      >
        <input
          ref={fileInputRef}
          type="file"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) attachFile(selected);
            event.target.value = '';
          }}
          accept={MEDIA_ACCEPT}
          className="hidden"
          tabIndex={-1}
        />
        <Button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          variant="ghost"
          size="icon"
          className="size-11 text-muted-foreground hover:bg-[var(--chat-icon-hover)] md:size-10"
          aria-label="Attach file"
          title="Attach file (or paste / drop it)"
        >
          <Paperclip className="h-5 w-5" />
        </Button>

        <Popover open={showActions} onOpenChange={setShowActions}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              disabled={disabled}
              size="icon"
              variant="ghost"
              className="size-11 text-muted-foreground hover:bg-[var(--chat-hover)] data-[state=open]:bg-[var(--chat-hover)] data-[state=open]:text-primary md:size-10"
              aria-label="More message types"
              title="More message types"
            >
              <Plus className={cn('h-5 w-5 transition-transform duration-200', showActions && 'rotate-45')} />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-72 p-1">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => {
                  setShowActions(false);
                  action.onSelect();
                }}
                className="flex min-h-14 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--chat-hover)] focus-visible:bg-[var(--chat-hover)] focus-visible:outline-none"
              >
                <span className="flex size-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
                  <action.icon aria-hidden="true" className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{action.label}</span>
                  <span className="block text-xs text-muted-foreground">{action.description}</span>
                </span>
              </button>
            ))}
          </PopoverContent>
        </Popover>

        <div className="relative min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => handleChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={file ? 'Add a caption' : 'Type a message'}
            disabled={disabled}
            rows={1}
            autoComplete="off"
            enterKeyHint="send"
            aria-label="Message"
            aria-invalid={overLimit || undefined}
            className={cn(
              'block max-h-40 min-h-11 w-full resize-none rounded-2xl border border-[var(--chat-border-strong)] bg-[var(--chat-input)] px-4 py-2.5 text-base leading-6 outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:opacity-50 md:min-h-10 md:py-2 md:text-sm md:leading-6',
              overLimit && 'border-red-500/70 focus-visible:border-red-500/70 focus-visible:ring-red-500/20',
            )}
          />
          {text.length > maxLength * 0.9 && (
            <span
              aria-live="polite"
              className={cn(
                'pointer-events-none absolute -top-5 right-2 text-[11px] tabular-nums',
                overLimit ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground',
              )}
            >
              {text.length}/{maxLength}
            </span>
          )}
        </div>

        <Button
          type="submit"
          disabled={!canSend}
          size="icon"
          className="size-11 rounded-full bg-primary hover:bg-[var(--primary-hover)] md:size-10"
          aria-label="Send message"
          title="Send (Enter) · New line (Shift+Enter)"
        >
          <Send className="h-5 w-5" />
        </Button>
      </form>
    </>
  );
});
