import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

type PageSeed = {
  sourceModule: string;
  componentLocation: string;
  explicitId?: string;
};

type ComponentCallsite = {
  sourceModule: string;
  location: string;
  instanceKey?: string;
};

type ElementSeed = {
  pageId: string;
  sourceModule: string;
  elementLocation: string;
  componentPath: ComponentCallsite[];
  explicitId?: string;
};

function segment(value: string): string {
  return `${value.length}:${value}`;
}

function tuple(kind: string, values: string[]): string {
  return `osd1|${segment(kind)}|${values.map(segment).join('|')}`;
}

function pageIdentity(seed: PageSeed): string {
  return tuple('page', [
    seed.sourceModule,
    seed.explicitId ? `id:${seed.explicitId}` : `component:${seed.componentLocation}`,
  ]);
}

function resolvePageIdentities(
  seeds: PageSeed[],
): { ok: true; identities: string[] } | { ok: false; duplicates: string[] } {
  const identities = seeds.map(pageIdentity);
  const counts = new Map<string, number>();
  for (const identity of identities) counts.set(identity, (counts.get(identity) ?? 0) + 1);
  const duplicates = Array.from(counts)
    .filter(([, count]) => count > 1)
    .map(([identity]) => identity);
  return duplicates.length > 0 ? { ok: false, duplicates } : { ok: true, identities };
}

function elementIdentity(seed: ElementSeed): string {
  const componentPath = seed.componentPath.map((callsite) =>
    tuple('callsite', [
      callsite.sourceModule,
      callsite.location,
      callsite.instanceKey ? `key:${callsite.instanceKey}` : 'key:',
    ]),
  );
  return tuple('element', [
    seed.pageId,
    ...componentPath,
    seed.sourceModule,
    seed.explicitId ? `id:${seed.explicitId}` : `location:${seed.elementLocation}`,
  ]);
}

function identitiesIn(markup: string): string[] {
  return Array.from(markup.matchAll(/data-slide-identity="([^"]+)"/g)).map((match) => match[1]);
}

describe('T-01 identity composition prototype', () => {
  it('keeps unique page identities stable when pages reorder', () => {
    const cover = {
      sourceModule: 'slides/deck/index.tsx',
      componentLocation: 'Cover@10:0',
    };
    const closing = {
      sourceModule: 'slides/deck/index.tsx',
      componentLocation: 'Closing@30:0',
    };
    const original = resolvePageIdentities([cover, closing]);
    const reordered = resolvePageIdentities([closing, cover]);
    expect(original.ok).toBe(true);
    expect(reordered.ok).toBe(true);
    if (!original.ok || !reordered.ok) throw new Error('expected unique page identities');
    expect(reordered.identities).toEqual([original.identities[1], original.identities[0]]);
  });

  it('rejects duplicated component references without per-occurrence page ids', () => {
    const repeated = {
      sourceModule: 'slides/deck/index.tsx',
      componentLocation: 'SharedPage@10:0',
    };
    const result = resolvePageIdentities([repeated, repeated]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected duplicate page identity rejection');
    expect(result.duplicates).toEqual([pageIdentity(repeated)]);
  });

  it('distinguishes duplicated page components when both occurrences have explicit ids', () => {
    const first = {
      sourceModule: 'slides/deck/index.tsx',
      componentLocation: 'SharedPage@10:0',
      explicitId: 'shared-page-a',
    };
    const second = { ...first, explicitId: 'shared-page-b' };
    const original = resolvePageIdentities([first, second]);
    const reordered = resolvePageIdentities([second, first]);
    expect(original.ok).toBe(true);
    expect(reordered.ok).toBe(true);
    if (!original.ok || !reordered.ok) throw new Error('expected explicit page identities');
    expect(reordered.identities).toEqual([original.identities[1], original.identities[0]]);
  });

  it('produces equal keys in separate canvas and thumbnail render roots', () => {
    const pageId = pageIdentity({
      sourceModule: 'slides/deck/index.tsx',
      componentLocation: 'Only@20:0',
    });
    const sharedElement = {
      pageId,
      sourceModule: 'slides/deck/index.tsx',
      elementLocation: '8:2',
    };
    const PrototypePage = () =>
      createElement(
        'main',
        null,
        createElement('span', {
          key: 'left',
          'data-slide-identity': elementIdentity({
            ...sharedElement,
            componentPath: [
              {
                sourceModule: 'slides/deck/index.tsx',
                location: '30:4',
              },
            ],
          }),
        }),
        createElement('span', {
          key: 'right',
          'data-slide-identity': elementIdentity({
            ...sharedElement,
            componentPath: [
              {
                sourceModule: 'slides/deck/index.tsx',
                location: '31:4',
              },
            ],
          }),
        }),
      );

    const canvas = identitiesIn(renderToStaticMarkup(createElement(PrototypePage)));
    const thumbnail = identitiesIn(renderToStaticMarkup(createElement(PrototypePage)));
    expect(thumbnail).toEqual(canvas);
    expect(new Set(canvas).size).toBe(2);
  });

  it('distinguishes shared nested elements by their full component call path', () => {
    const base = {
      pageId: pageIdentity({
        sourceModule: 'slides/deck/index.tsx',
        componentLocation: 'Only@20:0',
      }),
      sourceModule: 'slides/deck/components/Leaf.tsx',
      elementLocation: '5:2',
    };
    const inner = {
      sourceModule: 'slides/deck/components/Card.tsx',
      location: '12:4',
    };
    const left = elementIdentity({
      ...base,
      componentPath: [{ sourceModule: 'slides/deck/index.tsx', location: '30:4' }, inner],
    });
    const right = elementIdentity({
      ...base,
      componentPath: [{ sourceModule: 'slides/deck/index.tsx', location: '31:4' }, inner],
    });
    expect(left).not.toBe(right);
  });

  it('uses authored keys instead of map order for repeated instances at one callsite', () => {
    const base = {
      pageId: pageIdentity({
        sourceModule: 'slides/deck/index.tsx',
        componentLocation: 'Only@20:0',
      }),
      sourceModule: 'slides/deck/components/Row.tsx',
      elementLocation: '6:2',
    };
    const identityFor = (instanceKey?: string) =>
      elementIdentity({
        ...base,
        componentPath: [
          {
            sourceModule: 'slides/deck/index.tsx',
            location: '40:6',
            instanceKey,
          },
        ],
      });
    const original = ['alpha', 'beta'].map(identityFor);
    const reordered = ['beta', 'alpha'].map(identityFor);
    expect(reordered).toEqual([original[1], original[0]]);
    expect(new Set(original).size).toBe(2);
    expect(new Set([identityFor(), identityFor()]).size).toBe(1);
  });

  it('keeps an existing element id while using it as the identity anchor', () => {
    const identity = elementIdentity({
      pageId: pageIdentity({
        sourceModule: 'documents/report/index.tsx',
        componentLocation: 'Summary@12:0',
      }),
      sourceModule: 'documents/report/index.tsx',
      elementLocation: '18:2',
      componentPath: [],
      explicitId: 'summary-heading',
    });
    const markup = renderToStaticMarkup(
      createElement('h1', { id: 'summary-heading', 'data-slide-identity': identity }, 'Summary'),
    );
    expect(markup).toContain('id="summary-heading"');
    expect(identitiesIn(markup)).toEqual([identity]);
  });
});
