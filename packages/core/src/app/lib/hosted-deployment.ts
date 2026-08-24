export type HostedVersionState = {
  draftSha: string;
  mainSha: string;
  deployedSha?: string | null;
  hasDraftChanges: boolean;
  readOnly?: boolean;
};

export type HostedOperationReceipt = {
  version: number;
  operationId: string;
  requestHash: string;
  kind: string;
  artifactId: string;
  baseMainSha: string;
  draftCommitSha: string;
  targetMainSha: string;
  proof: Record<string, unknown>;
  createdAt?: string | null;
};

export type HostedOperationStatus = {
  ok: true;
  state: 'publishing' | 'waiting' | 'delayed' | 'ready' | 'conflict';
  operation: HostedOperationReceipt;
  draftSha: string;
  mainSha: string;
  deployedSha?: string | null;
  relation: 'pending' | 'exact' | 'descendant';
  proof: { ok: boolean; resolvedPageIndex: number | null } | null;
  resolvedPageIndex: number | null;
  allowedActions: string[];
};

export type HostedPublishConfig = {
  statusEndpoint: string;
  publishEndpoint: string;
};

export type StudioApiFailure = {
  ok?: false;
  code?: string;
  message?: string;
  error?: string;
  allowedActions?: string[];
};

export class HostedStudioError extends Error {
  code: string;
  allowedActions: string[];

  constructor(failure: StudioApiFailure, fallback: string) {
    super(failure.message ?? failure.error ?? fallback);
    this.name = 'HostedStudioError';
    this.code = failure.code ?? 'STUDIO_REQUEST_FAILED';
    this.allowedActions = failure.allowedActions ?? [];
  }
}

const POLL_INTERVAL_MS = 3_000;
const DEPLOYMENT_SETTLE_MS = 5_000;
const DEPLOYMENT_TIMEOUT_MS = 5 * 60_000;
const REQUIRED_MATCHES = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheBustedEndpoint(endpoint: string, params: Record<string, string> = {}) {
  const url = new URL(endpoint, window.location.origin);
  url.searchParams.set('studioStatus', Date.now().toString(36));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function responseBody<T>(response: Response, fallback: string): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & StudioApiFailure;
  if (!response.ok) throw new HostedStudioError(body, fallback);
  return body;
}

export async function fetchHostedVersion(statusEndpoint: string): Promise<HostedVersionState> {
  const response = await fetch(cacheBustedEndpoint(statusEndpoint), { cache: 'no-store' });
  return responseBody(response, `Status request failed with ${response.status}`);
}

export async function fetchHostedDeployment(statusEndpoint: string): Promise<string | null> {
  const response = await fetch(cacheBustedEndpoint(statusEndpoint, { deploymentOnly: '1' }), {
    cache: 'no-store',
  });
  const body = await responseBody<{ deployedSha?: string | null }>(
    response,
    `Deployment status failed with ${response.status}`,
  );
  return body.deployedSha ?? null;
}

export async function fetchHostedOperation(
  statusEndpoint: string,
  operationId: string,
): Promise<HostedOperationStatus> {
  const response = await fetch(cacheBustedEndpoint(statusEndpoint, { operationId }), {
    cache: 'no-store',
  });
  return responseBody(response, `Operation status failed with ${response.status}`);
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
  const body = await responseBody<{ mainSha?: string }>(
    response,
    `Publish failed with ${response.status}`,
  );
  return body.mainSha ?? expectedDraftHead;
}

export async function continueHostedOperation(
  publishConfig: HostedPublishConfig,
  operationId: string,
): Promise<HostedOperationReceipt> {
  const response = await fetch(publishConfig.publishEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operationId }),
  });
  const body = await responseBody<{ operation: HostedOperationReceipt }>(
    response,
    `Publish failed with ${response.status}`,
  );
  return body.operation;
}

export async function waitForHostedDeployment(
  statusEndpoint: string,
  targetSha: string,
  options: { signal?: AbortSignal; onWaiting?: () => void } = {},
): Promise<void> {
  const deadline = Date.now() + DEPLOYMENT_TIMEOUT_MS;
  let matches = 0;
  while (Date.now() < deadline && !options.signal?.aborted) {
    await sleep(POLL_INTERVAL_MS);
    options.onWaiting?.();
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
  if (options.signal?.aborted)
    throw new DOMException('Deployment wait was cancelled', 'AbortError');
  throw new Error('The change was published, but the deployment did not finish in time');
}

export async function waitForHostedOperation(
  statusEndpoint: string,
  receipt: HostedOperationReceipt,
  options: {
    signal?: AbortSignal;
    onPhase?: (phase: HostedOperationStatus['state']) => void;
  } = {},
): Promise<HostedOperationStatus> {
  let lastDeployedSha: string | null = null;
  let pollsSinceFullStatus = Number.POSITIVE_INFINITY;
  while (!options.signal?.aborted) {
    await sleep(POLL_INTERVAL_MS);
    const deployedSha = await fetchHostedDeployment(statusEndpoint).catch(() => null);
    pollsSinceFullStatus += 1;
    if (
      deployedSha === lastDeployedSha &&
      deployedSha !== receipt.targetMainSha &&
      pollsSinceFullStatus < 10
    ) {
      continue;
    }
    lastDeployedSha = deployedSha;
    pollsSinceFullStatus = 0;
    const status = await fetchHostedOperation(statusEndpoint, receipt.operationId);
    options.onPhase?.(status.state);
    if (status.state === 'ready') {
      await sleep(DEPLOYMENT_SETTLE_MS);
      return status;
    }
    if (status.state === 'conflict') {
      throw new HostedStudioError(
        {
          code: 'OPERATION_CONFLICT',
          message: 'The deployed content no longer contains this change.',
        },
        'The deployed content no longer contains this change.',
      );
    }
  }
  throw new DOMException('Operation wait was cancelled', 'AbortError');
}

export function deployedStudioUrl(url: string | URL, targetSha: string, operationId?: string) {
  const deployedUrl = new URL(url, window.location.origin);
  deployedUrl.searchParams.set('studioVersion', targetSha.slice(0, 12));
  if (operationId) deployedUrl.searchParams.set('studioOperation', operationId);
  return deployedUrl;
}
