import { describe, expect, it } from 'vitest';
import { normalizeSourceModule, PageIdentityValidationError } from './page-identity.ts';

describe('normalizeSourceModule', () => {
  it.each([
    'C:\\repo\\slides\\deck\\index.tsx',
    'C:repo\\slides\\deck\\index.tsx',
    'D:',
    '/repo/slides/deck/index.tsx',
    '../slides/deck/index.tsx',
    './slides/deck/index.tsx',
    'slides//deck/index.tsx',
    'slides/deck/index.tsx?raw',
    'slides/deck/index.tsx#cover',
  ])('rejects non-canonical source path %s', (value) => {
    expect(() => normalizeSourceModule(value)).toThrow(PageIdentityValidationError);
  });

  it('normalizes separators only after an input passes absolute-path checks', () => {
    expect(normalizeSourceModule('slides\\deck\\index.jsx')).toBe('slides/deck/index.jsx');
  });
});
