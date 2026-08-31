import { rememberAuthoringVersion } from './authoring-version.ts';

export type HostedVersionState = {
  draftSha: string;
  mainSha: string;
  deployedSha?: string | null;
  hasDraftChanges: boolean;
  readOnly?: boolean;
  targetRelation?: 'pending' | 'exact' | 'descendant' | 'unrelated';
};

export type HostedOperationReceipt = {
  version: 1;
  operationId: string;
  requestHash: string;
  kind: string;
  artifactId: string;
  baseDraftSha: string;
  baseMainSha: string;
  draftCommitSha: string;
  targetMainSha: string;
  proof: Record<string, unknown>;
  createdAt: string;
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

export function assertHostedVersionWritable(version: Pick<HostedVersionState, 'readOnly'>): void {
  if (version.readOnly) {
    throw new HostedStudioError(
      { code: 'STUDIO_READ_ONLY', message: 'This preview is read-only.' },
      'This preview is read-only.',
    );
  }
}

const POLL_INTERVAL_MS = 3_000;
const DELAYED_POLL_INTERVAL_MS = 15_000;
const DEPLOYMENT_SETTLE_MS = 5_000;
const DEPLOYMENT_DELAYED_MS = 5 * 60_000;
const DEPLOYMENT_STOP_MS = 30 * 60_000;
const REQUIRED_MATCHES = 2;
const OPERATION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_HASH_RE = /^sha256:[0-9a-f]{64}$/;
const GIT_SHA_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

function object(value: unknown, subject: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${subject} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, subject: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${subject} is required`);
  return value;
}

function gitSha(value: unknown, subject: string): string {
  const parsed = string(value, subject);
  if (!GIT_SHA_RE.test(parsed)) throw new Error(`${subject} is invalid`);
  return parsed;
}

function resolvedIndex(value: unknown, subject: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${subject} is invalid`);
  return value as number;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const valueObject = value as Record<string, unknown>;
  return `{${Object.keys(valueObject)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(valueObject[key])}`)
    .join(',')}}`;
}

function operationReceipt(value: unknown): HostedOperationReceipt {
  const body = object(value, 'status.operation');
  const operationId = string(body.operationId, 'status.operation.operationId');
  const requestHash = string(body.requestHash, 'status.operation.requestHash');
  if (!OPERATION_ID_RE.test(operationId)) throw new Error('status operation ID is invalid');
  if (!REQUEST_HASH_RE.test(requestHash))
    throw new Error('status operation request hash is invalid');
  if (body.version !== 1) throw new Error('status operation version is unsupported');
  const createdAt = string(body.createdAt, 'status.operation.createdAt');
  if (!Number.isFinite(Date.parse(createdAt)))
    throw new Error('status operation timestamp is invalid');
  return {
    version: 1,
    operationId,
    requestHash,
    kind: string(body.kind, 'status.operation.kind'),
    artifactId: string(body.artifactId, 'status.operation.artifactId'),
    baseDraftSha: gitSha(body.baseDraftSha, 'status.operation.baseDraftSha'),
    baseMainSha: gitSha(body.baseMainSha, 'status.operation.baseMainSha'),
    draftCommitSha: gitSha(body.draftCommitSha, 'status.operation.draftCommitSha'),
    targetMainSha: gitSha(body.targetMainSha, 'status.operation.targetMainSha'),
    proof: object(body.proof, 'status.operation.proof'),
    createdAt,
  };
}

export function parseHostedOperationStatus(
  value: unknown,
  expectedReceipt: HostedOperationReceipt,
): HostedOperationStatus {
  const body = object(value, 'operation status');
  if (body.ok !== true) throw new Error('Operation status is not successful');
  const states = ['publishing', 'waiting', 'delayed', 'ready', 'conflict'] as const;
  if (!states.includes(body.state as (typeof states)[number])) {
    throw new Error('Operation status state is invalid');
  }
  const relations = ['pending', 'exact', 'descendant'] as const;
  if (!relations.includes(body.relation as (typeof relations)[number])) {
    throw new Error('Operation status relation is invalid');
  }
  const operation = operationReceipt(body.operation);
  if (stableJson(operation) !== stableJson(expectedReceipt)) {
    throw new Error('Operation status does not match the original operation receipt');
  }
  const proofBody = body.proof === null ? null : object(body.proof, 'operation status proof');
  const statusProof = proofBody
    ? {
        ok:
          typeof proofBody.ok === 'boolean'
            ? proofBody.ok
            : (() => {
                throw new Error('Operation status proof result is invalid');
              })(),
        resolvedPageIndex: resolvedIndex(
          proofBody.resolvedPageIndex,
          'operation status proof index',
        ),
      }
    : null;
  const status: HostedOperationStatus = {
    ok: true,
    state: body.state as HostedOperationStatus['state'],
    operation,
    draftSha: gitSha(body.draftSha, 'operation status draft SHA'),
    mainSha: gitSha(body.mainSha, 'operation status main SHA'),
    deployedSha:
      body.deployedSha === undefined || body.deployedSha === null
        ? (body.deployedSha as undefined | null)
        : gitSha(body.deployedSha, 'operation status deployed SHA'),
    relation: body.relation as HostedOperationStatus['relation'],
    proof: statusProof,
    resolvedPageIndex: resolvedIndex(body.resolvedPageIndex, 'operation status resolved index'),
    allowedActions: Array.isArray(body.allowedActions)
      ? body.allowedActions.map((action) => string(action, 'operation status action'))
      : (() => {
          throw new Error('Operation status actions must be an array');
        })(),
  };
  if (status.state === 'ready') {
    if (status.relation === 'pending' || !status.deployedSha) {
      throw new Error('Ready operation status has not been deployed');
    }
    if (!status.proof?.ok) throw new Error('Ready operation status lacks successful proof');
    if (status.resolvedPageIndex !== status.proof.resolvedPageIndex) {
      throw new Error('Ready operation status resolved index contradicts its proof');
    }
    if ('resolvedPageIndex' in expectedReceipt.proof) {
      const receiptIndex = resolvedIndex(
        expectedReceipt.proof.resolvedPageIndex,
        'operation receipt proof index',
      );
      if (status.resolvedPageIndex !== receiptIndex) {
        throw new Error('Ready operation status index contradicts the operation receipt');
      }
    }
    if (
      (status.relation === 'exact' &&
        (status.mainSha !== expectedReceipt.targetMainSha ||
          status.deployedSha !== expectedReceipt.targetMainSha)) ||
      (status.relation === 'descendant' && status.deployedSha !== status.mainSha)
    ) {
      throw new Error('Ready operation status deployment does not match its relation');
    }
  }
  return status;
}

function abortError() {
  return new DOMException('Deployment wait was cancelled', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function cacheBustedEndpoint(endpoint: string, params: Record<string, string> = {}) {
  const url = new URL(endpoint, window.location.origin);
  url.searchParams.set('studioStatus', Date.now().toString(36));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function targetIsDeployed(state: HostedVersionState, targetSha: string): boolean {
  if (state.deployedSha === targetSha) return true;
  return Boolean(
    state.targetRelation === 'descendant' &&
      state.deployedSha &&
      state.deployedSha === state.mainSha,
  );
}

async function responseBody<T>(response: Response, fallback: string): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & StudioApiFailure;
  if (!response.ok) throw new HostedStudioError(body, fallback);
  return body;
}

export async function fetchHostedVersion(
  statusEndpoint: string,
  options: { targetSha?: string; signal?: AbortSignal } = {},
): Promise<HostedVersionState> {
  const params = options.targetSha ? { targetSha: options.targetSha } : undefined;
  const response = await fetch(cacheBustedEndpoint(statusEndpoint, params), {
    cache: 'no-store',
    signal: options.signal,
  });
  const version = await responseBody<HostedVersionState>(
    response,
    `Status request failed with ${response.status}`,
  );
  rememberAuthoringVersion(version);
  return version;
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
  receipt: HostedOperationReceipt,
): Promise<HostedOperationStatus> {
  const response = await fetch(
    cacheBustedEndpoint(statusEndpoint, { operationId: receipt.operationId }),
    {
      cache: 'no-store',
    },
  );
  const body = await responseBody<unknown>(
    response,
    `Operation status failed with ${response.status}`,
  );
  return parseHostedOperationStatus(body, receipt);
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
  options: { signal?: AbortSignal; onWaiting?: () => void; onDelayed?: () => void } = {},
): Promise<void> {
  const delayedAt = Date.now() + DEPLOYMENT_DELAYED_MS;
  const stopAt = Date.now() + DEPLOYMENT_STOP_MS;
  let delayed = false;
  let matches = 0;
  while (Date.now() < stopAt) {
    await sleep(delayed ? DELAYED_POLL_INTERVAL_MS : POLL_INTERVAL_MS, options.signal);
    if (!delayed) options.onWaiting?.();
    if (!delayed && Date.now() >= delayedAt) {
      delayed = true;
      options.onDelayed?.();
    }
    const requestController = new AbortController();
    let deadlineExpired = false;
    const abortRequest = () => requestController.abort();
    options.signal?.addEventListener('abort', abortRequest, { once: true });
    const deadlineTimer = setTimeout(
      () => {
        deadlineExpired = true;
        requestController.abort();
      },
      Math.max(0, stopAt - Date.now()),
    );
    try {
      const state = await fetchHostedVersion(statusEndpoint, {
        targetSha,
        signal: requestController.signal,
      });
      if (targetIsDeployed(state, targetSha)) {
        matches += 1;
        if (matches >= REQUIRED_MATCHES) {
          await sleep(DEPLOYMENT_SETTLE_MS, options.signal);
          return;
        }
      } else {
        matches = 0;
      }
    } catch (error) {
      if (options.signal?.aborted) throw abortError();
      if ((error as Error).name === 'AbortError' && !deadlineExpired) throw abortError();
      matches = 0;
    } finally {
      clearTimeout(deadlineTimer);
      options.signal?.removeEventListener('abort', abortRequest);
    }
  }
  throw new HostedStudioError(
    {
      code: 'DEPLOYMENT_STATUS_TIMEOUT',
      message: 'The change is saved, but Studio could not verify its deployment after 30 minutes.',
      allowedActions: ['retry-status', 'open-current'],
    },
    'The change is saved, but Studio could not verify its deployment after 30 minutes.',
  );
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
    const status = await fetchHostedOperation(statusEndpoint, receipt);
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
