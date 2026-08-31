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

  it('preserves directive prologues when it injects the page factory import', () => {
    const source = [
      "'use client';",
      'const Cover = () => null;',
      'export default [Cover];',
      '',
    ].join('\n');

    const migrated = migrateLegacyPageOccurrencesInSource(source, sourceModule);

    expect(migrated.startsWith("'use client';\nimport { page } from '@open-slide/core';")).toBe(
      true,
    );
    expect(pageIds(migrated)).toEqual([`${sourceModule}#cover`]);
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

  it('recognizes named aliases and reuses the imported binding for writes', () => {
    const source = [
      "import { page as definePage } from '@open-slide/core';",
      'const Shared = () => null;',
      "export default [definePage('first', Shared), definePage('second', Shared)];",
      '',
    ].join('\n');

    expect(pageIds(source)).toEqual([`${sourceModule}#first`, `${sourceModule}#second`]);
    const duplicated = duplicatePageByIdInSource(source, `${sourceModule}#first`, sourceModule);
    expect(duplicated.source).toContain("definePage('first-copy', Shared)");
    expect(duplicated.source.match(/from '@open-slide\/core'/g)).toHaveLength(1);
  });

  it('recognizes namespace imports and reuses the namespace member for migration', () => {
    const source = [
      "import * as OpenSlide from '@open-slide/core';",
      'const Cover = () => null;',
      'const Closing = () => null;',
      'export default [Cover, Closing];',
      '',
    ].join('\n');

    const migrated = migrateLegacyPageOccurrencesInSource(source, sourceModule);
    expect(migrated).toContain("OpenSlide.page('cover', Cover)");
    expect(migrated).toContain("OpenSlide.page('closing', Closing)");
    expect(pageIds(migrated)).toEqual([`${sourceModule}#cover`, `${sourceModule}#closing`]);
  });

  it('rejects spelling matches that are not value imports from core', () => {
    const sources = [
      [
        'const page = (id: string, component: unknown) => component;',
        'const Cover = () => null;',
        "export default [page('cover', Cover)];",
      ].join('\n'),
      [
        "import type { page } from '@open-slide/core';",
        'const Cover = () => null;',
        "export default [page('cover', Cover)];",
      ].join('\n'),
      [
        "import { page } from 'unrelated-package';",
        'const Cover = () => null;',
        "export default [page('cover', Cover)];",
      ].join('\n'),
      [
        "import * as Other from 'unrelated-package';",
        'const Cover = () => null;',
        "export default [Other.page('cover', Cover)];",
      ].join('\n'),
    ];

    for (const source of sources) {
      expect(resolvePageIdentitiesInSource(source, sourceModule).error).not.toBeNull();
    }
  });

  it('supports an immutable top-level const array without rewriting its export', () => {
    const source = [
      "import { page as definePage, type Page } from '@open-slide/core';",
      'const Shared = () => null;',
      'const pages: Page[] = ([',
      "  definePage('first', Shared), // authored first",
      "  definePage('second', Shared),",
      '] satisfies Page[]);',
      'export default pages;',
      '',
    ].join('\n');

    expect(pageIds(source)).toEqual([`${sourceModule}#first`, `${sourceModule}#second`]);
    const reordered = reorderDefaultExportPagesByIdInSource(
      source,
      [`${sourceModule}#second`, `${sourceModule}#first`],
      sourceModule,
    );
    expect(reordered.source).toContain('export default pages;');
    expect(reordered.source).toContain("definePage('first', Shared), // authored first");
    expect(pageIds(reordered.source)).toEqual([`${sourceModule}#second`, `${sourceModule}#first`]);

    const inserted = insertPageComponentInSource(
      reordered.source,
      'StudioAgenda',
      'const StudioAgenda = () => null;',
      1,
      'agenda',
    );
    expect(inserted).not.toBeNull();
    expect(inserted).toContain("definePage('agenda', StudioAgenda)");
    expect(inserted).toContain('export default pages;');
  });

  it('rejects mutable, imported, spread, reassigned, and ambiguous page arrays', () => {
    const unsupported = [
      ['const Cover = () => null;', 'let pages = [Cover];', 'export default pages;'].join('\n'),
      ["import pages from './pages';", 'export default pages;'].join('\n'),
      [
        'const Cover = () => null;',
        'const rest = [Cover];',
        'const pages = [Cover, ...rest];',
        'export default pages;',
      ].join('\n'),
      [
        'const Cover = () => null;',
        'const pages = [Cover];',
        'pages = [Cover];',
        'export default pages;',
      ].join('\n'),
      [
        'const Cover = () => null;',
        'const pages = [Cover];',
        '{ const pages = [Cover]; }',
        'export default pages;',
      ].join('\n'),
      [
        'const Cover = () => null;',
        'const pages = [Cover];',
        'pages.reverse();',
        'export default pages;',
      ].join('\n'),
      [
        'const Cover = () => null;',
        'const pages = [Cover];',
        'const alias = pages;',
        'alias.reverse();',
        'export default pages;',
      ].join('\n'),
      [
        'declare function mutate(value: unknown[]): void;',
        'const Cover = () => null;',
        'const pages = [Cover];',
        'mutate(pages);',
        'export default pages;',
      ].join('\n'),
    ];

    for (const source of unsupported) {
      expect(resolvePageIdentitiesInSource(source, sourceModule).error).not.toBeNull();
    }
  });
});
