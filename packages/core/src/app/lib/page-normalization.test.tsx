import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { page } from './page.tsx';
import {
  nextDuplicatePageId,
  PageIdentityCollisionError,
  PageIdentityValidationError,
} from './page-identity.ts';
import {
  copyResolvedPage,
  normalizeSlideModule,
  pageIdFor,
  pageIdsOrThrow,
} from './page-normalization.tsx';
import type { Page, SlideModule } from './sdk.ts';

function namedPage(name: string): Page {
  const Component = () => null;
  Component.displayName = name;
  return Component;
}

describe('authored page occurrence normalization', () => {
  it('validates page() ids and returns a renderable Page', () => {
    const Shared = () => null;
    const authored = page('opening', Shared);

    expect(typeof authored).toBe('function');
    expect(createElement(authored)).toMatchObject({ type: authored });
    expect(() => page('not valid', Shared)).toThrow(PageIdentityValidationError);
  });

  it('distinguishes repeated components and preserves ids across reorder and reparse', () => {
    const Shared = () => null;
    const first = page('first', Shared);
    const second = page('second', Shared);
    const module = { default: [first, second] } satisfies SlideModule;
    const normalized = normalizeSlideModule(module, 'slides/repeated/index.tsx');

    expect(pageIdsOrThrow(normalized.default)).toEqual([
      'slides/repeated/index.tsx#first',
      'slides/repeated/index.tsx#second',
    ]);
    expect(normalizeSlideModule(module, 'slides/repeated/index.tsx')).toBe(normalized);

    const reordered = normalizeSlideModule(
      { default: [second, first] },
      'slides/repeated/index.tsx',
    );
    expect(pageIdsOrThrow(reordered.default)).toEqual([
      'slides/repeated/index.tsx#second',
      'slides/repeated/index.tsx#first',
    ]);

    const reparsed = normalizeSlideModule(
      { default: [page('first', () => null), page('second', () => null)] },
      'slides/repeated/index.tsx',
    );
    expect(pageIdsOrThrow(reparsed.default)).toEqual(pageIdsOrThrow(normalized.default));
  });

  it('scopes the same authored id to its source module', () => {
    const Shared = () => null;
    const occurrence = page('cover', Shared);
    const slide = normalizeSlideModule({ default: [occurrence] }, 'slides/deck/index.tsx');
    const document = normalizeSlideModule({ default: [occurrence] }, 'documents/deck/index.tsx');

    expect(pageIdFor(slide.default[0])).toBe('slides/deck/index.tsx#cover');
    expect(pageIdFor(document.default[0])).toBe('documents/deck/index.tsx#cover');
  });

  it('keeps the canonical source when a normalized module crosses another boundary', () => {
    const document = normalizeSlideModule(
      { default: [page('cover', () => null)] },
      'documents/deck/index.tsx',
    );
    const passedThrough = normalizeSlideModule(document, 'slides/deck/index.tsx');

    expect(passedThrough).toBe(document);
    expect(pageIdFor(passedThrough.default[0])).toBe('documents/deck/index.tsx#cover');
  });

  it('gives unique named legacy components a stable fallback', () => {
    const original = normalizeSlideModule(
      { default: [namedPage('Cover'), namedPage('Closing')] },
      'slides/legacy/index.tsx',
    );
    const reparsed = normalizeSlideModule(
      { default: [namedPage('Cover'), namedPage('Closing')] },
      'slides/legacy/index.tsx',
    );

    expect(pageIdsOrThrow(original.default)).toEqual([
      'slides/legacy/index.tsx#legacy:Cover',
      'slides/legacy/index.tsx#legacy:Closing',
    ]);
    expect(pageIdsOrThrow(reparsed.default)).toEqual(pageIdsOrThrow(original.default));
  });

  it('uses source-registered legacy names after production name mangling', () => {
    const Minified = namedPage('a');
    const registryKey = Symbol.for('@open-slide/core/legacy-page-names');
    const registry = new WeakMap<object, Map<string, string>>();
    registry.set(Minified, new Map([['slides/legacy/index.tsx', 'Cover']]));
    (globalThis as Record<PropertyKey, unknown>)[registryKey] = registry;

    const normalized = normalizeSlideModule({ default: [Minified] }, 'slides/legacy/index.tsx');

    expect(pageIdsOrThrow(normalized.default)).toEqual(['slides/legacy/index.tsx#legacy:Cover']);
  });

  it('renders duplicate legacy occurrences but fails closed for identity use', () => {
    const Shared = namedPage('Shared');
    const normalized = normalizeSlideModule(
      { default: [Shared, Shared] },
      'slides/collision/index.tsx',
    );

    expect(normalized.default).toHaveLength(2);
    expect(normalized.default.every((entry) => typeof entry === 'function')).toBe(true);
    expect(normalized.pageIdentityError).toBeInstanceOf(PageIdentityCollisionError);
    expect(pageIdFor(normalized.default[0])).toBeNull();
    expect(pageIdFor(normalized.default[1])).toBeNull();
    expect(() => pageIdsOrThrow(normalized.default, normalized.pageIdentityError)).toThrow(
      PageIdentityCollisionError,
    );
  });

  it('creates deterministic identities for optimistic duplicate renders', () => {
    const normalized = normalizeSlideModule(
      { default: [page('cover', () => null)] },
      'slides/copy/index.tsx',
    );
    const ids = pageIdsOrThrow(normalized.default);
    const duplicate = nextDuplicatePageId(ids[0], ids);
    const copied = copyResolvedPage(normalized.default[0], duplicate.pageId);

    expect(pageIdFor(copied)).toBe('slides/copy/index.tsx#cover-copy');
  });

  it('keeps generated duplicate ids within the authored id length limit', () => {
    const source = 'slides/copy/index.tsx';
    const original = `${source}#${'a'.repeat(64)}`;
    const first = nextDuplicatePageId(original, [original]);
    const second = nextDuplicatePageId(original, [original, first.pageId]);

    expect(first.stableId).toHaveLength(64);
    expect(first.stableId).toMatch(/-copy$/);
    expect(second.stableId).toHaveLength(64);
    expect(second.stableId).toMatch(/-copy-2$/);
  });
});
