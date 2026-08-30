import type * as t from '@babel/types';
import {
  authoredPageId,
  legacyPageId,
  normalizeSourceModule,
  type PageId,
  PageIdentityCollisionError,
  PageIdentityError,
  PageIdentityUnavailableError,
  PageIdentityValidationError,
  type SourceModuleId,
  type StablePageId,
  validateStablePageId,
} from '../app/lib/page-identity.ts';
import {
  analyzePageSource,
  isPageFactoryCall,
  type PageSourceAnalysis,
  unwrapPageExpression,
} from './page-source-analysis.ts';

export type SourcePageOccurrence = {
  readonly id: PageId | null;
  readonly authored: boolean;
  readonly stableId: StablePageId | null;
  readonly componentName: string | null;
  readonly start: number;
  readonly end: number;
  readonly stableIdStart: number | null;
  readonly stableIdEnd: number | null;
};

export type SourcePageIdentityResolution = {
  readonly sourceModule: SourceModuleId;
  readonly occurrences: readonly SourcePageOccurrence[];
  readonly error: PageIdentityError | null;
};

function sourceOccurrence(
  source: string,
  node: t.Expression,
  sourceModule: SourceModuleId,
  analysis: PageSourceAnalysis,
): SourcePageOccurrence | PageIdentityError {
  const expression = unwrapPageExpression(node) ?? node;
  const start = expression.start;
  const end = expression.end;
  if (typeof start !== 'number' || typeof end !== 'number') {
    return new PageIdentityUnavailableError(sourceModule, 'A page source range is unavailable.');
  }

  if (isPageFactoryCall(expression, analysis)) {
    const args = expression.arguments;
    const idArg = unwrapPageExpression(args[0]);
    const componentArg = unwrapPageExpression(args[1]);
    if (
      args.length !== 2 ||
      args.some(
        (argument) => argument.type === 'SpreadElement' || argument.type === 'ArgumentPlaceholder',
      ) ||
      !idArg ||
      idArg.type !== 'StringLiteral' ||
      typeof idArg.value !== 'string' ||
      !componentArg
    ) {
      return new PageIdentityValidationError(source.slice(start, end));
    }
    let stableId: StablePageId;
    try {
      stableId = validateStablePageId(idArg.value);
    } catch (error) {
      return error instanceof PageIdentityError
        ? error
        : new PageIdentityValidationError(String(idArg.value));
    }
    return {
      id: authoredPageId(sourceModule, stableId),
      authored: true,
      stableId,
      componentName:
        componentArg.type === 'Identifier' && typeof componentArg.name === 'string'
          ? componentArg.name
          : null,
      start,
      end,
      stableIdStart: typeof idArg.start === 'number' ? idArg.start : null,
      stableIdEnd: typeof idArg.end === 'number' ? idArg.end : null,
    };
  }

  if (expression.type === 'Identifier' && typeof expression.name === 'string') {
    return {
      id: legacyPageId(sourceModule, expression.name),
      authored: false,
      stableId: null,
      componentName: expression.name,
      start,
      end,
      stableIdStart: null,
      stableIdEnd: null,
    };
  }

  return new PageIdentityUnavailableError(
    sourceModule,
    `Legacy page expression "${source.slice(start, end)}" has no stable component name.`,
  );
}

export function resolvePageIdentitiesInSource(
  source: string,
  sourceModuleValue: string,
): SourcePageIdentityResolution {
  let sourceModule: SourceModuleId;
  try {
    sourceModule = normalizeSourceModule(sourceModuleValue);
  } catch (error) {
    return {
      sourceModule: sourceModuleValue as SourceModuleId,
      occurrences: [],
      error:
        error instanceof PageIdentityError
          ? error
          : new PageIdentityValidationError(sourceModuleValue, 'source module'),
    };
  }

  const analyzed = analyzePageSource(source);
  if (!analyzed.ok) {
    return {
      sourceModule,
      occurrences: [],
      error: new PageIdentityUnavailableError(sourceModule, analyzed.reason),
    };
  }

  const occurrences: SourcePageOccurrence[] = [];
  let firstError: PageIdentityError | null = null;
  for (const element of analyzed.value.elements) {
    const occurrence = sourceOccurrence(source, element.node, sourceModule, analyzed.value);
    if (occurrence instanceof PageIdentityError) {
      firstError ??= occurrence;
      occurrences.push({
        id: null,
        authored: false,
        stableId: null,
        componentName: null,
        start: element.start,
        end: element.end,
        stableIdStart: null,
        stableIdEnd: null,
      });
    } else {
      occurrences.push(occurrence);
    }
  }

  const counts = new Map<string, number>();
  for (const occurrence of occurrences) {
    if (occurrence.id) counts.set(occurrence.id, (counts.get(occurrence.id) ?? 0) + 1);
  }
  const collisions = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  const collision =
    collisions.length > 0 ? new PageIdentityCollisionError(sourceModule, collisions) : null;
  return { sourceModule, occurrences, error: collision ?? firstError };
}

export function sourcePageOccurrencesOrThrow(
  source: string,
  sourceModule: string,
): Array<SourcePageOccurrence & { id: PageId }> {
  const resolution = resolvePageIdentitiesInSource(source, sourceModule);
  if (resolution.error) throw resolution.error;
  if (resolution.occurrences.some((occurrence) => occurrence.id === null)) {
    throw new PageIdentityUnavailableError(sourceModule, 'Page identities are unavailable.');
  }
  return resolution.occurrences as Array<SourcePageOccurrence & { id: PageId }>;
}
