import fs from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import type { Connect } from 'vite';
import { SLIDE_ID_RE } from '../../editing/slide-ops.ts';
import { resolveExistingContentEntry } from '../../files/content-entry.ts';
import { foldersManifestPath } from '../../files/folders.ts';

export type ApiContext = {
  userCwd: string;
  slidesDir: string;
  slidesRoot: string;
  documentsDir: string;
  documentsRoot: string;
  globalAssetsRoot: string;
  manifestPath: string;
  coreVersion: string;
  catalogSourceModule?: string;
};

export type ApiPluginOptions = {
  userCwd: string;
  slidesDir?: string;
  documentsDir?: string;
  assetsDir?: string;
  coreVersion: string;
  catalogSourceModule?: string;
};

export function makeContext(opts: ApiPluginOptions): ApiContext {
  const userCwd = opts.userCwd;
  const slidesDir = opts.slidesDir ?? 'slides';
  const documentsDir = opts.documentsDir ?? 'documents';
  const assetsDir = opts.assetsDir ?? 'assets';
  const slidesRoot = path.resolve(userCwd, slidesDir);
  const documentsRoot = path.resolve(userCwd, documentsDir);
  const globalAssetsRoot = path.resolve(userCwd, assetsDir);
  const manifestPath = foldersManifestPath(slidesRoot);
  return {
    userCwd,
    slidesDir,
    slidesRoot,
    documentsDir,
    documentsRoot,
    globalAssetsRoot,
    manifestPath,
    coreVersion: opts.coreVersion,
    catalogSourceModule: opts.catalogSourceModule,
  };
}

export async function readBody(req: Connect.IncomingMessage): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

export function resolveSlideEntryPath(ctx: ApiContext, slideId: string): string | null {
  return resolveSlidePath(ctx.userCwd, ctx.slidesDir, slideId);
}

export function resolveSlidePath(
  userCwd: string,
  slidesDir: string,
  slideId: string,
): string | null {
  if (!SLIDE_ID_RE.test(slideId)) return null;
  const slidesRoot = path.resolve(userCwd, slidesDir);
  const contentDirectory = path.resolve(slidesRoot, slideId);
  if (!contentDirectory.startsWith(slidesRoot + path.sep)) return null;
  return resolveExistingContentEntry(contentDirectory) ?? path.join(contentDirectory, 'index.tsx');
}

export async function readSlideSource(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export function contentRoot(ctx: ApiContext, kind: unknown): string {
  return kind === 'document' ? ctx.documentsRoot : ctx.slidesRoot;
}

export function contentDir(ctx: ApiContext, kind: unknown): string {
  return kind === 'document' ? ctx.documentsDir : ctx.slidesDir;
}

export type ResolvedContentEntry = {
  filePath: string;
  sourceModule: string;
};

export function resolveContentEntryPath(ctx: ApiContext, id: string, kind: unknown): string | null {
  return resolveContentEntry(ctx, id, kind)?.filePath ?? null;
}

export function resolveContentEntry(
  ctx: ApiContext,
  id: string,
  kind: unknown,
): ResolvedContentEntry | null {
  const filePath = resolveSlidePath(ctx.userCwd, contentDir(ctx, kind), id);
  if (!filePath) return null;
  return {
    filePath,
    sourceModule: `${kind === 'document' ? 'documents' : 'slides'}/${id}/${path.basename(filePath)}`,
  };
}
