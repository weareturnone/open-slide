import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeContext, resolveContentEntry } from './context.ts';

describe('resolveContentEntry', () => {
  it('carries the actual canonical entry extension into source provenance', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-slide-entry-'));
    try {
      const entry = path.join(root, 'slides', 'deck', 'index.jsx');
      await fs.mkdir(path.dirname(entry), { recursive: true });
      await fs.writeFile(entry, 'export default [];\n', 'utf8');
      const ctx = makeContext({ userCwd: root, coreVersion: 'test' });

      expect(resolveContentEntry(ctx, 'deck', 'slide')).toEqual({
        filePath: entry,
        sourceModule: 'slides/deck/index.jsx',
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('uses one deterministic extension when a folder contains conflicting entries', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-slide-entry-'));
    try {
      const contentDir = path.join(root, 'documents', 'proposal');
      await fs.mkdir(contentDir, { recursive: true });
      await fs.writeFile(path.join(contentDir, 'index.js'), 'export default [];\n', 'utf8');
      await fs.writeFile(path.join(contentDir, 'index.ts'), 'export default [];\n', 'utf8');
      const ctx = makeContext({ userCwd: root, coreVersion: 'test' });

      expect(resolveContentEntry(ctx, 'proposal', 'document')).toEqual({
        filePath: path.join(contentDir, 'index.ts'),
        sourceModule: 'documents/proposal/index.ts',
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
