import fs from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import { isPageIdentityError, PageIdentityStaleError } from '../../app/lib/page-identity.ts';
import { applyEdit, applyEditBatch, type EditOp } from '../../editing/edit-ops.ts';
import { sourcePageOccurrencesOrThrow } from '../../editing/page-identities.ts';
import { applyRevertAsset } from '../../editing/revert-asset.ts';
import { validateMutationRequest } from '../../http/request-guard.ts';
import {
  type ApiContext,
  contentSourceModule,
  json,
  readBody,
  readSlideSource,
  resolveContentEntryPath,
} from './context.ts';

// POST /__edit                applyEdit({ slideId, line, column, ops })
// POST /__edit/revert-asset   applyRevertAsset({ slideId, assetPath })
// POST /__edit/batch          applyEdit × N — single FS write per request

type EditBody = {
  slideId?: string;
  kind?: 'slide' | 'document';
  pageId?: string;
  line?: number;
  column?: number;
  ops?: EditOp[];
  strict?: boolean;
};

type EditBatchBody = {
  slideId?: string;
  kind?: 'slide' | 'document';
  pageId?: string;
  edits?: Array<{ line?: number; column?: number; ops?: EditOp[]; strict?: boolean }>;
};

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

function assertCurrentPageIdentity(
  source: string,
  slideId: string,
  kind: 'slide' | 'document' | undefined,
  pageId: unknown,
): void {
  if (typeof pageId !== 'string') throw new PageIdentityStaleError(String(pageId ?? ''));
  const occurrences = sourcePageOccurrencesOrThrow(source, contentSourceModule(slideId, kind));
  if (!occurrences.some((occurrence) => occurrence.id === pageId)) {
    throw new PageIdentityStaleError(pageId);
  }
}

export function registerEditRoutes(server: ViteDevServer, ctx: ApiContext): void {
  server.middlewares.use('/__edit', async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const method = req.method ?? 'GET';
    if (method !== 'POST') return next();
    const requestCheck = validateMutationRequest(req, { requireJsonBody: true });
    if (!requestCheck.ok) return json(res, requestCheck.status, { error: requestCheck.error });

    try {
      if (url.pathname === '/') {
        const body = (await readBody(req)) as EditBody;
        const slideId = body.slideId ?? '';
        const file = resolveContentEntryPath(ctx, slideId, body.kind);
        if (!file) return json(res, 400, { error: 'invalid slideId' });
        if (!body.line || body.line < 1) return json(res, 400, { error: 'invalid line' });
        if (!Array.isArray(body.ops)) return json(res, 400, { error: 'missing ops' });

        const source = await readSlideSource(file);
        if (source === null) return json(res, 404, { error: 'slide not found' });

        try {
          assertCurrentPageIdentity(source, slideId, body.kind, body.pageId);
        } catch (error) {
          return identityFailure(res, error);
        }

        const result = applyEdit(source, body.line, body.column ?? 0, body.ops, body.strict);
        if (!result.ok) return json(res, result.status, { error: result.error });
        const changed = result.source !== source;
        if (changed) await fs.writeFile(file, result.source, 'utf8');
        return json(res, 200, { ok: true, changed });
      }

      if (url.pathname === '/revert-asset') {
        const body = (await readBody(req)) as {
          slideId?: string;
          kind?: 'slide' | 'document';
          assetPath?: string;
        };
        const slideId = body.slideId ?? '';
        const assetPath = body.assetPath;
        const file = resolveContentEntryPath(ctx, slideId, body.kind);
        if (!file) return json(res, 400, { error: 'invalid slideId' });
        if (typeof assetPath !== 'string' || !assetPath) {
          return json(res, 400, { error: 'missing assetPath' });
        }
        if (!assetPath.startsWith('./assets/') && !assetPath.startsWith('@assets/')) {
          return json(res, 400, { error: 'asset path must start with ./assets/ or @assets/' });
        }

        const source = await readSlideSource(file);
        if (source === null) return json(res, 404, { error: 'slide not found' });

        const result = applyRevertAsset(source, assetPath);
        if (!result.ok) return json(res, result.status, { error: result.error });
        const changed = result.source !== source;
        if (changed) await fs.writeFile(file, result.source, 'utf8');
        return json(res, 200, { ok: true, changed });
      }

      // One read-modify-write per batch so a multi-element edit session
      // lands as a single HMR. The batch is atomic: one invalid edit aborts
      // the write so callers never get a partially applied source file.
      if (url.pathname === '/batch') {
        const body = (await readBody(req)) as EditBatchBody;
        const slideId = body.slideId ?? '';
        const file = resolveContentEntryPath(ctx, slideId, body.kind);
        if (!file) return json(res, 400, { error: 'invalid slideId' });
        if (!Array.isArray(body.edits)) return json(res, 400, { error: 'missing edits' });

        const source = await readSlideSource(file);
        if (source === null) return json(res, 404, { error: 'slide not found' });

        try {
          assertCurrentPageIdentity(source, slideId, body.kind, body.pageId);
        } catch (error) {
          return identityFailure(res, error);
        }

        const edits = body.edits.map((edit) => ({
          line: edit.line ?? 0,
          column: edit.column ?? 0,
          ops: edit.ops ?? [],
          strict: edit.strict,
        }));
        if (edits.some((edit) => edit.line < 1 || !Array.isArray(edit.ops))) {
          return json(res, 400, { error: 'invalid edit' });
        }
        const result = applyEditBatch(source, edits);
        if (!result.ok) {
          return json(res, result.status, {
            error: result.error,
            editIndex: result.editIndex,
          });
        }
        const changed = result.source !== source;
        if (changed) await fs.writeFile(file, result.source, 'utf8');
        return json(res, 200, {
          ok: true,
          changed,
          results: edits.map(() => ({ ok: true })),
        });
      }

      return next();
    } catch (err) {
      json(res, 500, { error: String((err as Error).message ?? err) });
    }
  });
}
