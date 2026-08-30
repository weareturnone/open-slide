import { describe, expect, it } from 'vitest';
import {
  brandingHeadTags,
  generateBrandingCss,
  resolveBrandingUrls,
  transformBrandingHtml,
  withBase,
} from './branding.ts';

describe('OpenSlide branding', () => {
  it('resolves public assets against base paths without changing external URLs', () => {
    expect(withBase('/favicon.svg', '/studio/')).toBe('/studio/favicon.svg');
    expect(withBase('./favicon.ico', '/')).toBe('/favicon.ico');
    expect(withBase('https://cdn.example/icon.svg', '/studio/')).toBe(
      'https://cdn.example/icon.svg',
    );

    const resolved = resolveBrandingUrls(
      {
        logo: { src: '/mark.svg' },
        icons: [{ rel: 'icon', href: '/favicon.svg' }],
        manifest: '/site.webmanifest',
        stylesheets: ['/fonts.css'],
      },
      '/studio/',
    );
    expect(resolved.logo?.src).toBe('/studio/mark.svg');
    expect(resolved.icons?.[0].href).toBe('/studio/favicon.svg');
    expect(resolved.manifest).toBe('/studio/site.webmanifest');
    expect(resolved.stylesheets).toEqual(['/studio/fonts.css']);
  });

  it('keeps the unconfigured HTML defaults and replaces them only when configured', () => {
    const source = [
      '<head>',
      '    <link rel="icon" href="./favicon.ico" />',
      '    <title>open-slide</title>',
      '</head>',
    ].join('\n');
    const transformed = transformBrandingHtml(source, {
      appName: 'Acme Studio',
      title: 'Acme <Studio>',
      icons: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
    });

    expect(source).toContain('<title>open-slide</title>');
    expect(source).toContain('./favicon.ico');
    expect(transformed.html).toContain('<title>Acme &lt;Studio&gt;</title>');
    expect(transformed.html).not.toContain('./favicon.ico');
    expect(transformed.tags).toContainEqual({
      tag: 'meta',
      attrs: { name: 'application-name', content: 'Acme Studio' },
      injectTo: 'head',
    });
    expect(transformed.tags).toContainEqual({
      tag: 'link',
      attrs: { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      injectTo: 'head',
    });
  });

  it('emits manifest, stylesheet, and light/dark theme metadata', () => {
    const tags = brandingHeadTags({
      appName: 'Acme',
      description: 'Acme presentations',
      themeColor: { light: '#ffffff', dark: '#111111' },
      manifest: '/site.webmanifest',
      stylesheets: ['/fonts.css'],
    });

    expect(tags).toContainEqual({
      tag: 'meta',
      attrs: {
        name: 'theme-color',
        content: '#ffffff',
        media: '(prefers-color-scheme: light)',
      },
      injectTo: 'head',
    });
    expect(tags).toContainEqual({
      tag: 'link',
      attrs: { rel: 'manifest', href: '/site.webmanifest' },
      injectTo: 'head',
    });
    expect(tags).toContainEqual({
      tag: 'link',
      attrs: { rel: 'stylesheet', href: '/fonts.css' },
      injectTo: 'head',
    });
  });

  it('maps configured font roles and brand colors to application CSS variables', () => {
    const css = generateBrandingCss({
      fonts: {
        body: 'Geist, sans-serif',
        heading: 'Example Display, Geist, sans-serif',
        metadata: 'ui-monospace, monospace',
      },
      colors: {
        light: {
          brand: '#2563eb',
          brandForeground: '#ffffff',
          brandSoft: 'rgb(37 99 235 / 0.12)',
        },
        dark: { brand: '#93c5fd', ring: '#93c5fd' },
      },
    });

    expect(css).toContain('--open-slide-font-heading: Example Display, Geist, sans-serif;');
    expect(css).toContain('--open-slide-font-body: Geist, sans-serif;');
    expect(css).toContain('--open-slide-font-metadata: ui-monospace, monospace;');
    expect(css).toContain('--brand: #2563eb;');
    expect(css).toContain('--chart-1: #2563eb;');
    expect(css).toContain('.dark');
    expect(css).toContain('--brand: #93c5fd;');
  });

  it('rejects multi-declaration CSS values', () => {
    expect(() => generateBrandingCss({ fonts: { body: 'Geist; color: red' } })).toThrow(
      /single CSS value/,
    );
  });
});
