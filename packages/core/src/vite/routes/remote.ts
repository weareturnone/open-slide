import { randomInt, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { ViteDevServer } from 'vite';
import type { PresenterState } from '../../app/components/present/use-presenter-channel';
import type { RemoteCommand, RemoteSnapshot } from '../../app/lib/remote-protocol';
import { validateMutationRequest } from '../../http/request-guard';

type Session = {
  id: string;
  code: string;
  hostToken: string;
  remoteToken: string;
  snapshot: RemoteSnapshot;
  host?: ServerResponse;
  remote?: ServerResponse;
  hostReady: boolean;
  lastSeen: number;
  created: number;
  seen: Set<string>;
};

export function validRemoteState(value: unknown): value is PresenterState {
  if (!value || typeof value !== 'object') return false;
  const s = value as PresenterState;
  return (
    Number.isInteger(s.pageCount) &&
    s.pageCount > 0 &&
    s.pageCount <= 1000 &&
    Number.isInteger(s.index) &&
    s.index >= 0 &&
    s.index < s.pageCount &&
    Number.isInteger(s.stepCount) &&
    s.stepCount >= 0 &&
    s.stepCount <= 10000 &&
    Number.isInteger(s.stepIndex) &&
    s.stepIndex >= 0 &&
    s.stepIndex <= s.stepCount &&
    Number.isFinite(s.startedAt) &&
    ['black', 'white', null].includes(s.blackout) &&
    Object.keys(s).every((key) =>
      ['index', 'pageCount', 'stepIndex', 'stepCount', 'blackout', 'startedAt'].includes(key),
    )
  );
}

export function validRemoteCommand(value: unknown, pageCount: number): value is RemoteCommand {
  if (!value || typeof value !== 'object') return false;
  const c = value as RemoteCommand;
  const keys = Object.keys(c);
  if (c.type === 'next' || c.type === 'prev') return keys.length === 1;
  if (c.type === 'blackout') return keys.length === 2 && typeof c.enabled === 'boolean';
  return (
    keys.length === 2 &&
    c.type === 'goto' &&
    Number.isInteger(c.index) &&
    c.index >= 0 &&
    c.index < pageCount
  );
}

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw new Error('Verzoek is te groot');
    chunks.push(Buffer.from(chunk));
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Ongeldig verzoek');
  return value;
}

function connected(res: ServerResponse | undefined): res is ServerResponse {
  return !!res && !res.destroyed && !res.writableEnded;
}

function event(res: ServerResponse | undefined, type: string, data: unknown) {
  if (connected(res)) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function registerRemoteRoutes(server: ViteDevServer) {
  const sessions = new Map<string, Session>();
  const attempts = new Map<string, { count: number; until: number }>();
  const expired = (session: Session) =>
    Date.now() - session.created >= 8 * 60 * 60 * 1000 || Date.now() - session.lastSeen >= 120000;
  const live = (session: Session) =>
    session.hostReady && connected(session.host) && Date.now() - session.lastSeen < 6000;
  const broadcast = (session: Session) => {
    if (session.hostReady && !live(session)) {
      session.hostReady = false;
      session.snapshot.revision++;
    }
    session.snapshot.commandExpiresAt = Date.now() + 4000;
    const snapshot = {
      ...session.snapshot,
      hostConnected: live(session),
      remoteConnected: connected(session.remote),
    };
    event(session.host, 'state', snapshot);
    event(session.remote, 'state', snapshot);
  };
  const end = (session: Session) => {
    sessions.delete(session.id);
    const { host, remote } = session;
    session.host = undefined;
    session.remote = undefined;
    event(host, 'ended', {});
    event(remote, 'ended', {});
    remote?.end();
    host?.end();
  };
  const timer = setInterval(() => {
    for (const s of sessions.values()) {
      if (expired(s)) end(s);
      else broadcast(s);
    }
    for (const [key, value] of attempts) if (Date.now() > value.until) attempts.delete(key);
  }, 2000);
  timer.unref();
  server.httpServer?.once('close', () => {
    clearInterval(timer);
    for (const s of sessions.values()) end(s);
  });

  server.middlewares.use('/__remote', async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (req.headers['x-forwarded-host'] || req.headers['x-forwarded-proto'])
        return json(res, 403, { error: 'Gebruik de lokale server rechtstreeks.' });
      const guard = validateMutationRequest(req, { requireJsonBody: req.method === 'POST' });
      if (!guard.ok) return json(res, guard.status, { error: guard.error });
      const body = req.method === 'POST' ? await readBody(req) : {};
      for (const session of sessions.values()) if (expired(session)) end(session);

      if (url.pathname === '/create' && req.method === 'POST') {
        const ip = req.socket.remoteAddress;
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip || '')) {
          return json(res, 403, { error: 'Start de sessie op de laptop via localhost.' });
        }
        if (sessions.size >= 16) return json(res, 429, { error: 'Stop eerst een eerdere sessie.' });
        if (typeof body.slideId !== 'string' || !/^[\w-]{1,100}$/.test(body.slideId))
          return json(res, 400, { error: 'Ongeldig deck' });
        let code: string;
        do {
          code = String(randomInt(100000, 1000000));
        } while ([...sessions.values()].some((s) => s.code === code));
        const session: Session = {
          id: randomUUID(),
          code,
          hostToken: randomUUID(),
          remoteToken: randomUUID(),
          snapshot: {
            slideId: body.slideId,
            title: String(body.title || body.slideId).slice(0, 200),
            state: null,
            active: false,
            hostConnected: false,
            remoteConnected: false,
            revision: 0,
            commandExpiresAt: 0,
          },
          hostReady: false,
          lastSeen: Date.now(),
          created: Date.now(),
          seen: new Set(),
        };
        sessions.set(session.id, session);
        const port = (server.httpServer?.address() as { port?: number } | null)?.port || 5173;
        const urls = Object.values(networkInterfaces())
          .flat()
          .filter((a) => a && a.family === 'IPv4' && !a.internal)
          .map((a) => `http://${a?.address}:${port}/remote`);
        return json(res, 200, { id: session.id, token: session.hostToken, code, urls });
      }

      if (url.pathname === '/join' && req.method === 'POST') {
        const ip = req.socket.remoteAddress || 'unknown';
        let limit = attempts.get(ip);
        if (!limit || Date.now() > limit.until) {
          limit = { count: 0, until: Date.now() + 60000 };
          attempts.set(ip, limit);
        }
        if (++limit.count > 12)
          return json(res, 429, { error: 'Te veel pogingen. Probeer over een minuut opnieuw.' });
        const session = [...sessions.values()].find((s) => s.code === body.code);
        if (!session)
          return json(res, 404, { error: 'Code niet gevonden. Controleer de code op je laptop.' });
        const previous = session.remote;
        session.remote = undefined;
        session.remoteToken = randomUUID();
        session.snapshot.revision++;
        event(previous, 'ended', {});
        previous?.end();
        broadcast(session);
        return json(res, 200, {
          id: session.id,
          token: session.remoteToken,
          code: session.code,
          urls: [],
        });
      }

      const route = /^\/([^/]+)\/(events|end|state|command)$/.exec(url.pathname);
      if (!route) return json(res, 404, { error: 'Onbekende remote-route' });
      const [, id, action] = route;
      const session = sessions.get(id);
      if (!session)
        return json(res, 404, { error: 'Sessie beëindigd. Koppel opnieuw op je laptop.' });
      const token =
        req.headers.authorization?.replace(/^Bearer /, '') || url.searchParams.get('token');
      const role =
        token === session.hostToken ? 'host' : token === session.remoteToken ? 'remote' : null;
      if (!role) return json(res, 403, { error: 'Ongeldige koppeling' });

      if (action === 'events' && req.method === 'GET') {
        const previous = session[role];
        session[role] = undefined;
        if (role === 'host') session.hostReady = false;
        session.snapshot.revision++;
        previous?.end();
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        res.write('retry: 1000\n\n');
        session[role] = res;
        res.on('close', () => {
          if (sessions.get(session.id) === session && session[role] === res) {
            session[role] = undefined;
            if (role === 'host') session.hostReady = false;
            session.snapshot.revision++;
            broadcast(session);
          }
        });
        broadcast(session);
        return;
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'Methode niet toegestaan' });
      if (action === 'end' && role === 'host') {
        end(session);
        return json(res, 200, { ok: true });
      }
      if (action === 'state' && role === 'host') {
        if (
          typeof body.active !== 'boolean' ||
          (body.state !== null && !validRemoteState(body.state)) ||
          (body.active && body.state === null)
        )
          return json(res, 400, { error: 'Ongeldige presentatiestand' });
        const changed =
          !live(session) ||
          session.snapshot.active !== body.active ||
          JSON.stringify(session.snapshot.state) !== JSON.stringify(body.state);
        session.snapshot = {
          ...session.snapshot,
          active: body.active,
          state: body.state,
          revision: session.snapshot.revision + Number(changed),
          ack: typeof body.ack === 'string' ? body.ack.slice(0, 100) : undefined,
        };
        session.lastSeen = Date.now();
        session.hostReady = connected(session.host);
        broadcast(session);
        return json(res, 200, { ok: true });
      }
      if (action === 'command' && role === 'remote') {
        if (
          typeof body.id !== 'string' ||
          body.id.length === 0 ||
          body.id.length > 100 ||
          !validRemoteCommand(body.command, session.snapshot.state?.pageCount || 0)
        )
          return json(res, 400, { error: 'Ongeldige bediening' });
        if (session.seen.has(body.id)) return json(res, 200, { ok: true });
        if (
          !live(session) ||
          !connected(session.remote) ||
          !session.snapshot.active ||
          !session.snapshot.state ||
          body.revision !== session.snapshot.revision ||
          typeof body.expiresAt !== 'number' ||
          !Number.isSafeInteger(body.expiresAt) ||
          body.expiresAt <= Date.now() ||
          body.expiresAt > session.snapshot.commandExpiresAt
        )
          return json(res, 409, { error: 'Presentatie niet gereed. Wacht op de actuele stand.' });
        // Reserve this revision before delivery so concurrent taps cannot both execute.
        session.snapshot.revision++;
        session.seen.add(body.id);
        const oldest = session.seen.values().next().value;
        if (session.seen.size > 256 && oldest !== undefined) session.seen.delete(oldest);
        event(session.host, 'command', {
          id: body.id,
          command: body.command,
          expiresAt: Date.now() + 2000,
        });
        return json(res, 200, { ok: true });
      }
      return json(res, 403, { error: 'Niet toegestaan' });
    } catch (error) {
      if (!res.headersSent)
        json(res, 400, { error: error instanceof Error ? error.message : 'Ongeldig verzoek' });
    }
  });
}
