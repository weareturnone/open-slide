import { createElement } from 'react';
import { authoredPageDefinition } from './page.tsx';
import {
  authoredPageId,
  legacyPageId,
  normalizeSourceModule,
  type PageId,
  PageIdentityCollisionError,
  type PageIdentityError,
  PageIdentityUnavailableError,
  type SourceModuleId,
} from './page-identity.ts';
import type { Page, SlideModule } from './sdk.ts';

const RESOLVED_PAGE = Symbol.for('@open-slide/core/resolved-page');
const NORMALIZED_MODULE = Symbol.for('@open-slide/core/normalized-slide-module');
const LEGACY_PAGE_NAMES = Symbol.for('@open-slide/core/legacy-page-names');

export type ResolvedPageDefinition = {
  readonly id: PageId | null;
  readonly component: Page;
};

export type ResolvedPage = Page & {
  readonly [RESOLVED_PAGE]: ResolvedPageDefinition;
};

export type NormalizedSlideModule = Omit<SlideModule, 'default'> & {
  readonly sourceModule: SourceModuleId;
  readonly pageIdentityError: PageIdentityError | null;
  readonly default: ResolvedPage[];
  readonly [NORMALIZED_MODULE]: true;
};

type PageNormalization = {
  pages: ResolvedPage[];
  error: PageIdentityError | null;
};

const pageCache = new WeakMap<readonly Page[], Map<string, PageNormalization>>();
const moduleCache = new WeakMap<object, Map<string, NormalizedSlideModule>>();

function legacyPageName(component: Page, sourceModule: SourceModuleId): string {
  const globalRegistry = (globalThis as Record<PropertyKey, unknown>)[LEGACY_PAGE_NAMES];
  const registered =
    globalRegistry instanceof WeakMap
      ? (globalRegistry as WeakMap<Page, Map<string, string>>).get(component)?.get(sourceModule)
      : undefined;
  return String(registered || component.displayName || component.name || '').trim();
}

function resolvedPage(component: Page, id: PageId | null): ResolvedPage {
  const Resolved = (() => createElement(component)) as unknown as ResolvedPage;
  Object.defineProperties(Resolved, {
    [RESOLVED_PAGE]: {
      configurable: false,
      enumerable: false,
      value: { id, component } satisfies ResolvedPageDefinition,
      writable: false,
    },
    displayName: {
      configurable: true,
      value: component.displayName || component.name || 'ResolvedPage',
      writable: true,
    },
  });
  Resolved.transition = component.transition;
  return Resolved;
}

function normalizePages(pages: readonly Page[], sourceModule: SourceModuleId): PageNormalization {
  let bySource = pageCache.get(pages);
  if (!bySource) {
    bySource = new Map();
    pageCache.set(pages, bySource);
  }
  const cached = bySource.get(sourceModule);
  if (cached) return cached;

  const candidateIds: Array<PageId | null> = [];
  let unavailable: PageIdentityUnavailableError | null = null;
  for (const candidate of pages) {
    const authored = authoredPageDefinition(candidate);
    if (authored) {
      candidateIds.push(authoredPageId(sourceModule, authored.stableId));
      continue;
    }
    const componentName = legacyPageName(candidate, sourceModule);
    try {
      candidateIds.push(legacyPageId(sourceModule, componentName));
    } catch (error) {
      candidateIds.push(null);
      if (!unavailable && error instanceof PageIdentityUnavailableError) unavailable = error;
    }
  }

  const counts = new Map<string, number>();
  for (const id of candidateIds) {
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const collisions = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  const collision =
    collisions.length > 0 ? new PageIdentityCollisionError(sourceModule, collisions) : null;
  const pagesWithIds = pages.map((component, index) => {
    const candidateId = candidateIds[index];
    const id = candidateId && counts.get(candidateId) === 1 ? candidateId : null;
    return resolvedPage(component, id);
  });
  const normalized = { pages: pagesWithIds, error: collision ?? unavailable };
  bySource.set(sourceModule, normalized);
  return normalized;
}

export function normalizeSlideModule(
  module: SlideModule,
  sourceModuleValue: string,
): NormalizedSlideModule {
  const sourceModule = normalizeSourceModule(sourceModuleValue);
  const alreadyNormalized = module as Partial<NormalizedSlideModule>;
  if (alreadyNormalized[NORMALIZED_MODULE]) {
    return alreadyNormalized as NormalizedSlideModule;
  }

  let bySource = moduleCache.get(module);
  if (!bySource) {
    bySource = new Map();
    moduleCache.set(module, bySource);
  }
  const cached = bySource.get(sourceModule);
  if (cached) return cached;

  const normalizedPages = normalizePages(module.default ?? [], sourceModule);
  const normalized = {
    ...module,
    default: normalizedPages.pages,
    sourceModule,
    pageIdentityError: normalizedPages.error,
  } as NormalizedSlideModule;
  Object.defineProperty(normalized, NORMALIZED_MODULE, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  bySource.set(sourceModule, normalized);
  return normalized;
}

export function resolvedPageDefinition(page: Page): ResolvedPageDefinition | null {
  return (page as Partial<ResolvedPage>)[RESOLVED_PAGE] ?? null;
}

export function pageIdFor(page: Page | null | undefined): PageId | null {
  return page ? (resolvedPageDefinition(page)?.id ?? null) : null;
}

export function pageIdsOrThrow(pages: readonly Page[], error?: PageIdentityError | null): PageId[] {
  if (error) throw error;
  const ids = pages.map(pageIdFor);
  if (ids.some((id) => id === null)) {
    throw new PageIdentityUnavailableError(undefined, 'Page identities are unavailable.');
  }
  return ids as PageId[];
}

export function copyResolvedPage(page: Page, id: PageId): ResolvedPage {
  const component = resolvedPageDefinition(page)?.component ?? page;
  return resolvedPage(component, id);
}
