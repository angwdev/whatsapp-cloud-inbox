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

export async function fetchConversations(): Promise<Conversation[]> {
  const response = await fetch('/api/conversations?limit=100');
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch conversations');
  }

  return data.data || [];
}

export async function fetchConversationMessages(conversationId: string, phoneNumberId?: string): Promise<Message[]> {
  const params = new URLSearchParams({ limit: '100' });
  if (phoneNumberId) {
    params.set('phoneNumberId', phoneNumberId);
  }

  const response = await fetch(`/api/messages/${conversationId}?${params.toString()}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch messages');
  }

  const messages = (data.data || []).map((message: Omit<Message, 'conversationId'>) => ({
    ...message,
    phoneNumberId: message.phoneNumberId ?? phoneNumberId ?? '',
    conversationId,
  }));

  return normalizeMessages(messages, { keepOrphanReactions: true });
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
