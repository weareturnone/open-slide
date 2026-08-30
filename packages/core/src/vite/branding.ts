import type {
  OpenSlideBrandingColors,
  OpenSlideBrandingConfig,
  OpenSlideBrandingIcon,
} from '../config.ts';

type HtmlTag = {
  tag: string;
  attrs?: Record<string, string>;
  injectTo: 'head';
};

const DEFAULT_TITLE = '<title>open-slide</title>';
const DEFAULT_ICON = '    <link rel="icon" href="./favicon.ico" />\n';

function externalUrl(href: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href);
}

export function withBase(href: string, base = '/'): string {
  if (externalUrl(href)) return href;
  const normalizedBase = `/${base.replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '');
  const normalizedHref = href.replace(/^\.?\//, '');
  return `${normalizedBase}/${normalizedHref}` || '/';
}

function resolveIcon(icon: OpenSlideBrandingIcon, base: string): OpenSlideBrandingIcon {
  return { ...icon, href: withBase(icon.href, base) };
}

export function resolveBrandingUrls(
  branding: OpenSlideBrandingConfig,
  base = '/',
): OpenSlideBrandingConfig {
  return {
    ...branding,
    ...(branding.logo
      ? { logo: { ...branding.logo, src: withBase(branding.logo.src, base) } }
      : {}),
    ...(branding.icons ? { icons: branding.icons.map((icon) => resolveIcon(icon, base)) } : {}),
    ...(branding.manifest ? { manifest: withBase(branding.manifest, base) } : {}),
    ...(branding.stylesheets
      ? { stylesheets: branding.stylesheets.map((href) => withBase(href, base)) }
      : {}),
  };
}

function tag(tagName: string, attrs: Record<string, string>): HtmlTag {
  return { tag: tagName, attrs, injectTo: 'head' };
}

export function brandingHeadTags(branding: OpenSlideBrandingConfig): HtmlTag[] {
  const tags: HtmlTag[] = [];
  const appName = branding.appName?.trim();

  if (appName) {
    tags.push(tag('meta', { name: 'application-name', content: appName }));
    tags.push(tag('meta', { name: 'apple-mobile-web-app-title', content: appName }));
  }
  if (branding.description?.trim()) {
    tags.push(tag('meta', { name: 'description', content: branding.description.trim() }));
  }
  if (typeof branding.themeColor === 'string') {
    tags.push(tag('meta', { name: 'theme-color', content: branding.themeColor }));
  } else if (branding.themeColor) {
    tags.push(
      tag('meta', {
        name: 'theme-color',
        content: branding.themeColor.light,
        media: '(prefers-color-scheme: light)',
      }),
    );
    if (branding.themeColor.dark) {
      tags.push(
        tag('meta', {
          name: 'theme-color',
          content: branding.themeColor.dark,
          media: '(prefers-color-scheme: dark)',
        }),
      );
    }
  }
  for (const icon of branding.icons ?? []) {
    const { rel, href, ...optional } = icon;
    const attrs = Object.fromEntries(
      Object.entries({ rel, href, ...optional }).filter((entry): entry is [string, string] => {
        return typeof entry[1] === 'string';
      }),
    );
    tags.push(tag('link', attrs));
  }
  if (branding.manifest) tags.push(tag('link', { rel: 'manifest', href: branding.manifest }));
  for (const href of branding.stylesheets ?? []) {
    tags.push(tag('link', { rel: 'stylesheet', href }));
  }
  return tags;
}

function escapeHtmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function transformBrandingHtml(
  html: string,
  branding: OpenSlideBrandingConfig,
  base = '/',
): { html: string; tags: HtmlTag[] } {
  const resolved = resolveBrandingUrls(branding, base);
  const appName = resolved.appName?.trim() || 'open-slide';
  const title = resolved.title?.trim() || appName;
  let transformed = html.replace(DEFAULT_TITLE, `<title>${escapeHtmlText(title)}</title>`);
  if (resolved.icons) transformed = transformed.replace(DEFAULT_ICON, '');
  return { html: transformed, tags: brandingHeadTags(resolved) };
}

function safeCssValue(value: string, label: string): string {
  if (/[;{}\r\n]/.test(value)) {
    throw new Error(`OpenSlide branding ${label} must be a single CSS value.`);
  }
  return value;
}

function paletteDeclarations(colors: OpenSlideBrandingColors): string[] {
  const declarations: string[] = [];
  const add = (property: string, value: string | undefined) => {
    if (value) declarations.push(`  ${property}: ${safeCssValue(value, property)};`);
  };
  add('--brand', colors.brand);
  add('--brand-foreground', colors.brandForeground);
  add('--brand-soft', colors.brandSoft);
  add('--ring', colors.ring ?? colors.brand);
  add('--chart-1', colors.brand);
  add('--sidebar-ring', colors.ring ?? colors.brand);
  return declarations;
}

function cssBlock(selector: string, declarations: string[]): string {
  return declarations.length > 0 ? `${selector} {\n${declarations.join('\n')}\n}` : '';
}

export function generateBrandingCss(branding: OpenSlideBrandingConfig | undefined): string {
  if (!branding) return '';
  const root: string[] = [];
  const addFont = (property: string, value: string | undefined) => {
    if (value) root.push(`  ${property}: ${safeCssValue(value, property)};`);
  };
  addFont('--open-slide-font-body', branding.fonts?.body);
  addFont('--open-slide-font-heading', branding.fonts?.heading);
  addFont('--open-slide-font-metadata', branding.fonts?.metadata);
  root.push(...paletteDeclarations(branding.colors?.light ?? {}));

  return [
    cssBlock(':root', root),
    cssBlock('.dark', paletteDeclarations(branding.colors?.dark ?? {})),
  ]
    .filter(Boolean)
    .join('\n\n');
}
