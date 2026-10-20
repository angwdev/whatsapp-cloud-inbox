import type { MediaData } from '@kapso/whatsapp-cloud-api';

export type ConversationStatusFilter = 'all' | 'active' | 'ended';

export type Conversation = {
  id: string;
  phoneNumber: string;
  status: string;
  lastActiveAt?: string;
  phoneNumberId: string;
  inboxPhoneNumber?: string;
  inboxDisplayName?: string;
  businessAccountId?: string;
  metadata?: Record<string, unknown>;
  contactName?: string;
  messagesCount?: number;
  /** When the contact last wrote; opens the 24-hour customer service window. */
  lastInboundAt?: string;
  lastOutboundAt?: string;
  lastMessage?: {
    content: string;
    direction: string;
    type?: string;
  };
};

export type MessageReaction = {
  emoji: string;
  direction: 'inbound' | 'outbound';
  createdAt: string;
  /** Sent from this browser and not yet confirmed by the message history. */
  pending?: boolean;
};

export type MessageLocation = {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
  url?: string;
};

export type SharedContact = {
  name: string;
  organization?: string;
  phones: Array<{ phone: string; waId?: string; type?: string }>;
  emails: string[];
};

/** A tap on a reply button, list row or template quick-reply button. */
export type InteractiveReply = {
  kind: 'button' | 'list' | 'template_button';
  title: string;
  id?: string;
  description?: string;
};

export type OrderSummary = {
  catalogId?: string;
  text?: string;
  items: Array<{ productId: string; quantity: number; price?: number; currency?: string }>;
};

/** What an outbound interactive message offered the contact. */
export type InteractiveSummary = {
  header?: string;
  footer?: string;
  buttons?: string[];
  cta?: string;
};

export type MessageError = {
  code?: number;
  title?: string;
  message?: string;
};

export const LOCATION_REQUEST_INTERACTIVE_TYPE = 'location_request_message';
export const LOCATION_REQUEST_BODY_MAX_LENGTH = 1024;
/** WhatsApp only delivers reactions to messages up to 30 days old. */
export const REACTION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type Message = {
  id: string;
  conversationId: string;
  phoneNumberId: string;
  direction: 'inbound' | 'outbound';
  content: string;
  createdAt: string;
  status?: string;
  phoneNumber: string;
  hasMedia: boolean;
  mediaData?: {
    url: string;
    contentType?: string;
    filename?: string;
  } | (MediaData & { url: string });
  /** Emoji carried by a reaction message itself. An empty string removes the reaction. */
  reactionEmoji?: string | null;
  reactedToMessageId?: string | null;
  /** Current reactions on this message, at most one per side. */
  reactions?: MessageReaction[];
  location?: MessageLocation | null;
  interactiveType?: string | null;
  interactiveReply?: InteractiveReply | null;
  interactiveSummary?: InteractiveSummary | null;
  contacts?: SharedContact[] | null;
  order?: OrderSummary | null;
  /** Answers from a WhatsApp Flow (nfm_reply), keyed as the flow defined them. */
  flowResponse?: Record<string, unknown> | null;
  /** Why WhatsApp failed to deliver an outbound message, or couldn't parse an inbound one. */
  errors?: MessageError[] | null;
  /** Set on messages sent from this browser that the history doesn't list yet. */
  localState?: 'sending' | 'failed';
  contextMessageId?: string | null;
  repliedTo?: {
    id: string;
    conversationId: string;
    content: string;
    direction: 'inbound' | 'outbound';
    messageType?: string;
    senderName?: string;
  } | null;
  filename?: string | null;
  mimeType?: string | null;
  messageType?: string;
  caption?: string | null;
  metadata?: {
    mediaId?: string;
    caption?: string;
  };
};

export type ConversationThread = {
  key: string;
  phoneNumber: string;
  phoneNumberId: string;
  inboxPhoneNumber?: string;
  inboxDisplayName?: string;
  businessAccountId?: string;
  contactName?: string;
  conversations: Conversation[];
  latestConversation: Conversation;
  conversationCount: number;
  previousConversationIds: string[];
  status: string;
  lastActiveAt?: string;
  lastInboundAt?: string;
  lastMessage?: Conversation['lastMessage'];
};

export const CONVERSATIONS_QUERY_KEY = ['conversations'] as const;

export function conversationMessagesQueryKey(phoneNumberId: string | undefined, conversationId: string) {
  return ['conversation-messages', phoneNumberId ?? '', conversationId] as const;
}

export function phoneThreadMessagesQueryKey(
  phoneNumberId: string | undefined,
  phoneNumber: string | undefined,
  conversationIds: string[]
) {
  return ['phone-thread-messages', phoneNumberId ?? '', phoneNumber ?? '', conversationIds.join(':')] as const;
}

function parseTimestamp(timestamp?: string): number {
  if (!timestamp) return 0;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? time : 0;
}

function conversationGroupKey(conversation: Conversation): string {
  const phoneNumber = conversation.phoneNumber.trim();
  const comparablePhoneNumber = phoneNumber.replace(/\D/g, '');
  const contactKey = comparablePhoneNumber || phoneNumber || `conversation:${conversation.id}`;
  return `${conversation.phoneNumberId}:${contactKey}`;
}

function byMostRecentConversation(a: Conversation, b: Conversation): number {
  const delta = parseTimestamp(b.lastActiveAt) - parseTimestamp(a.lastActiveAt);
  if (delta !== 0) return delta;
  return b.id.localeCompare(a.id);
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error || fallback);
  }
  return data as T;
}

export async function fetchConversations(): Promise<Conversation[]> {
  const response = await fetch('/api/conversations?limit=100');
  const data = await readJson<{ data?: Conversation[] }>(response, 'Failed to fetch conversations');
  return data.data || [];
}

/** One conversation's loaded history: the newest page plus any older pages the agent asked for. */
export type ConversationMessages = {
  messages: Message[];
  /** Cursor for the next older page, or null once the start of the conversation is loaded. */
  olderCursor: string | null;
  /** True after older pages were loaded, so polling the newest page keeps them. */
  extended: boolean;
};

const MESSAGES_PAGE_SIZE = 100;

async function fetchMessagesPage(conversationId: string, phoneNumberId?: string, after?: string) {
  const params = new URLSearchParams({ limit: String(MESSAGES_PAGE_SIZE) });
  if (phoneNumberId) params.set('phoneNumberId', phoneNumberId);
  if (after) params.set('after', after);

  const response = await fetch(`/api/messages/${encodeURIComponent(conversationId)}?${params.toString()}`);
  const data = await readJson<{ data?: Array<Omit<Message, 'conversationId'>>; paging?: { olderCursor?: string | null } }>(
    response,
    'Failed to fetch messages',
  );

  const messages = (data.data || []).map((message) => ({
    ...message,
    phoneNumberId: message.phoneNumberId ?? phoneNumberId ?? '',
    conversationId,
  }));

  return { messages, olderCursor: data.paging?.olderCursor ?? null };
}

function mergeById(newer: Message[], older: Message[]): Message[] {
  const seen = new Set(newer.map(message => message.id));
  return [...newer, ...older.filter(message => !seen.has(message.id))];
}

/**
 * Fetches the newest page of a conversation. When older pages were loaded before,
 * they stay, so a background refresh doesn't collapse a thread the agent scrolled back in.
 */
export async function fetchConversationMessages(
  conversationId: string,
  phoneNumberId?: string,
  previous?: ConversationMessages,
): Promise<ConversationMessages> {
  const page = await fetchMessagesPage(conversationId, phoneNumberId);

  if (previous?.extended) {
    return {
      messages: normalizeMessages(mergeById(page.messages, previous.messages), { keepOrphanReactions: true }),
      olderCursor: previous.olderCursor,
      extended: true,
    };
  }

  return {
    messages: normalizeMessages(page.messages, { keepOrphanReactions: true }),
    olderCursor: page.olderCursor,
    extended: false,
  };
}

export async function fetchOlderConversationMessages(
  conversationId: string,
  phoneNumberId: string | undefined,
  current: ConversationMessages,
): Promise<ConversationMessages> {
  if (!current.olderCursor) return current;

  const page = await fetchMessagesPage(conversationId, phoneNumberId, current.olderCursor);
  return {
    messages: normalizeMessages(mergeById(current.messages, page.messages), { keepOrphanReactions: true }),
    olderCursor: page.olderCursor,
    extended: true,
  };
}

export function groupConversationsByPhoneNumber(conversations: Conversation[]): ConversationThread[] {
  const groupedConversations = new Map<string, Conversation[]>();

  conversations.forEach((conversation) => {
    const key = conversationGroupKey(conversation);
    const existing = groupedConversations.get(key) || [];
    existing.push(conversation);
    groupedConversations.set(key, existing);
  });

  return Array.from(groupedConversations.entries())
    .map(([key, threadConversations]) => {
      const sortedConversations = [...threadConversations].sort(byMostRecentConversation);
      const latestConversation = sortedConversations[0];

      return {
        key,
        phoneNumber: latestConversation.phoneNumber,
        phoneNumberId: latestConversation.phoneNumberId,
        inboxPhoneNumber: latestConversation.inboxPhoneNumber,
        inboxDisplayName: latestConversation.inboxDisplayName,
        businessAccountId: latestConversation.businessAccountId,
        contactName: latestConversation.contactName || sortedConversations.find(conversation => conversation.contactName)?.contactName,
        conversations: sortedConversations,
        latestConversation,
        conversationCount: sortedConversations.length,
        previousConversationIds: sortedConversations.slice(1).map(conversation => conversation.id),
        status: latestConversation.status,
        lastActiveAt: latestConversation.lastActiveAt,
        lastInboundAt: sortedConversations
          .map(conversation => conversation.lastInboundAt)
          .filter((timestamp): timestamp is string => Boolean(timestamp))
          .sort((a, b) => parseTimestamp(b) - parseTimestamp(a))[0],
        lastMessage: latestConversation.lastMessage,
      };
    })
    .sort((a, b) => byMostRecentConversation(a.latestConversation, b.latestConversation));
}

export function filterConversationThreads(
  threads: ConversationThread[],
  statusFilter: ConversationStatusFilter,
  searchQuery: string,
): ConversationThread[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  return threads.filter((thread) => {
    if (statusFilter !== 'all' && thread.latestConversation.status !== statusFilter) {
      return false;
    }

    if (!normalizedQuery) return true;

    return (
      thread.phoneNumber.toLowerCase().includes(normalizedQuery) ||
      thread.inboxPhoneNumber?.toLowerCase().includes(normalizedQuery) ||
      thread.inboxDisplayName?.toLowerCase().includes(normalizedQuery) ||
      thread.contactName?.toLowerCase().includes(normalizedQuery) ||
      thread.conversations.some(conversation => conversation.id.toLowerCase().includes(normalizedQuery))
    );
  });
}

export function countThreadsByStatus(threads: ConversationThread[]) {
  return threads.reduce(
    (counts, thread) => {
      counts.all += 1;
      if (thread.latestConversation.status === 'active') counts.active += 1;
      if (thread.latestConversation.status === 'ended') counts.ended += 1;
      return counts;
    },
    { all: 0, active: 0, ended: 0 },
  );
}

export function shortConversationId(conversationId?: string): string {
  if (!conversationId) return '';
  return conversationId.replace(/-/g, '').slice(0, 8);
}

export function describeLocation(location: MessageLocation): string {
  return location.name || location.address || `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
}

export function isLocationRequestMessage(message: Pick<Message, 'messageType' | 'interactiveType'>): boolean {
  return message.messageType === 'interactive' && message.interactiveType === LOCATION_REQUEST_INTERACTIVE_TYPE;
}

function getReplyPreviewContent(message: Message): string {
  if (message.location) return `📍 ${describeLocation(message.location)}`;

  const content = message.caption || message.content || message.filename || '';
  const trimmedContent = content.trim();

  if (trimmedContent) {
    return trimmedContent.length > 120 ? `${trimmedContent.slice(0, 117)}...` : trimmedContent;
  }

  if (message.hasMedia && message.messageType) {
    return `${message.messageType.charAt(0).toUpperCase()}${message.messageType.slice(1)} message`;
  }

  return 'Message';
}

type ReactionEvent = MessageReaction & { targetId: string };

/**
 * Each side can hold one reaction per message: a newer reaction replaces the
 * older one and a reaction with an empty emoji removes it.
 */
function collectReactions(events: ReactionEvent[]): Map<string, MessageReaction[]> {
  const latestBySide = new Map<string, Map<MessageReaction['direction'], MessageReaction>>();

  [...events]
    .sort((a, b) => parseTimestamp(a.createdAt) - parseTimestamp(b.createdAt))
    .forEach(({ targetId, ...reaction }) => {
      const sides = latestBySide.get(targetId) ?? new Map();
      const emoji = reaction.emoji.trim();

      if (emoji) {
        sides.set(reaction.direction, { ...reaction, emoji });
      } else {
        sides.delete(reaction.direction);
      }

      latestBySide.set(targetId, sides);
    });

  const reactionMap = new Map<string, MessageReaction[]>();
  latestBySide.forEach((sides, targetId) => {
    // Contact first, then you, so chips read the same way on every message.
    reactionMap.set(
      targetId,
      [...sides.values()].sort((a, b) => (a.direction === b.direction ? 0 : a.direction === 'inbound' ? -1 : 1)),
    );
  });

  return reactionMap;
}

type NormalizeOptions = {
  /**
   * Keep reactions whose target is not in this batch, so a later pass over the
   * whole thread can attach a reaction sent in a newer conversation.
   */
  keepOrphanReactions?: boolean;
};

export function normalizeMessages(messages: Message[], options: NormalizeOptions = {}): Message[] {
  const reactions = messages.filter(message => message.messageType === 'reaction');
  const regularMessages = messages.filter(message => message.messageType !== 'reaction');
  const messageMap = new Map(regularMessages.map(message => [message.id, message]));
  const reactionEvents: ReactionEvent[] = [
    // Reactions attached by an earlier pass, so new events build on them.
    ...regularMessages.flatMap(message => (message.reactions ?? []).map(reaction => ({ ...reaction, targetId: message.id }))),
    ...reactions.flatMap((reaction) => (
      reaction.reactedToMessageId && messageMap.has(reaction.reactedToMessageId)
        ? [{
            targetId: reaction.reactedToMessageId,
            emoji: reaction.reactionEmoji ?? '',
            direction: reaction.direction,
            createdAt: reaction.createdAt,
          }]
        : []
    )),
  ];
  const reactionMap = collectReactions(reactionEvents);
  const orphanReactions = options.keepOrphanReactions
    ? reactions.filter(reaction => !reaction.reactedToMessageId || !messageMap.has(reaction.reactedToMessageId))
    : [];

  return regularMessages
    .map((message): Message => {
      const reaction = reactionMap.get(message.id);
      const contextMessageId = message.contextMessageId?.trim();
      const repliedMessage = contextMessageId ? messageMap.get(contextMessageId) : undefined;
      const repliedTo = message.repliedTo ?? (
        repliedMessage
          ? {
              id: repliedMessage.id,
              conversationId: repliedMessage.conversationId,
              content: getReplyPreviewContent(repliedMessage),
              direction: repliedMessage.direction,
              messageType: repliedMessage.messageType,
              senderName: repliedMessage.direction === 'outbound' ? 'You' : 'Contact',
            }
          : contextMessageId
            ? {
                id: contextMessageId,
                conversationId: message.conversationId,
                content: 'Original message',
                direction: 'inbound' as const,
                senderName: 'Contact',
              }
            : undefined
      );

      return {
        ...message,
        reactions: reaction ?? [],
        ...(repliedTo ? { repliedTo } : {}),
      };
    })
    .concat(orphanReactions)
    .sort((a, b) => parseTimestamp(a.createdAt) - parseTimestamp(b.createdAt));
}
