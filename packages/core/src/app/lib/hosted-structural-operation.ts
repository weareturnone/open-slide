import {
  type AuthoringMutationKind,
  authoringRequestHash,
  parseAuthoringMutationRequest,
  parseHostedOperationReceipt,
} from './authoring-protocol.ts';
import {
  type HostedOperationReceipt,
  HostedStudioError,
  type HostedVersionState,
  type StudioApiFailure,
} from './hosted-deployment.ts';

export type StoredStructuralRequest = {
  version: 1;
  label: string;
  endpoint: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  protocolKind?: AuthoringMutationKind;
  operationId: string;
  requestHash: string;
  expectedDraftSha: string;
  expectedMainSha: string;
  body: Record<string, unknown>;
};

type PrepareStoredStructuralRequest = {
  label: string;
  endpoint: string;
  method: StoredStructuralRequest['method'];
  protocolKind?: AuthoringMutationKind;
  operationId: string;
  version: HostedVersionState;
  body: Record<string, unknown>;
};

type StructuralResponse<T extends Record<string, unknown>> = T & {
  operation: HostedOperationReceipt;
};

function responseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Studio response must be an object');
  }
  return value as Record<string, unknown>;
}

export async function prepareStoredStructuralRequest({
  label,
  endpoint,
  method,
  protocolKind,
  operationId,
  version,
  body,
}: PrepareStoredStructuralRequest): Promise<StoredStructuralRequest> {
  const coordinatedBody = {
    ...body,
    operationId,
    expectedDraftSha: version.draftSha,
    expectedMainSha: version.mainSha,
  };
  const requestHash = await authoringRequestHash(method, endpoint, coordinatedBody);
  const stored: StoredStructuralRequest = {
    version: 1,
    label,
    endpoint,
    method,
    ...(protocolKind ? { protocolKind } : {}),
    operationId,
    requestHash,
    expectedDraftSha: version.draftSha,
    expectedMainSha: version.mainSha,
    body: { ...coordinatedBody, requestHash },
  };
  if (protocolKind) parseAuthoringMutationRequest(protocolKind, stored.body, { hosted: true });
  return stored;
}

export async function dispatchStoredStructuralRequest<T extends Record<string, unknown>>(
  stored: StoredStructuralRequest,
  persist: (request: StoredStructuralRequest) => void,
): Promise<StructuralResponse<T>> {
  persist(stored);
  const response = await fetch(stored.endpoint, {
    method: stored.method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(stored.body),
  });
  const raw = (await response.json().catch(() => ({}))) as StudioApiFailure;
  if (!response.ok) {
    throw new HostedStudioError(raw, `Studio request failed with ${response.status}`);
  }
  const result = responseObject(raw);
  if (!result.operation) throw new Error('Studio response did not include an operation receipt');
  const coordination = {
    operationId: stored.operationId,
    requestHash: stored.requestHash,
    expectedDraftSha: stored.expectedDraftSha,
    expectedMainSha: stored.expectedMainSha,
  };
  let operation: HostedOperationReceipt;
  if (stored.protocolKind) {
    const request = parseAuthoringMutationRequest(stored.protocolKind, stored.body, {
      hosted: true,
    });
    operation = parseHostedOperationReceipt(result.operation, coordination, request);
  } else {
    const candidate = responseObject(result.operation);
    if (
      candidate.operationId !== stored.operationId ||
      candidate.requestHash !== stored.requestHash ||
      candidate.baseDraftSha !== stored.expectedDraftSha ||
      candidate.baseMainSha !== stored.expectedMainSha
    ) {
      throw new Error('Studio response did not match the coordinated request');
    }
    operation = candidate as HostedOperationReceipt;
  }
  return { ...(result as T), operation };
}
