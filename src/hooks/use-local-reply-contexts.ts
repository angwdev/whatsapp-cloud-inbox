'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '@/lib/inbox-data';

const STORAGE_KEY = 'whatsapp-cloud-inbox-reply-contexts';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

export type RepliedToMessage = NonNullable<Message['repliedTo']>;

type LocalReplyContext = {
  contextMessageId: string;
  repliedTo: RepliedToMessage;
  createdAt: number;
};

type LocalReplyContexts = Record<string, LocalReplyContext>;

function prune(contexts: LocalReplyContexts): LocalReplyContexts {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(contexts)
      .filter(([, context]) => (
        context &&
        typeof context.contextMessageId === 'string' &&
        context.repliedTo &&
        typeof context.repliedTo.id === 'string' &&
        now - context.createdAt < MAX_AGE_MS
      ))
      .sort(([, a], [, b]) => b.createdAt - a.createdAt)
      .slice(0, MAX_ENTRIES),
  );
}

/**
 * Remembers which message each reply sent from this browser quoted, for message
 * histories that don't return the reply context of outbound messages.
 */
export function useLocalReplyContexts() {
  const [contexts, setContexts] = useState<LocalReplyContexts>({});
  const ref = useRef<LocalReplyContexts>({});

  const persist = useCallback((next: LocalReplyContexts) => {
    const pruned = prune(next);
    ref.current = pruned;
    setContexts(pruned);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
    } catch {
      // Keeping the in-memory map is enough for the current session.
    }
  }, []);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) persist(stored as LocalReplyContexts);
    } catch {
      ref.current = {};
    }
  }, [persist]);

  const remember = useCallback((sentMessageId: string, repliedTo: RepliedToMessage) => {
    persist({
      ...ref.current,
      [sentMessageId]: { contextMessageId: repliedTo.id, repliedTo, createdAt: Date.now() },
    });
  }, [persist]);

  const apply = useCallback((messages: Message[]) => {
    if (Object.keys(contexts).length === 0) return messages;

    return messages.map((message) => {
      if (message.contextMessageId || message.repliedTo) return message;
      const context = contexts[message.id];
      return context ? { ...message, contextMessageId: context.contextMessageId, repliedTo: context.repliedTo } : message;
    });
  }, [contexts]);

  return { remember, apply };
}
