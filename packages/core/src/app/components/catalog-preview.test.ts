import { describe, expect, it } from 'vitest';
import { isTrustedCoBrandPreview } from './catalog-preview-data';

const valid = {
  kind: 'co-brand-lockup',
  variant: 'cover' as const,
  turnOneLogo: 'turnone-primary-black',
  clientMark: 'placeholder',
  background: '#F9FAF8',
  text: '#26251E',
  muted: '#6E6D68',
  border: '#E6E5E0',
  accent: '#F54E00',
};

describe('trusted catalog previews', () => {
  it('accepts the fixed co-brand descriptor', () => {
    expect(isTrustedCoBrandPreview(valid)).toBe(true);
  });

  it('rejects unknown asset keys, URLs, and CSS injection', () => {
    expect(isTrustedCoBrandPreview({ ...valid, turnOneLogo: 'https://example.com/logo.svg' })).toBe(
      false,
    );
    expect(isTrustedCoBrandPreview({ ...valid, clientMark: '<script>' })).toBe(false);
    expect(isTrustedCoBrandPreview({ ...valid, background: 'url(javascript:alert(1))' })).toBe(
      false,
    );
  });
});
