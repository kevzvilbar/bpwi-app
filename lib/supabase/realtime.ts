import type { RealtimeChannel, RealtimePostgresChangesPayload, SupabaseClient } from '@supabase/supabase-js';

export interface VisibilityRealtimeListener {
  table: string;
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
  schema?: string;
  onEvent: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
}

export interface VisibilityAwareChannelOptions {
  sb: SupabaseClient;
  channelName: string;
  listeners: VisibilityRealtimeListener[];
  hiddenGraceMs?: number;
  onReconnect?: () => void;
}

/**
 * Subscribes to Supabase Realtime Postgres changes while the browser tab is active,
 * and tears down the WebSocket subscription after `hiddenGraceMs` in a background tab
 * to minimize Realtime heartbeats, WAL polling, and log ingestion.
 */
export function subscribeVisibilityAwareChannel({
  sb,
  channelName,
  listeners,
  hiddenGraceMs = 30_000,
  onReconnect,
}: VisibilityAwareChannelOptions): () => void {
  let active = true;
  let channel: RealtimeChannel | null = null;
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let disconnectedWhileHidden = false;

  const clearTimer = () => {
    if (disconnectTimer) {
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
    }
  };

  const disconnect = () => {
    clearTimer();
    if (channel) {
      const ch = channel;
      channel = null;
      void sb.removeChannel(ch);
    }
  };

  const connect = () => {
    if (!active || channel) return;
    let ch = sb.channel(channelName);
    for (const listener of listeners) {
      const ev = listener.event ?? '*';
      const schema = listener.schema ?? 'public';
      ch = ch.on(
        'postgres_changes',
        { event: ev as '*', schema, table: listener.table },
        (payload) => listener.onEvent(payload as RealtimePostgresChangesPayload<Record<string, unknown>>),
      );
    }
    channel = ch.subscribe();
  };

  const onVisibilityChange = () => {
    if (!active || typeof document === 'undefined') return;
    if (document.visibilityState === 'visible') {
      clearTimer();
      const shouldRefresh = disconnectedWhileHidden;
      disconnectedWhileHidden = false;
      connect();
      if (shouldRefresh) onReconnect?.();
    } else {
      clearTimer();
      disconnectTimer = setTimeout(() => {
        if (active && document.visibilityState === 'hidden') {
          disconnectedWhileHidden = true;
          disconnect();
        }
      }, hiddenGraceMs);
    }
  };

  if (typeof document === 'undefined' || document.visibilityState === 'visible') {
    connect();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  return () => {
    active = false;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    disconnect();
  };
}
