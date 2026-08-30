import { describe, expect, it } from 'vitest';
import { PageIdentityCollisionError, PageIdentityStaleError } from '../app/lib/page-identity.ts';
import { resolvePageIdentitiesInSource, sourcePageOccurrencesOrThrow } from './page-identities.ts';
import {
  duplicatePageByIdInSource,
  insertPageComponentInSource,
  migrateLegacyPageOccurrencesInSource,
  removePageByIdInSource,
  reorderDefaultExportPagesByIdInSource,
} from './slide-ops.ts';

const sourceModule = 'slides/identity/index.tsx';

function pageIds(source: string): string[] {
  return sourcePageOccurrencesOrThrow(source, sourceModule).map((occurrence) => occurrence.id);
}

describe('identity-authoritative page source operations', () => {
  it('reorders repeated components by authored id', () => {
    const source = [
      "import { page } from '@open-slide/core';",
      'const Shared = () => null;',
      "export default [page('first', Shared), page('second', Shared)];",
      '',
    ].join('\n');
    const reordered = reorderDefaultExportPagesByIdInSource(
      source,
      [`${sourceModule}#second`, `${sourceModule}#first`],
      sourceModule,
    );

    expect(reordered.order).toEqual([1, 0]);
    expect(pageIds(reordered.source)).toEqual([`${sourceModule}#second`, `${sourceModule}#first`]);
  });

  it('persists deterministic duplicate ids and survives a fresh parse', () => {
    const source = [
      "import { page } from '@open-slide/core';",
      'const Shared = () => null;',
      "export default [page('first', Shared), page('second', Shared)];",
      '',
    ].join('\n');
    const firstCopy = duplicatePageByIdInSource(source, `${sourceModule}#first`, sourceModule);
    const secondCopy = duplicatePageByIdInSource(
      firstCopy.source,
      `${sourceModule}#first`,
      sourceModule,
    );

    expect(firstCopy.pageId).toBe(`${sourceModule}#first-copy`);
    expect(secondCopy.pageId).toBe(`${sourceModule}#first-copy-2`);
    expect(pageIds(secondCopy.source)).toEqual([
      `${sourceModule}#first`,
      `${sourceModule}#first-copy-2`,
      `${sourceModule}#first-copy`,
      `${sourceModule}#second`,
    ]);
  });

  it('upgrades a duplicated unique legacy page without renumbering the original', () => {
    const source = ['const Cover = () => null;', 'export default [Cover];', ''].join('\n');
    const duplicated = duplicatePageByIdInSource(
      source,
      `${sourceModule}#legacy:Cover`,
      sourceModule,
    );

    expect(duplicated.source).toContain("import { page } from '@open-slide/core';");
    expect(duplicated.source).toContain("export default [Cover, page('cover-copy', Cover)];");
    expect(pageIds(duplicated.source)).toEqual([
      `${sourceModule}#legacy:Cover`,
      `${sourceModule}#cover-copy`,
    ]);
  });

  it('deletes by id and leaves every survivor id unchanged', () => {
    const source = [
      "import { page } from '@open-slide/core';",
      'const Shared = () => null;',
      "export default [page('one', Shared), page('two', Shared), page('three', Shared)];",
      '',
    ].join('\n');
    const removed = removePageByIdInSource(source, `${sourceModule}#two`, sourceModule);

    expect(removed.index).toBe(1);
    expect(pageIds(removed.source)).toEqual([`${sourceModule}#one`, `${sourceModule}#three`]);
  });

  it('returns a named collision for duplicate legacy occurrences', () => {
    const source = ['const Shared = () => null;', 'export default [Shared, Shared];', ''].join(
      '\n',
    );
    const resolution = resolvePageIdentitiesInSource(source, sourceModule);

    expect(resolution.occurrences).toHaveLength(2);
    expect(resolution.error).toBeInstanceOf(PageIdentityCollisionError);
    expect(() =>
      duplicatePageByIdInSource(source, `${sourceModule}#legacy:Shared`, sourceModule),
    ).toThrow(PageIdentityCollisionError);
    expect(() => reorderDefaultExportPagesByIdInSource(source, [], sourceModule)).toThrow(
      PageIdentityCollisionError,
    );
    expect(() =>
      removePageByIdInSource(source, `${sourceModule}#legacy:Shared`, sourceModule),
    ).toThrow(PageIdentityCollisionError);
  });

  it('rejects stale ids instead of falling back to array position', () => {
    const source = ['const Cover = () => null;', 'export default [Cover];', ''].join('\n');
    expect(() => removePageByIdInSource(source, `${sourceModule}#missing`, sourceModule)).toThrow(
      PageIdentityStaleError,
    );
  });

  it('migrates unique legacy pages and refuses ambiguous legacy duplicates', () => {
    const unique = [
      'const Cover = () => null;',
      'const Closing = () => null;',
      'export default [Cover, Closing];',
      '',
    ].join('\n');
    const migrated = migrateLegacyPageOccurrencesInSource(unique, sourceModule);

    expect(migrated).toContain("page('cover', Cover)");
    expect(migrated).toContain("page('closing', Closing)");
    expect(pageIds(migrated)).toEqual([`${sourceModule}#cover`, `${sourceModule}#closing`]);

    const collision = ['const Shared = () => null;', 'export default [Shared, Shared];'].join('\n');
    expect(() => migrateLegacyPageOccurrencesInSource(collision, sourceModule)).toThrow(
      PageIdentityCollisionError,
    );
  });

  it('writes an authored id for inserted catalog pages', () => {
    const source = ['const Cover = () => null;', 'export default [Cover];', ''].join('\n');
    const inserted = insertPageComponentInSource(
      source,
      'StudioAgenda',
      'const StudioAgenda = () => null;',
      1,
      'agenda',
    );

    expect(inserted).not.toBeNull();
    expect(inserted).toContain("page('agenda', StudioAgenda)");
    expect(inserted).toContain("import { page } from '@open-slide/core';");
  });
});
