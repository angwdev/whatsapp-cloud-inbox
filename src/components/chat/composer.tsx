'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { FileText, ListTree, MapPin, Paperclip, Plus, Reply, SendHorizontal, Workflow, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  MEDIA_ACCEPT,
  MEDIA_CAPTION_MAX_LENGTH,
  TEXT_BODY_MAX_LENGTH,
  formatBytes,
  validateOutboundMedia,
} from '@/lib/media-limits';
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
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="mx-auto flex w-full max-w-[900px] items-end gap-2 px-2.5 py-2 sm:px-4 sm:py-3"
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

      {/* One field holds the reply preview, attachment, text and the inline buttons. */}
      <div
        className={cn(
          'min-w-0 flex-1 overflow-hidden rounded-[1.375rem] border border-[var(--chat-border-strong)] bg-[var(--chat-input)] shadow-sm transition-[border-color,box-shadow] duration-150',
          'focus-within:border-primary/40 focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_10%,transparent)]',
          overLimit && 'border-red-500/60 focus-within:border-red-500/60 focus-within:shadow-[0_0_0_4px_rgb(239_68_68/0.14)]',
        )}
      >
        {replyTarget && (
          <div className="m-1.5 mb-0 flex items-center gap-2 rounded-2xl bg-[var(--chat-hover)] py-1.5 pl-3 pr-1 animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
            <div className="min-w-0 flex-1 border-l-[3px] border-primary pl-2">
              <p className="flex items-center gap-1 truncate text-xs font-semibold text-primary">
                <Reply aria-hidden="true" className="size-3 flex-shrink-0" />
                Replying to {replyTarget.senderLabel}
              </p>
              <p className="truncate text-[13px] text-muted-foreground">{replyTarget.preview}</p>
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              className="flex size-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
              aria-label="Cancel reply"
              title="Cancel reply (Esc)"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        {file && (
          <div className="m-1.5 mb-0 flex items-center gap-3 rounded-2xl bg-[var(--chat-hover)] p-1.5 pr-1 animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
            {filePreview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
              <img src={filePreview} alt="" className="size-12 rounded-xl object-cover" />
            ) : (
              <div className="flex size-12 items-center justify-center rounded-xl bg-background/70">
                <FileText aria-hidden="true" className="size-5 text-primary" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
              <p className="text-xs tabular-nums text-muted-foreground">{formatBytes(file.size)} · Caption optional</p>
            </div>
            <button
              type="button"
              onClick={clearFile}
              className="flex size-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
              aria-label="Remove attachment"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        <div className="flex items-end">
          <Popover open={showActions} onOpenChange={setShowActions}>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                className="m-1 flex size-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--chat-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50 data-[state=open]:bg-primary/12 data-[state=open]:text-primary"
                aria-label="More message types"
                title="More message types"
              >
                <Plus className={cn('size-5 transition-transform duration-200', showActions && 'rotate-45')} />
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" sideOffset={10} className="w-72 rounded-2xl p-1.5">
              <div role="menu" aria-label="Message types">
                {actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowActions(false);
                      action.onSelect();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[var(--chat-hover)] focus-visible:bg-[var(--chat-hover)] focus-visible:outline-none"
                  >
                    <span className="flex size-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                      <action.icon aria-hidden="true" className="size-[18px]" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">{action.label}</span>
                      <span className="block text-xs leading-4 text-muted-foreground">{action.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => handleChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={file ? 'Add a caption' : 'Message'}
            disabled={disabled}
            rows={1}
            autoComplete="off"
            enterKeyHint="send"
            aria-label="Message"
            aria-invalid={overLimit || undefined}
            className="block max-h-40 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-1 py-[0.6875rem] text-base leading-[1.375rem] outline-none placeholder:text-muted-foreground disabled:opacity-50 md:text-[15px]"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="m-1 flex size-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--chat-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50"
            aria-label="Attach file"
            title="Attach file (or paste / drop it)"
          >
            <Paperclip className="size-5" />
          </button>
        </div>

        {text.length > maxLength * 0.9 && (
          <p
            aria-live="polite"
            className={cn(
              'px-4 pb-1.5 text-right text-[11px] tabular-nums',
              overLimit ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground',
            )}
          >
            {text.length}/{maxLength}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={!canSend}
        className={cn(
          'flex size-11 flex-shrink-0 items-center justify-center rounded-full shadow-sm transition-[background-color,transform,box-shadow,color] duration-200 ease-out focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 active:scale-90',
          canSend
            ? 'bg-primary text-primary-foreground shadow-primary/30 hover:bg-[var(--primary-hover)] hover:shadow-md'
            : 'bg-[var(--chat-hover)] text-muted-foreground shadow-none',
        )}
        aria-label="Send message"
        title="Send (Enter) · New line (Shift+Enter)"
      >
        <SendHorizontal className={cn('size-5 transition-transform duration-200', canSend && 'translate-x-px')} />
      </button>
    </form>
  );
});
