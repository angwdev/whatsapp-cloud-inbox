'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { REACTION_MAX_AGE_MS, type Message, type MessageReaction } from '@/lib/inbox-data';

const STORAGE_KEY = 'whatsapp-cloud-inbox-reactions';
const MAX_ENTRIES = 300;

/**
 * Your reaction as sent from this browser. The message history may lag behind
 * or never list outbound reactions, so this stays until the history agrees.
 */
export type LocalReaction = {
  emoji: string;
  createdAt: number;
  pending: boolean;
};

export type LocalReactions = Record<string, LocalReaction>;

function prune(reactions: LocalReactions): LocalReactions {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(reactions)
      .filter(([, reaction]) => (
        reaction &&
        typeof reaction.emoji === 'string' &&
        typeof reaction.createdAt === 'number' &&
        now - reaction.createdAt < REACTION_MAX_AGE_MS
      ))
      .sort(([, a], [, b]) => b.createdAt - a.createdAt)
      .slice(0, MAX_ENTRIES),
  );
}

export function getOutboundReaction(message: Message): MessageReaction | undefined {
  return message.reactions?.find((reaction) => reaction.direction === 'outbound');
}

/** True once the message history shows the local reaction, or a newer one. */
function isSettled(localReaction: LocalReaction, serverReaction?: MessageReaction): boolean {
  if (localReaction.pending) return false;
  if ((serverReaction?.emoji ?? '') === localReaction.emoji) return true;
  return Boolean(serverReaction && Date.parse(serverReaction.createdAt) > localReaction.createdAt + 5_000);
}

export function applyLocalReactions(messages: Message[], localReactions: LocalReactions): Message[] {
  if (Object.keys(localReactions).length === 0) return messages;

  return messages.map((message) => {
    const localReaction = localReactions[message.id];
    if (!localReaction || isSettled(localReaction, getOutboundReaction(message))) return message;

    const contactReactions = (message.reactions ?? []).filter((reaction) => reaction.direction !== 'outbound');
    return {
      ...message,
      reactions: localReaction.emoji
        ? [
            ...contactReactions,
            {
              emoji: localReaction.emoji,
              direction: 'outbound' as const,
              createdAt: new Date(localReaction.createdAt).toISOString(),
              pending: localReaction.pending,
            },
          ]
        : contactReactions,
    };
  });
}

export function useLocalReactions(serverMessages: Message[]) {
  const [localReactions, setLocalReactions] = useState<LocalReactions>({});
  const ref = useRef<LocalReactions>({});

  const update = useCallback((updater: (reactions: LocalReactions) => LocalReactions) => {
    const next = prune(updater(ref.current));
    ref.current = next;
    setLocalReactions(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Keeping the in-memory map is enough for the current session.
    }
  }, []);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        // A reload interrupts any request that was still in flight.
        update(() => Object.fromEntries(
          Object.entries(stored as LocalReactions).map(([id, reaction]) => [id, { ...reaction, pending: false }]),
        ));
      }
    } catch {
      ref.current = {};
    }
  }, [update]);

  // Forget local reactions once the message history reflects them.
  useEffect(() => {
    const settledIds = serverMessages
      .filter((message) => {
        const localReaction = ref.current[message.id];
        return localReaction && isSettled(localReaction, getOutboundReaction(message));
      })
      .map((message) => message.id);

    if (settledIds.length === 0) return;
    update((reactions) => {
      const next = { ...reactions };
      settledIds.forEach((id) => delete next[id]);
      return next;
    });
  }, [serverMessages, update]);

  /** Applies a reaction optimistically; the result confirms or rolls it back. */
  const setOptimistic = useCallback((messageId: string, emoji: string) => {
    const previous = ref.current[messageId];
    const attempt: LocalReaction = { emoji, createdAt: Date.now(), pending: true };
    update((reactions) => ({ ...reactions, [messageId]: attempt }));

    const isCurrent = (reactions: LocalReactions) => reactions[messageId] === attempt;
    return {
      confirm: () => update((reactions) => (
        isCurrent(reactions) ? { ...reactions, [messageId]: { ...attempt, pending: false } } : reactions
      )),
      // Roll back only if nothing newer replaced this attempt meanwhile.
      rollback: () => update((reactions) => {
        if (!isCurrent(reactions)) return reactions;
        const next = { ...reactions };
        if (previous) next[messageId] = previous;
        else delete next[messageId];
        return next;
      }),
    };
  }, [update]);

  return { localReactions, setOptimistic };
}
