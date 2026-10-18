import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Connect, ViteDevServer } from 'vite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiPlugin } from '../api-plugin';
import { registerRemoteRoutes } from './remote';

let server: Server;
let base: string;
let streams: AbortController[];
let clientAddress: string;
let now: number;

beforeEach(async () => {
  streams = [];
  clientAddress = '127.0.0.1';
  now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  server = createServer();
  registerRemoteRoutes({
    httpServer: server,
    middlewares: {
      use(_path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) {
        server.on('request', (req, res) => {
          Object.defineProperty(req.socket, 'remoteAddress', {
            value: clientAddress,
            configurable: true,
          });
          req.url = req.url?.replace(/^\/__remote/, '');
          handler(req, res);
        });
      },
    },
  } as unknown as ViteDevServer);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  for (const stream of streams) stream.abort();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function post(path: string, body: unknown, token?: string, headers = {}) {
  return fetch(`${base}/__remote${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function create(slideId = 'test-deck') {
  return (await post('/create', { slideId, title: 'Test' })).json() as Promise<{
    id: string;
    token: string;
    code: string;
  }>;
}

async function connect(id: string, token: string) {
  const abort = new AbortController();
  streams.push(abort);
  const response = await fetch(`${base}/__remote/${id}/events?token=${token}`, {
    signal: abort.signal,
  });
  if (!response.ok || !response.body) throw new Error(`Missing event stream: ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    abort,
    async next(type: string) {
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary >= 0) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (chunk.startsWith(`event: ${type}\n`)) return JSON.parse(chunk.split('\ndata: ')[1]);
        } else {
          const result = await reader.read();
          if (result.done) throw new Error('Stream closed');
          buffer += decoder.decode(result.value, { stream: true });
        }
      }
    },
  };
}

const state = { index: 0, pageCount: 8, stepIndex: 0, stepCount: 0, blackout: null, startedAt: 1 };

it('pairs one remote and relays commands only to its host with confirmed state', async () => {
  const host = await create();
  const hostEvents = await connect(host.id, host.token);
  await post(`/${host.id}/state`, { active: true, state }, host.token);
  const remote = await (await post('/join', { code: host.code })).json();
  const remoteEvents = await connect(host.id, remote.token);
  const snapshot = await remoteEvents.next('state');
  expect(snapshot.hostConnected).toBe(true);
  const command = {
    id: 'tap-1',
    revision: snapshot.revision,
    expiresAt: snapshot.commandExpiresAt,
    command: { type: 'goto', index: 5 },
  };
  expect((await post(`/${host.id}/command`, command, remote.token)).status).toBe(200);
  expect((await hostEvents.next('command')).command).toEqual({ type: 'goto', index: 5 });
  await post(
    `/${host.id}/state`,
    { active: true, state: { ...state, index: 5 }, ack: 'tap-1' },
    host.token,
  );
  const updated = await remoteEvents.next('state');
  expect(updated.state.index).toBe(5);
  expect(updated.ack).toBe('tap-1');
  expect((await post(`/${host.id}/command`, command, remote.token)).status).toBe(200);
  const next = {
    id: 'tap-2',
    revision: updated.revision,
    expiresAt: updated.commandExpiresAt,
    command: { type: 'prev' },
  };
  await post(`/${host.id}/command`, next, remote.token);
  expect((await hostEvents.next('command')).id).toBe('tap-2');
});

it('rejects cross-site requests, wrong codes and unauthorized or wrong-role writes', async () => {
  expect(
    (await post('/create', { slideId: 'test' }, undefined, { origin: 'https://evil.example' }))
      .status,
  ).toBe(403);
  expect((await post('/join', { code: '000000' })).status).toBe(404);
  const host = await create();
  const remote = await (await post('/join', { code: host.code })).json();
  expect((await post(`/${host.id}/state`, { active: true, state }, remote.token)).status).toBe(403);
  expect((await post(`/${host.id}/state`, { active: true, state }, 'wrong')).status).toBe(403);
  expect((await fetch(`${base}/${host.id}/events?token=wrong`)).status).toBe(403);
});

it('isolates sessions and revokes a replaced remote token', async () => {
  const a = await create('deck-a');
  const b = await create('deck-b');
  const remote = await (await post('/join', { code: a.code })).json();
  expect(
    (await post(`/${b.id}/command`, { id: '1', command: { type: 'next' } }, remote.token)).status,
  ).toBe(403);
  await post('/join', { code: a.code });
  expect(
    (await post(`/${a.id}/command`, { id: '2', command: { type: 'next' } }, remote.token)).status,
  ).toBe(403);
});

it('rejects stale, invalid and paused commands without queuing them', async () => {
  const host = await create();
  await connect(host.id, host.token);
  const remote = await (await post('/join', { code: host.code })).json();
  await post(`/${host.id}/state`, { active: true, state }, host.token);
  const command = { id: '1', command: { type: 'next' }, revision: -1 };
  expect((await post(`/${host.id}/command`, command, remote.token)).status).toBe(409);
  expect(
    (
      await post(
        `/${host.id}/command`,
        { ...command, command: { type: 'goto', index: 90 } },
        remote.token,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await post(
        `/${host.id}/command`,
        { ...command, command: { type: 'switch-slide', slideId: 'other' } },
        remote.token,
      )
    ).status,
  ).toBe(400);
  expect(
    (await post(`/${host.id}/state`, { active: true, state: { ...state, index: -1 } }, host.token))
      .status,
  ).toBe(400);
  await post(`/${host.id}/state`, { active: false, state }, host.token);
  expect(
    (await post(`/${host.id}/command`, { ...command, revision: 2 }, remote.token)).status,
  ).toBe(409);
});

it('stops a session and invalidates its code and tokens', async () => {
  const host = await create();
  expect((await post(`/${host.id}/end`, {}, host.token)).status).toBe(200);
  expect((await post('/join', { code: host.code })).status).toBe(404);
  expect((await post(`/${host.id}/state`, { active: true, state }, host.token)).status).toBe(404);
});

it('limits pairing guesses', async () => {
  for (let i = 0; i < 12; i++) await post('/join', { code: '000000' });
  expect((await post('/join', { code: '000000' })).status).toBe(429);
});

async function ready() {
  const host = await create();
  const hostEvents = await connect(host.id, host.token);
  await post(`/${host.id}/state`, { active: true, state }, host.token);
  const remote = await (await post('/join', { code: host.code })).json();
  const remoteEvents = await connect(host.id, remote.token);
  const snapshot = await remoteEvents.next('state');
  return { host, hostEvents, remote, remoteEvents, snapshot };
}

function tap(snapshot: { revision: number; commandExpiresAt: number }, id = 'tap') {
  return {
    id,
    revision: snapshot.revision,
    expiresAt: snapshot.commandExpiresAt,
    command: { type: 'next' },
  };
}

it('expires connected hosts after eight hours and notifies both devices', async () => {
  const { host, hostEvents, remoteEvents } = await ready();
  const created = now;
  while (now + 119000 < created + 8 * 60 * 60 * 1000) {
    now += 119000;
    expect((await post(`/${host.id}/state`, { active: true, state }, host.token)).status).toBe(200);
  }
  now = created + 8 * 60 * 60 * 1000;
  vi.advanceTimersByTime(2000);
  expect(await remoteEvents.next('ended')).toEqual({});
  expect(await hostEvents.next('ended')).toEqual({});
  expect((await post(`/${host.id}/state`, { active: true, state }, host.token)).status).toBe(404);
  expect((await post('/join', { code: host.code })).status).toBe(404);
});

it('does not revive a session whose idle or absolute expiry precedes the cleanup tick', async () => {
  for (const elapsed of [120000, 8 * 60 * 60 * 1000]) {
    const host = await create();
    await connect(host.id, host.token);
    now += elapsed;
    expect((await post(`/${host.id}/state`, { active: true, state }, host.token)).status).toBe(404);
    expect((await post('/join', { code: host.code })).status).toBe(404);
  }
});

it('requires a connected remote and confirmed state before accepting commands', async () => {
  const host = await create();
  await connect(host.id, host.token);
  const remote = await (await post('/join', { code: host.code })).json();
  await post(`/${host.id}/state`, { active: true, state }, host.token);
  expect(
    (
      await post(
        `/${host.id}/command`,
        { id: 'offline', revision: 1, expiresAt: now + 4000, command: { type: 'next' } },
        remote.token,
      )
    ).status,
  ).toBe(409);
  const remoteEvents = await connect(host.id, remote.token);
  await remoteEvents.next('state');
  expect((await post(`/${host.id}/state`, { active: true, state: null }, host.token)).status).toBe(
    400,
  );
});

it('rejects expired, missing and unbounded command leases without relaying them later', async () => {
  const { host, hostEvents, remote, snapshot } = await ready();
  expect(snapshot.commandExpiresAt).toBe(now + 4000);
  for (const expiresAt of [undefined, now, now - 1, now + 4001, 'later']) {
    expect(
      (await post(`/${host.id}/command`, { ...tap(snapshot), expiresAt }, remote.token)).status,
    ).toBe(409);
  }
  expect((await post(`/${host.id}/command`, tap(snapshot, 'fresh'), remote.token)).status).toBe(
    200,
  );
  expect((await hostEvents.next('command')).id).toBe('fresh');
});

it('requires a fresh host publication after reconnect and invalidates old commands', async () => {
  const { host, hostEvents, remote, snapshot } = await ready();
  hostEvents.abort.abort();
  const reconnected = await connect(host.id, host.token);
  expect((await reconnected.next('state')).hostConnected).toBe(false);
  expect((await post(`/${host.id}/command`, tap(snapshot), remote.token)).status).toBe(409);
  await post(`/${host.id}/state`, { active: true, state }, host.token);
  const fresh = await reconnected.next('state');
  expect(fresh.hostConnected).toBe(true);
  expect(fresh.revision).toBeGreaterThan(snapshot.revision);
  expect((await post(`/${host.id}/command`, tap(snapshot), remote.token)).status).toBe(409);
  expect((await post(`/${host.id}/command`, tap(fresh, 'fresh'), remote.token)).status).toBe(200);
  expect((await reconnected.next('command')).id).toBe('fresh');
});

it('invalidates delayed commands when the phone stream reconnects', async () => {
  const { host, hostEvents, remote, remoteEvents, snapshot } = await ready();
  remoteEvents.abort.abort();
  const reconnected = await connect(host.id, remote.token);
  const fresh = await reconnected.next('state');
  expect(fresh.revision).toBeGreaterThan(snapshot.revision);
  expect((await post(`/${host.id}/command`, tap(snapshot), remote.token)).status).toBe(409);
  expect((await post(`/${host.id}/command`, tap(fresh, 'fresh'), remote.token)).status).toBe(200);
  expect((await hostEvents.next('command')).id).toBe('fresh');
});

it('invalidates old revisions when the host recovers from a missed heartbeat', async () => {
  const { host, hostEvents, remote, remoteEvents, snapshot } = await ready();
  now += 6000;
  expect(
    (await post(`/${host.id}/command`, { ...tap(snapshot), expiresAt: now + 4000 }, remote.token))
      .status,
  ).toBe(409);
  await post(`/${host.id}/state`, { active: true, state }, host.token);
  const fresh = await remoteEvents.next('state');
  expect(fresh.revision).toBeGreaterThan(snapshot.revision);
  expect(
    (await post(`/${host.id}/command`, { ...tap(snapshot), expiresAt: now + 4000 }, remote.token))
      .status,
  ).toBe(409);
  expect((await post(`/${host.id}/command`, tap(fresh, 'fresh'), remote.token)).status).toBe(200);
  expect((await hostEvents.next('command')).id).toBe('fresh');
});

it('does not mark a replacement phone connected until its stream is open', async () => {
  const { host, hostEvents, remote, remoteEvents } = await ready();
  const replacement = await (await post('/join', { code: host.code })).json();
  expect(await remoteEvents.next('ended')).toEqual({});
  await post(`/${host.id}/state`, { active: true, state }, host.token);
  let snapshot = await hostEvents.next('state');
  while (snapshot.remoteConnected) snapshot = await hostEvents.next('state');
  expect(snapshot.remoteConnected).toBe(false);
  expect((await post(`/${host.id}/command`, tap(snapshot), replacement.token)).status).toBe(409);
  expect((await fetch(`${base}/__remote/${host.id}/events?token=${remote.token}`)).status).toBe(
    403,
  );
  const replacementEvents = await connect(host.id, replacement.token);
  const fresh = await replacementEvents.next('state');
  expect(fresh.remoteConnected).toBe(true);
  expect((await post(`/${host.id}/state`, { active: true, state }, replacement.token)).status).toBe(
    403,
  );
  expect((await post(`/${host.id}/end`, {}, replacement.token)).status).toBe(403);
  expect((await post(`/${host.id}/command`, tap(fresh), host.token)).status).toBe(403);
});

it('rejects malformed payloads and routes without accepting arbitrary state fields', async () => {
  const { host, remote, snapshot } = await ready();
  for (const body of [null, [], 'text']) expect((await post('/join', body)).status).toBe(400);
  for (const invalid of [
    { ...state, stepIndex: 1 },
    { ...state, pageCount: 1001 },
    { ...state, startedAt: null },
  ]) {
    expect(
      (await post(`/${host.id}/state`, { active: true, state: invalid }, host.token)).status,
    ).toBe(400);
  }
  expect(
    (await post(`/${host.id}/command`, { ...tap(snapshot), id: '' }, remote.token)).status,
  ).toBe(400);
  expect((await post(`/${host.id}/end/ignored`, {}, host.token)).status).toBe(404);
  expect(
    (
      await post(
        `/${host.id}/state`,
        { active: true, state: { ...state, extra: 'untrusted' } },
        host.token,
      )
    ).status,
  ).toBe(400);
  const malformed = await fetch(`${base}/__remote/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  expect(malformed.status).toBe(400);
  expect((await post('/join', { code: '1'.repeat(8193) })).status).toBe(400);
});

it('blocks forwarded-origin spoofing and cross-site event streams', async () => {
  const host = await create();
  expect(
    (
      await post('/join', { code: host.code }, undefined, {
        origin: 'https://evil.example',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(`${base}/__remote/${host.id}/events?token=${host.token}`, {
        headers: { origin: 'https://evil.example' },
      })
    ).status,
  ).toBe(403);
});

it('allows LAN pairing while blocking session creation and all other LAN mutations', async () => {
  const host = await create();
  const remoteHandler = server.listeners('request')[0] as (
    req: IncomingMessage,
    res: ServerResponse,
  ) => void;
  let guard: Connect.NextHandleFunction | undefined;
  const plugin = apiPlugin({ userCwd: '/tmp', coreVersion: 'test' });
  const configure = plugin.configureServer;
  if (typeof configure !== 'function') throw new Error('Missing configureServer');
  configure.call(
    {} as never,
    {
      httpServer: server,
      watcher: { add() {}, on() {} },
      middlewares: {
        use(handler: string | Connect.NextHandleFunction) {
          if (!guard && typeof handler === 'function') guard = handler;
        },
      },
    } as unknown as ViteDevServer,
  );
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    Object.defineProperty(req.socket, 'remoteAddress', {
      value: clientAddress,
      configurable: true,
    });
    guard?.(req, res, () => {
      if (req.url?.startsWith('/__remote/')) remoteHandler(req, res);
      else res.end('passed');
    });
  });
  clientAddress = '192.168.1.20';
  expect((await post('/join', { code: host.code })).status).toBe(200);
  expect((await post('/create', { slideId: 'test' })).status).toBe(403);
  for (const path of [
    '/__edit',
    '/__assets',
    '/__restart-server',
    '/__catalog',
    '/__remote-other',
    '/__remote/../__edit',
  ]) {
    expect((await fetch(`${base}${path}`, { method: 'POST', body: '{}' })).status).toBe(403);
  }
  expect((await fetch(`${base}/slides/test-deck/index.tsx`)).status).toBe(200);
});

it('admits only one command for a confirmed revision under concurrent requests', async () => {
  const { host, hostEvents, remote, snapshot } = await ready();
  const results = await Promise.all(
    ['first', 'second'].map(async (id) => ({
      id,
      response: await post(`/${host.id}/command`, tap(snapshot, id), remote.token),
    })),
  );
  expect(results.map(({ response }) => response.status).sort()).toEqual([200, 409]);
  expect((await hostEvents.next('command')).id).toBe(
    results.find(({ response }) => response.status === 200)?.id,
  );
});

it('rejects replay of an old request after the bounded duplicate history rolls over', async () => {
  const { host, remote, snapshot } = await ready();
  for (let i = 0; i < 257; i++) {
    expect(
      (
        await post(
          `/${host.id}/command`,
          { ...tap(snapshot, `tap-${i}`), revision: snapshot.revision + i },
          remote.token,
        )
      ).status,
    ).toBe(200);
  }
  expect((await post(`/${host.id}/command`, tap(snapshot, 'tap-0'), remote.token)).status).toBe(
    409,
  );
});
