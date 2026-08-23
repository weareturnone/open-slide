/**
 * Local trusted-catalog adapter:
 *   GET  /__catalog       list layouts for a content kind
 *   POST /__catalog       insert a layout at an exact page boundary
 *   POST /__decks         create a slide deck or A4 document
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ViteDevServer } from 'vite';
import {
  insertNotesElementInSource,
  insertPageComponentInSource,
  SLIDE_ID_RE,
} from '../../editing/slide-ops.ts';
import {
  type ApiContext,
  contentRoot,
  json,
  readBody,
  resolveContentEntryPath,
} from './context.ts';

type ContentKind = 'slide' | 'document';
type CatalogEntry = {
  id: string;
  name: string;
  source: string;
  kind: ContentKind;
};
type CatalogModule = {
  publicCatalog: (kind: ContentKind) => Array<Omit<CatalogEntry, 'source'>>;
  findCatalogEntry: (id: string, kind: ContentKind) => CatalogEntry | null;
  createDeckSource: (input: {
    title: string;
    template: CatalogEntry;
    kind: ContentKind;
  }) => string;
};

const RESERVED_IDS = new Set(['api', 'assets', 'documents', 'studio', 'themes']);

function normalizeKind(value: unknown): ContentKind {
  return value === 'document' ? 'document' : 'slide';
}

async function loadCatalog(ctx: ApiContext): Promise<CatalogModule | null> {
  if (!ctx.catalogSourceModule) return null;
  const modulePath = path.resolve(ctx.userCwd, ctx.catalogSourceModule);
  if (!modulePath.startsWith(`${ctx.userCwd}${path.sep}`)) return null;
  try {
    const stat = await fs.stat(modulePath);
    return (await import(`${pathToFileURL(modulePath).href}?mtime=${stat.mtimeMs}`)) as CatalogModule;
  } catch {
    return null;
  }
}

function componentName(templateId: string): string {
  const stem = templateId
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
  return `Studio${stem}${randomBytes(4).toString('hex')}`;
}

export function registerCatalogRoutes(server: ViteDevServer, ctx: ApiContext): void {
  server.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/__catalog' && url.pathname !== '/__decks') return next();

    const catalog = await loadCatalog(ctx);
    if (!catalog) return json(res, 404, { error: 'Local catalog is not configured' });

    if (url.pathname === '/__catalog' && req.method === 'GET') {
      return json(res, 200, { entries: catalog.publicCatalog(normalizeKind(url.searchParams.get('kind'))) });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

    try {
      const body = (await readBody(req)) as Record<string, unknown>;
      const kind = normalizeKind(body.kind);
      const template =
        typeof body.templateId === 'string'
          ? catalog.findCatalogEntry(body.templateId, kind)
          : null;
      if (!template) return json(res, 400, { error: 'Invalid catalog template' });

      if (url.pathname === '/__decks') {
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const deckId = typeof body.deckId === 'string' ? body.deckId.trim() : '';
        if (
          title.length < 1 ||
          title.length > 120 ||
          deckId.length < 3 ||
          deckId.length > 64 ||
          !SLIDE_ID_RE.test(deckId) ||
          RESERVED_IDS.has(deckId)
        ) {
          return json(res, 400, { error: 'Invalid title, ID, or template' });
        }
        const sourcePath = resolveContentEntryPath(ctx, deckId, kind);
        if (!sourcePath) return json(res, 400, { error: 'Invalid content ID' });
        try {
          await fs.access(sourcePath);
          return json(res, 409, { error: 'Content with this ID already exists' });
        } catch {}
        const root = contentRoot(ctx, kind);
        const contentDir = path.dirname(sourcePath);
        if (!contentDir.startsWith(`${root}${path.sep}`)) {
          return json(res, 400, { error: 'Invalid content path' });
        }
        await fs.mkdir(contentDir, { recursive: false });
        await fs.writeFile(sourcePath, catalog.createDeckSource({ title, template, kind }), 'utf8');
        return json(res, 200, { ok: true, deckId, kind });
      }

      const slideId = typeof body.slideId === 'string' ? body.slideId : '';
      const index = body.index;
      if (!Number.isInteger(index) || (index as number) < 0) {
        return json(res, 400, { error: 'Invalid insertion index' });
      }
      const sourcePath = resolveContentEntryPath(ctx, slideId, kind);
      if (!sourcePath) return json(res, 400, { error: 'Invalid content ID' });
      const current = await fs.readFile(sourcePath, 'utf8');
      const name = componentName(template.id);
      const componentSource = template.source.replace('__COMPONENT__', name);
      const withPage = insertPageComponentInSource(current, name, componentSource, index as number);
      if (withPage === null) {
        return json(res, 422, { error: 'This content cannot accept the selected catalog page' });
      }
      const nextSource = insertNotesElementInSource(withPage, index as number);
      if (nextSource === null) return json(res, 422, { error: 'Could not keep notes aligned' });
      await fs.writeFile(sourcePath, nextSource, 'utf8');
      return json(res, 200, { ok: true, componentName: name, index, kind });
    } catch (error) {
      return json(res, 500, { error: String((error as Error).message ?? error) });
    }
  });
}
