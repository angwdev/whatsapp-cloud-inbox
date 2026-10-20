'use client';

import { memo } from 'react';
import { Check, Clock, MapPin, Mic, RotateCcw, Smile, Trash2, Reply, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isLocationRequestMessage, type Message } from '@/lib/inbox-data';
import { describeWhatsAppError, isWindowClosedError } from '@/lib/whatsapp-errors';
import { getOutboundReaction } from '@/hooks/use-local-reactions';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverTrigger } from '@/components/ui/popover';
import { MediaMessage } from '@/components/media-message';
import { LocationMessage, LocationRequestFooter } from '@/components/location-message';
import { ReactionChips, ReactionPickerContent } from '@/components/reaction-picker';
import { FormattedText } from '@/components/chat/formatted-text';
import {
  FlowResponseCard,
  InteractiveReplyChip,
  InteractiveSummaryFooter,
  MessageErrorNotice,
  OrderCard,
  SharedContactsCard,
} from '@/components/chat/message-extras';
import { formatMessageTime, getDisplayMessageContent, getMessageSenderLabel } from '@/components/chat/message-utils';

function MessageStatus({ message }: { message: Message }) {
  if (message.localState === 'sending') {
    return <Clock aria-label="Sending" className="size-3 text-[var(--chat-tick)]" />;
  }
  if (message.localState === 'failed' || message.status === 'failed') {
    return <XCircle aria-label="Not delivered" className="size-3.5 text-red-500" />;
  }

  switch (message.status) {
    case 'played':
      return <Mic aria-label="Played" className="size-3.5 text-[var(--chat-tick-read)]" />;
    case 'read':
    case 'delivered':
      return (
        <span
          aria-label={message.status === 'read' ? 'Read' : 'Delivered'}
          className={cn(
            'relative inline-flex h-3.5 w-[1.125rem] items-center',
            message.status === 'read' ? 'text-[var(--chat-tick-read)]' : 'text-[var(--chat-tick)]',
          )}
        >
          <Check aria-hidden="true" className="absolute left-0 top-0 size-3.5" />
          <Check aria-hidden="true" className="absolute right-0 top-0 size-3.5" />
        </span>
      );
    case 'sent':
      return <Check aria-label="Sent" className="size-3.5 text-[var(--chat-tick)]" />;
    default:
      return <Clock aria-label="Queued" className="size-3 text-[var(--chat-tick)]" />;
  }
}

export type MessageRowHandlers = {
  onReply: (message: Message) => void;
  onReact: (message: Message, emoji: string) => void;
  onPickerChange: (messageId: string | null) => void;
  onJumpTo: (messageId: string) => void;
  onRetry: (localId: string) => void;
  onDiscard: (localId: string) => void;
  onLongPressStart: (event: React.PointerEvent, messageId: string) => void;
  onLongPressMove: (event: React.PointerEvent) => void;
  onLongPressEnd: () => void;
};

type MessageRowProps = {
  message: Message;
  contactLabel: string;
  contactName?: string;
  phoneNumber?: string;
  fallbackPhoneNumberId?: string;
  isHighlighted: boolean;
  isPickerOpen: boolean;
  canReply: boolean;
  canReact: boolean;
  answeredByMessageId?: string;
  handlers: MessageRowHandlers;
};

const iconButtonClass =
  'size-9 flex-shrink-0 text-muted-foreground hover:bg-[var(--chat-hover)] focus-visible:opacity-100 pointer-fine:size-7 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100';

/**
 * One message in the thread. Memoized: polling returns structurally shared data,
 * so unchanged messages keep their identity and skip re-rendering.
 */
export const MessageRow = memo(function MessageRow({
  message,
  contactLabel,
  contactName,
  phoneNumber,
  fallbackPhoneNumberId,
  isHighlighted,
  isPickerOpen,
  canReply,
  canReact,
  answeredByMessageId,
  handlers,
}: MessageRowProps) {
  if (message.messageType === 'system') {
    return (
      <div className="my-3 flex justify-center px-6">
        <p className="rounded-lg bg-[var(--chat-warning-background)] px-3 py-1.5 text-center text-xs text-[var(--chat-warning-foreground)]">
          {message.content || 'The contact changed their WhatsApp account'}
        </p>
      </div>
    );
  }

  const isOutbound = message.direction === 'outbound';
  const isLocationRequest = isLocationRequestMessage(message);
  const displayContent = getDisplayMessageContent(message);
  const outboundReaction = getOutboundReaction(message);
  const isLocalFailure = message.localState === 'failed';
  const hasCard = Boolean(isLocationRequest || message.location);
  const mediaId = message.metadata?.mediaId;
  const hasMedia = message.hasMedia && (message.mediaData?.url || mediaId);

  const replyButton = canReply && !message.localState && (
    <Button
      type="button"
      onClick={() => handlers.onReply(message)}
      variant="ghost"
      size="icon"
      className={cn('mt-1', iconButtonClass)}
      aria-label="Reply to message"
      title="Reply"
    >
      <Reply className="h-3.5 w-3.5" />
    </Button>
  );

  return (
    <Popover open={isPickerOpen} onOpenChange={(open) => handlers.onPickerChange(open ? message.id : null)}>
      <div
        className={cn(
          'group mb-2 flex items-start gap-1.5 rounded-lg px-1 py-0.5 transition-colors',
          isOutbound ? 'justify-end' : 'justify-start',
          isHighlighted && 'bg-primary/10',
          isPickerOpen && 'bg-[var(--chat-hover)]/60',
        )}
      >
        {isOutbound && replyButton}

        <div
          className={cn(
            'flex min-w-0 max-w-[min(88%,34rem)] flex-col sm:max-w-[min(78%,38rem)] lg:max-w-[min(70%,42rem)]',
            isOutbound ? 'items-end' : 'items-start',
          )}
        >
          <PopoverAnchor asChild>
            <div
              onPointerDown={canReact ? (event) => handlers.onLongPressStart(event, message.id) : undefined}
              onPointerMove={canReact ? handlers.onLongPressMove : undefined}
              onPointerUp={canReact ? handlers.onLongPressEnd : undefined}
              onPointerCancel={canReact ? handlers.onLongPressEnd : undefined}
              onPointerLeave={canReact ? handlers.onLongPressEnd : undefined}
              onContextMenu={canReact ? (event) => {
                // Long-press opens the reaction picker on touch screens instead of the system menu.
                if (window.matchMedia('(pointer: coarse)').matches) event.preventDefault();
              } : undefined}
              className={cn(
                'relative max-w-full rounded-lg px-3 py-2 shadow-sm transition-[box-shadow,transform,opacity] duration-150',
                isOutbound
                  ? 'rounded-br-none bg-[var(--chat-bubble-outgoing)] text-foreground'
                  : 'rounded-bl-none bg-[var(--chat-bubble-incoming)] text-foreground',
                canReact && '[-webkit-touch-callout:none]',
                (hasCard || message.interactiveSummary) && 'overflow-hidden',
                message.localState === 'sending' && 'opacity-80',
                isLocalFailure && 'ring-1 ring-red-500/40',
                isHighlighted && 'ring-2 ring-primary/35',
                isPickerOpen && 'ring-2 ring-primary/25 pointer-coarse:scale-[0.98]',
              )}
            >
              {message.repliedTo && (
                <button
                  type="button"
                  onClick={() => handlers.onJumpTo(message.repliedTo!.id)}
                  className="mb-2 block w-full rounded border-l-2 border-primary/60 bg-background/45 px-2 py-1.5 text-left hover:bg-background/70"
                >
                  <span className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-primary">
                    <Reply className="h-3 w-3 flex-shrink-0" />
                    <span className="truncate">
                      {message.repliedTo.senderName || getMessageSenderLabel(message.repliedTo, contactName, phoneNumber)}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{message.repliedTo.content}</span>
                </button>
              )}

              {isLocationRequest && (
                <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-primary">
                  <MapPin aria-hidden="true" className="size-3" />
                  Location request
                </p>
              )}

              {message.interactiveSummary?.header && (
                <p className="mb-1 text-sm font-semibold">{message.interactiveSummary.header}</p>
              )}

              {message.location && <LocationMessage location={message.location} />}
              {message.contacts?.length ? <SharedContactsCard contacts={message.contacts} /> : null}
              {message.flowResponse && <FlowResponseCard response={message.flowResponse} />}
              {message.order && <OrderCard order={message.order} />}
              {message.interactiveReply && <InteractiveReplyChip reply={message.interactiveReply} />}

              {hasMedia && message.messageType && (
                <div className="mb-1.5">
                  <MediaMessage
                    url={message.mediaData?.url}
                    mediaId={mediaId}
                    phoneNumberId={message.phoneNumberId || fallbackPhoneNumberId}
                    messageType={message.messageType}
                    contentType={message.mediaData?.contentType ?? message.mimeType ?? undefined}
                    caption={message.caption}
                    filename={message.mediaData?.filename || message.filename}
                    byteSize={message.mediaData && 'byteSize' in message.mediaData ? message.mediaData.byteSize : undefined}
                  />
                </div>
              )}

              {message.caption && (
                <p className="mb-1 whitespace-pre-wrap break-words text-sm">
                  <FormattedText text={message.caption} />
                </p>
              )}

              {displayContent && (
                <p className="whitespace-pre-wrap break-words text-sm">
                  <FormattedText text={displayContent} />
                </p>
              )}

              {message.interactiveSummary?.footer && (
                <p className="mt-1 text-xs text-muted-foreground">{message.interactiveSummary.footer}</p>
              )}

              <div className="mt-1 flex flex-wrap items-center justify-end gap-1.5">
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {message.localState === 'sending' ? 'Sending…' : formatMessageTime(message.createdAt)}
                </span>
                {isOutbound && <MessageStatus message={message} />}
              </div>

              {isOutbound && message.status === 'failed' && (
                <MessageErrorNotice errors={message.errors?.length ? message.errors : [{}]} />
              )}
              {!isOutbound && message.messageType === 'unsupported' && message.errors?.length ? (
                <MessageErrorNotice errors={message.errors} tone="unsupported" />
              ) : null}

              {isLocalFailure && (
                <div className="mt-1.5 space-y-1.5">
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {message.errors?.[0]
                      ? describeWhatsAppError(message.errors[0].code, message.errors[0].message)
                      : 'Not sent.'}
                  </p>
                  <div className="flex gap-1.5">
                    {/* Retrying can't succeed until a template reopens the window. */}
                    {!isWindowClosedError(message.errors?.[0]?.code) && (
                      <Button type="button" size="sm" variant="outline" className="h-8 gap-1 px-2 text-xs" onClick={() => handlers.onRetry(message.id)}>
                        <RotateCcw aria-hidden="true" className="size-3.5" />
                        Retry
                      </Button>
                    )}
                    <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs text-muted-foreground" onClick={() => handlers.onDiscard(message.id)}>
                      <Trash2 aria-hidden="true" className="size-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>
              )}

              {isLocationRequest ? (
                <div className="-mb-2">
                  <LocationRequestFooter answeredByMessageId={answeredByMessageId} onShowAnswer={handlers.onJumpTo} />
                </div>
              ) : message.interactiveSummary ? (
                <InteractiveSummaryFooter summary={message.interactiveSummary} />
              ) : null}
            </div>
          </PopoverAnchor>

          <ReactionChips
            reactions={message.reactions ?? []}
            contactLabel={contactLabel}
            align={isOutbound ? 'end' : 'start'}
            onClick={canReact ? () => handlers.onPickerChange(message.id) : undefined}
          />
        </div>

        {!isOutbound && (canReact || replyButton) && (
          // `relative` keeps the visually hidden react button inside the scroll area.
          <div className="relative mt-1 flex flex-shrink-0 items-center gap-0.5">
            {canReact && (
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  // Touch screens open the picker with a long-press; the button stays for screen readers.
                  className="text-muted-foreground hover:bg-[var(--chat-hover)] focus-visible:opacity-100 pointer-coarse:sr-only pointer-fine:size-7 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 data-[state=open]:opacity-100"
                  aria-label={outboundReaction ? `Change reaction ${outboundReaction.emoji}` : 'React to message'}
                  title="React"
                >
                  <Smile className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
            )}
            {replyButton && <div className="-mt-1">{replyButton}</div>}
          </div>
        )}
      </div>

      {isPickerOpen && (
        <ReactionPickerContent
          currentEmoji={outboundReaction?.emoji}
          align="start"
          onSelect={(emoji) => handlers.onReact(message, emoji)}
        />
      )}
    </Popover>
  );
});
