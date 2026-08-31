import { parse as babelParse } from '@babel/parser';
import type * as t from '@babel/types';

export type PageFactoryBinding = {
  readonly reference: string;
  readonly localName: string;
  readonly kind: 'named' | 'namespace';
  readonly start: number;
};

export type PageArrayElement = {
  readonly node: t.Expression;
  readonly start: number;
  readonly end: number;
};

export type PageSourceAnalysis = {
  readonly ast: t.File;
  readonly array: t.ArrayExpression;
  readonly arrayStart: number;
  readonly arrayEnd: number;
  readonly elements: readonly PageArrayElement[];
  readonly pageFactories: readonly PageFactoryBinding[];
};

export type PageSourceAnalysisResult =
  | { readonly ok: true; readonly value: PageSourceAnalysis }
  | { readonly ok: false; readonly reason: string };

type NodeWithRange = t.Node & { start: number; end: number };

export function unwrapPageExpression(node: t.Node | null | undefined): t.Node | undefined {
  let current = node ?? undefined;
  while (
    current?.type === 'TSAsExpression' ||
    current?.type === 'TSSatisfiesExpression' ||
    current?.type === 'TypeCastExpression' ||
    current?.type === 'ParenthesizedExpression' ||
    current?.type === 'TSNonNullExpression'
  ) {
    current = current.expression;
  }
  return current;
}

function parseProgram(source: string): t.File | null {
  try {
    return babelParse(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      errorRecovery: false,
    });
  } catch {
    return null;
  }
}

function nodeRange(node: t.Node): NodeWithRange | null {
  return typeof node.start === 'number' && typeof node.end === 'number'
    ? (node as NodeWithRange)
    : null;
}

function importedName(specifier: t.ImportSpecifier): string | null {
  return specifier.imported.type === 'Identifier'
    ? specifier.imported.name
    : specifier.imported.value;
}

function pageFactoryBindings(ast: t.File): PageFactoryBinding[] {
  const bindings: PageFactoryBinding[] = [];
  for (const statement of ast.program.body) {
    if (statement.type !== 'ImportDeclaration' || statement.source.value !== '@open-slide/core') {
      continue;
    }
    if (statement.importKind === 'type') continue;
    for (const specifier of statement.specifiers) {
      const range = nodeRange(specifier);
      if (!range) continue;
      if (
        specifier.type === 'ImportSpecifier' &&
        specifier.importKind !== 'type' &&
        importedName(specifier) === 'page'
      ) {
        bindings.push({
          reference: specifier.local.name,
          localName: specifier.local.name,
          kind: 'named',
          start: range.start,
        });
      } else if (specifier.type === 'ImportNamespaceSpecifier') {
        bindings.push({
          reference: `${specifier.local.name}.page`,
          localName: specifier.local.name,
          kind: 'namespace',
          start: range.start,
        });
      }
    }
  }
  return bindings.sort((left, right) => left.start - right.start);
}

function declarationsInStatement(
  statement: t.Statement | t.ModuleDeclaration,
): t.VariableDeclaration[] {
  if (statement.type === 'VariableDeclaration') return [statement];
  if (
    statement.type === 'ExportNamedDeclaration' &&
    statement.declaration?.type === 'VariableDeclaration'
  ) {
    return [statement.declaration];
  }
  return [];
}

function identifierPatternName(pattern: t.LVal | t.VoidPattern | null | undefined): string | null {
  return pattern?.type === 'Identifier' ? pattern.name : null;
}

function walk(node: unknown, visit: (value: t.Node) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.type === 'string') visit(node as t.Node);
  for (const [key, value] of Object.entries(record)) {
    if (
      key === 'loc' ||
      key === 'leadingComments' ||
      key === 'trailingComments' ||
      key === 'innerComments' ||
      key === 'tokens' ||
      key === 'comments'
    ) {
      continue;
    }
    walk(value, visit);
  }
}

function bindingIsUnambiguousAndImmutable(
  ast: t.File,
  name: string,
  selected: t.VariableDeclarator,
): boolean {
  let conflictingDeclaration = false;
  let mutation = false;
  let escaped = false;
  const allowedReferences = new Set<t.Identifier>();
  if (selected.id.type === 'Identifier') allowedReferences.add(selected.id);
  for (const statement of ast.program.body) {
    if (statement.type !== 'ExportDefaultDeclaration') continue;
    const exported = unwrapPageExpression(statement.declaration);
    if (exported?.type === 'Identifier' && exported.name === name) {
      allowedReferences.add(exported);
    }
  }
  walk(ast.program, (node) => {
    if (node.type === 'Identifier' && node.name === name && !allowedReferences.has(node)) {
      escaped = true;
    }
    if (node.type === 'VariableDeclarator' && node !== selected) {
      if (identifierPatternName(node.id) === name) conflictingDeclaration = true;
      return;
    }
    if (
      (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') &&
      node.id?.name === name
    ) {
      conflictingDeclaration = true;
      return;
    }
    if (node.type === 'ImportSpecifier' || node.type === 'ImportDefaultSpecifier') {
      if (node.local.name === name) conflictingDeclaration = true;
      return;
    }
    if (node.type === 'ImportNamespaceSpecifier' && node.local.name === name) {
      conflictingDeclaration = true;
      return;
    }
    if (node.type === 'AssignmentExpression') {
      const left = unwrapPageExpression(node.left);
      if (left?.type === 'Identifier' && left.name === name) mutation = true;
      if (left?.type === 'MemberExpression') {
        const object = unwrapPageExpression(left.object);
        if (object?.type === 'Identifier' && object.name === name) mutation = true;
      }
      return;
    }
    if (node.type === 'UpdateExpression') {
      const argument = unwrapPageExpression(node.argument);
      if (argument?.type === 'Identifier' && argument.name === name) mutation = true;
      return;
    }
    if (node.type === 'UnaryExpression' && node.operator === 'delete') {
      const argument = unwrapPageExpression(node.argument);
      if (argument?.type === 'MemberExpression') {
        const object = unwrapPageExpression(argument.object);
        if (object?.type === 'Identifier' && object.name === name) mutation = true;
      }
      return;
    }
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const callee = unwrapPageExpression(node.callee);
      if (callee?.type === 'MemberExpression' || callee?.type === 'OptionalMemberExpression') {
        const object = unwrapPageExpression(callee.object);
        if (object?.type === 'Identifier' && object.name === name) mutation = true;
      }
    }
  });
  return !conflictingDeclaration && !mutation && !escaped;
}

function resolveArray(ast: t.File): t.ArrayExpression | string {
  const defaults = ast.program.body.filter(
    (statement): statement is t.ExportDefaultDeclaration =>
      statement.type === 'ExportDefaultDeclaration',
  );
  if (defaults.length !== 1) return 'The module must have exactly one default export.';
  const declaration = unwrapPageExpression(defaults[0].declaration);
  if (declaration?.type === 'ArrayExpression') return declaration;
  if (declaration?.type !== 'Identifier') {
    return 'The default export must be an inline array or an immutable top-level array binding.';
  }

  const matches: Array<{ declaration: t.VariableDeclaration; item: t.VariableDeclarator }> = [];
  for (const statement of ast.program.body) {
    for (const variable of declarationsInStatement(statement)) {
      for (const item of variable.declarations) {
        if (identifierPatternName(item.id) === declaration.name) {
          matches.push({ declaration: variable, item });
        }
      }
    }
  }
  if (matches.length !== 1 || matches[0].declaration.kind !== 'const') {
    return 'The exported page array binding must be one unambiguous top-level const.';
  }
  const selected = matches[0].item;
  if (!bindingIsUnambiguousAndImmutable(ast, declaration.name, selected)) {
    return 'The exported page array binding must not be shadowed, reassigned, mutated, aliased, or passed to another function.';
  }
  const initializer = unwrapPageExpression(selected.init);
  if (initializer?.type !== 'ArrayExpression') {
    return 'The exported page array binding must be initialized directly with an array.';
  }
  return initializer;
}

export function analyzePageSource(source: string): PageSourceAnalysisResult {
  const ast = parseProgram(source);
  if (!ast) return { ok: false, reason: 'The page source is not valid TypeScript/JavaScript.' };
  const resolved = resolveArray(ast);
  if (typeof resolved === 'string') return { ok: false, reason: resolved };
  const arrayRange = nodeRange(resolved);
  if (!arrayRange) return { ok: false, reason: 'The page array source range is unavailable.' };

  const elements: PageArrayElement[] = [];
  for (const raw of resolved.elements) {
    if (!raw || raw.type === 'SpreadElement') {
      return { ok: false, reason: 'The page array cannot contain holes or spread elements.' };
    }
    const unwrapped = unwrapPageExpression(raw);
    if (
      !unwrapped ||
      unwrapped.type === 'JSXNamespacedName' ||
      unwrapped.type === 'ArgumentPlaceholder'
    ) {
      return { ok: false, reason: 'A page array element is not a supported expression.' };
    }
    const range = nodeRange(unwrapped);
    if (!range) return { ok: false, reason: 'A page element source range is unavailable.' };
    elements.push({ node: unwrapped as t.Expression, start: range.start, end: range.end });
  }

  return {
    ok: true,
    value: {
      ast,
      array: resolved,
      arrayStart: arrayRange.start,
      arrayEnd: arrayRange.end,
      elements,
      pageFactories: pageFactoryBindings(ast),
    },
  };
}

export function isPageFactoryCall(
  node: t.Node | null | undefined,
  analysis: PageSourceAnalysis,
): node is t.CallExpression {
  const expression = unwrapPageExpression(node);
  if (expression?.type !== 'CallExpression' || expression.optional) return false;
  const callee = unwrapPageExpression(expression.callee);
  if (callee?.type === 'Identifier') {
    return analysis.pageFactories.some(
      (binding) => binding.kind === 'named' && binding.localName === callee.name,
    );
  }
  if (callee?.type !== 'MemberExpression' || callee.computed || callee.optional) return false;
  const object = unwrapPageExpression(callee.object);
  return (
    object?.type === 'Identifier' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'page' &&
    analysis.pageFactories.some(
      (binding) => binding.kind === 'namespace' && binding.localName === object.name,
    )
  );
}

function allIdentifierNames(ast: t.File): Set<string> {
  const names = new Set<string>();
  walk(ast.program, (node) => {
    if (node.type === 'Identifier') names.add(node.name);
  });
  return names;
}

export function ensurePageFactoryBindingInSource(
  source: string,
): { source: string; reference: string } | null {
  const ast = parseProgram(source);
  if (!ast) return null;
  const existing = pageFactoryBindings(ast)[0];
  if (existing) return { source, reference: existing.reference };

  const names = allIdentifierNames(ast);
  let localName = 'page';
  if (names.has(localName)) {
    localName = 'openSlidePage';
    let suffix = 2;
    while (names.has(localName)) localName = `openSlidePage${suffix++}`;
  }
  const specifier = localName === 'page' ? 'page' : `page as ${localName}`;
  const importStatement = `import { ${specifier} } from '@open-slide/core';`;
  let insertionPoint = ast.program.interpreter?.end ?? 0;
  for (const directive of ast.program.directives) {
    if (typeof directive.end === 'number') insertionPoint = directive.end;
  }
  for (const statement of ast.program.body) {
    if (statement.type !== 'ImportDeclaration') break;
    if (typeof statement.end === 'number') insertionPoint = statement.end;
  }
  const before = source.slice(0, insertionPoint);
  const after = source.slice(insertionPoint);
  const leadingNewline = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
  const trailingNewline = after.startsWith('\n') ? '' : '\n';
  return {
    source: `${before}${leadingNewline}${importStatement}${trailingNewline}${after}`,
    reference: localName,
  };
}
