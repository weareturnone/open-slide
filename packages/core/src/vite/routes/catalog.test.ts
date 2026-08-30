import fs from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Connect, ViteDevServer } from 'vite';
import { describe, expect, it } from 'vitest';
import { registerCatalogRoutes } from './catalog.ts';
import { makeContext } from './context.ts';

async function requestCatalog(
  root: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let middleware:
    | ((req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => void)
    | null = null;
  const server = {
    middlewares: {
      use(handler: typeof middleware) {
        middleware = handler;
      },
    },
  } as unknown as ViteDevServer;
  const ctx = makeContext({
    userCwd: root,
    coreVersion: 'test',
    catalogSourceModule: 'catalog.mjs',
  });
  registerCatalogRoutes(server, ctx);
  if (!middleware) throw new Error('catalog middleware was not registered');

  const request = Readable.from([Buffer.from(JSON.stringify(body))]) as Connect.IncomingMessage;
  request.url = '/__catalog';
  request.method = 'POST';
  request.headers = { 'content-type': 'application/json' };
  request.socket = {} as Connect.IncomingMessage['socket'];
  return await new Promise((resolve, reject) => {
    const response = {
      statusCode: 0,
      setHeader() {},
      end(payload: string) {
        resolve({
          status: response.statusCode,
          body: JSON.parse(payload) as Record<string, unknown>,
        });
      },
    } as unknown as ServerResponse;
    Promise.resolve(middleware?.(request, response, reject)).catch(reject);
  });
}

async function withCatalogProject<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-slide-catalog-'));
  const catalog = [
    "const template = { id: 'agenda', name: 'Agenda', source: 'const __COMPONENT__ = () => null;', kind: 'slide' };",
    'export const publicCatalog = () => [{ id: template.id, name: template.name, kind: template.kind }];',
    "export const findCatalogEntry = (id, kind) => id === 'agenda' && kind === 'slide' ? template : null;",
    "export const createDeckSource = () => 'export default [];';",
    'export const resolveCatalogInsertion = (source, _template, componentSource) => ({ ok: true, source, componentSource });',
    '',
  ].join('\n');
  await fs.writeFile(path.join(root, 'catalog.mjs'), catalog, 'utf8');
  try {
    return await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe('catalog insertion source identity', () => {
  it('returns 404 when the selected content entry does not exist', async () => {
    await withCatalogProject(async (root) => {
      const response = await requestCatalog(root, {
        slideId: 'missing',
        kind: 'slide',
        templateId: 'agenda',
        afterPageId: 'slides/missing/index.tsx#cover',
      });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'content not found' });
    });
  });

  it('mutates index.jsx and reports page identity with that exact extension', async () => {
    await withCatalogProject(async (root) => {
      const entry = path.join(root, 'slides', 'deck', 'index.jsx');
      await fs.mkdir(path.dirname(entry), { recursive: true });
      await fs.writeFile(
        entry,
        [
          "import { page } from '@open-slide/core';",
          'const Cover = () => null;',
          "export default [page('cover', Cover)];",
          '',
        ].join('\n'),
        'utf8',
      );

      const response = await requestCatalog(root, {
        slideId: 'deck',
        kind: 'slide',
        templateId: 'agenda',
        afterPageId: 'slides/deck/index.jsx#cover',
      });

      expect(response.status).toBe(200);
      expect(response.body.pageId).toBe('slides/deck/index.jsx#agenda');
      expect(await fs.readFile(entry, 'utf8')).toContain("page('agenda', StudioAgenda)");
      await expect(fs.access(path.join(root, 'slides', 'deck', 'index.tsx'))).rejects.toMatchObject(
        {
          code: 'ENOENT',
        },
      );
    });
  });
});
