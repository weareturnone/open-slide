import { createElement } from 'react';
import { type StablePageId, validateStablePageId } from './page-identity.ts';
import type { Page } from './sdk.ts';

const AUTHORED_PAGE = Symbol.for('@open-slide/core/authored-page');

export type AuthoredPageDefinition = {
  readonly stableId: StablePageId;
  readonly component: Page;
};

export type AuthoredPage = Page & {
  readonly [AUTHORED_PAGE]: AuthoredPageDefinition;
};

export function page(stableId: string, component: Page): AuthoredPage {
  const validated = validateStablePageId(stableId);
  if (typeof component !== 'function') {
    throw new TypeError('page() expects a renderable React page component.');
  }

  const Authored = (() => createElement(component)) as unknown as AuthoredPage;
  Object.defineProperties(Authored, {
    [AUTHORED_PAGE]: {
      configurable: false,
      enumerable: false,
      value: { stableId: validated, component } satisfies AuthoredPageDefinition,
      writable: false,
    },
    displayName: {
      configurable: true,
      value: component.displayName || component.name || `Page(${validated})`,
      writable: true,
    },
  });
  Authored.transition = component.transition;
  return Authored;
}

export function authoredPageDefinition(value: Page): AuthoredPageDefinition | null {
  const candidate = value as Partial<AuthoredPage>;
  return candidate[AUTHORED_PAGE] ?? null;
}
