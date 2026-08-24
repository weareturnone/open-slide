export type CatalogPreviewDescriptor = {
  kind?: string;
  variant?: 'cover' | 'content' | 'decision';
  turnOneLogo?: string;
  clientMark?: string;
  background?: string;
  text?: string;
  muted?: string;
  border?: string;
  accent?: string;
};

const SAFE_COLOR = /^#[0-9a-f]{6}$/i;

export function isTrustedCoBrandPreview(
  preview: CatalogPreviewDescriptor | undefined,
): preview is Required<CatalogPreviewDescriptor> {
  return Boolean(
    preview &&
      preview.kind === 'co-brand-lockup' &&
      ['cover', 'content', 'decision'].includes(preview.variant || '') &&
      preview.turnOneLogo === 'turnone-primary-black' &&
      preview.clientMark === 'placeholder' &&
      SAFE_COLOR.test(preview.background || '') &&
      SAFE_COLOR.test(preview.text || '') &&
      SAFE_COLOR.test(preview.muted || '') &&
      SAFE_COLOR.test(preview.border || '') &&
      SAFE_COLOR.test(preview.accent || ''),
  );
}
