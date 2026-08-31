export type AuthoringVersionSnapshot = {
  draftSha: string;
  mainSha: string;
  deployedSha?: string | null;
  hasDraftChanges: boolean;
  readOnly?: boolean;
};

let currentVersion: AuthoringVersionSnapshot | null = null;

export function rememberAuthoringVersion(version: AuthoringVersionSnapshot): void {
  currentVersion = version;
}

export function currentAuthoringVersion(): AuthoringVersionSnapshot | null {
  return currentVersion;
}
