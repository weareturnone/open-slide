import path from 'node:path';
import { parse as babelParse } from '@babel/parser';
import * as t from '@babel/types';
import type { Plugin } from 'vite';
import { walkAll, walkJsx } from '../editing/babel-walk.ts';
import { targetFingerprint } from '../editing/target-fingerprint.ts';

// Inject `data-slide-loc="<line>:<col>"` onto every host JSX element in
// slide source files so the inspector can map a click straight to a
// source location, sidestepping HMR-stale `_debugSource` on fibers.

// Capitalized components that explicitly forward `data-slide-loc` to a
// host root, so the inspector can target them like a host element.
const BUILT_IN_FORWARDING_COMPONENTS = new Set(['ImagePlaceholder']);

function isTaggableJsxName(
  name: t.JSXOpeningElement['name'],
  forwardingComponents: Set<string>,
): name is t.JSXIdentifier {
  if (!t.isJSXIdentifier(name)) return false;
  return /^[a-z]/.test(name.name) || forwardingComponents.has(name.name);
}

type ForwardedComponentProps = {
  restName: string;
  styleName: string | null;
};

function forwardedComponentProps(
  fn: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression,
): ForwardedComponentProps | null {
  let props: t.Node | undefined = fn.params[0];
  if (t.isAssignmentPattern(props)) props = props.left;
  if (!t.isObjectPattern(props)) return null;
  let restName: string | null = null;
  let styleName: string | null = null;
  for (const property of props.properties) {
    if (t.isRestElement(property) && t.isIdentifier(property.argument)) {
      restName = property.argument.name;
      continue;
    }
    if (!t.isObjectProperty(property) || property.computed) continue;
    const key = t.isIdentifier(property.key)
      ? property.key.name
      : t.isStringLiteral(property.key)
        ? property.key.value
        : null;
    if (key === 'data-slide-loc') return null;
    if (key !== 'style') continue;
    if (t.isIdentifier(property.value)) styleName = property.value.name;
    else if (t.isAssignmentPattern(property.value) && t.isIdentifier(property.value.left)) {
      styleName = property.value.left.name;
    } else {
      return null;
    }
  }
  return restName ? { restName, styleName } : null;
}

function hostForwardsStyle(
  opening: t.JSXOpeningElement,
  forwarded: ForwardedComponentProps,
): boolean {
  const restIndex = opening.attributes.findIndex(
    (attribute) =>
      t.isJSXSpreadAttribute(attribute) &&
      t.isIdentifier(attribute.argument) &&
      attribute.argument.name === forwarded.restName,
  );
  if (restIndex < 0) return false;
  const laterAttributes = opening.attributes.slice(restIndex + 1);
  if (
    laterAttributes.some(
      (attribute) =>
        t.isJSXSpreadAttribute(attribute) ||
        (t.isJSXAttribute(attribute) &&
          t.isJSXIdentifier(attribute.name) &&
          attribute.name.name === 'data-slide-loc'),
    )
  ) {
    return false;
  }
  if (forwarded.styleName === null) {
    return !laterAttributes.some(
      (attribute) =>
        t.isJSXAttribute(attribute) &&
        t.isJSXIdentifier(attribute.name) &&
        attribute.name.name === 'style',
    );
  }
  const style = opening.attributes.find(
    (attribute): attribute is t.JSXAttribute =>
      t.isJSXAttribute(attribute) &&
      t.isJSXIdentifier(attribute.name) &&
      attribute.name.name === 'style',
  );
  const expression =
    style?.value && t.isJSXExpressionContainer(style.value) ? style.value.expression : null;
  if (t.isIdentifier(expression) && expression.name === forwarded.styleName) return true;
  if (!t.isObjectExpression(expression)) return false;
  const last = expression.properties[expression.properties.length - 1];
  return (
    t.isSpreadElement(last) &&
    t.isIdentifier(last.argument) &&
    last.argument.name === forwarded.styleName
  );
}

function forwardsEditablePropsToOneHost(
  fn: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression,
  forwarded: ForwardedComponentProps,
): boolean {
  let restUses = 0;
  let forwardedHost: t.JSXOpeningElement | null = null;
  let nestedUse = false;
  walkJsx(fn.body, (node) => {
    if (!t.isJSXElement(node) || !t.isJSXIdentifier(node.openingElement.name)) return;
    const uses = node.openingElement.attributes.filter(
      (attribute) =>
        t.isJSXSpreadAttribute(attribute) &&
        t.isIdentifier(attribute.argument) &&
        attribute.argument.name === forwarded.restName,
    ).length;
    if (uses === 0) return;
    walkAll(fn.body, (candidate) => {
      if (
        (t.isFunctionDeclaration(candidate) ||
          t.isFunctionExpression(candidate) ||
          t.isArrowFunctionExpression(candidate)) &&
        (candidate.start ?? 0) <= (node.start ?? 0) &&
        (candidate.end ?? 0) >= (node.end ?? 0)
      ) {
        nestedUse = true;
        return 'stop';
      }
    });
    restUses += uses;
    if (/^[a-z]/.test(node.openingElement.name.name)) forwardedHost = node.openingElement;
  });
  return (
    !nestedUse &&
    restUses === 1 &&
    forwardedHost !== null &&
    hostForwardsStyle(forwardedHost, forwarded)
  );
}

function collectForwardingComponents(ast: t.File): Set<string> {
  const components = new Set(BUILT_IN_FORWARDING_COMPONENTS);
  const localComponents = new Map<string, boolean[]>();
  walkAll(ast, (node) => {
    let name: string | null = null;
    let fn: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression | null = null;
    if (t.isFunctionDeclaration(node) && node.id) {
      name = node.id.name;
      fn = node;
    } else if (
      t.isVariableDeclarator(node) &&
      t.isIdentifier(node.id) &&
      (t.isFunctionExpression(node.init) || t.isArrowFunctionExpression(node.init))
    ) {
      name = node.id.name;
      fn = node.init;
    }
    if (!name || !fn || !/^[A-Z]/.test(name)) return;
    const forwarded = forwardedComponentProps(fn);
    const declarations = localComponents.get(name) ?? [];
    declarations.push(Boolean(forwarded && forwardsEditablePropsToOneHost(fn, forwarded)));
    localComponents.set(name, declarations);
  });
  for (const [name, declarations] of localComponents) {
    components.delete(name);
    if (declarations.length === 1 && declarations[0]) components.add(name);
  }
  return components;
}

function hasAttribute(opening: t.JSXOpeningElement, name: string): boolean {
  return opening.attributes.some(
    (attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === name,
  );
}

export function injectLocTags(code: string): string | null {
  let ast: t.File;
  try {
    ast = babelParse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      errorRecovery: true,
    });
  } catch {
    return null;
  }

  const forwardingComponents = collectForwardingComponents(ast);
  const insertions: { offset: number; text: string }[] = [];
  walkJsx(ast, (node) => {
    if (!t.isJSXElement(node) || !node.loc) return;
    const opening = node.openingElement;
    const name = opening.name;
    if (!isTaggableJsxName(name, forwardingComponents)) return;
    const attributes: string[] = [];
    if (!hasAttribute(opening, 'data-slide-loc')) {
      attributes.push(`data-slide-loc="${node.loc.start.line}:${node.loc.start.column}"`);
    }
    if (!hasAttribute(opening, 'data-slide-target')) {
      attributes.push(
        `data-slide-target="${targetFingerprint(code, node.start ?? 0, node.end ?? 0)}"`,
      );
    }
    if (attributes.length === 0) return;
    insertions.push({
      offset: name.end ?? 0,
      text: ` ${attributes.join(' ')}`,
    });
  });

  if (insertions.length === 0) return null;
  insertions.sort((a, b) => b.offset - a.offset);
  let next = code;
  for (const ins of insertions) {
    next = next.slice(0, ins.offset) + ins.text + next.slice(ins.offset);
  }
  return next;
}

export type LocTagsPluginOptions = {
  userCwd: string;
  slidesDir?: string;
  documentsDir?: string;
};

// Vite normally hands `id` to plugins with forward slashes, but other
// plugins or virtual modules can pass through Windows-style paths.
// Compare both sides in POSIX shape so the match doesn't depend on
// which separator the caller happened to use.
function isSlideSourceFile(id: string, slidesRootPosix: string): boolean {
  const filePath = id.split(/[?#]/)[0].replace(/\\/g, '/');
  if (!filePath.startsWith(`${slidesRootPosix}/`)) return false;
  if (!filePath.endsWith('.tsx')) return false;
  if (filePath.endsWith('.d.ts') || filePath.endsWith('.test.tsx')) return false;
  const rel = filePath.slice(slidesRootPosix.length + 1);
  return rel.includes('/');
}

export function locTagsPlugin(opts: LocTagsPluginOptions): Plugin {
  const slidesRoot = path.resolve(opts.userCwd, opts.slidesDir ?? 'slides').replace(/\\/g, '/');
  const documentsRoot = path
    .resolve(opts.userCwd, opts.documentsDir ?? 'documents')
    .replace(/\\/g, '/');
  return {
    name: 'open-slide:loc-tags',
    // Must run before @vitejs/plugin-react so the JSX transform
    // sees our injected attributes.
    enforce: 'pre',
    transform(code, id) {
      if (!isSlideSourceFile(id, slidesRoot) && !isSlideSourceFile(id, documentsRoot)) return null;
      const next = injectLocTags(code);
      if (next === null) return null;
      return { code: next, map: null };
    },
  };
}
