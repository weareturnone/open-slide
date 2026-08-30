import {
  slideCreatedAt as createdAt,
  documentSourceModules as documentSources,
  documentIds as documents,
  documentCreatedAt as documentsCreatedAt,
  slideIds as ids,
  loadSlide as load,
  loadDocument as loadDoc,
  slideSourceModules as sources,
  slideThemes as themes,
} from 'virtual:open-slide/slides';
import { type NormalizedSlideModule, normalizeSlideModule } from './page-normalization';

export const slideIds: string[] = ids;
export const documentIds: string[] = documents;
export const slideThemes: Record<string, string> = themes;
export const slideCreatedAt: Record<string, number> = createdAt;
export const documentCreatedAt: Record<string, number> = documentsCreatedAt;
export const slideSourceModules: Record<string, string> = sources;
export const documentSourceModules: Record<string, string> = documentSources;

export function slidesByTheme(themeId: string): string[] {
  return slideIds.filter((id) => slideThemes[id] === themeId);
}

export async function loadSlide(id: string): Promise<NormalizedSlideModule> {
  return normalizeSlideModule(await load(id), slideSourceModules[id] ?? `slides/${id}/index.tsx`);
}

export async function loadDocument(id: string): Promise<NormalizedSlideModule> {
  return normalizeSlideModule(
    await loadDoc(id),
    documentSourceModules[id] ?? `documents/${id}/index.tsx`,
  );
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
