import config from 'virtual:open-slide/config';

/** Local Vite authoring is always available. Production authoring is an
 * explicit host capability because it needs durable, authenticated writes. */
export const authoringEnabled = import.meta.env.DEV || config.authoring?.enabled === true;

export const AUTHORING_CHANGED_EVENT = 'open-slide:authoring-changed';

export function notifyAuthoringChanged(): void {
  window.dispatchEvent(new Event(AUTHORING_CHANGED_EVENT));
}
