export type HostedVersionState = {
  draftSha: string;
  mainSha: string;
  deployedSha?: string;
  hasDraftChanges: boolean;
};

export type HostedPublishConfig = {
  statusEndpoint: string;
  publishEndpoint: string;
};

const POLL_INTERVAL_MS = 3_000;
const DEPLOYMENT_SETTLE_MS = 5_000;
const DEPLOYMENT_TIMEOUT_MS = 5 * 60_000;
const REQUIRED_MATCHES = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheBustedEndpoint(endpoint: string) {
  const url = new URL(endpoint, window.location.origin);
  url.searchParams.set('studioStatus', Date.now().toString(36));
  return url.toString();
}

export async function fetchHostedVersion(statusEndpoint: string): Promise<HostedVersionState> {
  const response = await fetch(cacheBustedEndpoint(statusEndpoint), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Status request failed with ${response.status}`);
  return (await response.json()) as HostedVersionState;
}

export async function publishHostedDraft(
  publishConfig: HostedPublishConfig,
  expectedDraftHead: string,
): Promise<string> {
  const response = await fetch(publishConfig.publishEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedDraftHead }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    mainSha?: string;
  };
  if (!response.ok) throw new Error(body.error ?? `Publish failed with ${response.status}`);
  return body.mainSha ?? expectedDraftHead;
}

export async function waitForHostedDeployment(
  statusEndpoint: string,
  targetSha: string,
): Promise<void> {
  const deadline = Date.now() + DEPLOYMENT_TIMEOUT_MS;
  let matches = 0;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const state = await fetchHostedVersion(statusEndpoint);
      if (state.deployedSha === targetSha) {
        matches += 1;
        if (matches >= REQUIRED_MATCHES) {
          await sleep(DEPLOYMENT_SETTLE_MS);
          return;
        }
      } else {
        matches = 0;
      }
    } catch {
      matches = 0;
    }
  }
  throw new Error('The change was published, but the deployment did not finish in time');
}

export function deployedStudioUrl(url: string | URL, targetSha: string) {
  const deployedUrl = new URL(url, window.location.origin);
  deployedUrl.searchParams.set('studioVersion', targetSha.slice(0, 12));
  return deployedUrl;
}
