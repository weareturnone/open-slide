import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PresenterState } from '../components/present/use-presenter-channel';
import {
  type RemoteBridge,
  type RemoteEnvelope,
  type RemoteSession,
  type RemoteSnapshot,
  remoteRequest,
} from './remote-protocol';

export function useRemoteHost(slideId: string, title: string, active: boolean) {
  const [session, setSession] = useState<RemoteSession | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const sessionRef = useRef(session);
  const activeRef = useRef(active);
  activeRef.current = active;
  const stateRef = useRef<PresenterState | null>(null);
  const ackRef = useRef<string>();
  const handlerRef = useRef<((message: RemoteEnvelope) => void) | null>(null);
  const generationRef = useRef(0);
  const startingRef = useRef<Promise<void> | null>(null);
  const busyRef = useRef(false);
  const dirtyRef = useRef(false);

  const flush = useCallback(async () => {
    dirtyRef.current = true;
    if (busyRef.current || !sessionRef.current) return;
    busyRef.current = true;
    let current = sessionRef.current;
    try {
      while (dirtyRef.current && sessionRef.current) {
        dirtyRef.current = false;
        current = sessionRef.current;
        await remoteRequest(
          `/${current.id}/state`,
          { state: stateRef.current, active: activeRef.current, ack: ackRef.current },
          current.token,
        );
      }
    } catch {
      if (sessionRef.current === current) setConnected(false);
    } finally {
      busyRef.current = false;
    }
  }, []);

  const bridge = useMemo<RemoteBridge>(
    () => ({
      publish(state, ack) {
        stateRef.current = state;
        ackRef.current = ack;
        void flush();
      },
      subscribe(handler) {
        handlerRef.current = handler;
        return () => {
          if (handlerRef.current === handler) handlerRef.current = null;
        };
      },
    }),
    [flush],
  );

  const stop = useCallback(() => {
    generationRef.current += 1;
    startingRef.current = null;
    const current = sessionRef.current;
    sessionRef.current = null;
    setSession(null);
    setStarting(false);
    setConnected(false);
    if (current) void remoteRequest(`/${current.id}/end`, {}, current.token).catch(() => {});
  }, []);

  const start = useCallback(() => {
    if (sessionRef.current) return Promise.resolve();
    if (startingRef.current) return startingRef.current;
    const generation = generationRef.current;
    setError('');
    setStarting(true);
    const request = (async () => {
      try {
        const next = await remoteRequest<RemoteSession>('/create', { slideId, title });
        if (generation !== generationRef.current) {
          void remoteRequest(`/${next.id}/end`, {}, next.token).catch(() => {});
          return;
        }
        sessionRef.current = next;
        setSession(next);
      } catch (e) {
        if (generation === generationRef.current)
          setError(e instanceof Error ? e.message : 'Koppelen mislukt');
      } finally {
        if (generation === generationRef.current) {
          startingRef.current = null;
          setStarting(false);
        }
      }
    })();
    startingRef.current = request;
    return request;
  }, [slideId, title]);

  useEffect(() => {
    activeRef.current = active;
    void flush();
  }, [active, flush]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Changing decks must invalidate the previous pairing.
  useEffect(() => {
    return () => {
      stop();
      stateRef.current = null;
      ackRef.current = undefined;
    };
  }, [slideId, stop]);

  useEffect(() => {
    if (!session) return;
    const isCurrent = () => sessionRef.current === session;
    const stream = new EventSource(
      `/__remote/${session.id}/events?token=${encodeURIComponent(session.token)}`,
    );
    const seen = new Set<string>();
    stream.addEventListener('open', () => {
      if (isCurrent()) void flush();
    });
    stream.addEventListener('state', (event) => {
      if (!isCurrent()) return;
      const snapshot = JSON.parse((event as MessageEvent).data) as RemoteSnapshot;
      setConnected(snapshot.remoteConnected);
    });
    stream.addEventListener('command', (event) => {
      if (!isCurrent()) return;
      const message = JSON.parse((event as MessageEvent).data) as RemoteEnvelope;
      if (!activeRef.current || seen.has(message.id) || Date.now() > message.expiresAt) return;
      seen.add(message.id);
      if (seen.size > 256) seen.delete(seen.values().next().value as string);
      handlerRef.current?.(message);
    });
    stream.addEventListener('ended', () => {
      if (!isCurrent()) return;
      stop();
      setError('Sessie beëindigd. Start een nieuwe koppeling.');
    });
    stream.onerror = () => {
      if (isCurrent()) setConnected(false);
    };
    const heartbeat = window.setInterval(() => {
      void flush();
    }, 2000);
    return () => {
      stream.close();
      window.clearInterval(heartbeat);
    };
  }, [session, flush, stop]);

  return { session, connected, starting, error, start, stop, bridge };
}
