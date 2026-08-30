import { existsSync } from 'node:fs';
import path from 'node:path';

export const CONTENT_ENTRY_EXTENSIONS = ['tsx', 'jsx', 'ts', 'js'] as const;

export function resolveExistingContentEntry(contentDirectory: string): string | null {
  for (const extension of CONTENT_ENTRY_EXTENSIONS) {
    const candidate = path.join(contentDirectory, `index.${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function canonicalizeContentEntries(files: readonly string[], root: string): string[] {
  const selected = new Map<string, { file: string; priority: number }>();
  for (const file of files) {
    const relative = path.relative(root, file);
    const [id, basename, ...rest] = relative.split(path.sep);
    if (!id || !basename || rest.length > 0) continue;
    const extension = CONTENT_ENTRY_EXTENSIONS.findIndex((value) => basename === `index.${value}`);
    if (extension < 0) continue;
    const current = selected.get(id);
    if (!current || extension < current.priority) {
      selected.set(id, { file, priority: extension });
    }
  }
  return [...selected.values()].map(({ file }) => file).sort();
}
