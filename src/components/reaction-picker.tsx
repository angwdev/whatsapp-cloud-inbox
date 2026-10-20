'use client';

import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MessageReaction } from '@/lib/inbox-data';
import { PopoverContent } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { EmojiPicker } from '@/components/ui/emoji-picker';

// WhatsApp's default quick reactions.
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** Arrow keys move between the quick reactions and the actions below them. */
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
  const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
  if (!horizontal && !vertical && event.key !== 'Home' && event.key !== 'End') return;

  const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-menu-option]'));
  const index = options.indexOf(document.activeElement as HTMLElement);
  if (index === -1) return;

  event.preventDefault();
  const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + step + options.length) % options.length;
  options[next]?.focus();
}

/** Full-screen-width sheets on phones and narrow windows, a popover panel elsewhere. */
export function prefersEmojiSheet(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 639px), (pointer: coarse)').matches;
}

export type MessageAction = {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
};

type MessageActionsContentProps = {
  /** Omitted when the message can't be reacted to (your own messages, closed window). */
  onReact?: (emoji: string) => void;
  currentEmoji?: string;
  /** Shown under the reactions, as a menu, on touch screens. */
  actions?: MessageAction[];
  align: 'start' | 'end';
  /** Asked to open the full picker as a bottom sheet instead of inside the popover. */
  onOpenEmojiSheet?: () => void;
};

/**
 * What a long-press (touch) or the react button (pointer) opens: the quick
 * reaction bar, the full emoji picker behind "+", and message actions.
 * Choosing your current reaction again removes it.
 */
export function MessageActionsContent({ onReact, currentEmoji, actions = [], align, onOpenEmojiSheet }: MessageActionsContentProps) {
  const [showFullPicker, setShowFullPicker] = useState(false);
  const quickReactions = currentEmoji && !QUICK_REACTIONS.includes(currentEmoji)
    ? [...QUICK_REACTIONS.slice(0, 5), currentEmoji]
    : QUICK_REACTIONS;

  const openFullPicker = () => {
    if (onOpenEmojiSheet && prefersEmojiSheet()) {
      onOpenEmojiSheet();
      return;
    }
    setShowFullPicker(true);
  };

  if (showFullPicker && onReact) {
    return (
      <PopoverContent
        side="top"
        align={align}
        sideOffset={8}
        aria-label="Choose a reaction"
        // A fixed height lets the popover flip below the message instead of shrinking.
        className="flex h-[24rem] max-h-[calc(100dvh-2rem)] w-[22rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl p-1.5 pt-2"
      >
        <EmojiPicker autoFocus onSelect={(emoji) => onReact(emoji === currentEmoji ? '' : emoji)} />
      </PopoverContent>
    );
  }

  return (
    <PopoverContent
      side="top"
      align={align}
      sideOffset={8}
      onKeyDown={moveFocus}
      aria-label={onReact ? 'React or choose an action' : 'Message actions'}
      // Two floating cards (reaction bar, action menu) rather than one box.
      className="flex w-auto flex-col gap-2 border-0 bg-transparent p-0 shadow-none data-[side=bottom]:flex-col-reverse"
    >
      {onReact && (
        <div
          role="group"
          aria-label="Quick reactions"
          className={cn(
            'flex w-max max-w-[calc(100vw-1.5rem)] items-center gap-0.5 rounded-full border border-[var(--chat-border-strong)] bg-popover p-1 shadow-xl shadow-black/10',
            align === 'end' && 'self-end',
          )}
        >
          {quickReactions.map((emoji, index) => {
            const selected = emoji === currentEmoji;
            return (
              <button
                key={emoji}
                type="button"
                data-menu-option
                onClick={() => onReact(selected ? '' : emoji)}
                aria-pressed={selected}
                aria-label={selected ? `Remove ${emoji} reaction` : `React with ${emoji}`}
                style={{ animationDelay: `${index * 18}ms` }}
                className={cn(
                  'flex size-11 touch-manipulation items-center justify-center rounded-full text-[1.65rem] leading-none transition-[transform,background-color] duration-150 ease-out animate-in fade-in-0 zoom-in-75 fill-mode-both hover:-translate-y-0.5 hover:scale-115 hover:bg-[var(--chat-hover)] focus-visible:scale-110 focus-visible:bg-[var(--chat-hover)] focus-visible:outline-none active:scale-95 motion-reduce:animate-none motion-reduce:hover:transform-none sm:size-10',
                  selected && 'bg-primary/15 ring-1 ring-inset ring-primary/40',
                )}
              >
                <span aria-hidden="true">{emoji}</span>
              </button>
            );
          })}
          <button
            type="button"
            data-menu-option
            onClick={openFullPicker}
            aria-label="More reactions"
            title="More reactions"
            className="ml-0.5 flex size-11 touch-manipulation items-center justify-center rounded-full bg-[var(--chat-hover)] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 sm:size-10"
          >
            <Plus aria-hidden="true" className="size-5" />
          </button>
        </div>
      )}

      {actions.length > 0 && (
        <div
          role="menu"
          aria-label="Message actions"
          className={cn(
            'w-56 overflow-hidden rounded-2xl border border-[var(--chat-border-strong)] bg-popover p-1 shadow-xl shadow-black/10 animate-in fade-in-0 zoom-in-95',
            align === 'end' && 'self-end',
          )}
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              data-menu-option
              onClick={action.onSelect}
              className={cn(
                'flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] transition-colors hover:bg-[var(--chat-hover)] focus-visible:bg-[var(--chat-hover)] focus-visible:outline-none',
                action.destructive ? 'text-red-600 dark:text-red-400' : 'text-foreground',
              )}
            >
              <span aria-hidden="true" className="text-muted-foreground [&_svg]:size-[18px]">{action.icon}</span>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </PopoverContent>
  );
}

type EmojiPickerSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (emoji: string) => void;
};

/** The full emoji picker as a bottom sheet, for phones and narrow windows. */
export function EmojiPickerSheet({ open, onOpenChange, onSelect }: EmojiPickerSheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(70dvh,32rem)] flex-col gap-0 p-2 pt-3 sm:max-w-sm sm:p-2" showCloseButton={false}>
        <DialogTitle className="sr-only">Choose a reaction</DialogTitle>
        <DialogDescription className="sr-only">Search or browse emoji to react with.</DialogDescription>
        <EmojiPicker
          columns={8}
          onSelect={(emoji) => {
            onSelect(emoji);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function describeReactions(reactions: MessageReaction[], contactLabel: string): string {
  return reactions
    .map((reaction) => `${reaction.direction === 'outbound' ? 'You' : contactLabel} reacted ${reaction.emoji}${reaction.pending ? ' (sending)' : ''}`)
    .join(', ');
}

type ReactionChipsProps = {
  reactions: MessageReaction[];
  contactLabel: string;
  align: 'start' | 'end';
  /** Set when you can change your own reaction from the chip. */
  onClick?: () => void;
};

export function ReactionChips({ reactions, contactLabel, align, onClick }: ReactionChipsProps) {
  if (reactions.length === 0) return null;

  const sameEmoji = reactions.length > 1 && reactions.every((reaction) => reaction.emoji === reactions[0].emoji);
  const emojis = sameEmoji ? [reactions[0].emoji] : reactions.map((reaction) => reaction.emoji);
  const pending = reactions.some((reaction) => reaction.pending);
  const label = describeReactions(reactions, contactLabel);
  const className = cn(
    'relative z-[1] -mt-2 inline-flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-full border-2 border-[var(--chat-canvas)] bg-[var(--chat-surface)] px-1.5 text-[15px] leading-none shadow-sm ring-1 ring-[var(--chat-border-strong)] animate-in zoom-in-50 fade-in-0 duration-200',
    align === 'end' ? 'mr-2 self-end' : 'ml-2 self-start',
    pending && 'opacity-70',
  );
  const content = (
    <>
      {emojis.map((emoji) => (
        <span key={emoji} aria-hidden="true">{emoji}</span>
      ))}
      {sameEmoji && (
        <span aria-hidden="true" className="ml-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
          {reactions.length}
        </span>
      )}
    </>
  );

  if (!onClick) {
    return (
      <span role="img" aria-label={label} title={label} className={className}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}. Change your reaction`}
      title={label}
      className={cn(
        className,
        // The pseudo-element widens the tap target past the small pill.
        'touch-manipulation transition-[transform,background-color] after:absolute after:-inset-2 after:content-[""] hover:bg-[var(--chat-hover)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
      )}
    >
      {content}
    </button>
  );
}
