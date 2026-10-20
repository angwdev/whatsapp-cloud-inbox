'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CONVERSATIONS_QUERY_KEY, conversationMessagesQueryKey } from '@/lib/inbox-data';

type MeResponse = { realtime?: boolean };

type InboxEvent = {
  event: string;
  phoneNumberId?: string;
  conversationId?: string;
};

const INVALIDATE_DEBOUNCE_MS = 250;

/**
 * Subscribes to webhook-driven server-sent events when the server has a webhook
 * secret. Returns whether the stream is live, so callers can poll less often.
 */
export function useRealtimeUpdates(): boolean {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const response = await fetch('/api/me');
      return response.ok ? (await response.json() as MeResponse) : {};
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
  const enabled = Boolean(me?.realtime);

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;

    const source = new EventSource('/api/events');
    const pendingConversations = new Map<string, string | undefined>();
    let timer: number | null = null;

    // Bursts (a message plus its sent/delivered/read statuses) collapse into one refetch.
    const flush = () => {
      timer = null;
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
      pendingConversations.forEach((phoneNumberId, conversationId) => {
        void queryClient.invalidateQueries({ queryKey: conversationMessagesQueryKey(phoneNumberId, conversationId) });
      });
      pendingConversations.clear();
      void queryClient.invalidateQueries({ queryKey: ['phone-thread-messages'] });
    };

    const handleEvent = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as InboxEvent;
        if (payload.conversationId) pendingConversations.set(payload.conversationId, payload.phoneNumberId);
      } catch {
        // Still refresh the list below.
      }
      if (timer === null) timer = window.setTimeout(flush, INVALIDATE_DEBOUNCE_MS);
    };

    source.addEventListener('open', () => setConnected(true));
    source.addEventListener('error', () => setConnected(source.readyState === EventSource.OPEN));
    source.addEventListener('inbox', handleEvent as EventListener);

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      source.close();
      setConnected(false);
    };
  }, [enabled, queryClient]);

  return connected;
}
