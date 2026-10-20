"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowDown, ArrowLeft, Clock, History, Loader2, MessageSquare, Paperclip, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApiError, apiFetch, errorMessage } from "@/lib/api-client";
import {
  CONVERSATIONS_QUERY_KEY,
  REACTION_MAX_AGE_MS,
  type Conversation,
  type ConversationMessages,
  type Message,
  conversationMessagesQueryKey,
  fetchConversationMessages,
  fetchOlderConversationMessages,
  normalizeMessages,
  phoneThreadMessagesQueryKey,
  shortConversationId,
} from "@/lib/inbox-data";
import { mediaTypeForMime, resolveMimeType } from "@/lib/media-limits";
import { isWindowClosedError } from "@/lib/whatsapp-errors";
import { readReceiptsEnabled } from "@/lib/preferences";
import { applyLocalReactions, useLocalReactions } from "@/hooks/use-local-reactions";
import { useLocalReplyContexts, type RepliedToMessage } from "@/hooks/use-local-reply-contexts";
import { TemplateSelectorDialog } from "@/components/template-selector-dialog";
import { InteractiveMessageDialog } from "@/components/interactive-message-dialog";
import { LocationRequestDialog } from "@/components/location-request-dialog";
import { FlowMessageDialog } from "@/components/flow-message-dialog";
import { Composer, type ComposerHandle, type ComposerSendInput } from "@/components/chat/composer";
import { MessageRow, type MessageRowHandlers } from "@/components/chat/message-row";
import {
  CUSTOMER_SERVICE_WINDOW_MS,
  extractSentMessageId,
  formatDateDivider,
  formatDisplayPhoneNumber,
  formatLastSeen,
  getMessageSenderLabel,
  getReplyPreviewContent,
  isSameDay,
  opensServiceWindow,
} from "@/components/chat/message-utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";

const MESSAGE_SKELETON_WIDTHS = [280, 180, 320, 210, 260, 170];
const LONG_PRESS_DELAY_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const NEAR_BOTTOM_PX = 120;
/** Statuses (delivered, read) change without moving the conversation, so check more often while they can. */
const RECENT_OUTBOUND_MS = 10 * 60_000;
const READ_RECEIPT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type ThreadData = {
  messages: Message[];
  olderCursors: Record<string, string | null>;
};

type PendingSend = {
  id: string;
  text: string;
  file: File | null;
  previewUrl: string | null;
  replyTo: RepliedToMessage | null;
  createdAt: string;
  state: "sending" | "failed" | "sent";
  serverId?: string;
  error?: { code?: number; message: string };
};

function createLocalId(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `local:${random}`;
}

function formatWindowRemaining(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function pendingToMessage(pending: PendingSend, conversationId: string, phoneNumberId: string, phoneNumber: string): Message {
  const mimeType = pending.file ? resolveMimeType(pending.file) : undefined;
  const mediaType = mimeType ? mediaTypeForMime(mimeType) ?? "document" : undefined;

  return {
    id: pending.id,
    conversationId,
    phoneNumberId,
    direction: "outbound",
    content: pending.file ? "" : pending.text,
    caption: pending.file && pending.text ? pending.text : undefined,
    createdAt: pending.createdAt,
    phoneNumber,
    hasMedia: Boolean(pending.file && pending.previewUrl),
    mediaData: pending.file && pending.previewUrl
      ? { url: pending.previewUrl, contentType: mimeType, filename: pending.file.name }
      : undefined,
    filename: pending.file?.name,
    // Files without a local preview show as a document-style caption until the history has them.
    messageType: pending.previewUrl ? (mediaType ?? "image") : "text",
    ...(pending.file && !pending.previewUrl && { content: `📎 ${pending.file.name}${pending.text ? `\n${pending.text}` : ""}`, caption: undefined }),
    repliedTo: pending.replyTo,
    localState: pending.state === "failed" ? "failed" : "sending",
    errors: pending.error ? [{ code: pending.error.code, message: pending.error.message }] : undefined,
  };
}

type Props = {
  threadKey?: string;
  conversationId?: string;
  conversations?: Conversation[];
  phoneNumber?: string;
  phoneNumberId?: string;
  inboxPhoneNumber?: string;
  inboxDisplayName?: string;
  contactName?: string;
  lastActiveAt?: string;
  lastInboundAt?: string;
  realtimeConnected?: boolean;
  onTemplateSent?: (phoneNumber: string, phoneNumberId?: string) => Promise<void>;
  onBack?: () => void;
  isVisible?: boolean;
};

export function MessageView({
  threadKey: threadKeyProp,
  conversationId,
  conversations = [],
  phoneNumber,
  phoneNumberId,
  inboxPhoneNumber,
  inboxDisplayName,
  contactName,
  lastActiveAt,
  lastInboundAt,
  realtimeConnected = false,
  onTemplateSent,
  onBack,
  isVisible = false,
}: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [showInteractiveDialog, setShowInteractiveDialog] = useState(false);
  const [showLocationRequestDialog, setShowLocationRequestDialog] = useState(false);
  const [showFlowDialog, setShowFlowDialog] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [newWhileAway, setNewWhileAway] = useState(0);
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [pendingSends, setPendingSends] = useState<PendingSend[]>([]);
  const [windowClosedAt, setWindowClosedAt] = useState<number | null>(null);
  const [loadingOlderFor, setLoadingOlderFor] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const lastInitialScrollKeyRef = useRef("");
  const highlightTimeoutRef = useRef<number | null>(null);
  const longPressRef = useRef<{ timer: number; x: number; y: number } | null>(null);
  const markedReadRef = useRef<Set<string>>(new Set());
  const restoreScrollRef = useRef<number | null>(null);
  const lastActiveAtRef = useRef(lastActiveAt);
  const awayBaselineRef = useRef<number | null>(null);
  const queryClient = useQueryClient();
  const { remember: rememberReplyContext, apply: applyReplyContexts } = useLocalReplyContexts();
  const lastSeenText = formatLastSeen(lastActiveAt);
  const displayPhoneNumber = formatDisplayPhoneNumber(phoneNumber);
  const displayInboxPhoneNumber = formatDisplayPhoneNumber(inboxPhoneNumber);
  const contactLabel = contactName || displayPhoneNumber || "Contact";

  const threadConversationIds = useMemo(() => {
    const ids = conversations.map((conversation) => conversation.id);
    return ids.length > 0 ? ids : conversationId ? [conversationId] : [];
  }, [conversationId, conversations]);
  const threadMessagesQueryKey = useMemo(
    () => phoneThreadMessagesQueryKey(phoneNumberId, phoneNumber, threadConversationIds),
    [phoneNumberId, phoneNumber, threadConversationIds],
  );
  const threadKey = threadKeyProp ?? threadConversationIds.join(":");
  const initialScrollKey = `${conversationId ?? ""}:${threadKey}`;

  // ---------------------------------------------------------------------------
  // Data

  const combineThread = useCallback((pages: Array<[string, ConversationMessages | undefined]>): ThreadData => ({
    messages: normalizeMessages(pages.flatMap(([, page]) => page?.messages ?? [])),
    olderCursors: Object.fromEntries(pages.map(([id, page]) => [id, page?.olderCursor ?? null])),
  }), []);

  const fetchThread = useCallback(async ({ refreshAll = false } = {}): Promise<ThreadData> => {
    if (threadConversationIds.length === 0) return { messages: [], olderCursors: {} };

    const latestConversationId = threadConversationIds[0];
    const pages = await Promise.all(threadConversationIds.map(async (id): Promise<[string, ConversationMessages]> => {
      const queryKey = conversationMessagesQueryKey(phoneNumberId, id);
      const cached = queryClient.getQueryData<ConversationMessages>(queryKey);

      // Older conversations are closed; only the latest one changes between polls.
      if (cached && id !== latestConversationId && !refreshAll) return [id, cached];

      const page = await queryClient.fetchQuery({
        queryKey,
        queryFn: () => fetchConversationMessages(id, phoneNumberId, cached),
        staleTime: 0,
      });
      return [id, page];
    }));

    return combineThread(pages);
  }, [combineThread, phoneNumberId, queryClient, threadConversationIds]);

  const { data: thread, isPending: loading } = useQuery({
    queryKey: threadMessagesQueryKey,
    queryFn: () => fetchThread(),
    enabled: threadConversationIds.length > 0,
    // New messages also trigger a refetch through lastActiveAt (and webhooks when set up),
    // so polling mostly picks up delivery and read ticks.
    refetchInterval: (query) => {
      if (realtimeConnected) return 60_000;
      const awaitingTicks = query.state.data?.messages.some((message) => (
        message.direction === "outbound" &&
        (message.status === "sent" || message.status === "delivered") &&
        Date.now() - Date.parse(message.createdAt) < RECENT_OUTBOUND_MS
      ));
      return awaitingTicks ? 10_000 : 30_000;
    },
    refetchOnMount: false,
  });
  const serverMessages = useMemo(() => thread?.messages ?? [], [thread]);
  const olderCursors = thread?.olderCursors;

  const refreshCurrentThread = useCallback(async () => {
    const data = await fetchThread({ refreshAll: true });
    queryClient.setQueryData(threadMessagesQueryKey, data);
  }, [fetchThread, queryClient, threadMessagesQueryKey]);

  // The conversation list polls; when it reports activity on this thread, fetch it now.
  useEffect(() => {
    if (lastActiveAtRef.current === lastActiveAt) return;
    lastActiveAtRef.current = lastActiveAt;
    if (!lastActiveAt || threadConversationIds.length === 0) return;
    void queryClient.invalidateQueries({ queryKey: threadMessagesQueryKey });
  }, [lastActiveAt, queryClient, threadConversationIds.length, threadMessagesQueryKey]);

  const { localReactions, setOptimistic } = useLocalReactions(serverMessages);

  // Sent messages stay as local bubbles until the history lists them.
  useEffect(() => {
    const serverIds = new Set(serverMessages.map((message) => message.id));
    setPendingSends((pending) => {
      const delivered = pending.filter((send) => send.serverId && serverIds.has(send.serverId));
      if (delivered.length === 0) return pending;
      delivered.forEach((send) => send.previewUrl && URL.revokeObjectURL(send.previewUrl));
      return pending.filter((send) => !delivered.includes(send));
    });
  }, [serverMessages]);

  const displayMessages = useMemo(() => {
    const withLocal = applyReplyContexts(applyLocalReactions(serverMessages, localReactions));
    if (pendingSends.length === 0) return withLocal;
    return [
      ...withLocal,
      ...pendingSends.map((send) => pendingToMessage(send, conversationId ?? "", phoneNumberId ?? "", phoneNumber ?? "")),
    ];
  }, [applyReplyContexts, conversationId, localReactions, pendingSends, phoneNumber, phoneNumberId, serverMessages]);

  const latestInboundMessage = useMemo(() => {
    for (let index = serverMessages.length - 1; index >= 0; index -= 1) {
      if (opensServiceWindow(serverMessages[index])) return serverMessages[index];
    }
    return undefined;
  }, [serverMessages]);

  const answeredLocationRequests = useMemo(() => {
    const answers = new Map<string, string>();
    displayMessages.forEach((message) => {
      if (message.location && message.direction === "inbound" && message.contextMessageId) {
        answers.set(message.contextMessageId, message.id);
      }
    });
    return answers;
  }, [displayMessages]);

  // ---------------------------------------------------------------------------
  // Customer service window

  const lastInboundTime = Math.max(
    lastInboundAt ? Date.parse(lastInboundAt) || 0 : 0,
    latestInboundMessage ? Date.parse(latestInboundMessage.createdAt) || 0 : 0,
  );
  const windowExpiresAt = lastInboundTime ? lastInboundTime + CUSTOMER_SERVICE_WINDOW_MS : 0;
  // A 131047 from WhatsApp wins until the contact writes again.
  const closedByError = windowClosedAt !== null && lastInboundTime <= windowClosedAt;
  const canSendRegularMessage = !closedByError && windowExpiresAt > now;
  const windowRemainingMs = windowExpiresAt - now;

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  // Flip to template-only exactly when the window closes, not at the next tick.
  useEffect(() => {
    const remaining = windowExpiresAt - Date.now();
    if (remaining <= 0 || remaining > 2_000_000_000) return;
    const timeout = window.setTimeout(() => setNow(Date.now()), remaining + 50);
    return () => window.clearTimeout(timeout);
  }, [windowExpiresAt]);

  useEffect(() => {
    setReplyingToMessage(null);
    setReactionPickerMessageId(null);
    setWindowClosedAt(null);
    setNewWhileAway(0);
  }, [threadKey]);

  useEffect(() => {
    if (!canSendRegularMessage) {
      setReplyingToMessage(null);
      setReactionPickerMessageId(null);
    }
  }, [canSendRegularMessage]);

  // ---------------------------------------------------------------------------
  // Read receipts and typing indicator

  useEffect(() => {
    const message = latestInboundMessage;
    if (!isVisible || !message || markedReadRef.current.has(message.id) || !readReceiptsEnabled()) return;
    if (Date.now() - Date.parse(message.createdAt) > READ_RECEIPT_MAX_AGE_MS) return;

    const markRead = () => {
      if (document.visibilityState !== "visible" || markedReadRef.current.has(message.id)) return;
      markedReadRef.current.add(message.id);
      // Best effort: an old or unknown message just returns 131009.
      void apiFetch("/api/messages/read", {
        method: "POST",
        body: { messageId: message.id, phoneNumberId: message.phoneNumberId || phoneNumberId },
      }).catch(() => {});
    };

    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [isVisible, latestInboundMessage, phoneNumberId]);

  const handleTyping = useCallback(() => {
    if (!latestInboundMessage || !canSendRegularMessage || !readReceiptsEnabled()) return;
    void apiFetch("/api/messages/read", {
      method: "POST",
      body: {
        messageId: latestInboundMessage.id,
        phoneNumberId: latestInboundMessage.phoneNumberId || phoneNumberId,
        typing: true,
      },
    }).catch(() => {});
  }, [canSendRegularMessage, latestInboundMessage, phoneNumberId]);

  // ---------------------------------------------------------------------------
  // Scrolling

  const getScrollViewport = useCallback(() => (
    messagesContainerRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ?? null
  ), []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const viewport = getScrollViewport();
    if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, [getScrollViewport]);

  const scrollToSelectedConversation = useCallback(() => {
    const viewport = getScrollViewport();
    if (!viewport) return;

    const isLatestConversation = !conversationId || threadConversationIds[0] === conversationId;
    const selected = isLatestConversation
      ? []
      : Array.from(viewport.querySelectorAll<HTMLElement>("[data-conversation-id]"))
          .filter((element) => element.dataset.conversationId === conversationId);
    const target = selected[selected.length - 1];

    if (target) {
      target.scrollIntoView({ behavior: "auto", block: "center" });
    } else {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [conversationId, getScrollViewport, threadConversationIds]);

  const scrollToMessage = useCallback((messageId: string) => {
    const viewport = getScrollViewport();
    const target = viewport
      ? Array.from(viewport.querySelectorAll<HTMLElement>("[data-message-id]")).find((element) => element.dataset.messageId === messageId)
      : undefined;

    if (!target) {
      toast("That message isn't loaded", { description: "Load earlier messages to find it." });
      return;
    }

    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(messageId);
    if (highlightTimeoutRef.current !== null) window.clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedMessageId(null);
      highlightTimeoutRef.current = null;
    }, 2_000);
  }, [getScrollViewport]);

  // Follow new messages only while the agent is at the bottom.
  useEffect(() => {
    if (isNearBottom && restoreScrollRef.current === null) scrollToBottom();
  }, [displayMessages, isNearBottom, scrollToBottom]);

  // Count what arrived while the agent was scrolled up.
  useEffect(() => {
    const inboundCount = displayMessages.reduce((count, message) => count + (message.direction === "inbound" ? 1 : 0), 0);
    if (isNearBottom) {
      awayBaselineRef.current = null;
      setNewWhileAway(0);
      return;
    }
    if (awayBaselineRef.current === null) awayBaselineRef.current = inboundCount;
    setNewWhileAway(Math.max(0, inboundCount - awayBaselineRef.current));
  }, [displayMessages, isNearBottom]);

  // Keep the agent's place when older messages are prepended.
  useLayoutEffect(() => {
    const distanceFromBottom = restoreScrollRef.current;
    const viewport = getScrollViewport();
    if (distanceFromBottom === null || !viewport) return;
    viewport.scrollTop = viewport.scrollHeight - distanceFromBottom;
    restoreScrollRef.current = null;
  }, [displayMessages, getScrollViewport]);

  useEffect(() => {
    if (loading || displayMessages.length === 0 || !threadKey) return;
    if (lastInitialScrollKeyRef.current === initialScrollKey) return;

    lastInitialScrollKeyRef.current = initialScrollKey;
    setIsNearBottom(true);

    const viewport = getScrollViewport();
    const content = viewport?.firstElementChild;
    let frame = 0;
    let secondFrame = 0;
    let stopped = false;
    let resizeObserver: ResizeObserver | null = null;
    let timeout = 0;

    const stop = () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(timeout);
      resizeObserver?.disconnect();
      viewport?.removeEventListener("wheel", stop);
      viewport?.removeEventListener("touchstart", stop);
    };
    const sync = () => {
      if (!stopped) scrollToSelectedConversation();
    };

    viewport?.addEventListener("wheel", stop, { passive: true });
    viewport?.addEventListener("touchstart", stop, { passive: true });
    if (typeof ResizeObserver !== "undefined" && content) {
      // Images load after the first paint; keep the end in view until they settle.
      resizeObserver = new ResizeObserver(sync);
      resizeObserver.observe(content);
    }

    sync();
    frame = window.requestAnimationFrame(() => {
      sync();
      secondFrame = window.requestAnimationFrame(sync);
    });
    timeout = window.setTimeout(stop, 1_500);
    return stop;
  }, [displayMessages.length, getScrollViewport, initialScrollKey, loading, scrollToSelectedConversation, threadKey]);

  // Attach once the scroll area exists (it isn't rendered while loading).
  useEffect(() => {
    if (loading) return;
    const viewport = getScrollViewport();
    if (!viewport) return;

    const handleScroll = () => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      setIsNearBottom(distanceFromBottom < NEAR_BOTTOM_PX);
    };
    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, [getScrollViewport, loading, conversationId]);

  useEffect(() => () => {
    if (highlightTimeoutRef.current !== null) window.clearTimeout(highlightTimeoutRef.current);
    if (longPressRef.current) window.clearTimeout(longPressRef.current.timer);
  }, []);

  // ---------------------------------------------------------------------------
  // Sending

  const sendPending = useCallback(async (pending: PendingSend) => {
    if (!phoneNumber) return;

    const formData = new FormData();
    formData.append("to", phoneNumber);
    if (phoneNumberId) formData.append("phoneNumberId", phoneNumberId);
    if (pending.replyTo) formData.append("contextMessageId", pending.replyTo.id);
    if (pending.text) formData.append("body", pending.text);
    if (pending.file) formData.append("file", pending.file);

    try {
      const result = await apiFetch<unknown>("/api/messages/send", { method: "POST", body: formData, errorMessage: "Failed to send message" });
      const serverId = extractSentMessageId(result) ?? undefined;
      if (serverId && pending.replyTo) rememberReplyContext(serverId, pending.replyTo);

      setPendingSends((sends) => sends.map((send) => (send.id === pending.id ? { ...send, state: "sent", serverId } : send)));
      // Without an id there's nothing to match against the history; drop the local copy after the refetch.
      if (!serverId) {
        window.setTimeout(() => setPendingSends((sends) => sends.filter((send) => send.id !== pending.id)), 8_000);
      }

      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
      await refreshCurrentThread();
    } catch (error) {
      const code = error instanceof ApiError ? error.code : undefined;
      setPendingSends((sends) => sends.map((send) => (
        send.id === pending.id
          ? { ...send, state: "failed", error: { code, message: errorMessage(error, "Failed to send message") } }
          : send
      )));

      if (isWindowClosedError(code)) {
        setWindowClosedAt(Date.now());
        toast.error("The 24-hour window is closed", {
          description: "Send a template to reopen the conversation.",
          action: { label: "Templates", onClick: () => setShowTemplateDialog(true) },
        });
      } else {
        toast.error("Message not sent", { description: errorMessage(error, "Failed to send message") });
      }
    }
  }, [phoneNumber, phoneNumberId, queryClient, refreshCurrentThread, rememberReplyContext]);

  const handleSend = useCallback(({ text, file }: ComposerSendInput) => {
    const replyTarget = replyingToMessage;
    const pending: PendingSend = {
      id: createLocalId(),
      text,
      file,
      previewUrl: file && /^(image|video)\//.test(file.type) ? URL.createObjectURL(file) : null,
      replyTo: replyTarget
        ? {
            id: replyTarget.id,
            conversationId: replyTarget.conversationId,
            content: getReplyPreviewContent(replyTarget),
            direction: replyTarget.direction,
            messageType: replyTarget.messageType,
            senderName: getMessageSenderLabel(replyTarget, contactName, phoneNumber),
          }
        : null,
      createdAt: new Date().toISOString(),
      state: "sending",
    };

    setPendingSends((sends) => [...sends, pending]);
    setReplyingToMessage(null);
    setIsNearBottom(true);
    window.requestAnimationFrame(() => scrollToBottom("smooth"));
    void sendPending(pending);
  }, [contactName, phoneNumber, replyingToMessage, scrollToBottom, sendPending]);

  const handleSessionMessageSent = useCallback(async () => {
    void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
    await refreshCurrentThread();
  }, [queryClient, refreshCurrentThread]);

  const handleTemplateSent = async () => {
    setWindowClosedAt(null);
    await refreshCurrentThread();
    if (phoneNumber && onTemplateSent) await onTemplateSent(phoneNumber, phoneNumberId);
  };

  const loadOlder = useCallback(async (targetConversationId: string) => {
    const queryKey = conversationMessagesQueryKey(phoneNumberId, targetConversationId);
    const current = queryClient.getQueryData<ConversationMessages>(queryKey);
    if (!current?.olderCursor) return;

    setLoadingOlderFor(targetConversationId);
    try {
      const next = await fetchOlderConversationMessages(targetConversationId, phoneNumberId, current);
      queryClient.setQueryData(queryKey, next);
      const viewport = getScrollViewport();
      if (viewport) restoreScrollRef.current = viewport.scrollHeight - viewport.scrollTop;
      queryClient.setQueryData(threadMessagesQueryKey, combineThread(
        threadConversationIds.map((id) => [id, queryClient.getQueryData<ConversationMessages>(conversationMessagesQueryKey(phoneNumberId, id))]),
      ));
    } catch (error) {
      toast.error("Couldn't load earlier messages", { description: errorMessage(error) });
    } finally {
      setLoadingOlderFor(null);
    }
  }, [combineThread, getScrollViewport, phoneNumberId, queryClient, threadConversationIds, threadMessagesQueryKey]);

  // ---------------------------------------------------------------------------
  // Row handlers: stable across renders so memoized rows skip re-rendering.

  const latestRef = useRef({ phoneNumber, phoneNumberId, setOptimistic, pendingSends, sendPending, scrollToMessage });
  useLayoutEffect(() => {
    latestRef.current = { phoneNumber, phoneNumberId, setOptimistic, pendingSends, sendPending, scrollToMessage };
  });

  const handlers = useMemo<MessageRowHandlers>(() => {
    const cancelLongPress = () => {
      if (!longPressRef.current) return;
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    };

    return {
      onReply: (message) => {
        setReplyingToMessage(message);
        window.requestAnimationFrame(() => composerRef.current?.focus());
      },
      onReact: async (message, emoji) => {
        setReactionPickerMessageId(null);
        const { phoneNumber: to, phoneNumberId: fallbackId, setOptimistic: optimistic } = latestRef.current;
        if (!to) return;

        const attempt = optimistic(message.id, emoji);
        try {
          await apiFetch("/api/messages/reaction", {
            method: "POST",
            body: { to, phoneNumberId: message.phoneNumberId || fallbackId, messageId: message.id, emoji },
            errorMessage: "Failed to send reaction",
          });
          attempt.confirm();
        } catch (error) {
          attempt.rollback();
          toast.error(emoji ? "Couldn't send the reaction" : "Couldn't remove the reaction", { description: errorMessage(error) });
        }
      },
      onPickerChange: setReactionPickerMessageId,
      onJumpTo: (messageId) => latestRef.current.scrollToMessage(messageId),
      onRetry: (localId) => {
        const pending = latestRef.current.pendingSends.find((send) => send.id === localId);
        if (!pending) return;
        const retry: PendingSend = { ...pending, state: "sending", error: undefined };
        setPendingSends((sends) => sends.map((send) => (send.id === localId ? retry : send)));
        void latestRef.current.sendPending(retry);
      },
      onDiscard: (localId) => setPendingSends((sends) => sends.filter((send) => {
        if (send.id !== localId) return true;
        if (send.previewUrl) URL.revokeObjectURL(send.previewUrl);
        return false;
      })),
      onLongPressStart: (event, messageId) => {
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
      },
      onLongPressMove: (event) => {
        const longPress = longPressRef.current;
        if (
          longPress &&
          (Math.abs(event.clientX - longPress.x) > LONG_PRESS_MOVE_TOLERANCE_PX ||
            Math.abs(event.clientY - longPress.y) > LONG_PRESS_MOVE_TOLERANCE_PX)
        ) {
          cancelLongPress();
        }
      },
      onLongPressEnd: cancelLongPress,
    };
  }, []);

  useEffect(() => {
    if (!replyingToMessage) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      // Dialogs and popovers handle their own Escape first.
      if (event.key === "Escape" && !event.defaultPrevented) setReplyingToMessage(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [replyingToMessage]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshCurrentThread();
    } catch (error) {
      toast.error("Couldn't refresh", { description: errorMessage(error) });
    } finally {
      setRefreshing(false);
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file && canSendRegularMessage) composerRef.current?.attachFile(file);
  };

  // ---------------------------------------------------------------------------
  // Render

  if (!conversationId) {
    return (
      <div className={cn("flex min-h-0 min-w-0 flex-1 items-center justify-center bg-muted/50 p-6 text-center", !isVisible && "hidden md:flex")}>
        <div className="max-w-sm space-y-2">
          <MessageSquare aria-hidden="true" className="mx-auto size-10 text-muted-foreground/50" />
          <p className="text-sm leading-6 text-muted-foreground">Select a conversation to view messages</p>
        </div>
      </div>
    );
  }

  const header = (
    <div className="border-b border-[var(--chat-border-strong)] bg-[var(--chat-toolbar)] px-2 pb-2 pt-safe-2 sm:px-3 sm:pb-3 sm:pt-safe-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
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
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-medium text-foreground">{contactName || phoneNumber || "Conversation"}</h2>
            {displayPhoneNumber && (
              <p className="truncate text-xs text-muted-foreground">
                {lastSeenText ? `Active ${lastSeenText} · ${displayPhoneNumber}` : displayPhoneNumber}
              </p>
            )}
            {(inboxDisplayName || displayInboxPhoneNumber) && (
              <p className="truncate text-[11px] text-muted-foreground/80">
                via {inboxDisplayName || displayInboxPhoneNumber}
                {inboxDisplayName && displayInboxPhoneNumber ? ` · ${displayInboxPhoneNumber}` : ""}
              </p>
            )}
            {!loading && canSendRegularMessage && windowRemainingMs < 2 * 60 * 60_000 && (
              // The window chip is hidden on phones; warn when it's about to close.
              <p className="flex items-center gap-1 text-[11px] font-medium text-[var(--chat-warning-foreground)] sm:hidden">
                <Clock aria-hidden="true" className="size-3" />
                Replies close in {formatWindowRemaining(windowRemainingMs)}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-0.5 md:gap-2">
          {!loading && (
            <span
              className={cn(
                "hidden items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium sm:inline-flex",
                canSendRegularMessage
                  ? windowRemainingMs < 60 * 60_000
                    ? "bg-[var(--chat-warning-background)] text-[var(--chat-warning-foreground)]"
                    : "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
              title="WhatsApp allows free-form replies for 24 hours after the contact's last message"
            >
              <Clock aria-hidden="true" className="size-3" />
              {canSendRegularMessage ? `${formatWindowRemaining(windowRemainingMs)} left to reply` : "Templates only"}
            </span>
          )}
          {realtimeConnected && (
            <span className="hidden size-2 rounded-full bg-[var(--chat-presence)] md:block" title="Live updates on" aria-label="Live updates on" />
          )}
          <ThemeToggle className="size-11 md:hidden" />
          <Button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            variant="ghost"
            size="icon"
            className="size-11 text-muted-foreground hover:bg-[var(--chat-hover)] md:size-10"
            aria-label="Refresh messages"
            title="Refresh messages"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--chat-canvas)]", !isVisible && "hidden md:flex")}>
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:p-4 lg:p-6" aria-busy="true" aria-label="Loading messages">
          <div className="mx-auto w-full max-w-[900px] space-y-3">
            {MESSAGE_SKELETON_WIDTHS.map((width, index) => (
              <div key={index} className={cn("mb-2 flex", index % 2 === 1 ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[min(88%,34rem)] rounded-lg px-3 py-2 shadow-sm", index % 2 === 1 ? "rounded-br-none" : "rounded-bl-none")}>
                  <Skeleton className="mb-2 h-4 max-w-full" style={{ width }} />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const replyTarget = replyingToMessage
    ? { senderLabel: getMessageSenderLabel(replyingToMessage, contactName, phoneNumber), preview: getReplyPreviewContent(replyingToMessage) }
    : null;

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--chat-canvas)]", !isVisible && "hidden md:flex")}>
      {header}

      <div
        className="relative flex min-h-0 flex-1 flex-col"
        onDragEnter={(event) => {
          if (canSendRegularMessage && event.dataTransfer.types.includes("Files")) setDragActive(true);
        }}
        onDragOver={(event) => {
          if (dragActive) event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
        }}
        onDrop={handleDrop}
      >
        <ScrollArea ref={messagesContainerRef} className="h-0 flex-1 overscroll-contain px-4 py-3 sm:p-4 lg:p-6">
          <div
            className="mx-auto w-full max-w-[900px]"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label={`Messages with ${contactLabel}`}
          >
            {displayMessages.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No messages yet</p>
            ) : (
              displayMessages.map((message, index) => {
                const previous = index > 0 ? displayMessages[index - 1] : null;
                const startsConversation = !previous || previous.conversationId !== message.conversationId;
                const olderCursor = startsConversation && !message.localState ? olderCursors?.[message.conversationId] : null;
                const canReact = canSendRegularMessage &&
                  message.direction === "inbound" &&
                  !message.localState &&
                  now - Date.parse(message.createdAt) < REACTION_MAX_AGE_MS;

                return (
                  <div key={message.id} data-message-id={message.id} data-conversation-id={message.conversationId}>
                    {olderCursor && (
                      <div className="my-3 flex justify-center">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void loadOlder(message.conversationId)}
                          disabled={loadingOlderFor === message.conversationId}
                          className="h-9 gap-1.5 rounded-full bg-[var(--chat-surface)] text-xs"
                        >
                          {loadingOlderFor === message.conversationId
                            ? <Loader2 className="size-3.5 animate-spin" />
                            : <History className="size-3.5" />}
                          Load earlier messages
                        </Button>
                      </div>
                    )}

                    {previous && startsConversation && (
                      <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
                        <div className="h-px flex-1 bg-[var(--chat-border)]" />
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--chat-canvas)] px-2 py-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--chat-presence)]" />
                          Conversation {shortConversationId(message.conversationId)}
                        </span>
                        <div className="h-px flex-1 bg-[var(--chat-border)]" />
                      </div>
                    )}

                    {(!previous || !isSameDay(previous.createdAt, message.createdAt)) && (
                      <div className="my-4 flex justify-center">
                        <Badge variant="secondary" className="shadow-sm">{formatDateDivider(message.createdAt)}</Badge>
                      </div>
                    )}

                    <MessageRow
                      message={message}
                      contactLabel={contactLabel}
                      contactName={contactName}
                      phoneNumber={phoneNumber}
                      fallbackPhoneNumberId={phoneNumberId}
                      isHighlighted={highlightedMessageId === message.id}
                      isPickerOpen={canReact && reactionPickerMessageId === message.id}
                      canReply={canSendRegularMessage}
                      canReact={canReact}
                      answeredByMessageId={answeredLocationRequests.get(message.id)}
                      handlers={handlers}
                    />
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>

        {!isNearBottom && (
          <button
            type="button"
            onClick={() => {
              setIsNearBottom(true);
              scrollToBottom("smooth");
            }}
            className="absolute bottom-4 right-4 flex size-11 items-center justify-center rounded-full border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] text-muted-foreground shadow-lg transition-transform animate-in fade-in-0 zoom-in-90 hover:text-foreground active:scale-95"
            aria-label={newWhileAway ? `${newWhileAway} new messages. Jump to latest` : "Jump to latest message"}
          >
            <ArrowDown className="size-5" />
            {newWhileAway > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold tabular-nums text-primary-foreground">
                {newWhileAway}
              </span>
            )}
          </button>
        )}

        {dragActive && (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/60 bg-primary/5 backdrop-blur-[1px]">
            <p className="flex items-center gap-2 rounded-full bg-[var(--chat-surface)] px-4 py-2 text-sm font-medium text-primary shadow">
              <Paperclip aria-hidden="true" className="size-4" />
              Drop to attach
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--chat-border-strong)] bg-[var(--chat-toolbar)] pb-safe-0">
        {canSendRegularMessage ? (
          <Composer
            ref={composerRef}
            threadKey={threadKey}
            replyTarget={replyTarget}
            onCancelReply={() => setReplyingToMessage(null)}
            onSend={handleSend}
            onTyping={handleTyping}
            onOpenInteractive={() => setShowInteractiveDialog(true)}
            onOpenLocationRequest={() => setShowLocationRequestDialog(true)}
            onOpenFlow={() => setShowFlowDialog(true)}
          />
        ) : (
          <div className="mx-auto w-full max-w-[900px] px-4 py-3">
            <div className="rounded-lg border border-[var(--chat-warning-border)] bg-[var(--chat-warning-background)] p-3 sm:p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--chat-warning-foreground)]" />
                <div className="min-w-0 flex-1">
                  <p className="mb-3 text-sm leading-5 text-foreground">
                    {!lastInboundTime
                      ? "The contact hasn't messaged yet. Send a template or wait for them to write."
                      : closedByError
                        ? "WhatsApp closed the 24-hour window for this contact. Send a template to reopen it."
                        : "The contact's last message was over 24 hours ago. Send a template or wait for them to write."}
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
      <FlowMessageDialog
        open={showFlowDialog}
        onOpenChange={setShowFlowDialog}
        phoneNumber={phoneNumber}
        phoneNumberId={phoneNumberId}
        onMessageSent={handleSessionMessageSent}
      />
    </div>
  );
}
