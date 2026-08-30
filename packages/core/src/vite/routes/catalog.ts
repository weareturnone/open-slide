/**
 * Local trusted-catalog adapter:
 *   GET  /__catalog       list layouts for a content kind
 *   POST /__catalog       insert a layout at an exact page boundary
 *   POST /__decks         create a slide deck or A4 document
 */
import fs from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ViteDevServer } from 'vite';
import {
  authoredPageId,
  isPageIdentityError,
  PageIdentityStaleError,
  stablePageIdFromLabel,
  validateStablePageId,
} from '../../app/lib/page-identity.ts';
import { sourcePageOccurrencesOrThrow } from '../../editing/page-identities.ts';
import {
  insertNotesElementInSource,
  insertPageComponentInSource,
  migrateLegacyPageOccurrencesInSource,
  SLIDE_ID_RE,
} from '../../editing/slide-ops.ts';
import {
  type ApiContext,
  contentRoot,
  contentSourceModule,
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
  createDeckSource: (input: { title: string; template: CatalogEntry; kind: ContentKind }) => string;
  resolveCatalogInsertion: (
    source: string,
    template: CatalogEntry,
    componentSource: string,
  ) => { ok: true; source: string; componentSource: string } | { ok: false; error: string };
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
    return (await import(
      `${pathToFileURL(modulePath).href}?mtime=${stat.mtimeMs}`
    )) as CatalogModule;
  } catch {
    return null;
  }
}

function componentName(templateId: string, source: string): string {
  const stem = templateId
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
  const base = `Studio${stem || 'Page'}`;
  let candidate = base;
  let suffix = 2;
  while (new RegExp(`\\b${candidate}\\b`).test(source)) candidate = `${base}${suffix++}`;
  return candidate;
}

function identityFailure(res: ServerResponse, error: unknown): void {
  if (!isPageIdentityError(error)) {
    json(res, 422, { error: String((error as Error).message ?? error) });
    return;
  }
  const status =
    error.code === 'PAGE_IDENTITY_VALIDATION'
      ? 400
      : error.code === 'PAGE_IDENTITY_COLLISION' || error.code === 'PAGE_IDENTITY_STALE'
        ? 409
        : 422;
  json(res, status, { error: error.message, name: error.name, code: error.code });
}

function insertionIndex(
  pageIds: readonly string[],
  beforePageId: unknown,
  afterPageId: unknown,
): number {
  const beforeIndex =
    typeof beforePageId === 'string'
      ? pageIds.indexOf(beforePageId)
      : pageIds.length === 0
        ? 0
        : -1;
  const afterIndex = typeof afterPageId === 'string' ? pageIds.indexOf(afterPageId) : -1;
  if (typeof beforePageId === 'string' && beforeIndex < 0) {
    throw new PageIdentityStaleError(beforePageId);
  }
  if (typeof afterPageId === 'string' && afterIndex < 0) {
    throw new PageIdentityStaleError(afterPageId);
  }
  if (beforeIndex >= 0 && afterIndex >= 0 && beforeIndex !== afterIndex + 1) {
    throw new PageIdentityStaleError(`${String(afterPageId)} -> ${String(beforePageId)}`);
  }
  if (beforeIndex >= 0) return beforeIndex;
  if (afterIndex >= 0) return afterIndex + 1;
  throw new PageIdentityStaleError('insertion-boundary');
}

function availableStableId(
  templateId: string,
  sourceModule: string,
  pageIds: readonly string[],
): string {
  const base = stablePageIdFromLabel(templateId);
  const occupied = new Set(pageIds);
  let candidate = base as string;
  let suffix = 2;
  while (occupied.has(authoredPageId(sourceModule, candidate))) {
    candidate = `${base}-${suffix++}`;
  }
  return validateStablePageId(candidate);
}

export function registerCatalogRoutes(server: ViteDevServer, ctx: ApiContext): void {
  server.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/__catalog' && url.pathname !== '/__decks') return next();

    const catalog = await loadCatalog(ctx);
    if (!catalog) return json(res, 404, { error: 'Local catalog is not configured' });

    if (url.pathname === '/__catalog' && req.method === 'GET') {
      return json(res, 200, {
        entries: catalog.publicCatalog(normalizeKind(url.searchParams.get('kind'))),
      });
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
        let createdSource = catalog.createDeckSource({ title, template, kind });
        try {
          createdSource = migrateLegacyPageOccurrencesInSource(
            createdSource,
            contentSourceModule(deckId, kind),
          );
        } catch (error) {
          return identityFailure(res, error);
        }
        await fs.mkdir(contentDir, { recursive: false });
        await fs.writeFile(sourcePath, createdSource, 'utf8');
        return json(res, 200, { ok: true, deckId, kind });
      }

      const slideId = typeof body.slideId === 'string' ? body.slideId : '';
      const sourcePath = resolveContentEntryPath(ctx, slideId, kind);
      if (!sourcePath) return json(res, 400, { error: 'Invalid content ID' });
      const current = await fs.readFile(sourcePath, 'utf8');
      const sourceModule = contentSourceModule(slideId, kind);
      let occurrences: ReturnType<typeof sourcePageOccurrencesOrThrow>;
      let index: number;
      try {
        occurrences = sourcePageOccurrencesOrThrow(current, sourceModule);
        index = insertionIndex(
          occurrences.map((occurrence) => occurrence.id),
          body.beforePageId,
          body.afterPageId,
        );
      } catch (error) {
        return identityFailure(res, error);
      }
      const pageStableId = availableStableId(
        template.id,
        sourceModule,
        occurrences.map((occurrence) => occurrence.id),
      );
      const name = componentName(template.id, current);
      const componentSource = template.source.replace('__COMPONENT__', name);
      const dependencies = catalog.resolveCatalogInsertion(current, template, componentSource);
      if (!dependencies.ok) return json(res, 422, { error: dependencies.error });
      const withPage = insertPageComponentInSource(
        dependencies.source,
        name,
        dependencies.componentSource,
        index,
        pageStableId,
      );
      if (withPage === null) {
        return json(res, 422, { error: 'This content cannot accept the selected catalog page' });
      }
      const nextSource = insertNotesElementInSource(withPage, index);
      if (nextSource === null) return json(res, 422, { error: 'Could not keep notes aligned' });
      await fs.writeFile(sourcePath, nextSource, 'utf8');
      return json(res, 200, {
        ok: true,
        componentName: name,
        index,
        pageId: authoredPageId(sourceModule, pageStableId),
        kind,
      });
    } catch (error) {
      return json(res, 500, { error: String((error as Error).message ?? error) });
    }
  });
}
