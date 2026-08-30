import type { Page, SlideMeta } from '@open-slide/core';
import type { CSSProperties } from 'react';

export const meta: SlideMeta = {
  title: 'Edit Target',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const fill = {
  width: '100%',
  height: '100%',
  background: '#1a1408',
  color: '#f5ead2',
  padding: 120,
  fontFamily: 'system-ui, sans-serif',
} as const;

const cropImage =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400"%3E%3Crect width="800" height="400" fill="%23c84a2f"/%3E%3C/svg%3E';

const portraitCropImage =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="800" viewBox="0 0 400 800"%3E%3Crect width="400" height="800" fill="%232f6fc8"/%3E%3C/svg%3E';

type SharedCropImageProps = {
  src: string;
  alt: string;
  style?: CSSProperties;
  'data-slide-loc'?: string;
};

const SharedCropImage = ({ src, alt, style, ...imageProps }: SharedCropImageProps) => (
  <img
    src={src}
    alt={alt}
    {...imageProps}
    style={{ width: 400, height: 300, objectFit: 'cover', ...style }}
  />
);

const NestedProvenanceLeaf = ({ label }: { label: string }) => (
  <span data-provenance-label={label}>{label}</span>
);

const NestedProvenanceCard = ({ label }: { label: string }) => (
  <NestedProvenanceLeaf label={label} />
);

const Only: Page = () => (
  <div style={fill}>
    <h1 style={{ fontSize: 96, margin: 0 }}>Editable headline</h1>
    <p style={{ fontSize: 40 }}>Editable body copy</p>
    <img
      src={cropImage}
      alt="Crop target"
      style={{ width: 400, height: 300, objectFit: 'cover' }}
    />
    <div style={{ display: 'flex', gap: 24 }}>
      <SharedCropImage src={cropImage} alt="Shared crop landscape" />
      <SharedCropImage src={portraitCropImage} alt="Shared crop portrait" />
    </div>
    <div style={{ display: 'flex', gap: 24, fontSize: 24 }}>
      <NestedProvenanceCard label="Nested provenance left" />
      <NestedProvenanceCard label="Nested provenance right" />
    </div>
  </div>
);

export default [Only] satisfies Page[];
