import type { ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import { isPageIdentityError } from '../../app/lib/page-identity.ts';
import {
  duplicateNotesElementInSource,
  duplicatePageByIdInSource,
  duplicateSlideDir,
  removeNotesElementInSource,
  removePageByIdInSource,
  reorderDefaultExportPagesByIdInSource,
  reorderNotesArrayInSource,
  rmSlideDir,
  SLIDE_ID_RE,
  updateMetaTitleInSource,
  validateSlideName,
} from '../../editing/slide-ops.ts';
import { readManifest, writeManifest } from '../../files/folders.ts';
import { transactSourceFile } from '../../files/source-transactions.ts';
import { validateMutationRequest } from '../../http/request-guard.ts';
import { type ApiContext, contentRoot, json, readBody, resolveContentEntry } from './context.ts';

// PUT    /__slides/:id/reorder            reorder pages { pageIds: string[] }
// DELETE /__slides/:id/pages              remove page { pageId }
// POST   /__slides/:id/pages/duplicate    duplicate page { pageId }
// POST   /__slides/:id/duplicate          duplicate slide directory { newId? }
// PATCH  /__slides/:id                    rename slide (writes meta.title)
// DELETE /__slides/:id                    delete slide directory + folder assignment

type DuplicateSlideBody = { newId?: unknown };
type SlidePatchBody = { name?: unknown };

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

export function registerSlideRoutes(server: ViteDevServer, ctx: ApiContext): void {
  server.middlewares.use('/__slides', async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const method = req.method ?? 'GET';
    const kind = url.searchParams.get('kind') === 'document' ? 'document' : 'slide';
    const root = contentRoot(ctx, kind);

    try {
      const reorderMatch = url.pathname.match(/^\/([^/]+)\/reorder$/);
      if (reorderMatch && method === 'PUT') {
        const requestCheck = validateMutationRequest(req, { requireJsonBody: true });
        if (!requestCheck.ok) {
          return json(res, requestCheck.status, { error: requestCheck.error });
        }
        const slideId = reorderMatch[1];
        if (!SLIDE_ID_RE.test(slideId)) return json(res, 400, { error: 'invalid slideId' });

        const body = (await readBody(req)) as { pageIds?: unknown };
        if (
          !Array.isArray(body.pageIds) ||
          body.pageIds.some((value) => typeof value !== 'string')
        ) {
          return json(res, 400, { error: 'invalid pageIds' });
        }

        const entry = resolveContentEntry(ctx, slideId, kind);
        if (!entry) return json(res, 400, { error: 'invalid slideId' });

        let transaction: { value: { ok: true } | { ok: false; error: string } };
        try {
          transaction = await transactSourceFile<{ ok: true } | { ok: false; error: string }>(
            entry.filePath,
            (source) => {
              const reordered = reorderDefaultExportPagesByIdInSource(
                source,
                body.pageIds as string[],
                entry.sourceModule,
              );
              const withNotes = reorderNotesArrayInSource(reordered.source, reordered.order);
              if (withNotes === null) {
                return {
                  source,
                  value: {
                    ok: false,
                    error: 'could not reorder pages — `notes` export has an unexpected shape',
                  } as const,
                };
              }
              return { source: withNotes, value: { ok: true } as const };
            },
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return json(res, 404, { error: 'slide not found' });
          }
          return identityFailure(res, error);
        }
        if (!transaction.value.ok) {
          return json(res, 422, { error: transaction.value.error });
        }
        return json(res, 200, { ok: true, slideId, pageIds: body.pageIds });
      }

      const pageOpMatch = url.pathname.match(/^\/([^/]+)\/pages(?:\/(\d+))?(?:\/([a-z]+))?$/);
      if (pageOpMatch) {
        const slideId = pageOpMatch[1];
        const legacyPageIndex =
          pageOpMatch[2] === undefined ? null : Number.parseInt(pageOpMatch[2], 10);
        const op = pageOpMatch[3];
        if (!SLIDE_ID_RE.test(slideId)) return json(res, 400, { error: 'invalid slideId' });
        if (legacyPageIndex !== null && (!Number.isInteger(legacyPageIndex) || legacyPageIndex < 0))
          return json(res, 400, { error: 'invalid page index' });

        const isDelete = method === 'DELETE' && !op;
        const isDuplicate = method === 'POST' && op === 'duplicate';
        if (!isDelete && !isDuplicate) return next();
        const requestCheck = validateMutationRequest(req, { requireJsonBody: true });
        if (!requestCheck.ok) {
          return json(res, requestCheck.status, { error: requestCheck.error });
        }

        const entry = resolveContentEntry(ctx, slideId, kind);
        if (!entry) return json(res, 400, { error: 'invalid slideId' });

        const body = (await readBody(req)) as { pageId?: unknown };
        if (typeof body.pageId !== 'string') return json(res, 400, { error: 'invalid pageId' });
        type PageOperationValue =
          | { ok: false; error: string }
          | { ok: true; index: number; pageId: string };
        let transaction: { value: PageOperationValue };
        try {
          transaction = await transactSourceFile<PageOperationValue>(entry.filePath, (source) => {
            const updated = isDelete
              ? removePageByIdInSource(source, body.pageId as string, entry.sourceModule)
              : duplicatePageByIdInSource(source, body.pageId as string, entry.sourceModule);
            const noteIndex = isDelete
              ? updated.index
              : (updated as ReturnType<typeof duplicatePageByIdInSource>).sourceIndex;
            const withNotes = isDelete
              ? removeNotesElementInSource(updated.source, noteIndex)
              : duplicateNotesElementInSource(updated.source, noteIndex);
            if (withNotes === null) {
              return {
                source,
                value: {
                  ok: false,
                  error: isDelete
                    ? 'could not delete page — `notes` export has an unexpected shape'
                    : 'could not duplicate page — `notes` export has an unexpected shape',
                } as const,
              };
            }
            return {
              source: withNotes,
              value: {
                ok: true,
                index: updated.index,
                pageId: isDelete
                  ? (body.pageId as string)
                  : (updated as ReturnType<typeof duplicatePageByIdInSource>).pageId,
              } as const,
            };
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return json(res, 404, { error: 'slide not found' });
          }
          return identityFailure(res, error);
        }
        if (!transaction.value.ok) {
          return json(res, 422, { error: transaction.value.error });
        }
        return json(res, 200, {
          ok: true,
          slideId,
          index: transaction.value.index,
          pageId: transaction.value.pageId,
        });
      }

      const duplicateMatch = url.pathname.match(/^\/([^/]+)\/duplicate$/);
      if (duplicateMatch && method === 'POST') {
        const requestCheck = validateMutationRequest(req);
        if (!requestCheck.ok) {
          return json(res, requestCheck.status, { error: requestCheck.error });
        }
        const slideId = duplicateMatch[1];
        if (!SLIDE_ID_RE.test(slideId)) return json(res, 400, { error: 'invalid slideId' });

        const body = (await readBody(req)) as DuplicateSlideBody;
        if (body.newId !== undefined && typeof body.newId !== 'string') {
          return json(res, 400, { error: 'invalid newId' });
        }

        const duplicated = await duplicateSlideDir(root, slideId, body.newId);
        if (!duplicated.ok) return json(res, duplicated.status, { error: duplicated.error });

        if (kind === 'slide') {
          const manifest = await readManifest(ctx.manifestPath);
          const folderId = manifest.assignments[slideId];
          if (folderId) {
            manifest.assignments[duplicated.slideId] = folderId;
            await writeManifest(ctx.manifestPath, manifest);
          }
        }
        return json(res, 200, { ok: true, slideId: duplicated.slideId });
      }

      const idMatch = url.pathname.match(/^\/([^/]+)$/);
      if (!idMatch) return next();
      const slideId = idMatch[1];
      if (!SLIDE_ID_RE.test(slideId)) return json(res, 400, { error: 'invalid slideId' });

      if (method === 'PATCH') {
        const requestCheck = validateMutationRequest(req, { requireJsonBody: true });
        if (!requestCheck.ok) {
          return json(res, requestCheck.status, { error: requestCheck.error });
        }
        const body = (await readBody(req)) as SlidePatchBody;
        const name = validateSlideName(body.name);
        if (!name) return json(res, 400, { error: 'invalid name' });

        const entry = resolveContentEntry(ctx, slideId, kind);
        if (!entry) return json(res, 400, { error: 'invalid slideId' });

        let transaction: { value: { ok: true } | { ok: false } };
        try {
          transaction = await transactSourceFile<{ ok: true } | { ok: false }>(
            entry.filePath,
            (source) => {
              const updated = updateMetaTitleInSource(source, name);
              return updated === null
                ? { source, value: { ok: false } as const }
                : { source: updated, value: { ok: true } as const };
            },
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return json(res, 404, { error: 'slide not found' });
          }
          throw error;
        }
        if (!transaction.value.ok) {
          return json(res, 422, {
            error: `could not locate a safe place to write meta.title in ${entry.sourceModule}`,
          });
        }
        // The TSX edit lands through Vite's normal HMR pipeline, but the
        // React state holding `slide.meta` in the editor won't re-fetch on
        // its own — tell every client to refresh so the new title shows up.
        server.ws.send({ type: 'full-reload' });
        return json(res, 200, { ok: true, slideId, name });
      }

      if (method === 'DELETE') {
        const requestCheck = validateMutationRequest(req);
        if (!requestCheck.ok) {
          return json(res, requestCheck.status, { error: requestCheck.error });
        }
        const removed = await rmSlideDir(root, slideId);
        if (!removed) return json(res, 404, { error: 'slide not found' });

        if (kind === 'slide') {
          const manifest = await readManifest(ctx.manifestPath);
          delete manifest.assignments[slideId];
          await writeManifest(ctx.manifestPath, manifest);
        }
        return json(res, 200, { ok: true });
      }

      return next();
    } catch (err) {
      json(res, 500, { error: String((err as Error).message ?? err) });
    }
  });
}
