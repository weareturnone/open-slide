export const STABLE_PAGE_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;

declare const stablePageIdBrand: unique symbol;
declare const sourceModuleIdBrand: unique symbol;
declare const pageIdBrand: unique symbol;

export type StablePageId = string & { readonly [stablePageIdBrand]: true };
export type SourceModuleId = string & { readonly [sourceModuleIdBrand]: true };
export type PageId = string & { readonly [pageIdBrand]: true };

export type PageIdentityErrorCode =
  | 'PAGE_IDENTITY_COLLISION'
  | 'PAGE_IDENTITY_STALE'
  | 'PAGE_IDENTITY_UNAVAILABLE'
  | 'PAGE_IDENTITY_VALIDATION';

export class PageIdentityError extends Error {
  readonly code: PageIdentityErrorCode;

  constructor(name: string, code: PageIdentityErrorCode, message: string) {
    super(message);
    this.name = name;
    this.code = code;
  }
}

export class PageIdentityValidationError extends PageIdentityError {
  constructor(value: string, subject: 'page id' | 'source module' = 'page id') {
    super(
      'PageIdentityValidationError',
      'PAGE_IDENTITY_VALIDATION',
      `Invalid ${subject} "${value}".`,
    );
  }
}

export class PageIdentityCollisionError extends PageIdentityError {
  readonly sourceModule: string;
  readonly collisions: readonly string[];

  constructor(sourceModule: string, collisions: readonly string[]) {
    const unique = [...new Set(collisions)].sort();
    super(
      'PageIdentityCollisionError',
      'PAGE_IDENTITY_COLLISION',
      `Page identity collision in ${sourceModule}: ${unique.join(', ')}. Wrap each repeated occurrence with page('stable-id', Component).`,
    );
    this.sourceModule = sourceModule;
    this.collisions = unique;
  }
}

export class PageIdentityUnavailableError extends PageIdentityError {
  readonly sourceModule?: string;

  constructor(sourceModule?: string, detail = 'A legacy page has no stable component name.') {
    super(
      'PageIdentityUnavailableError',
      'PAGE_IDENTITY_UNAVAILABLE',
      `${detail}${sourceModule ? ` Source: ${sourceModule}.` : ''}`,
    );
    this.sourceModule = sourceModule;
  }
}

export class PageIdentityStaleError extends PageIdentityError {
  readonly pageId: string;

  constructor(pageId: string) {
    super(
      'PageIdentityStaleError',
      'PAGE_IDENTITY_STALE',
      `Page identity "${pageId}" no longer exists in the current source.`,
    );
    this.pageId = pageId;
  }
}

export function validateStablePageId(value: string): StablePageId {
  if (!STABLE_PAGE_ID_RE.test(value)) throw new PageIdentityValidationError(value);
  return value as StablePageId;
}

export function normalizeSourceModule(value: string): SourceModuleId {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  const segments = normalized.split('/');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.includes('?') ||
    normalized.includes('#') ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new PageIdentityValidationError(value, 'source module');
  }
  return normalized as SourceModuleId;
}

export function authoredPageId(sourceModule: string, stableId: string): PageId {
  return `${normalizeSourceModule(sourceModule)}#${validateStablePageId(stableId)}` as PageId;
}

export function legacyPageId(sourceModule: string, componentName: string): PageId {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(componentName)) {
    throw new PageIdentityUnavailableError(
      sourceModule,
      `Legacy page component "${componentName}" has no stable component name.`,
    );
  }
  return `${normalizeSourceModule(sourceModule)}#legacy:${componentName}` as PageId;
}

export function pageIdSource(pageId: string): SourceModuleId {
  const separator = pageId.lastIndexOf('#');
  if (separator <= 0 || separator === pageId.length - 1) {
    throw new PageIdentityValidationError(pageId);
  }
  return normalizeSourceModule(pageId.slice(0, separator));
}

export function pageIdLocalPart(pageId: string): string {
  const separator = pageId.lastIndexOf('#');
  if (separator <= 0 || separator === pageId.length - 1) {
    throw new PageIdentityValidationError(pageId);
  }
  return pageId.slice(separator + 1);
}

export function stablePageIdFromLabel(value: string): StablePageId {
  const slug = value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 54)
    .replace(/-+$/g, '');
  return validateStablePageId(slug || 'page');
}

export function nextDuplicatePageId(
  currentPageId: string,
  existingPageIds: readonly string[],
): { pageId: PageId; stableId: StablePageId } {
  const sourceModule = pageIdSource(currentPageId);
  const local = pageIdLocalPart(currentPageId);
  const authoredBase = local.startsWith('legacy:')
    ? stablePageIdFromLabel(local.slice('legacy:'.length))
    : local.replace(/-copy(?:-\d+)?$/, '');
  const occupied = new Set(existingPageIds);
  const candidateFor = (copyNumber?: number): StablePageId => {
    const suffix = copyNumber === undefined ? '-copy' : `-copy-${copyNumber}`;
    const stem = (authoredBase || 'page').slice(0, 64 - suffix.length).replace(/[._-]+$/g, '');
    return validateStablePageId(`${stem || 'page'}${suffix}`);
  };
  let candidate = candidateFor();
  let copyNumber = 2;
  while (occupied.has(authoredPageId(sourceModule, candidate))) {
    candidate = candidateFor(copyNumber++);
  }
  const stableId = candidate;
  return { pageId: authoredPageId(sourceModule, stableId), stableId };
}

export function isPageIdentityError(value: unknown): value is PageIdentityError {
  return value instanceof PageIdentityError;
}
