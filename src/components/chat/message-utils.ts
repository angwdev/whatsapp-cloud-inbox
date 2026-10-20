import { format, formatDistanceToNow, isToday, isValid, isYesterday } from 'date-fns';
import { describeLocation, isLocationRequestMessage, type Message } from '@/lib/inbox-data';

export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function formatMessageTime(timestamp: string): string {
  const date = new Date(timestamp);
  return isValid(date) ? format(date, 'HH:mm') : '';
}

export function formatDateDivider(timestamp: string): string {
  const date = new Date(timestamp);
  if (!isValid(date)) return '';
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'MMMM d, yyyy');
}

export function formatLastSeen(timestamp?: string): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return isValid(date) ? formatDistanceToNow(date, { addSuffix: true }) : null;
}

export function formatDisplayPhoneNumber(phoneNumber?: string): string | null {
  const trimmed = phoneNumber?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('+')) return trimmed;
  if (/^\d+$/.test(trimmed)) return `+${trimmed}`;
  return trimmed;
}

export function isSameDay(a: string, b: string): boolean {
  const first = new Date(a);
  const second = new Date(b);
  return isValid(first) && isValid(second) && format(first, 'yyyy-MM-dd') === format(second, 'yyyy-MM-dd');
}

function extractTranscriptDisplayContent(content: string): string | undefined {
  const match = content.match(/\bTranscript:\s*[\s\S]*$/i);
  if (!match) return undefined;
  return match[0].replace(/\s+\bURL:\s*https?:\/\/\S+[\s\S]*$/i, '').trim();
}

function isGeneratedAttachmentDisplayContent(content: string): boolean {
  return (
    /^https?:\/\//i.test(content) ||
    /\bURL:\s*https?:\/\//i.test(content) ||
    /^(image|audio)\s+attached\b/i.test(content)
  );
}

/** The text to show in the bubble, or null when a card already shows everything. */
export function getDisplayMessageContent(message: Message): string | null {
  if (message.location || message.contacts?.length || message.flowResponse || message.order) return null;
  if (message.interactiveReply) return null;
  if (!message.content || message.content === '[Image attached]') return null;

  const trimmedContent = message.content.trim();

  if (message.messageType === 'audio') {
    return extractTranscriptDisplayContent(trimmedContent) ??
      (isGeneratedAttachmentDisplayContent(trimmedContent) ? null : trimmedContent);
  }

  if (message.messageType === 'image' && isGeneratedAttachmentDisplayContent(trimmedContent)) {
    return null;
  }

  return trimmedContent;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export function getReplyPreviewContent(message: Message): string {
  if (message.location) return `📍 ${describeLocation(message.location)}`;
  if (message.contacts?.length) return `👤 ${message.contacts.map((contact) => contact.name).join(', ')}`;
  if (message.flowResponse) return '📋 Form response';
  if (message.order) return '🛒 Order';
  if (message.interactiveReply) return message.interactiveReply.title;
  if (isLocationRequestMessage(message)) return `📍 ${truncate(message.content || 'Location request', 120)}`;

  const content = (getDisplayMessageContent(message) || message.caption || message.filename || '').trim();
  if (content) return truncate(content, 140);

  if (message.hasMedia && message.messageType) {
    return `${message.messageType.charAt(0).toUpperCase()}${message.messageType.slice(1)} message`;
  }

  return 'Message';
}

export function getMessageSenderLabel(
  message: Pick<Message, 'direction'>,
  contactName?: string,
  phoneNumber?: string,
): string {
  if (message.direction === 'outbound') return 'you';
  return contactName || phoneNumber || 'contact';
}

/** Messages that count as the contact writing, which opens the customer service window. */
export function opensServiceWindow(message: Message): boolean {
  return message.direction === 'inbound' && message.messageType !== 'system' && !message.localState;
}

export function extractSentMessageId(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const sendResult = result as { messages?: Array<{ id?: string }>; messageId?: string; id?: string };
  const sentMessageId = sendResult.messages?.find((message) => typeof message.id === 'string')?.id;
  return sentMessageId ?? sendResult.messageId ?? sendResult.id ?? null;
}
