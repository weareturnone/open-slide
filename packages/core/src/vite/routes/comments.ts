import type { ViteDevServer } from 'vite';
import {
  b64urlEncode,
  findInsertion,
  markerDeleteRegex,
  newCommentId,
  offsetToLine,
  parseMarkers,
} from '../../editing/comments.ts';
import { transactSourceFile } from '../../files/source-transactions.ts';
import { validateMutationRequest } from '../../http/request-guard.ts';
import {
  type ApiContext,
  json,
  readBody,
  readSlideSource,
  resolveSlideEntryPath,
} from './context.ts';

// GET    /__comments        list markers for ?slideId=…
// POST   /__comments/add    add marker { slideId, line, column?, text, hint? }
// DELETE /__comments/:id    remove marker

type AddCommentBody = {
  slideId?: string;
  line?: number;
  column?: number;
  text?: string;
  hint?: string;
};

export function registerCommentRoutes(server: ViteDevServer, ctx: ApiContext): void {
  server.middlewares.use('/__comments', async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const method = req.method ?? 'GET';

    try {
      if (method === 'GET' && url.pathname === '/') {
        const slideId = url.searchParams.get('slideId') ?? '';
        const file = resolveSlideEntryPath(ctx, slideId);
        if (!file) return json(res, 400, { error: 'invalid slideId' });
        const source = await readSlideSource(file);
        if (source === null) return json(res, 404, { error: 'slide not found' });
        return json(res, 200, { comments: parseMarkers(source) });
      }

      if (method === 'POST' && url.pathname === '/add') {
        const requestCheck = validateMutationRequest(req, { requireJsonBody: true });
        if (!requestCheck.ok) {
          return json(res, requestCheck.status, { error: requestCheck.error });
        }
        const body = (await readBody(req)) as AddCommentBody;
        const slideId = body.slideId ?? '';
        const file = resolveSlideEntryPath(ctx, slideId);
        if (!file) return json(res, 400, { error: 'invalid slideId' });
        if (!body.line || body.line < 1) return json(res, 400, { error: 'invalid line' });
        if (!body.text || typeof body.text !== 'string') {
          return json(res, 400, { error: 'missing text' });
        }

        const id = newCommentId();
        const ts = new Date().toISOString();
        const payload = b64urlEncode(JSON.stringify({ note: body.text, hint: body.hint }));
        let transaction: { value: { ok: false } | { ok: true; line: number } };
        try {
          transaction = await transactSourceFile<{ ok: false } | { ok: true; line: number }>(
            file,
            (source) => {
              const plan = findInsertion(source, body.line as number, body.column);
              if (!plan) return { source, value: { ok: false } as const };
              const marker = `\n${plan.indent}{/* @slide-comment id="${id}" ts="${ts}" text="${payload}" */}`;
              const next = source.slice(0, plan.offset) + marker + source.slice(plan.offset);
              return {
                source: next,
                value: { ok: true, line: offsetToLine(next, plan.offset + 1) } as const,
              };
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
            error:
              'could not find a JSX container around line ' +
              `${body.line}. Try clicking a different element.`,
          });
        }
        return json(res, 200, { id, line: transaction.value.line });
      }

      if (method === 'DELETE' && url.pathname.startsWith('/')) {
        const requestCheck = validateMutationRequest(req);
        if (!requestCheck.ok) {
          return json(res, requestCheck.status, { error: requestCheck.error });
        }
        const id = url.pathname.slice(1);
        if (!/^c-[a-f0-9]+$/.test(id)) return json(res, 400, { error: 'invalid id' });
        const slideId = url.searchParams.get('slideId') ?? '';
        const file = resolveSlideEntryPath(ctx, slideId);
        if (!file) return json(res, 400, { error: 'invalid slideId' });

        let transaction: { value: { found: boolean } };
        try {
          transaction = await transactSourceFile<{ found: boolean }>(file, (source) => {
            const lines = source.split('\n');
            const idRe = markerDeleteRegex(id);
            const hit = lines.findIndex((line) => idRe.test(line));
            if (hit === -1) return { source, value: { found: false } };
            lines.splice(hit, 1);
            return { source: lines.join('\n'), value: { found: true } };
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return json(res, 404, { error: 'slide not found' });
          }
          throw error;
        }
        if (!transaction.value.found) return json(res, 404, { error: 'marker not found' });
        return json(res, 200, { ok: true });
      }

      next();
    } catch (err) {
      json(res, 500, { error: String((err as Error).message ?? err) });
    }
  });
}
