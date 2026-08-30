import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyEdit } from '../editing/edit-ops.ts';
import { sourcePageOccurrencesOrThrow } from '../editing/page-identities.ts';
import {
  duplicatePageByIdInSource,
  reorderDefaultExportPagesByIdInSource,
} from '../editing/slide-ops.ts';
import { transactSourceFile } from './source-transactions.ts';

async function withSourceFile<T>(run: (file: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-slide-transaction-'));
  const file = path.join(root, 'index.tsx');
  await fs.writeFile(file, '0', { encoding: 'utf8', mode: 0o640 });
  try {
    return await run(file);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe('transactSourceFile', () => {
  it('serializes the complete read-transform-replace cycle for one source file', async () => {
    await withSourceFile(async (file) => {
      await Promise.all(
        Array.from({ length: 24 }, (_, index) =>
          transactSourceFile(file, async (source) => {
            await new Promise((resolve) => setTimeout(resolve, index % 3));
            const next = String(Number(source) + 1);
            return { source: next, value: next };
          }),
        ),
      );

      expect(await fs.readFile(file, 'utf8')).toBe('24');
    });
  });

  it('atomically replaces changed content and preserves mode bits', async () => {
    await withSourceFile(async (file) => {
      const before = (await fs.stat(file)).mode & 0o777;
      const result = await transactSourceFile(file, (source) => ({
        source: `${source}\nchanged`,
        value: 'committed',
      }));

      expect(result).toEqual({ changed: true, value: 'committed' });
      expect(await fs.readFile(file, 'utf8')).toBe('0\nchanged');
      expect((await fs.stat(file)).mode & 0o777).toBe(before);
    });
  });

  it('leaves the original and unrelated temporary-looking files intact after failure', async () => {
    await withSourceFile(async (file) => {
      const unrelated = path.join(path.dirname(file), '.index.tsx.open-slide-tmp-existing');
      await fs.writeFile(unrelated, 'keep', 'utf8');

      await expect(
        transactSourceFile(file, () => {
          throw new Error('transform failed');
        }),
      ).rejects.toThrow('transform failed');

      expect(await fs.readFile(file, 'utf8')).toBe('0');
      expect(await fs.readFile(unrelated, 'utf8')).toBe('keep');
    });
  });

  it('does not lose concurrent page duplication, reorder, or inspector edits', async () => {
    await withSourceFile(async (file) => {
      const sourceModule = 'slides/deck/index.tsx';
      await fs.writeFile(
        file,
        [
          "import { page } from '@open-slide/core';",
          'const A = () => (',
          '<h1>A</h1>',
          ');',
          'const B = () => <h2>B</h2>;',
          "export default [page('a', A), page('b', B)];",
          '',
        ].join('\n'),
        'utf8',
      );

      await Promise.all([
        transactSourceFile(file, (source) => ({
          source: duplicatePageByIdInSource(source, `${sourceModule}#a`, sourceModule).source,
          value: 'duplicate',
        })),
        transactSourceFile(file, (source) => {
          const pageIds = sourcePageOccurrencesOrThrow(source, sourceModule).map(({ id }) => id);
          return {
            source: reorderDefaultExportPagesByIdInSource(
              source,
              [...pageIds].reverse(),
              sourceModule,
            ).source,
            value: 'reorder',
          };
        }),
        transactSourceFile(file, (source) => {
          const edited = applyEdit(source, 3, 0, [
            { kind: 'set-style', key: 'color', value: '#123456' },
          ]);
          if (!edited.ok) throw new Error(edited.error);
          return { source: edited.source, value: 'edit' };
        }),
      ]);

      const finalSource = await fs.readFile(file, 'utf8');
      expect(
        sourcePageOccurrencesOrThrow(finalSource, sourceModule)
          .map(({ id }) => id)
          .sort(),
      ).toEqual([`${sourceModule}#a`, `${sourceModule}#a-copy`, `${sourceModule}#b`].sort());
      expect(finalSource).toContain("<h1 style={{ color: '#123456' }}>A</h1>");
    });
  });
});
