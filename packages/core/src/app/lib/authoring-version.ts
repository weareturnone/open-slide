export type AuthoringVersionSnapshot = {
  draftSha: string;
  mainSha: string;
  deployedSha?: string | null;
  hasDraftChanges: boolean;
  readOnly?: boolean;
};

let currentVersion: AuthoringVersionSnapshot | null = null;
let currentVersionEpoch = 0;

/**
 * Marks the start of an asynchronous status read. Only the newest started read
 * may later update the shared authoring snapshot.
 */
export function beginAuthoringVersionRead(): number {
  currentVersionEpoch += 1;
  return currentVersionEpoch;
}

export function rememberAuthoringVersion(
  version: AuthoringVersionSnapshot,
  readEpoch?: number,
): boolean {
  if (readEpoch !== undefined && readEpoch !== currentVersionEpoch) return false;
  if (readEpoch === undefined) currentVersionEpoch += 1;
  currentVersion = version;
  return true;
}

export function currentAuthoringVersion(): AuthoringVersionSnapshot | null {
  return currentVersion;
}
