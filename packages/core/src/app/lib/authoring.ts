import config from 'virtual:open-slide/config';

/** Local Vite authoring is always available. Production authoring is an
 * explicit host capability because it needs durable, authenticated writes. */
export const authoringEnabled = import.meta.env.DEV || config.authoring?.enabled === true;
export const authoringReadOnly = !import.meta.env.DEV && config.authoring?.readOnly === true;
export const authoringWritable = authoringEnabled && !authoringReadOnly;

export const AUTHORING_CHANGED_EVENT = 'open-slide:authoring-changed';

export function notifyAuthoringChanged(): void {
  window.dispatchEvent(new Event(AUTHORING_CHANGED_EVENT));
}

export function pageComponentIdentities(
  pages: Array<{ name?: string; displayName?: string }>,
): string[] | null {
  const occurrences = new Map<string, number>();
  const identities: string[] = [];
  for (const page of pages) {
    const componentName = String(page.displayName || page.name || '').trim();
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(componentName)) return null;
    const occurrence = (occurrences.get(componentName) || 0) + 1;
    occurrences.set(componentName, occurrence);
    identities.push(`${componentName}#${occurrence}`);
  }
  return identities;
}
