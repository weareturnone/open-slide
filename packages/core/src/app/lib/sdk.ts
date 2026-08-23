import type { ComponentType } from 'react';
import type { DesignSystem } from './design.ts';
import type { SlideTransition } from './transition.ts';

export type Page = ComponentType & { transition?: SlideTransition };

export type ContentKind = 'slide' | 'document';

export type CanvasSize = {
  width: number;
  height: number;
  /** Optional print hint used by document exporters. */
  print?: 'a4';
};

export type SlideMeta = {
  title?: string;
  theme?: string;
  /** ISO 8601 timestamp. Set once at scaffold time; used to sort the slide list. */
  createdAt?: string;
  /** Slides remain the default so existing decks need no migration. */
  kind?: ContentKind;
  /** Logical authoring canvas. Defaults to the original 1920 x 1080 slide canvas. */
  canvas?: CanvasSize;
};

export type SlideModule = {
  default: Page[];
  meta?: SlideMeta;
  design?: DesignSystem;
  // Index-aligned with `default`.
  notes?: (string | undefined)[];
  transition?: SlideTransition;
};

export type FolderIcon = { type: 'emoji'; value: string } | { type: 'color'; value: string };

export type Folder = {
  id: string;
  name: string;
  icon: FolderIcon;
};

export type FoldersManifest = {
  folders: Folder[];
  assignments: Record<string, string>;
};

export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;
export const A4_CANVAS_WIDTH = 794;
export const A4_CANVAS_HEIGHT = 1123;

export function canvasSizeFor(module: Pick<SlideModule, 'meta'> | null | undefined): CanvasSize {
  const canvas = module?.meta?.canvas;
  if (
    canvas &&
    Number.isFinite(canvas.width) &&
    Number.isFinite(canvas.height) &&
    canvas.width > 0 &&
    canvas.height > 0
  ) {
    return canvas;
  }
  return { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
}
