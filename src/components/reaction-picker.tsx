'use client';

import { useState, type KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MessageReaction } from '@/lib/inbox-data';
import { PopoverContent } from '@/components/ui/popover';

// WhatsApp's default quick reactions.
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const MORE_REACTIONS = [
  '😀', '😁', '😊', '😍', '🥰', '😘', '😉', '😎',
  '🤩', '🥳', '😇', '🤗', '🤔', '🫡', '😅', '🤣',
  '😌', '😴', '🙄', '😬', '😳', '🥺', '😭', '😡',
  '🤯', '😱', '🤝', '👏', '🙌', '👌', '✌️', '🤞',
  '💪', '👀', '🔥', '✨', '💯', '✅', '❌', '⭐',
  '🎉', '🎁', '💡', '📍', '📦', '🚚', '⏰', '💚',
];

/** Arrow keys move between options, a row at a time inside the grid. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;

  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-reaction-option]'));
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (index === -1) return;

  event.preventDefault();
  const columns = Number(
    (document.activeElement as HTMLElement).closest<HTMLElement>('[data-columns]')?.dataset.columns ?? buttons.length,
  );
  const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index + steps[event.key];

  buttons[Math.max(0, Math.min(buttons.length - 1, nextIndex))]?.focus();
}

type ReactionPickerContentProps = {
  currentEmoji?: string;
  align?: 'start' | 'end';
  onSelect: (emoji: string) => void;
};

/**
 * Popover body for reacting to a message. Choosing the current reaction again removes it.
 */
export function ReactionPickerContent({ currentEmoji, align = 'start', onSelect }: ReactionPickerContentProps) {
  const [expanded, setExpanded] = useState(false);
  const currentIsQuick = currentEmoji ? QUICK_REACTIONS.includes(currentEmoji) : true;
  const quickReactions = currentIsQuick || !currentEmoji ? QUICK_REACTIONS : [...QUICK_REACTIONS.slice(0, 5), currentEmoji];

  const renderOption = (emoji: string, size: 'lg' | 'md') => {
    const selected = emoji === currentEmoji;
    return (
      <button
        key={emoji}
        type="button"
        data-reaction-option
        onClick={() => onSelect(selected ? '' : emoji)}
        aria-pressed={selected}
        aria-label={selected ? `Remove ${emoji} reaction` : `React with ${emoji}`}
        title={selected ? 'Remove reaction' : undefined}
        className={cn(
          'flex touch-manipulation items-center justify-center rounded-full leading-none transition-[transform,background-color] duration-150 ease-out hover:scale-110 hover:bg-[var(--chat-hover)] focus-visible:scale-110 focus-visible:bg-[var(--chat-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 active:scale-95 motion-reduce:hover:scale-100',
          size === 'lg' ? 'size-11 text-[1.6rem] sm:size-10' : 'size-9 text-xl',
          selected && 'bg-primary/15 ring-1 ring-primary/40 hover:bg-primary/20',
        )}
      >
        <span aria-hidden="true">{emoji}</span>
      </button>
    );
  };

  return (
    <PopoverContent
      side="top"
      align={align}
      className="w-auto max-w-[calc(100vw-1.5rem)] rounded-full p-1 data-[expanded=true]:rounded-2xl"
      data-expanded={expanded}
      onKeyDown={moveFocus}
      aria-label="Choose a reaction"
    >
      <div role="group" aria-label="Quick reactions" data-columns={quickReactions.length + 1} className="flex items-center gap-0.5">
        {quickReactions.map((emoji) => renderOption(emoji, 'lg'))}
        <button
          type="button"
          data-reaction-option
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Fewer reactions' : 'More reactions'}
          className="flex size-11 touch-manipulation items-center justify-center rounded-full bg-[var(--chat-hover)] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 sm:size-10"
        >
          <Plus aria-hidden="true" className={cn('size-5 transition-transform duration-200', expanded && 'rotate-45')} />
        </button>
      </div>

      {expanded && (
        <div className="animate-in fade-in-0 slide-in-from-top-1 duration-150">
          <div
            role="group"
            aria-label="More reactions"
            data-columns={8}
            className="mt-1 grid max-h-44 grid-cols-8 gap-0.5 overflow-y-auto overscroll-contain border-t border-[var(--chat-border)] px-0.5 pt-1.5"
          >
            {MORE_REACTIONS.map((emoji) => renderOption(emoji, 'md'))}
          </div>
          {currentEmoji && (
            <button
              type="button"
              data-reaction-option
              onClick={() => onSelect('')}
              className="mt-1 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-muted-foreground transition-colors hover:bg-[var(--chat-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <X aria-hidden="true" className="size-3.5" />
              Remove my reaction
            </button>
          )}
        </div>
      )}
    </PopoverContent>
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
    'relative z-[1] -mt-2.5 inline-flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-full border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] px-1.5 text-[15px] leading-none shadow-sm animate-in zoom-in-50 fade-in-0 duration-200',
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
