import type { Page, SlideMeta } from '@open-slide/core';

export const meta: SlideMeta = {
  title: 'A4 Report',
  createdAt: '2026-01-04T00:00:00.000Z',
  kind: 'document',
  canvas: {
    width: 794,
    height: 1123,
    print: 'a4',
  },
};

const pageStyle = {
  width: '100%',
  height: '100%',
  background: '#f8f5ee',
  color: '#201d18',
  padding: 72,
  fontFamily: 'system-ui, sans-serif',
} as const;

const Cover: Page = () => (
  <article style={pageStyle}>
    <p style={{ fontSize: 18, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
      Native document fixture
    </p>
    <h1 style={{ fontSize: 72, lineHeight: 1.05, margin: '180px 0 0' }}>A4 report page</h1>
  </article>
);

export default [Cover] satisfies Page[];
