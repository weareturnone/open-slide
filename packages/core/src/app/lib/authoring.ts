import config from 'virtual:open-slide/config';
import { type AuthoringVersionSnapshot, rememberAuthoringVersion } from './authoring-version.ts';

export type { AuthoringVersionSnapshot } from './authoring-version.ts';

/** Local Vite authoring is always available. Production authoring is an
 * explicit host capability because it needs durable, authenticated writes. */
export const authoringEnabled = import.meta.env.DEV || config.authoring?.enabled === true;
export const authoringReadOnly = !import.meta.env.DEV && config.authoring?.readOnly === true;
export const authoringWritable = authoringEnabled && !authoringReadOnly;

export const AUTHORING_CHANGED_EVENT = 'open-slide:authoring-changed';
export const AUTHORING_MUTATION_EVENT = 'open-slide:authoring-mutation';

export type AuthoringChangedDetail = {
  version?: AuthoringVersionSnapshot;
  previewingDraft?: boolean;
};

export function notifyAuthoringChanged(detail?: AuthoringChangedDetail): void {
  if (detail?.version) rememberAuthoringVersion(detail.version);
  window.dispatchEvent(
    new CustomEvent<AuthoringChangedDetail>(AUTHORING_CHANGED_EVENT, { detail }),
  );
}

export function notifyAuthoringMutation(phase: 'start' | 'finish'): void {
  window.dispatchEvent(new CustomEvent(AUTHORING_MUTATION_EVENT, { detail: { phase } }));
}
