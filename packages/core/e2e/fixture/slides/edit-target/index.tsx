import type { Page, SlideMeta } from '@open-slide/core';

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

const Only: Page = () => (
  <div style={fill}>
    <h1 style={{ fontSize: 96, margin: 0 }}>Editable headline</h1>
    <p style={{ fontSize: 40 }}>Editable body copy</p>
    <img
      src={cropImage}
      alt="Crop target"
      style={{ width: 400, height: 300, objectFit: 'cover' }}
    />
  </div>
);

export default [Only] satisfies Page[];
