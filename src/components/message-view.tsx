"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  format,
  formatDistanceToNow,
  isValid,
  isToday,
  isYesterday,
  differenceInHours,
} from "date-fns";
import {
  RefreshCw,
  Paperclip,
  Send,
  X,
  AlertCircle,
  MessageSquare,
  XCircle,
  ListTree,
  ArrowLeft,
  Check,
  Reply,
  Smile,
  MapPin,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CONVERSATIONS_QUERY_KEY,
  REACTION_MAX_AGE_MS,
  type Conversation,
  type Message,
  type MessageReaction,
  conversationMessagesQueryKey,
  describeLocation,
  fetchConversationMessages,
  isLocationRequestMessage,
  normalizeMessages,
  phoneThreadMessagesQueryKey,
  shortConversationId,
} from "@/lib/inbox-data";
import { MediaMessage } from "@/components/media-message";
import { LocationMessage, LocationRequestFooter } from "@/components/location-message";
import { LocationRequestDialog } from "@/components/location-request-dialog";
import { ReactionChips, ReactionPickerContent } from "@/components/reaction-picker";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TemplateSelectorDialog } from "@/components/template-selector-dialog";
import { InteractiveMessageDialog } from "@/components/interactive-message-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";

function formatMessageTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (isValid(date)) {
      return format(date, "HH:mm");
    }
    return "";
  } catch {
    return "";
  }
}

function formatDateDivider(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (!isValid(date)) return "";

    if (isToday(date)) return "Today";
    if (isYesterday(date)) return "Yesterday";
    return format(date, "MMMM d, yyyy");
  } catch {
    return "";
  }
}

function formatLastSeen(timestamp?: string): string | null {
  if (!timestamp) return null;

  try {
    const date = new Date(timestamp);
    if (!isValid(date)) return null;

    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return null;
  }
}

function formatDisplayPhoneNumber(phoneNumber?: string): string | null {
  if (!phoneNumber) return null;

  const trimmedPhoneNumber = phoneNumber.trim();
  if (!trimmedPhoneNumber) return null;
  if (trimmedPhoneNumber.startsWith("+")) return trimmedPhoneNumber;
  if (/^\d+$/.test(trimmedPhoneNumber)) return `+${trimmedPhoneNumber}`;

  return trimmedPhoneNumber;
}

function MessageStatusChecks({ status }: { status: string }) {
  if (status === "read" || status === "delivered") {
    return (
      <span
        aria-label={status === "read" ? "Read" : "Delivered"}
        className="relative inline-flex h-3.5 w-[1.125rem] items-center text-[var(--chat-check)]"
      >
        <Check aria-hidden="true" className="absolute left-0 top-0 size-3.5" />
        <Check aria-hidden="true" className="absolute right-0 top-0 size-3.5" />
      </span>
    );
  }

  if (status === "sent") {
    return (
      <Check aria-label="Sent" className="size-3.5 text-[var(--chat-check)]" />
    );
  }

  return null;
}

function shouldShowDateDivider(
  currentMsg: Message,
  prevMsg: Message | null,
): boolean {
  if (!prevMsg) return true;

  try {
    const currentDate = new Date(currentMsg.createdAt);
    const prevDate = new Date(prevMsg.createdAt);

    if (!isValid(currentDate) || !isValid(prevDate)) return false;

    return format(currentDate, "yyyy-MM-dd") !== format(prevDate, "yyyy-MM-dd");
  } catch {
    return false;
  }
}

function shouldShowConversationDivider(
  currentMsg: Message,
  prevMsg: Message | null,
): boolean {
  return Boolean(
    prevMsg && currentMsg.conversationId !== prevMsg.conversationId,
  );
}

function isWithin24HourWindow(messages: Message[]): boolean {
  // Find the last inbound message
  const inboundMessages = messages.filter((msg) => msg.direction === "inbound");

  if (inboundMessages.length === 0) {
    // No inbound messages yet - only templates allowed
    return false;
  }

  const lastInboundMessage = inboundMessages[inboundMessages.length - 1];

  try {
    const lastMessageDate = new Date(lastInboundMessage.createdAt);
    if (!isValid(lastMessageDate)) return false;

    const hoursSinceLastMessage = differenceInHours(
      new Date(),
      lastMessageDate,
    );
    return hoursSinceLastMessage < 24;
  } catch {
    return false; // In case of error, only allow templates
  }
}

function getDisabledInputMessage(messages: Message[]): string {
  const inboundMessages = messages.filter((msg) => msg.direction === "inbound");

  if (inboundMessages.length === 0) {
    return "User hasn't messaged yet. Send a template message or wait for them to reply.";
  }

  return "Last message was over 24 hours ago. Send a template message or wait for the user to message you.";
}

const MESSAGE_SKELETON_WIDTHS = [280, 180, 320, 210, 260, 170];
const LOCAL_REPLY_CONTEXT_STORAGE_KEY = "whatsapp-cloud-inbox-reply-contexts";
const LOCAL_REPLY_CONTEXT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LOCAL_REPLY_CONTEXTS = 200;
const LOCAL_REACTIONS_STORAGE_KEY = "whatsapp-cloud-inbox-reactions";
const MAX_LOCAL_REACTIONS = 300;
const LONG_PRESS_DELAY_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const NOTICE_DURATION_MS = 4_000;

type RepliedToMessage = NonNullable<Message["repliedTo"]>;

type LocalReplyContext = {
  contextMessageId: string;
  repliedTo: RepliedToMessage;
  createdAt: number;
};

type LocalReplyContexts = Record<string, LocalReplyContext>;

/**
 * Your reaction as sent from this browser. The message history may lag behind
 * or never list outbound reactions, so this stays until the history agrees.
 */
type LocalReaction = {
  emoji: string;
  createdAt: number;
  pending: boolean;
};

type LocalReactions = Record<string, LocalReaction>;

type SendMessageResult = {
  messages?: Array<{ id?: string }>;
  messageId?: string;
  id?: string;
  contextMessageId?: string;
};

function extractTranscriptDisplayContent(content: string): string | undefined {
  const match = content.match(/\bTranscript:\s*[\s\S]*$/i);
  if (!match) return undefined;

  return match[0]
    .replace(/\s+\bURL:\s*https?:\/\/\S+[\s\S]*$/i, '')
    .trim();
}

function isGeneratedAttachmentDisplayContent(content: string): boolean {
  return (
    /^https?:\/\//i.test(content) ||
    /\bURL:\s*https?:\/\//i.test(content) ||
    /^(image|audio)\s+attached\b/i.test(content)
  );
}

function getDisplayMessageContent(message: Message): string | null {
  // The location card shows everything the generated text would.
  if (message.location) return null;

  if (!message.content || message.content === "[Image attached]") {
    return null;
  }

  const trimmedContent = message.content.trim();

  if (message.messageType === 'audio') {
    return extractTranscriptDisplayContent(trimmedContent) ??
      (isGeneratedAttachmentDisplayContent(trimmedContent) ? null : trimmedContent);
  }

  if (
    message.messageType === 'image' &&
    isGeneratedAttachmentDisplayContent(trimmedContent)
  ) {
    return null;
  }

  return trimmedContent;
}

function getReplyPreviewContent(message: Message): string {
  if (message.location) return `📍 ${describeLocation(message.location)}`;

  const content = getDisplayMessageContent(message) || message.caption || message.filename || '';
  const trimmedContent = content.trim();

  if (trimmedContent) {
    return trimmedContent.length > 140 ? `${trimmedContent.slice(0, 137)}...` : trimmedContent;
  }

  if (message.hasMedia && message.messageType) {
    return `${message.messageType.charAt(0).toUpperCase()}${message.messageType.slice(1)} message`;
  }

  return 'Message';
}

function getMessageSenderLabel(
  message: Pick<Message, 'direction'>,
  contactName?: string,
  phoneNumber?: string,
): string {
  if (message.direction === 'outbound') return 'you';
  return contactName || phoneNumber || 'contact';
}

function extractSentMessageId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;

  const sendResult = result as SendMessageResult;
  const sentMessageId = sendResult.messages?.find((message) => typeof message.id === "string")?.id;

  return sentMessageId ?? sendResult.messageId ?? sendResult.id ?? null;
}

function pruneLocalReplyContexts(contexts: LocalReplyContexts): LocalReplyContexts {
  const now = Date.now();
  const entries = Object.entries(contexts)
    .filter(([, context]) => (
      context &&
      typeof context.contextMessageId === "string" &&
      context.repliedTo &&
      typeof context.repliedTo.id === "string" &&
      now - context.createdAt < LOCAL_REPLY_CONTEXT_MAX_AGE_MS
    ))
    .sort(([, a], [, b]) => b.createdAt - a.createdAt)
    .slice(0, MAX_LOCAL_REPLY_CONTEXTS);

  return Object.fromEntries(entries);
}

function pruneLocalReactions(reactions: LocalReactions): LocalReactions {
  const now = Date.now();
  const entries = Object.entries(reactions)
    .filter(([, reaction]) => (
      reaction &&
      typeof reaction.emoji === "string" &&
      typeof reaction.createdAt === "number" &&
      now - reaction.createdAt < REACTION_MAX_AGE_MS
    ))
    .sort(([, a], [, b]) => b.createdAt - a.createdAt)
    .slice(0, MAX_LOCAL_REACTIONS);

  return Object.fromEntries(entries);
}

function getOutboundReaction(message: Message): MessageReaction | undefined {
  return message.reactions?.find((reaction) => reaction.direction === "outbound");
}

/** True once the message history shows the local reaction, or a newer one. */
function isLocalReactionSettled(localReaction: LocalReaction, serverReaction?: MessageReaction): boolean {
  if (localReaction.pending) return false;
  if ((serverReaction?.emoji ?? "") === localReaction.emoji) return true;

  return Boolean(serverReaction && Date.parse(serverReaction.createdAt) > localReaction.createdAt + 5_000);
}

function applyLocalReactions(messages: Message[], localReactions: LocalReactions): Message[] {
  if (Object.keys(localReactions).length === 0) return messages;

  return messages.map((message) => {
    const localReaction = localReactions[message.id];
    if (!localReaction || isLocalReactionSettled(localReaction, getOutboundReaction(message))) {
      return message;
    }

    const contactReactions = (message.reactions ?? []).filter((reaction) => reaction.direction !== "outbound");
    return {
      ...message,
      reactions: localReaction.emoji
        ? [
            ...contactReactions,
            {
              emoji: localReaction.emoji,
              direction: "outbound" as const,
              createdAt: new Date(localReaction.createdAt).toISOString(),
              pending: localReaction.pending,
            },
          ]
        : contactReactions,
    };
  });
}

function isOlderThan(timestamp: string, maxAgeMs: number): boolean {
  const time = Date.parse(timestamp);
  return !Number.isFinite(time) || Date.now() - time >= maxAgeMs;
}

type Props = {
  conversationId?: string;
  conversations?: Conversation[];
  phoneNumber?: string;
  phoneNumberId?: string;
  inboxPhoneNumber?: string;
  inboxDisplayName?: string;
  contactName?: string;
  lastActiveAt?: string;
  onTemplateSent?: (phoneNumber: string, phoneNumberId?: string) => Promise<void>;
  onBack?: () => void;
  isVisible?: boolean;
};

export function MessageView({
  conversationId,
  conversations = [],
  phoneNumber,
  phoneNumberId,
  inboxPhoneNumber,
  inboxDisplayName,
  contactName,
  lastActiveAt,
  onTemplateSent,
  onBack,
  isVisible = false,
}: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const [messageInput, setMessageInput] = useState("");
  const [sending, setSending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [canSendRegularMessage, setCanSendRegularMessage] = useState(true);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [showInteractiveDialog, setShowInteractiveDialog] = useState(false);
  const [showLocationRequestDialog, setShowLocationRequestDialog] = useState(false);
  const [showComposerActions, setShowComposerActions] = useState(false);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [localReactions, setLocalReactions] = useState<LocalReactions>({});
  const [notice, setNotice] = useState<string | null>(null);
  const localReactionsRef = useRef<LocalReactions>({});
  const longPressRef = useRef<{ timer: number; x: number; y: number } | null>(null);
  const noticeTimeoutRef = useRef<number | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastInitialScrollKeyRef = useRef("");
  const highlightTimeoutRef = useRef<number | null>(null);
  const localReplyContextsRef = useRef<LocalReplyContexts>({});
  const [localReplyContextVersion, setLocalReplyContextVersion] = useState(0);
  const queryClient = useQueryClient();
  const lastSeenText = formatLastSeen(lastActiveAt);
  const displayPhoneNumber = formatDisplayPhoneNumber(phoneNumber);
  const displayInboxPhoneNumber = formatDisplayPhoneNumber(inboxPhoneNumber);
  const threadConversationIds = useMemo(() => {
    const conversationIds = conversations.map(
      (conversation) => conversation.id,
    );
    return conversationIds.length > 0
      ? conversationIds
      : conversationId
        ? [conversationId]
        : [];
  }, [conversationId, conversations]);
  const threadMessagesQueryKey = useMemo(
    () => phoneThreadMessagesQueryKey(phoneNumberId, phoneNumber, threadConversationIds),
    [phoneNumberId, phoneNumber, threadConversationIds],
  );
  const threadKey = threadConversationIds.join(":");
  const initialScrollKey = `${conversationId ?? ""}:${threadKey}`;

  const getScrollViewport = useCallback(() => {
    return (
      messagesContainerRef.current?.querySelector<HTMLElement>(
        "[data-radix-scroll-area-viewport]",
      ) ?? null
    );
  }, []);

  const scrollToBottom = useCallback(() => {
    const viewport = getScrollViewport();

    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }

    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [getScrollViewport]);

  const scrollToSelectedConversation = useCallback(() => {
    const viewport = getScrollViewport();

    if (!viewport || !conversationId) {
      scrollToBottom();
      return;
    }

    const selectedConversationMessages = Array.from(
      viewport.querySelectorAll<HTMLElement>("[data-conversation-id]"),
    ).filter((element) => element.dataset.conversationId === conversationId);
    const targetMessage =
      selectedConversationMessages[selectedConversationMessages.length - 1];

    if (targetMessage) {
      targetMessage.scrollIntoView({ behavior: "auto", block: "center" });
      return;
    }

    scrollToBottom();
  }, [conversationId, getScrollViewport, scrollToBottom]);

  const scrollToMessage = useCallback((messageId: string) => {
    const viewport = getScrollViewport();
    if (!viewport) return;

    const targetMessage = Array.from(
      viewport.querySelectorAll<HTMLElement>("[data-message-id]"),
    ).find((element) => element.dataset.messageId === messageId);

    if (!targetMessage) return;

    targetMessage.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(messageId);

    if (highlightTimeoutRef.current !== null) {
      window.clearTimeout(highlightTimeoutRef.current);
    }

    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedMessageId(null);
      highlightTimeoutRef.current = null;
    }, 2_000);
  }, [getScrollViewport]);

  const handleReplyToMessage = useCallback((message: Message) => {
    setReplyingToMessage(message);
    window.requestAnimationFrame(() => {
      messageInputRef.current?.focus();
    });
  }, []);

  const handleCancelReply = useCallback(() => {
    setReplyingToMessage(null);
  }, []);

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimeoutRef.current !== null) {
      window.clearTimeout(noticeTimeoutRef.current);
    }
    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimeoutRef.current = null;
    }, NOTICE_DURATION_MS);
  }, []);

  const updateLocalReactions = useCallback((update: (reactions: LocalReactions) => LocalReactions) => {
    const nextReactions = pruneLocalReactions(update(localReactionsRef.current));
    localReactionsRef.current = nextReactions;
    setLocalReactions(nextReactions);

    try {
      window.localStorage.setItem(LOCAL_REACTIONS_STORAGE_KEY, JSON.stringify(nextReactions));
    } catch {
      // Keeping the in-memory map is enough for the current session.
    }
  }, []);

  const handleReact = useCallback(async (message: Message, emoji: string) => {
    setReactionPickerMessageId(null);
    if (!phoneNumber) return;

    const previousReaction = localReactionsRef.current[message.id];
    const optimisticReaction: LocalReaction = { emoji, createdAt: Date.now(), pending: true };
    const isCurrentAttempt = (reactions: LocalReactions) => reactions[message.id] === optimisticReaction;

    updateLocalReactions((reactions) => ({ ...reactions, [message.id]: optimisticReaction }));

    try {
      const response = await fetch("/api/messages/reaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: phoneNumber,
          phoneNumberId: message.phoneNumberId || phoneNumberId,
          messageId: message.id,
          emoji,
        }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "Failed to send reaction");
      }

      updateLocalReactions((reactions) => (
        isCurrentAttempt(reactions)
          ? { ...reactions, [message.id]: { ...optimisticReaction, pending: false } }
          : reactions
      ));
    } catch (error) {
      console.error("Error sending reaction:", error);
      // Roll back only if nothing newer replaced this attempt meanwhile.
      updateLocalReactions((reactions) => {
        if (!isCurrentAttempt(reactions)) return reactions;
        const nextReactions = { ...reactions };
        if (previousReaction) {
          nextReactions[message.id] = previousReaction;
        } else {
          delete nextReactions[message.id];
        }
        return nextReactions;
      });
      showNotice(emoji ? "Couldn't send the reaction. Try again." : "Couldn't remove the reaction. Try again.");
    }
  }, [phoneNumber, phoneNumberId, showNotice, updateLocalReactions]);

  const cancelLongPress = useCallback(() => {
    if (!longPressRef.current) return;
    window.clearTimeout(longPressRef.current.timer);
    longPressRef.current = null;
  }, []);

  const startLongPress = useCallback((event: React.PointerEvent, messageId: string) => {
    if (event.pointerType !== "touch") return;

    cancelLongPress();
    longPressRef.current = {
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        longPressRef.current = null;
        window.getSelection()?.removeAllRanges();
        navigator.vibrate?.(10);
        setReactionPickerMessageId(messageId);
      }, LONG_PRESS_DELAY_MS),
    };
  }, [cancelLongPress]);

  const trackLongPressMove = useCallback((event: React.PointerEvent) => {
    const longPress = longPressRef.current;
    if (!longPress) return;

    if (
      Math.abs(event.clientX - longPress.x) > LONG_PRESS_MOVE_TOLERANCE_PX ||
      Math.abs(event.clientY - longPress.y) > LONG_PRESS_MOVE_TOLERANCE_PX
    ) {
      cancelLongPress();
    }
  }, [cancelLongPress]);

  const persistLocalReplyContexts = useCallback((contexts: LocalReplyContexts) => {
    const prunedContexts = pruneLocalReplyContexts(contexts);
    localReplyContextsRef.current = prunedContexts;
    setLocalReplyContextVersion((version) => version + 1);

    try {
      window.localStorage.setItem(
        LOCAL_REPLY_CONTEXT_STORAGE_KEY,
        JSON.stringify(prunedContexts),
      );
    } catch {
      // Keeping the in-memory map is enough for the current session.
    }
  }, []);

  const rememberLocalReplyContext = useCallback((sentMessageId: string, replyTarget: Message) => {
    persistLocalReplyContexts({
      ...localReplyContextsRef.current,
      [sentMessageId]: {
        contextMessageId: replyTarget.id,
        repliedTo: {
          id: replyTarget.id,
          conversationId: replyTarget.conversationId,
          content: getReplyPreviewContent(replyTarget),
          direction: replyTarget.direction,
          messageType: replyTarget.messageType,
          senderName: getMessageSenderLabel(replyTarget, contactName, phoneNumber),
        },
        createdAt: Date.now(),
      },
    });
  }, [contactName, persistLocalReplyContexts, phoneNumber]);

  const applyLocalReplyContexts = useCallback((inputMessages: Message[]) => {
    const localReplyContexts = localReplyContextsRef.current;
    if (Object.keys(localReplyContexts).length === 0) return inputMessages;

    return inputMessages.map((message) => {
      if (message.contextMessageId || message.repliedTo) return message;

      const localReplyContext = localReplyContexts[message.id];
      if (!localReplyContext) return message;

      return {
        ...message,
        contextMessageId: localReplyContext.contextMessageId,
        repliedTo: localReplyContext.repliedTo,
      };
    });
  }, []);

  const fetchThreadMessages = useCallback(async () => {
    if (threadConversationIds.length === 0) return [];

    const latestConversationId = threadConversationIds[0];
    const messageBatches = await Promise.all(
      threadConversationIds.map((threadConversationId) => {
        const queryKey = conversationMessagesQueryKey(phoneNumberId, threadConversationId);
        const cachedMessages = queryClient.getQueryData<Message[]>(queryKey);

        if (cachedMessages && threadConversationId !== latestConversationId) {
          return cachedMessages;
        }

        return queryClient.fetchQuery({
          queryKey,
          queryFn: () => fetchConversationMessages(threadConversationId, phoneNumberId),
          staleTime: 0,
        });
      }),
    );

    return applyLocalReplyContexts(normalizeMessages(messageBatches.flat()));
  }, [applyLocalReplyContexts, phoneNumberId, queryClient, threadConversationIds]);

  const { data: messages = [], isPending: loading } = useQuery({
    queryKey: threadMessagesQueryKey,
    queryFn: fetchThreadMessages,
    enabled: threadConversationIds.length > 0,
    refetchInterval: 5_000,
    refetchOnMount: false,
  });

  const displayMessages = useMemo(
    () => applyLocalReactions(messages, localReactions),
    [localReactions, messages],
  );

  const answeredLocationRequests = useMemo(() => {
    const answers = new Map<string, string>();
    displayMessages.forEach((message) => {
      if (message.location && message.direction === "inbound" && message.contextMessageId) {
        answers.set(message.contextMessageId, message.id);
      }
    });
    return answers;
  }, [displayMessages]);

  // Forget local reactions once the message history reflects them.
  useEffect(() => {
    const settledMessageIds = messages
      .filter((message) => {
        const localReaction = localReactionsRef.current[message.id];
        return localReaction && isLocalReactionSettled(localReaction, getOutboundReaction(message));
      })
      .map((message) => message.id);

    if (settledMessageIds.length === 0) return;

    updateLocalReactions((reactions) => {
      const nextReactions = { ...reactions };
      settledMessageIds.forEach((messageId) => delete nextReactions[messageId]);
      return nextReactions;
    });
  }, [messages, updateLocalReactions]);

  useEffect(() => {
    try {
      const storedContexts = window.localStorage.getItem(LOCAL_REPLY_CONTEXT_STORAGE_KEY);
      if (!storedContexts) return;

      const parsedContexts = JSON.parse(storedContexts);
      if (parsedContexts && typeof parsedContexts === "object" && !Array.isArray(parsedContexts)) {
        persistLocalReplyContexts(parsedContexts as LocalReplyContexts);
      }
    } catch {
      localReplyContextsRef.current = {};
    }
  }, [persistLocalReplyContexts]);

  useEffect(() => {
    try {
      const storedReactions = window.localStorage.getItem(LOCAL_REACTIONS_STORAGE_KEY);
      if (!storedReactions) return;

      const parsedReactions = JSON.parse(storedReactions);
      if (parsedReactions && typeof parsedReactions === "object" && !Array.isArray(parsedReactions)) {
        // A reload interrupts any request that was still in flight.
        updateLocalReactions(() => Object.fromEntries(
          Object.entries(parsedReactions as LocalReactions).map(([messageId, reaction]) => [
            messageId,
            { ...reaction, pending: false },
          ]),
        ));
      }
    } catch {
      localReactionsRef.current = {};
    }
  }, [updateLocalReactions]);

  useEffect(() => {
    const currentMessages = queryClient.getQueryData<Message[]>(threadMessagesQueryKey);
    if (!currentMessages) return;

    queryClient.setQueryData(
      threadMessagesQueryKey,
      applyLocalReplyContexts(currentMessages),
    );
  }, [applyLocalReplyContexts, localReplyContextVersion, queryClient, threadMessagesQueryKey]);

  const refreshCurrentThread = useCallback(async () => {
    if (threadConversationIds.length === 0) return;

    const messageBatches = await Promise.all(
      threadConversationIds.map((threadConversationId) =>
        queryClient.fetchQuery({
          queryKey: conversationMessagesQueryKey(phoneNumberId, threadConversationId),
          queryFn: () => fetchConversationMessages(threadConversationId, phoneNumberId),
          staleTime: 0,
        }),
      ),
    );

    queryClient.setQueryData(
      threadMessagesQueryKey,
      applyLocalReplyContexts(normalizeMessages(messageBatches.flat())),
    );
  }, [applyLocalReplyContexts, phoneNumberId, queryClient, threadConversationIds, threadMessagesQueryKey]);

  useEffect(() => {
    if (isNearBottom) {
      scrollToBottom();
    }
  }, [messages, isNearBottom, scrollToBottom]);

  useEffect(() => {
    if (loading || messages.length === 0 || !threadKey) return;
    if (lastInitialScrollKeyRef.current === initialScrollKey) return;

    lastInitialScrollKeyRef.current = initialScrollKey;
    setIsNearBottom(true);

    const viewport = getScrollViewport();
    const content = viewport?.firstElementChild;
    let animationFrameId = 0;
    let secondAnimationFrameId = 0;
    let timeoutId = 0;
    let resizeObserver: ResizeObserver | null = null;
    let stopped = false;

    const stopInitialScrollSync = () => {
      stopped = true;
      window.cancelAnimationFrame(animationFrameId);
      window.cancelAnimationFrame(secondAnimationFrameId);
      window.clearTimeout(timeoutId);
      resizeObserver?.disconnect();
      viewport?.removeEventListener("wheel", stopInitialScrollSync);
      viewport?.removeEventListener("touchstart", stopInitialScrollSync);
    };

    const syncSelectedConversationScroll = () => {
      if (stopped) return;

      scrollToSelectedConversation();
    };

    if (viewport) {
      viewport.addEventListener("wheel", stopInitialScrollSync, {
        passive: true,
      });
      viewport.addEventListener("touchstart", stopInitialScrollSync, {
        passive: true,
      });
    }

    if (typeof ResizeObserver !== "undefined" && content) {
      resizeObserver = new ResizeObserver(syncSelectedConversationScroll);
      resizeObserver.observe(content);
    }

    syncSelectedConversationScroll();
    animationFrameId = window.requestAnimationFrame(() => {
      syncSelectedConversationScroll();
      secondAnimationFrameId = window.requestAnimationFrame(
        syncSelectedConversationScroll,
      );
    });
    timeoutId = window.setTimeout(stopInitialScrollSync, 1_000);

    return stopInitialScrollSync;
  }, [
    getScrollViewport,
    initialScrollKey,
    loading,
    messages.length,
    scrollToSelectedConversation,
    threadKey,
  ]);

  useEffect(() => {
    setCanSendRegularMessage(isWithin24HourWindow(messages));
  }, [messages]);

  useEffect(() => {
    setReplyingToMessage(null);
    setReactionPickerMessageId(null);
  }, [threadKey]);

  useEffect(() => {
    if (!canSendRegularMessage) {
      setReplyingToMessage(null);
      setReactionPickerMessageId(null);
    }
  }, [canSendRegularMessage]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
      if (noticeTimeoutRef.current !== null) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
      cancelLongPress();
    };
  }, [cancelLongPress]);

  // Track if user is near bottom of scroll
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const viewport = container.querySelector(
        "[data-radix-scroll-area-viewport]",
      );
      if (!viewport) return;

      const { scrollTop, scrollHeight, clientHeight } = viewport;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      setIsNearBottom(distanceFromBottom < 100);
    };

    const viewport = container.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    if (viewport) {
      viewport.addEventListener("scroll", handleScroll);
      return () => viewport.removeEventListener("scroll", handleScroll);
    }
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshCurrentThread();
    } finally {
      setRefreshing(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);

    // Create preview for images
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFilePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setFilePreview(null);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setFilePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if ((!messageInput.trim() && !selectedFile) || !phoneNumber || sending)
      return;

    const replyTarget = replyingToMessage;
    setSending(true);
    try {
      const formData = new FormData();
      formData.append("to", phoneNumber);
      if (phoneNumberId) {
        formData.append("phoneNumberId", phoneNumberId);
      }
      if (replyingToMessage?.id) {
        formData.append("contextMessageId", replyingToMessage.id);
      }
      if (messageInput.trim()) {
        formData.append("body", messageInput);
      }
      if (selectedFile) {
        formData.append("file", selectedFile);
      }

      const response = await fetch("/api/messages/send", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "Failed to send message");
      }

      const sentMessageId = extractSentMessageId(data);
      if (sentMessageId && replyTarget) {
        rememberLocalReplyContext(sentMessageId, replyTarget);
      }

      setMessageInput("");
      setReplyingToMessage(null);
      handleRemoveFile();
      await queryClient.invalidateQueries({
        queryKey: CONVERSATIONS_QUERY_KEY,
      });
      await refreshCurrentThread();
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setSending(false);
    }
  };

  const handleSessionMessageSent = async () => {
    await queryClient.invalidateQueries({
      queryKey: CONVERSATIONS_QUERY_KEY,
    });
    await refreshCurrentThread();
  };

  const canReactTo = (message: Message) => (
    canSendRegularMessage &&
    message.direction === "inbound" &&
    !isOlderThan(message.createdAt, REACTION_MAX_AGE_MS)
  );

  const handleTemplateSent = async () => {
    await refreshCurrentThread();

    if (phoneNumber && onTemplateSent) {
      await onTemplateSent(phoneNumber, phoneNumberId);
    }
  };

  if (!conversationId) {
    return (
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 items-center justify-center bg-muted/50 p-6 text-center",
          !isVisible && "hidden md:flex",
        )}
      >
        <p className="max-w-sm text-sm leading-6 text-muted-foreground">
          Select a conversation to view messages
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--chat-canvas)]",
          !isVisible && "hidden md:flex",
        )}
      >
        <div className="border-b border-[var(--chat-border-strong)] bg-[var(--chat-toolbar)] px-2 pb-2 pt-safe-2 sm:px-3 sm:pb-3 sm:pt-safe-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1">
              {onBack && (
                <Button
                  onClick={onBack}
                  variant="ghost"
                  size="icon"
                  className="size-11 text-muted-foreground hover:bg-[var(--chat-hover)] md:hidden"
                  aria-label="Back to conversations"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              )}
              <div className="flex-1">
                <Skeleton className="h-5 w-40 mb-1" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle className="size-11 md:hidden" />
              <Skeleton className="size-10 rounded-lg" />
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:p-4 lg:p-6">
          <div className="mx-auto w-full max-w-[900px] space-y-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className={cn(
                  "flex mb-2",
                  i % 2 === 0 ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[min(88%,34rem)] rounded-lg px-3 py-2 shadow-sm sm:max-w-[min(78%,38rem)] lg:max-w-[min(70%,42rem)]",
                    i % 2 === 0 ? "rounded-br-none" : "rounded-bl-none",
                  )}
                >
                  <Skeleton
                    className="h-4 max-w-full mb-2"
                    style={{ width: `${MESSAGE_SKELETON_WIDTHS[i - 1]}px` }}
                  />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--chat-canvas)]",
        !isVisible && "hidden md:flex",
      )}
    >
      <div className="border-b border-[var(--chat-border-strong)] bg-[var(--chat-toolbar)] px-2 pb-2 pt-safe-2 sm:px-3 sm:pb-3 sm:pt-safe-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {onBack && (
              <Button
                onClick={onBack}
                variant="ghost"
                size="icon"
                className="size-11 flex-shrink-0 text-muted-foreground hover:bg-[var(--chat-hover)] md:hidden"
                aria-label="Back to conversations"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="truncate text-base font-medium text-foreground">
                {contactName || phoneNumber || "Conversation"}
              </h2>
              {displayPhoneNumber && (
                <p className="truncate text-xs text-muted-foreground">
                  {lastSeenText
                    ? `Active · ${lastSeenText} · ${displayPhoneNumber}`
                    : displayPhoneNumber}
                </p>
              )}
              {(inboxDisplayName || displayInboxPhoneNumber) && (
                <p className="truncate text-[11px] text-muted-foreground/80">
                  via {inboxDisplayName || displayInboxPhoneNumber}
                  {inboxDisplayName && displayInboxPhoneNumber ? ` · ${displayInboxPhoneNumber}` : ''}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-0.5 md:gap-2">
            <ThemeToggle className="size-11 md:hidden" />
            <Button
              onClick={handleRefresh}
              disabled={refreshing}
              variant="ghost"
              size="icon"
              className="size-11 text-muted-foreground hover:bg-[var(--chat-hover)] md:size-10"
              aria-label="Refresh messages"
              title="Refresh messages"
            >
              <RefreshCw
                className={cn("h-4 w-4", refreshing && "animate-spin")}
              />
            </Button>
          </div>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
      <ScrollArea
        ref={messagesContainerRef}
        className="h-0 flex-1 overscroll-contain px-4 py-3 sm:p-4 lg:p-6"
      >
        <div className="mx-auto w-full max-w-[900px]">
          {displayMessages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No messages yet
            </p>
          ) : (
            displayMessages.map((message, index) => {
              const prevMessage = index > 0 ? displayMessages[index - 1] : null;
              const showDateDivider = shouldShowDateDivider(
                message,
                prevMessage,
              );
              const showConversationDivider = shouldShowConversationDivider(
                message,
                prevMessage,
              );
              const displayMessageContent = getDisplayMessageContent(message);
              const isHighlighted = highlightedMessageId === message.id;
              const isOutbound = message.direction === "outbound";
              const isLocationRequest = isLocationRequestMessage(message);
              const canReact = canReactTo(message);
              const isPickerOpen = canReact && reactionPickerMessageId === message.id;
              const outboundReaction = getOutboundReaction(message);
              const contactLabel = contactName || displayPhoneNumber || "Contact";

              return (
                <div
                  key={message.id}
                  data-message-id={message.id}
                  data-conversation-id={message.conversationId}
                >
                  {showConversationDivider && (
                    <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
                      <div className="h-px flex-1 bg-[var(--chat-border)]" />
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--chat-canvas)] px-2 py-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--chat-presence)]" />
                        Conversation{" "}
                        {shortConversationId(message.conversationId)}
                      </span>
                      <div className="h-px flex-1 bg-[var(--chat-border)]" />
                    </div>
                  )}

                  {showDateDivider && (
                    <div className="flex justify-center my-4">
                      <Badge variant="secondary" className="shadow-sm">
                        {formatDateDivider(message.createdAt)}
                      </Badge>
                    </div>
                  )}

                  <Popover
                    open={isPickerOpen}
                    onOpenChange={(open) => setReactionPickerMessageId(open ? message.id : null)}
                  >
                    <div
                      className={cn(
                        "group mb-2 flex items-start gap-1.5 rounded-lg px-1 py-0.5 transition-colors",
                        isOutbound ? "justify-end" : "justify-start",
                        isHighlighted && "bg-primary/10",
                        isPickerOpen && "bg-[var(--chat-hover)]/60",
                      )}
                    >
                      {isOutbound && canSendRegularMessage && (
                        <Button
                          type="button"
                          onClick={() => handleReplyToMessage(message)}
                          variant="ghost"
                          size="icon"
                          className="mt-1 size-9 flex-shrink-0 text-muted-foreground opacity-100 hover:bg-[var(--chat-hover)] focus-visible:opacity-100 pointer-fine:size-7 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
                          aria-label="Reply to message"
                          title="Reply"
                        >
                          <Reply className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <div
                        className={cn(
                          "flex min-w-0 max-w-[min(88%,34rem)] flex-col sm:max-w-[min(78%,38rem)] lg:max-w-[min(70%,42rem)]",
                          isOutbound ? "items-end" : "items-start",
                        )}
                      >
                        <PopoverAnchor asChild>
                          <div
                            onPointerDown={canReact ? (event) => startLongPress(event, message.id) : undefined}
                            onPointerMove={canReact ? trackLongPressMove : undefined}
                            onPointerUp={canReact ? cancelLongPress : undefined}
                            onPointerCancel={canReact ? cancelLongPress : undefined}
                            onPointerLeave={canReact ? cancelLongPress : undefined}
                            onContextMenu={canReact ? (event) => {
                              // Long-press opens the reaction picker on touch screens instead of the system menu.
                              if (window.matchMedia("(pointer: coarse)").matches) event.preventDefault();
                            } : undefined}
                            className={cn(
                              "relative max-w-full rounded-lg px-3 py-2 shadow-sm transition-[box-shadow,transform] duration-150",
                              isOutbound
                                ? "bg-[var(--chat-bubble-outgoing)] text-foreground rounded-br-none"
                                : "bg-[var(--chat-bubble-incoming)] text-foreground rounded-bl-none",
                              canReact && "[-webkit-touch-callout:none]",
                              (isLocationRequest || message.location) && "overflow-hidden",
                              isHighlighted && "ring-2 ring-primary/35",
                              isPickerOpen && "ring-2 ring-primary/25 pointer-coarse:scale-[0.98]",
                            )}
                          >
                            {message.repliedTo && (
                              <button
                                type="button"
                                onClick={() => scrollToMessage(message.repliedTo!.id)}
                                className="mb-2 block w-full rounded border-l-2 border-primary/60 bg-background/45 px-2 py-1.5 text-left hover:bg-background/70"
                              >
                                <span className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-primary">
                                  <Reply className="h-3 w-3 flex-shrink-0" />
                                  <span className="truncate">
                                    {message.repliedTo.senderName ||
                                      getMessageSenderLabel(message.repliedTo, contactName, phoneNumber)}
                                  </span>
                                </span>
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                  {message.repliedTo.content}
                                </span>
                              </button>
                            )}

                            {isLocationRequest && (
                              <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-primary">
                                <MapPin aria-hidden="true" className="size-3" />
                                Location request
                              </p>
                            )}

                            {message.location && <LocationMessage location={message.location} />}

                          {message.hasMedia && message.mediaData?.url ? (
                            <div className="mb-2">
                              {message.messageType === "sticker" ? (
                                <img
                                  src={message.mediaData.url}
                                  alt="Sticker"
                                  className="h-auto max-h-[150px] max-w-[150px]"
                                />
                              ) : message.mediaData.contentType?.startsWith(
                                  "image/",
                                ) || message.messageType === "image" ? (
                                <img
                                  src={message.mediaData.url}
                                  alt="Media"
                                  className="h-auto max-h-96 max-w-full rounded outline outline-1 [outline-color:var(--chat-media-outline)]"
                                />
                              ) : message.mediaData.contentType?.startsWith(
                                  "video/",
                                ) || message.messageType === "video" ? (
                                <video
                                  src={message.mediaData.url}
                                  controls
                                  className="h-auto max-h-96 max-w-full rounded outline outline-1 [outline-color:var(--chat-media-outline)]"
                                />
                              ) : message.mediaData.contentType?.startsWith(
                                  "audio/",
                                ) || message.messageType === "audio" ? (
                                <audio
                                  src={message.mediaData.url}
                                  controls
                                  className="w-full"
                                />
                              ) : (
                                <a
                                  href={message.mediaData.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={cn(
                                    "flex min-w-0 items-center gap-2 text-sm underline hover:opacity-80",
                                    message.direction === "outbound"
                                      ? "text-primary"
                                      : "text-primary",
                                  )}
                                >
                                  <Paperclip className="h-4 w-4 flex-shrink-0" />
                                  <span className="truncate">
                                    {message.mediaData.filename ||
                                      message.filename ||
                                      "Download file"}
                                  </span>
                                </a>
                              )}
                            </div>
                          ) : message.metadata?.mediaId && message.messageType ? (
                            <div className="mb-2">
                              <MediaMessage
                                mediaId={message.metadata.mediaId}
                                phoneNumberId={message.phoneNumberId || phoneNumberId}
                                messageType={message.messageType}
                                caption={message.caption}
                                filename={message.filename}
                                isOutbound={message.direction === "outbound"}
                              />
                            </div>
                          ) : null}

                            {message.caption && (
                              <p className="text-sm break-words whitespace-pre-wrap mb-1">
                                {message.caption}
                              </p>
                            )}

                            {displayMessageContent && (
                              <p className="text-sm break-words whitespace-pre-wrap">
                                {displayMessageContent}
                              </p>
                            )}

                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] tabular-nums text-muted-foreground">
                                {formatMessageTime(message.createdAt)}
                              </span>

                              {isOutbound && message.status && (
                                <>
                                  {message.status === "failed" ? (
                                    <XCircle className="h-3.5 w-3.5 text-red-500" />
                                  ) : (
                                    <MessageStatusChecks status={message.status} />
                                  )}
                                </>
                              )}
                            </div>

                            {isOutbound && message.status === "failed" && (
                              <div className="mt-1">
                                <span className="text-[11px] text-red-500 flex items-center gap-1">
                                  Not delivered
                                </span>
                              </div>
                            )}

                            {isLocationRequest && (
                              <div className="-mb-2">
                                <LocationRequestFooter
                                  answeredByMessageId={answeredLocationRequests.get(message.id)}
                                  onShowAnswer={scrollToMessage}
                                />
                              </div>
                            )}
                          </div>
                        </PopoverAnchor>

                        <ReactionChips
                          reactions={message.reactions ?? []}
                          contactLabel={contactLabel}
                          align={isOutbound ? "end" : "start"}
                          onClick={canReact ? () => setReactionPickerMessageId(message.id) : undefined}
                        />
                      </div>

                      {!isOutbound && canSendRegularMessage && (
                        // `relative` keeps the visually hidden react button inside the scroll area.
                        <div className="relative mt-1 flex flex-shrink-0 items-center gap-0.5">
                          {canReact && (
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                // Touch screens open the picker with a long-press; the button stays for screen readers.
                                className="text-muted-foreground hover:bg-[var(--chat-hover)] focus-visible:opacity-100 pointer-coarse:sr-only pointer-fine:size-7 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 data-[state=open]:opacity-100"
                                aria-label={outboundReaction ? `Change reaction ${outboundReaction.emoji}` : "React to message"}
                                title="React"
                              >
                                <Smile className="h-3.5 w-3.5" />
                              </Button>
                            </PopoverTrigger>
                          )}
                          <Button
                            type="button"
                            onClick={() => handleReplyToMessage(message)}
                            variant="ghost"
                            size="icon"
                            className="size-9 text-muted-foreground opacity-100 hover:bg-[var(--chat-hover)] focus-visible:opacity-100 pointer-fine:size-7 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
                            aria-label="Reply to message"
                            title="Reply"
                          >
                            <Reply className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>

                    {isPickerOpen && (
                      <ReactionPickerContent
                        currentEmoji={outboundReaction?.emoji}
                        align="start"
                        onSelect={(emoji) => void handleReact(message, emoji)}
                      />
                    )}
                  </Popover>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4"
        >
          {notice && (
            <p className="flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
              <AlertCircle aria-hidden="true" className="size-4 flex-shrink-0" />
              {notice}
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--chat-border-strong)] bg-[var(--chat-toolbar)] pb-safe-0">
        {canSendRegularMessage ? (
          <>
            {replyingToMessage && (
              <div className="border-b border-[var(--chat-border-strong)] bg-[var(--chat-surface)] px-4 py-2">
                <div className="mx-auto flex w-full max-w-[900px] items-center gap-2">
                  <Reply className="h-4 w-4 flex-shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-primary">
                      Replying to {getMessageSenderLabel(replyingToMessage, contactName, phoneNumber)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {getReplyPreviewContent(replyingToMessage)}
                    </p>
                  </div>
                  <Button
                    onClick={handleCancelReply}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 flex-shrink-0 text-muted-foreground md:size-8"
                    aria-label="Cancel reply"
                    title="Cancel reply"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {selectedFile && (
              <div className="border-b border-[var(--chat-border-strong)] bg-[var(--chat-surface)] px-4 py-3">
                <div className="mx-auto flex w-full max-w-[900px] items-start gap-3">
                  {filePreview ? (
                    <img
                      src={filePreview}
                      alt="Preview"
                      className="size-16 rounded object-cover outline outline-1 [outline-color:var(--chat-media-outline)]"
                    />
                  ) : (
                    <div className="flex size-16 items-center justify-center rounded bg-[var(--chat-hover)]">
                      <Paperclip className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {selectedFile.name}
                    </p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  <Button
                    onClick={handleRemoveFile}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 text-muted-foreground md:size-10"
                    aria-label="Remove selected file"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            <form
              onSubmit={handleSendMessage}
              className="mx-auto flex w-full max-w-[900px] items-end gap-2 px-3 py-2.5 sm:p-3"
            >
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileSelect}
                accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
              />
              <Button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                variant="ghost"
                size="icon"
                className="size-11 text-muted-foreground hover:bg-[var(--chat-icon-hover)] md:size-10"
                aria-label="Upload file"
                title="Upload file"
              >
                <Paperclip className="h-5 w-5" />
              </Button>
              {/* Small screens fold the extra message types into one menu to keep the input wide. */}
              <Popover open={showComposerActions} onOpenChange={setShowComposerActions}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    disabled={sending}
                    size="icon"
                    variant="ghost"
                    className="size-11 text-muted-foreground hover:bg-[var(--chat-hover)] data-[state=open]:bg-[var(--chat-hover)] data-[state=open]:text-primary md:hidden"
                    aria-label="More message types"
                    title="More message types"
                  >
                    <Plus className={cn("h-5 w-5 transition-transform duration-200", showComposerActions && "rotate-45")} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="w-64 p-1">
                  {[
                    {
                      icon: ListTree,
                      label: "Interactive buttons",
                      description: "Up to 3 quick-reply buttons",
                      onSelect: () => setShowInteractiveDialog(true),
                    },
                    {
                      icon: MapPin,
                      label: "Request location",
                      description: "Ask the contact to share where they are",
                      onSelect: () => setShowLocationRequestDialog(true),
                    },
                  ].map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => {
                        setShowComposerActions(false);
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
              <Button
                type="button"
                onClick={() => setShowInteractiveDialog(true)}
                disabled={sending}
                size="icon"
                variant="ghost"
                className="hidden size-10 text-muted-foreground hover:bg-[var(--chat-hover)] hover:text-primary md:inline-flex"
                aria-label="Send interactive message"
                title="Send interactive message"
              >
                <ListTree className="h-5 w-5" />
              </Button>
              <Button
                type="button"
                onClick={() => setShowLocationRequestDialog(true)}
                disabled={sending}
                size="icon"
                variant="ghost"
                className="hidden size-10 text-muted-foreground hover:bg-[var(--chat-hover)] hover:text-primary md:inline-flex"
                aria-label="Request location"
                title="Request location"
              >
                <MapPin className="h-5 w-5" />
              </Button>
              <Input
                ref={messageInputRef}
                type="text"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder="Type a message"
                disabled={sending}
                autoComplete="off"
                enterKeyHint="send"
                aria-label="Message"
                className="h-11 min-w-0 flex-1 rounded-lg border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-base focus-visible:ring-primary md:h-10 md:text-sm"
              />
              <Button
                type="submit"
                disabled={sending || (!messageInput.trim() && !selectedFile)}
                size="icon"
                className="size-11 rounded-full bg-primary hover:bg-[var(--primary-hover)] md:size-10"
                aria-label="Send message"
              >
                <Send className="h-5 w-5" />
              </Button>
            </form>
          </>
        ) : (
          <div className="mx-auto w-full max-w-[900px] px-4 py-3">
            <div className="rounded-lg border border-[var(--chat-warning-border)] bg-[var(--chat-warning-background)] p-3 sm:p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-[var(--chat-warning-foreground)] flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="mb-3 text-sm leading-5 text-foreground">
                    {getDisabledInputMessage(messages)}
                  </p>
                  <Button
                    onClick={() => setShowTemplateDialog(true)}
                    className="h-11 w-full bg-primary hover:bg-[var(--primary-hover)] sm:w-auto md:h-9"
                    size="sm"
                  >
                    <MessageSquare className="h-4 w-4" />
                    Send template
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <TemplateSelectorDialog
        open={showTemplateDialog}
        onOpenChange={setShowTemplateDialog}
        phoneNumber={phoneNumber || ""}
        phoneNumberId={phoneNumberId}
        onTemplateSent={handleTemplateSent}
      />

      <InteractiveMessageDialog
        open={showInteractiveDialog}
        onOpenChange={setShowInteractiveDialog}
        conversationId={conversationId}
        phoneNumber={phoneNumber}
        phoneNumberId={phoneNumberId}
        onMessageSent={handleSessionMessageSent}
      />

      <LocationRequestDialog
        open={showLocationRequestDialog}
        onOpenChange={setShowLocationRequestDialog}
        phoneNumber={phoneNumber}
        phoneNumberId={phoneNumberId}
        onMessageSent={handleSessionMessageSent}
      />
    </div>
  );
}
