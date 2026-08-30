import {
  slideCreatedAt as createdAt,
  documentIds as documents,
  documentCreatedAt as documentsCreatedAt,
  slideIds as ids,
  loadSlide as load,
  loadDocument as loadDoc,
  slideThemes as themes,
} from 'virtual:open-slide/slides';
import type { SlideModule } from './sdk';

export const slideIds: string[] = ids;
export const documentIds: string[] = documents;
export const slideThemes: Record<string, string> = themes;
export const slideCreatedAt: Record<string, number> = createdAt;
export const documentCreatedAt: Record<string, number> = documentsCreatedAt;

export function slidesByTheme(themeId: string): string[] {
  return slideIds.filter((id) => slideThemes[id] === themeId);
}

export async function loadSlide(id: string): Promise<SlideModule> {
  return load(id);
}

export async function loadDocument(id: string): Promise<SlideModule> {
  return loadDoc(id);
}

export function changedContentIds(data: unknown, kind: 'slide' | 'document' = 'slide'): string[] {
  if (!data || typeof data !== 'object') return [];
  const payload = data as {
    slideId?: unknown;
    slideIds?: unknown;
    documentId?: unknown;
    documentIds?: unknown;
  };
  const ids = kind === 'document' ? payload.documentIds : payload.slideIds;
  const id = kind === 'document' ? payload.documentId : payload.slideId;
  const changed = Array.isArray(ids)
    ? ids.filter((value): value is string => typeof value === 'string')
    : [];
  if (typeof id === 'string' && !changed.includes(id)) changed.push(id);
  return changed;
}

export function changedSlideIds(data: unknown): string[] {
  return changedContentIds(data);
}

export function slideChangeIncludes(
  data: unknown,
  slideId: string,
  kind: 'slide' | 'document' = 'slide',
): boolean {
  return changedContentIds(data, kind).includes(slideId);
}
