# @open-slide/core

Runtime and CLI for [open-slide](https://github.com/1weiho/open-slide) — a React-based slide framework where you write slides and the framework handles the Vite/React stack, layout, navigation, hot reload, and fullscreen play mode.

## Install

```bash
pnpm add @open-slide/core
```

Most users get this installed automatically by running `npx @open-slide/cli init`. Use this package directly only if you're wiring up an existing workspace by hand.

## What's inside

- **Runtime** — home page, slide viewer, thumbnail rail, keyboard navigation, and fullscreen presenter mode. Every slide renders into a fixed **1920×1080** canvas; the framework scales it.
- **Vite plugin** — discovers `slides/<id>/index.{tsx,jsx,ts,js}`, exposes them via virtual modules, and reloads when slides are added or removed.
- **CLI** — `open-slide dev | build | preview` so workspaces never need to touch Vite, React, or tsconfig directly.

## CLI

Once installed, the `open-slide` bin is available in the workspace:

| Command | Description |
| --- | --- |
| `open-slide dev` | Start the dev server. Flags: `-p, --port <port>`, `--host [host]`, `--open`. |
| `open-slide build` | Build a static site. Flags: `--out-dir <dir>` (defaults to `dist`). |
| `open-slide preview` | Preview the production build. Flags: `-p, --port <port>`, `--host [host]`, `--open`. |

## Config

Create `open-slide.config.ts` in the workspace root (all fields optional):

```ts
import type { OpenSlideConfig } from '@open-slide/core';

const openSlideConfig: OpenSlideConfig = {
  slidesDir: 'slides',
  port: 5173,
};

export default openSlideConfig;
```

### Hosting under a subpath

Set `base` to deploy the built site under a sub-directory (intranet folders, GitHub Pages project sites, reverse proxies). Use a leading and trailing slash:

```ts
const openSlideConfig: OpenSlideConfig = {
  base: '/my-slides/',
};
```

The value is passed straight to Vite's `base` and to React Router's `basename`, so client-side navigation matches the deployed path.

## Authoring slides

Slides live under `slides/<kebab-case-id>/index.{tsx,jsx,ts,js}` and default-export an array of
`Page` components. When more than one entry extension exists in a folder, OpenSlide selects the
first in this order: `.tsx`, `.jsx`, `.ts`, `.js`. The selected filename, including its extension,
is part of every page ID.

Use `page()` to give each authored occurrence a persistent identity:

```tsx
import { page, type Page } from '@open-slide/core';

const Cover: Page = () => (
  <div className="flex h-full w-full items-center justify-center">
    <h1 className="text-[120px] font-bold">Hello, open-slide</h1>
  </div>
);

const pages: Page[] = [page('cover', Cover)];
export default pages;

export const meta = { title: 'Hello' };
```

Plain arrays such as `[Cover]` remain compatible. A unique named component gets a stable legacy
fallback. Repeating the same legacy component still renders, but editing and structural writes stop
with `PageIdentityCollisionError` until each occurrence is wrapped with a unique `page()` ID. See
[Persistent page occurrence identity](../../docs/page-occurrence-identity.md) for migration details.

The page-array source grammar is deliberately narrow. OpenSlide accepts an inline default-exported
array, or one top-level `const` initialized directly with an array and then default-exported by
name. Parentheses, TypeScript `as`, and `satisfies` wrappers are allowed. A `page()` call is authored
only when its callee is a value import from `@open-slide/core`; named aliases and namespace imports
work. A local function named `page`, a type-only import, or a similarly named export from another
package does not establish identity. Mutable, imported, reassigned, shadowed, sparse, or spread page
arrays render only outside identity-dependent source operations; the writer refuses to guess how to
rewrite them.

## Exports

```ts
import {
  CANVAS_WIDTH,   // 1920
  CANVAS_HEIGHT,  // 1080
  MorphElement,   // match or fade objects across pages for morph transitions
  type Page,
  type SlideMeta,
  type SlideModule,
  type SlideTransition,
  type OpenSlideConfig,
} from '@open-slide/core';
```

The Vite plugin is exposed under a subpath for advanced setups:

```ts
import { createViteConfig } from '@open-slide/core/vite';
```

## License

MIT
