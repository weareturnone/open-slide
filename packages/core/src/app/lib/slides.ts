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

export function slideChangeIncludes(
  data: unknown,
  slideId: string,
  kind: 'slide' | 'document' = 'slide',
): boolean {
  if (!data || typeof data !== 'object') return false;
  const payload = data as {
    slideId?: unknown;
    slideIds?: unknown;
    documentId?: unknown;
    documentIds?: unknown;
  };
  if (kind === 'document') {
    if (payload.documentId === slideId) return true;
    return Array.isArray(payload.documentIds) && payload.documentIds.includes(slideId);
  }
  if (payload.slideId === slideId) return true;
  return Array.isArray(payload.slideIds) && payload.slideIds.includes(slideId);
}
