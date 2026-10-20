'use client';

import { EmojiPicker as Picker, type EmojiPickerRootProps } from 'frimousse';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Emoji data is served by the app (see src/app/emojibase), not a public CDN. */
const EMOJIBASE_URL = '/emojibase';

type EmojiPickerProps = {
  onSelect: (emoji: string) => void;
  className?: string;
  columns?: number;
  autoFocus?: boolean;
} & Pick<EmojiPickerRootProps, 'skinTone'>;

/**
 * Full emoji picker with search, sticky category headers and a skin tone toggle.
 * Virtualized, so the whole Unicode set scrolls smoothly on phones.
 */
export function EmojiPicker({ onSelect, className, columns = 8, autoFocus = false, skinTone }: EmojiPickerProps) {
  return (
    <Picker.Root
      columns={columns}
      skinTone={skinTone}
      emojibaseUrl={EMOJIBASE_URL}
      onEmojiSelect={({ emoji }) => onSelect(emoji)}
      className={cn('isolate flex h-full min-h-0 w-full flex-col', className)}
    >
      <div className="flex items-center gap-2 px-2 pb-2 pt-1">
        <label className="relative flex min-w-0 flex-1 items-center">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
          <span className="sr-only">Search emoji</span>
          <Picker.Search
            autoFocus={autoFocus}
            placeholder="Search emoji"
            className="h-10 w-full rounded-xl border border-transparent bg-[var(--chat-hover)] pl-9 pr-3 text-base outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-primary/40 focus-visible:ring-4 focus-visible:ring-primary/10 sm:text-sm"
          />
        </label>
        <Picker.SkinToneSelector
          className="flex size-10 flex-shrink-0 items-center justify-center rounded-xl text-xl transition-colors hover:bg-[var(--chat-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          title="Change skin tone"
        />
      </div>

      <Picker.Viewport className="relative min-h-0 flex-1 outline-none">
        <Picker.Loading className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Loading emoji…
        </Picker.Loading>
        <Picker.Empty className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {({ search }) => <>No emoji match “{search}”</>}
        </Picker.Empty>
        <Picker.List
          className="select-none pb-2"
          components={{
            CategoryHeader: ({ category, ...props }) => (
              <div
                {...props}
                className="bg-popover/95 px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm"
              >
                {category.label}
              </div>
            ),
            Row: ({ children, ...props }) => (
              <div {...props} className="scroll-my-1 px-1.5">
                {children}
              </div>
            ),
            Emoji: ({ emoji, ...props }) => (
              <button
                {...props}
                // Fixed column width, so short rows (search results) don't stretch.
                className="flex aspect-square w-[calc(100%/var(--frimousse-list-columns))] items-center justify-center rounded-xl text-2xl transition-transform duration-100 data-[active]:scale-110 data-[active]:bg-[var(--chat-hover)] active:scale-95 sm:text-[1.4rem]"
              >
                {emoji.emoji}
              </button>
            ),
          }}
        />
      </Picker.Viewport>
    </Picker.Root>
  );
}
