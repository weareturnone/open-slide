import { ArrowLeft, ArrowRight, ChevronLeft, Grid2X2, Smartphone, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SlideCanvas } from '../components/slide-canvas';
import { SlidePageProvider } from '../lib/page-context';
import {
  type RemoteCommand,
  type RemoteSession,
  type RemoteSnapshot,
  remoteRequest,
} from '../lib/remote-protocol';
import type { SlideModule } from '../lib/sdk';
import { loadSlide } from '../lib/slides';
import { type StepController, StepHost } from '../lib/step-context';

export function Remote() {
  useEffect(() => {
    document.title = 'Remote · Turn.One Studio';
  }, []);
  const [code, setCode] = useState(() =>
    window.location.hash.slice(1).replace(/\D/g, '').slice(0, 6),
  );
  const [session, setSession] = useState<RemoteSession | null>(null);
  const [snapshot, setSnapshot] = useState<RemoteSnapshot | null>(null);
  const [slide, setSlide] = useState<SlideModule | null>(null);
  const [online, setOnline] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState(false);
  const autoJoined = useRef(false);
  const sessionRef = useRef<RemoteSession | null>(null);
  const onlineRef = useRef(false);
  const joinGeneration = useRef(0);
  const joinQueue = useRef(Promise.resolve());
  const mounted = useRef(true);
  const commandRequest = useRef<AbortController | null>(null);

  const disconnect = useCallback(() => {
    onlineRef.current = false;
    setOnline(false);
    commandRequest.current?.abort();
    commandRequest.current = null;
    if (pendingRef.current) {
      setError('Verbinding onderbroken. Controleer de slide voordat je opnieuw klikt.');
      pendingRef.current = null;
      setPending(null);
    }
  }, []);

  const join = useCallback(
    (value: string) => {
      const generation = ++joinGeneration.current;
      disconnect();
      sessionRef.current = null;
      setSession(null);
      setSnapshot(null);
      setSlide(null);
      setOverview(false);
      setJoining(true);
      setError('');
      // Joining rotates the token, so requests must finish in the same order as the user's choices.
      const request = joinQueue.current.then(async () => {
        if (!mounted.current || generation !== joinGeneration.current) return;
        try {
          const next = await remoteRequest<RemoteSession>('/join', { code: value });
          if (!mounted.current || generation !== joinGeneration.current) return;
          sessionRef.current = next;
          setSession(next);
          window.history.replaceState(null, '', `#${value}`);
        } catch (e) {
          if (mounted.current && generation === joinGeneration.current)
            setError(e instanceof Error ? e.message : 'Koppelen mislukt');
        } finally {
          if (mounted.current && generation === joinGeneration.current) setJoining(false);
        }
      });
      joinQueue.current = request;
      return request;
    },
    [disconnect],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      commandRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (autoJoined.current) return;
    autoJoined.current = true;
    if (code.length === 6 && import.meta.env.DEV) void join(code);
  }, [code, join]);

  useEffect(() => {
    const changed = () => {
      const value = window.location.hash.slice(1).replace(/\D/g, '').slice(0, 6);
      if (value.length !== 6) return;
      setCode(value);
      void join(value);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [join]);

  useEffect(() => {
    if (!session) return;
    let stream: EventSource | null = null;
    let disposed = false;
    let lastSeen = 0;
    const close = () => {
      stream?.close();
      stream = null;
      disconnect();
    };
    const ended = () => {
      close();
      sessionRef.current = null;
      setSession(null);
      setSnapshot(null);
      setSlide(null);
      setOverview(false);
      setError('Sessie beëindigd. Start een nieuwe koppeling op je laptop.');
    };
    const connect = () => {
      close();
      if (disposed || document.hidden || !navigator.onLine || sessionRef.current !== session)
        return;
      lastSeen = 0;
      const current = new EventSource(
        `/__remote/${session.id}/events?token=${encodeURIComponent(session.token)}`,
      );
      stream = current;
      const isCurrent = () => !disposed && stream === current && sessionRef.current === session;
      current.addEventListener('state', (event) => {
        if (!isCurrent()) return;
        const next = JSON.parse((event as MessageEvent).data) as RemoteSnapshot;
        lastSeen = Date.now();
        setSnapshot(next);
        onlineRef.current = true;
        setOnline(true);
        if (next.ack === pendingRef.current) {
          pendingRef.current = null;
          setPending(null);
          setError('');
        }
      });
      current.addEventListener('ended', () => {
        if (isCurrent()) ended();
      });
      current.onerror = () => {
        if (!isCurrent()) return;
        if (current.readyState === EventSource.CLOSED) ended();
        else disconnect();
      };
    };
    const visibility = () => {
      if (document.hidden) close();
      else connect();
    };
    connect();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', close);
    window.addEventListener('pageshow', connect);
    window.addEventListener('offline', close);
    window.addEventListener('online', connect);
    const timer = window.setInterval(() => {
      if (lastSeen && Date.now() - lastSeen > 5000) connect();
    }, 1000);
    return () => {
      disposed = true;
      close();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', close);
      window.removeEventListener('pageshow', connect);
      window.removeEventListener('offline', close);
      window.removeEventListener('online', connect);
    };
  }, [session, disconnect]);

  const slideId = snapshot?.slideId;
  useEffect(() => {
    if (!slideId) return;
    let cancelled = false;
    setSlide(null);
    loadSlide(slideId)
      .then((value) => {
        if (!cancelled) setSlide(value);
      })
      .catch(() => {
        if (!cancelled) setError('Slidevoorbeeld kon niet laden. De pijlen blijven beschikbaar.');
      });
    return () => {
      cancelled = true;
    };
  }, [slideId]);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => {
      if (pendingRef.current === pending) {
        commandRequest.current?.abort();
        commandRequest.current = null;
        pendingRef.current = null;
        setPending(null);
        setError('Geen bevestiging ontvangen. Controleer de slide voordat je opnieuw klikt.');
      }
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [pending]);

  const ready = online && !!snapshot?.hostConnected && !!snapshot?.active && !!snapshot?.state;
  async function send(command: RemoteCommand) {
    if (
      !session ||
      !snapshot ||
      !ready ||
      !onlineRef.current ||
      sessionRef.current !== session ||
      document.hidden ||
      pendingRef.current
    )
      return;
    const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(16)).join(
      '-',
    );
    pendingRef.current = id;
    setPending(id);
    setError('');
    const controller = new AbortController();
    commandRequest.current = controller;
    try {
      await remoteRequest(
        `/${session.id}/command`,
        { id, revision: snapshot.revision, expiresAt: snapshot.commandExpiresAt, command },
        session.token,
        controller.signal,
      );
    } catch (e) {
      if (pendingRef.current === id) {
        pendingRef.current = null;
        setPending(null);
        setError(e instanceof Error ? e.message : 'Verbinding verbroken');
      }
    } finally {
      if (commandRequest.current === controller) commandRequest.current = null;
    }
  }

  if (!import.meta.env.DEV)
    return (
      <div className="p-8">
        De telefoonbediening is op dit moment beschikbaar in de lokale Studio.
      </div>
    );

  if (!session)
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
        <form
          className="w-full max-w-sm rounded-[2px] border border-border bg-card p-6 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void join(code);
          }}
        >
          <Smartphone className="mb-4 size-8 text-brand" />
          <h1 className="font-heading text-3xl font-medium">Studio Remote</h1>
          <p className="my-4 text-sm text-muted-foreground">
            Open je deck op de laptop en kies ‘Telefoon’. Vul hier de koppelcode in.
          </p>
          <label htmlFor="pair-code" className="text-sm font-medium">
            Koppelcode
          </label>
          <input
            id="pair-code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            className="my-2 w-full rounded-[2px] border border-border bg-card p-4 text-center font-mono text-3xl tracking-[0.2em]"
          />
          <button
            type="submit"
            disabled={joining || code.length !== 6}
            className="mt-3 w-full rounded-[2px] bg-brand p-4 font-medium text-brand-foreground disabled:opacity-40"
          >
            {joining ? 'Koppelen…' : 'Verbinden'}
          </button>
          {error && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {error}
            </p>
          )}
          <p className="mt-5 text-xs text-muted-foreground">
            Je telefoon en laptop moeten op hetzelfde netwerk zitten.
          </p>
        </form>
      </main>
    );

  const state = snapshot?.state;
  const status = !online
    ? 'Opnieuw verbinden…'
    : !snapshot?.hostConnected
      ? 'Laptop niet bereikbaar'
      : !snapshot.active
        ? 'Start of hervat de presentatie op je laptop'
        : 'Verbonden';
  const disabled = !ready || !!pending;
  return (
    <main
      className="flex h-dvh flex-col overflow-hidden bg-background text-foreground"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <header className="shrink-0 border-b border-border bg-card px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="truncate text-sm font-medium">{snapshot?.title || 'Studio Remote'}</h1>
          <span className="shrink-0 text-xs tabular-nums" data-testid="remote-position">
            {state ? `${state.index + 1} / ${state.pageCount}` : '—'}
          </span>
        </div>
        <p
          role="status"
          className={`mt-1 text-xs ${ready ? 'text-emerald-700' : 'text-amber-700'}`}
        >
          {status}
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {overview ? (
          <>
            <button
              type="button"
              className="mb-3 flex min-h-11 w-full items-center gap-2 rounded-[2px] border border-border bg-card px-3 text-sm font-medium"
              onClick={() => setOverview(false)}
            >
              <ChevronLeft className="size-4" />
              Terug naar bediening
            </button>
            <p className="mb-3 text-xs text-muted-foreground">
              Tik op een slide om deze direct te tonen.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {slide?.default.map((_, index) => (
                <RemoteThumbnail
                  // biome-ignore lint/suspicious/noArrayIndexKey: Slide positions are stable within this loaded deck.
                  key={`${slideId}-${index}`}
                  slide={slide}
                  index={index}
                  current={state?.index === index}
                  disabled={disabled}
                  onSelect={() => {
                    void send({ type: 'goto', index });
                    setOverview(false);
                  }}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <div
              role="img"
              aria-label={`Voorbeeld van slide ${state ? state.index + 1 : '—'}`}
              className="mx-auto w-full max-w-[320px] overflow-hidden rounded-[2px] border border-border bg-card"
              style={{ aspectRatio: '16 / 9' }}
            >
              {slide && state ? (
                <RemoteSlide slide={slide} index={state.index} steps={state.stepIndex} />
              ) : (
                <div className="grid h-full place-items-center text-sm text-muted-foreground">
                  Voorbeeld laden…
                </div>
              )}
            </div>
            <button
              type="button"
              disabled={!slide}
              onClick={() => setOverview(true)}
              className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-[2px] border border-border bg-card px-4 font-medium disabled:opacity-40"
            >
              <Grid2X2 className="size-5" />
              Alle slides
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={state?.blackout === 'black'}
              onClick={() => void send({ type: 'blackout', enabled: state?.blackout !== 'black' })}
              className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-[2px] border border-border bg-card px-4 text-sm disabled:opacity-40"
            >
              <Square className="size-4" />
              {state?.blackout === 'black' ? 'Beeld hervatten' : 'Zwart beeld'}
            </button>
            {state?.blackout && (
              <p className="mt-3 text-center text-sm text-amber-700">
                Het publiek ziet {state.blackout === 'black' ? 'zwart' : 'wit'} beeld.
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-[2px] bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
      <footer
        aria-busy={!!pending}
        className="grid shrink-0 grid-cols-2 gap-3 border-t border-border bg-card p-4"
      >
        <button
          type="button"
          aria-label="Vorige slide"
          disabled={disabled || (state?.index === 0 && state.stepIndex === 0)}
          onClick={() => void send({ type: 'prev' })}
          className="flex min-h-24 touch-manipulation items-center justify-center rounded-[2px] bg-muted text-foreground active:bg-muted/80 disabled:opacity-35"
        >
          <ArrowLeft className="size-10" />
        </button>
        <button
          type="button"
          aria-label="Volgende slide"
          disabled={
            disabled ||
            (!!state && state.index === state.pageCount - 1 && state.stepIndex === state.stepCount)
          }
          onClick={() => void send({ type: 'next' })}
          className="flex min-h-24 touch-manipulation items-center justify-center rounded-[2px] bg-brand text-brand-foreground active:bg-brand/85 disabled:opacity-35"
        >
          <ArrowRight className="size-10" />
        </button>
      </footer>
    </main>
  );
}

function RemoteSlide({
  slide,
  index,
  steps,
}: {
  slide: SlideModule;
  index: number;
  steps?: number;
}) {
  const controller = useRef<StepController | null>(null);
  const Page = slide.default[index];
  if (!Page) return null;
  return (
    <SlideCanvas design={slide.design} freezeMotion={steps === undefined}>
      <div
        aria-hidden="true"
        ref={(element) => element?.setAttribute('inert', '')}
        className="pointer-events-none h-full w-full"
      >
        <SlidePageProvider index={index} total={slide.default.length}>
          <StepHost
            key={index}
            isActivePage={false}
            entryDirection="jump"
            controllerRef={controller}
            controlledRevealed={steps}
          >
            <Page />
          </StepHost>
        </SlidePageProvider>
      </div>
    </SlideCanvas>
  );
}

function RemoteThumbnail({
  slide,
  index,
  current,
  disabled,
  onSelect,
}: {
  slide: SlideModule;
  index: number;
  current: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <button
      ref={ref}
      type="button"
      aria-label={`Toon slide ${index + 1}`}
      aria-current={current ? 'true' : undefined}
      disabled={disabled}
      onClick={onSelect}
      className={`overflow-hidden rounded-[2px] border-2 bg-card text-left disabled:opacity-50 ${current ? 'border-brand' : 'border-border'}`}
    >
      <div style={{ aspectRatio: '16 / 9' }}>
        {visible && <RemoteSlide slide={slide} index={index} />}
      </div>
      <div className="px-2 py-1.5 text-xs font-medium">
        {index + 1}
        {current ? ' · Nu' : ''}
      </div>
    </button>
  );
}
