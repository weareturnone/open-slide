import { parse as babelParse } from '@babel/parser';
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

type AstNode = Record<string, unknown>;

function unwrapExpression(node: AstNode | undefined): AstNode | undefined {
  let current = node;
  while (
    current &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TypeCastExpression' ||
      current.type === 'ParenthesizedExpression')
  ) {
    current = current.expression as AstNode | undefined;
  }
  return current;
}

function parseDefaultExportElements(source: string): AstNode[] | null {
  let ast: unknown;
  try {
    ast = babelParse(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      errorRecovery: false,
    });
  } catch {
    return null;
  }
  const body = (ast as { program?: { body?: AstNode[] } }).program?.body ?? [];
  for (const node of body) {
    if (node.type !== 'ExportDefaultDeclaration') continue;
    const declaration = unwrapExpression(node.declaration as AstNode | undefined);
    if (declaration?.type !== 'ArrayExpression') return null;
    const elements = (declaration.elements as Array<AstNode | null> | undefined) ?? [];
    if (elements.some((element) => !element || element.type === 'SpreadElement')) return null;
    return elements as AstNode[];
  }
  return null;
}

function sourceOccurrence(
  source: string,
  node: AstNode,
  sourceModule: SourceModuleId,
): SourcePageOccurrence | PageIdentityError {
  const expression = unwrapExpression(node) ?? node;
  const start = expression.start;
  const end = expression.end;
  if (typeof start !== 'number' || typeof end !== 'number') {
    return new PageIdentityUnavailableError(sourceModule, 'A page source range is unavailable.');
  }

  if (expression.type === 'CallExpression') {
    const callee = expression.callee as AstNode | undefined;
    const args = (expression.arguments as AstNode[] | undefined) ?? [];
    if (callee?.type === 'Identifier' && callee.name === 'page') {
      const idArg = args[0];
      const componentArg = unwrapExpression(args[1]);
      if (
        args.length !== 2 ||
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

  const elements = parseDefaultExportElements(source);
  if (!elements) {
    return {
      sourceModule,
      occurrences: [],
      error: new PageIdentityUnavailableError(
        sourceModule,
        'The default export must be a page array.',
      ),
    };
  }

  const occurrences: SourcePageOccurrence[] = [];
  let firstError: PageIdentityError | null = null;
  for (const element of elements) {
    const occurrence = sourceOccurrence(source, element, sourceModule);
    if (occurrence instanceof PageIdentityError) {
      firstError ??= occurrence;
      const expression = unwrapExpression(element) ?? element;
      occurrences.push({
        id: null,
        authored: false,
        stableId: null,
        componentName: null,
        start: typeof expression.start === 'number' ? expression.start : 0,
        end: typeof expression.end === 'number' ? expression.end : 0,
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
