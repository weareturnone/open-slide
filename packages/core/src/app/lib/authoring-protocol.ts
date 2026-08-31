import {
  type PageId,
  pageIdLocalPart,
  pageIdSource,
  validateStablePageId,
} from './page-identity.ts';

export type AuthoringMutationKind =
  | 'slide.reorder'
  | 'page.duplicate'
  | 'page.delete'
  | 'catalog.insert';

export type AuthoringCoordination = {
  operationId: string;
  requestHash: string;
  expectedDraftSha: string;
  expectedMainSha: string;
};

type ContentKind = 'slide' | 'document';
type RequestBase = { kind: AuthoringMutationKind; slideId: string; contentKind: ContentKind };
export type AuthoringMutationRequest =
  | (RequestBase & { kind: 'slide.reorder'; pageIds: PageId[]; focusPageId: PageId })
  | (RequestBase & { kind: 'page.duplicate' | 'page.delete'; pageId: PageId })
  | (RequestBase & {
      kind: 'catalog.insert';
      templateId: string;
      pageCount: number;
      beforePageId?: PageId;
      afterPageId?: PageId;
    });

export type ParsedAuthoringMutationRequest = AuthoringMutationRequest & {
  coordination: AuthoringCoordination | null;
};

export type AuthoringProofBase = {
  version: 1;
  sourceModule: string;
  pageIds: PageId[];
  focusPageId: PageId | null;
  resolvedPageIndex: number | null;
};

export type AuthoringOperationProof =
  | (AuthoringProofBase & { kind: 'slide.reorder'; orderedPageIds: PageId[] })
  | (AuthoringProofBase & {
      kind: 'page.duplicate';
      sourcePageId: PageId;
      createdPageId: PageId;
    })
  | (AuthoringProofBase & { kind: 'page.delete'; deletedPageId: PageId })
  | (AuthoringProofBase & {
      kind: 'catalog.insert';
      templateId: string;
      createdPageId: PageId;
    });

export type HostedOperationReceipt = {
  version: 1;
  operationId: string;
  requestHash: string;
  kind: AuthoringMutationKind;
  artifactId: string;
  baseDraftSha: string;
  baseMainSha: string;
  draftCommitSha: string;
  targetMainSha: string;
  proof: AuthoringOperationProof;
  createdAt: string;
};

export type AuthoringErrorCode =
  | 'INVALID_AUTHORING_REQUEST'
  | 'STUDIO_READ_ONLY'
  | 'CONTENT_NOT_FOUND'
  | 'STALE_STUDIO_HEADS'
  | 'OPERATION_ID_REUSED'
  | 'OPERATION_IN_PROGRESS'
  | 'PAGE_IDENTITY_STALE'
  | 'UNSUPPORTED_SOURCE_SHAPE'
  | 'INTERNAL_AUTHORING_ERROR';

const OPERATION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_HASH_RE = /^sha256:[0-9a-f]{64}$/;
const GIT_SHA_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const SLIDE_ID_RE = /^[A-Za-z0-9_-]+$/;

function record(value: unknown, subject: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${subject} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, subject: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${subject} is required`);
  return value;
}

function contentKind(value: unknown): ContentKind {
  if (value !== 'slide' && value !== 'document') throw new Error('kind must be slide or document');
  return value;
}

function slideId(value: unknown): string {
  const parsed = requiredString(value, 'slideId');
  if (!SLIDE_ID_RE.test(parsed)) throw new Error('slideId is invalid');
  return parsed;
}

function pageId(value: unknown): PageId {
  const parsed = requiredString(value, 'pageId');
  pageIdSource(parsed);
  const local = pageIdLocalPart(parsed);
  if (local.startsWith('legacy:')) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(local.slice('legacy:'.length))) {
      throw new Error('pageId has an invalid legacy local part');
    }
  } else {
    validateStablePageId(local);
  }
  return parsed as PageId;
}

function optionalPageId(value: unknown, subject: string): PageId | undefined {
  if (value === undefined) return undefined;
  try {
    return pageId(value);
  } catch {
    throw new Error(`${subject} is invalid`);
  }
}

function nonNegativeInteger(value: unknown, subject: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${subject} must be a non-negative integer`);
  }
  return value as number;
}

function coordination(
  body: Record<string, unknown>,
  hosted: boolean,
): AuthoringCoordination | null {
  const fields = ['operationId', 'requestHash', 'expectedDraftSha', 'expectedMainSha'] as const;
  const supplied = fields.filter((field) => body[field] !== undefined);
  if (!hosted && supplied.length === 0) return null;
  for (const field of fields) requiredString(body[field], field);
  if (!OPERATION_ID_RE.test(body.operationId as string)) throw new Error('operationId is invalid');
  if (!REQUEST_HASH_RE.test(body.requestHash as string)) throw new Error('requestHash is invalid');
  if (!GIT_SHA_RE.test(body.expectedDraftSha as string)) {
    throw new Error('expectedDraftSha is invalid');
  }
  if (!GIT_SHA_RE.test(body.expectedMainSha as string)) {
    throw new Error('expectedMainSha is invalid');
  }
  return {
    operationId: body.operationId as string,
    requestHash: body.requestHash as string,
    expectedDraftSha: body.expectedDraftSha as string,
    expectedMainSha: body.expectedMainSha as string,
  };
}

export function parseAuthoringMutationRequest(
  mutationKind: AuthoringMutationKind,
  value: unknown,
  options: { hosted?: boolean } = {},
): ParsedAuthoringMutationRequest {
  const body = record(value, 'request');
  const base = {
    slideId: slideId(body.slideId),
    contentKind: contentKind(body.kind),
    coordination: coordination(body, options.hosted === true),
  };
  if (mutationKind === 'slide.reorder') {
    if (!Array.isArray(body.pageIds) || body.pageIds.length === 0) {
      throw new Error('pageIds must be a non-empty array');
    }
    const pageIds = body.pageIds.map(pageId);
    if (new Set(pageIds).size !== pageIds.length) throw new Error('pageIds must be unique');
    const focusPageId = pageId(body.focusPageId);
    if (!pageIds.includes(focusPageId)) throw new Error('focusPageId must occur in pageIds');
    return { ...base, kind: mutationKind, pageIds, focusPageId };
  }
  if (mutationKind === 'page.duplicate' || mutationKind === 'page.delete') {
    return { ...base, kind: mutationKind, pageId: pageId(body.pageId) };
  }
  if (mutationKind === 'catalog.insert') {
    const pageCount = nonNegativeInteger(body.pageCount, 'pageCount');
    const beforePageId = optionalPageId(body.beforePageId, 'beforePageId');
    const afterPageId = optionalPageId(body.afterPageId, 'afterPageId');
    if (pageCount === 0 && (beforePageId || afterPageId)) {
      throw new Error('an empty catalog target cannot have an insertion boundary');
    }
    if (pageCount > 0 && !beforePageId && !afterPageId) {
      throw new Error('an insertion boundary is required');
    }
    return {
      ...base,
      kind: mutationKind,
      templateId: requiredString(body.templateId, 'templateId'),
      pageCount,
      beforePageId,
      afterPageId,
    };
  }
  throw new Error('Unsupported authoring mutation kind');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('Request hashes cannot contain non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = record(value, 'hash input');
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

function normalizedEndpoint(endpoint: string): string {
  const url = new URL(endpoint, 'https://open-slide.invalid');
  url.searchParams.sort();
  return `${url.pathname}${url.search}`;
}

export async function authoringRequestHash(
  method: string,
  endpoint: string,
  bodyValue: Record<string, unknown>,
): Promise<string> {
  const { operationId: _operationId, requestHash: _requestHash, ...body } = bodyValue;
  const canonical = canonicalJson({
    method: method.toUpperCase(),
    endpoint: normalizedEndpoint(endpoint),
    body,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hex = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

function sha(value: unknown, subject: string): string {
  const parsed = requiredString(value, subject);
  if (!GIT_SHA_RE.test(parsed)) throw new Error(`${subject} is invalid`);
  return parsed;
}

function pageIdArray(value: unknown, subject: string): PageId[] {
  if (!Array.isArray(value)) throw new Error(`${subject} must be an array`);
  return value.map(pageId);
}

function proof(value: unknown, expectedKind: AuthoringMutationKind): AuthoringOperationProof {
  const body = record(value, 'proof');
  if (body.version !== 1) throw new Error('proof version is unsupported');
  if (body.kind !== expectedKind) throw new Error('proof kind does not match receipt kind');
  const sourceModule = requiredString(body.sourceModule, 'proof.sourceModule');
  pageIdSource(`${sourceModule}#proof`);
  const pageIds = pageIdArray(body.pageIds, 'proof.pageIds');
  if (new Set(pageIds).size !== pageIds.length) throw new Error('proof.pageIds must be unique');
  const focusPageId = body.focusPageId === null ? null : pageId(body.focusPageId);
  const resolvedPageIndex =
    body.resolvedPageIndex === null
      ? null
      : Number.isInteger(body.resolvedPageIndex) && (body.resolvedPageIndex as number) >= 0
        ? (body.resolvedPageIndex as number)
        : (() => {
            throw new Error('proof.resolvedPageIndex is invalid');
          })();
  const base = { version: 1 as const, sourceModule, pageIds, focusPageId, resolvedPageIndex };
  if (expectedKind === 'slide.reorder') {
    return {
      ...base,
      kind: expectedKind,
      orderedPageIds: pageIdArray(body.orderedPageIds, 'proof.orderedPageIds'),
    };
  }
  if (expectedKind === 'page.duplicate') {
    return {
      ...base,
      kind: expectedKind,
      sourcePageId: pageId(body.sourcePageId),
      createdPageId: pageId(body.createdPageId),
    };
  }
  if (expectedKind === 'page.delete') {
    return { ...base, kind: expectedKind, deletedPageId: pageId(body.deletedPageId) };
  }
  if (expectedKind === 'catalog.insert') {
    return {
      ...base,
      kind: expectedKind,
      templateId: requiredString(body.templateId, 'proof.templateId'),
      createdPageId: pageId(body.createdPageId),
    };
  }
  throw new Error('Unsupported authoring proof kind');
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function expectedSourceModule(request: ParsedAuthoringMutationRequest): string {
  const directory = request.contentKind === 'document' ? 'documents' : 'slides';
  const escapedSlideId = request.slideId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${directory}/${escapedSlideId}/index\\.(?:tsx|jsx|ts|js)$`);
  const requestPageIds =
    request.kind === 'slide.reorder'
      ? request.pageIds
      : 'pageId' in request
        ? [request.pageId]
        : [request.beforePageId, request.afterPageId].filter(
            (value): value is PageId => value !== undefined,
          );
  const sources = new Set(requestPageIds.map(pageIdSource));
  if (sources.size > 1) throw new Error('Request page identities span multiple source modules');
  const source = sources.values().next().value as string | undefined;
  const resolved = source ?? `${directory}/${request.slideId}/index.tsx`;
  if (!pattern.test(resolved)) {
    throw new Error('Request page identities do not belong to the requested artifact');
  }
  return resolved;
}

function assertReceiptMatchesRequest(
  receipt: HostedOperationReceipt,
  request: ParsedAuthoringMutationRequest,
) {
  if (receipt.kind !== request.kind) {
    throw new Error('Operation receipt kind does not match the original request');
  }
  if (receipt.artifactId !== request.slideId) {
    throw new Error('Operation receipt artifact does not match the original request');
  }
  const requestSource = expectedSourceModule(request);
  const proofSource = receipt.proof.sourceModule;
  if (request.kind === 'catalog.insert' && request.pageCount === 0) {
    const directory = request.contentKind === 'document' ? 'documents' : 'slides';
    const escapedSlideId = request.slideId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (
      !new RegExp(`^${directory}/${escapedSlideId}/index\\.(?:tsx|jsx|ts|js)$`).test(proofSource)
    ) {
      throw new Error('Operation proof source does not match the original request');
    }
  } else if (proofSource !== requestSource) {
    throw new Error('Operation proof source does not match the original request');
  }
  if (receipt.proof.pageIds.some((id) => pageIdSource(id) !== proofSource)) {
    throw new Error('Operation proof page identities do not match its source module');
  }
  if (receipt.proof.focusPageId === null) {
    if (receipt.proof.resolvedPageIndex !== null) {
      throw new Error('Operation proof index cannot resolve a missing focus page');
    }
  } else {
    const index = receipt.proof.pageIds.indexOf(receipt.proof.focusPageId);
    if (index < 0 || index !== receipt.proof.resolvedPageIndex) {
      throw new Error('Operation proof focus page and resolved index disagree');
    }
  }

  if (request.kind === 'slide.reorder' && receipt.proof.kind === 'slide.reorder') {
    if (
      !arraysEqual(receipt.proof.pageIds, request.pageIds) ||
      !arraysEqual(receipt.proof.orderedPageIds, request.pageIds) ||
      receipt.proof.focusPageId !== request.focusPageId
    ) {
      throw new Error('Reorder proof does not match the original request');
    }
    return;
  }
  if (request.kind === 'page.duplicate' && receipt.proof.kind === 'page.duplicate') {
    if (
      receipt.proof.sourcePageId !== request.pageId ||
      receipt.proof.focusPageId !== receipt.proof.createdPageId ||
      !receipt.proof.pageIds.includes(receipt.proof.createdPageId)
    ) {
      throw new Error('Duplicate proof does not match the original request');
    }
    return;
  }
  if (request.kind === 'page.delete' && receipt.proof.kind === 'page.delete') {
    if (
      receipt.proof.deletedPageId !== request.pageId ||
      receipt.proof.pageIds.includes(receipt.proof.deletedPageId)
    ) {
      throw new Error('Delete proof does not match the original request');
    }
    return;
  }
  if (request.kind === 'catalog.insert' && receipt.proof.kind === 'catalog.insert') {
    if (
      receipt.proof.templateId !== request.templateId ||
      receipt.proof.pageIds.length !== request.pageCount + 1 ||
      receipt.proof.focusPageId !== receipt.proof.createdPageId ||
      !receipt.proof.pageIds.includes(receipt.proof.createdPageId)
    ) {
      throw new Error('Catalog proof does not match the original request');
    }
    return;
  }
  throw new Error('Operation proof does not match the original request');
}

export function parseHostedOperationReceipt(
  value: unknown,
  expected?: AuthoringCoordination,
  request?: ParsedAuthoringMutationRequest,
): HostedOperationReceipt {
  const body = record(value, 'operation receipt');
  if (body.version !== 1) throw new Error('Operation receipt version is unsupported');
  const operationId = requiredString(body.operationId, 'operation.operationId');
  const requestHash = requiredString(body.requestHash, 'operation.requestHash');
  if (!OPERATION_ID_RE.test(operationId)) throw new Error('Operation receipt ID is invalid');
  if (!REQUEST_HASH_RE.test(requestHash))
    throw new Error('Operation receipt request hash is invalid');
  if (expected?.operationId !== undefined && operationId !== expected.operationId) {
    throw new Error('Operation receipt ID does not match the request');
  }
  if (expected?.requestHash !== undefined && requestHash !== expected.requestHash) {
    throw new Error('Operation receipt request hash does not match the request');
  }
  const kind = body.kind;
  if (
    kind !== 'slide.reorder' &&
    kind !== 'page.duplicate' &&
    kind !== 'page.delete' &&
    kind !== 'catalog.insert'
  ) {
    throw new Error('Operation receipt kind is invalid');
  }
  const baseDraftSha = sha(body.baseDraftSha, 'operation.baseDraftSha');
  const baseMainSha = sha(body.baseMainSha, 'operation.baseMainSha');
  if (expected && baseDraftSha !== expected.expectedDraftSha) {
    throw new Error('Operation receipt draft base does not match the request');
  }
  if (expected && baseMainSha !== expected.expectedMainSha) {
    throw new Error('Operation receipt main base does not match the request');
  }
  const createdAt = requiredString(body.createdAt, 'operation.createdAt');
  if (!Number.isFinite(Date.parse(createdAt)))
    throw new Error('Operation receipt timestamp is invalid');
  const receipt: HostedOperationReceipt = {
    version: 1,
    operationId,
    requestHash,
    kind,
    artifactId: requiredString(body.artifactId, 'operation.artifactId'),
    baseDraftSha,
    baseMainSha,
    draftCommitSha: sha(body.draftCommitSha, 'operation.draftCommitSha'),
    targetMainSha: sha(body.targetMainSha, 'operation.targetMainSha'),
    proof: proof(body.proof, kind),
    createdAt,
  };
  if (request) assertReceiptMatchesRequest(receipt, request);
  return receipt;
}

export function duplicateResultPageIndex(
  receipt: HostedOperationReceipt,
  result: Record<string, unknown>,
): number {
  if (receipt.kind !== 'page.duplicate' || receipt.proof.kind !== 'page.duplicate') {
    throw new Error('An authoritative duplicate receipt is required');
  }
  let resultPageId: PageId;
  try {
    resultPageId = pageId(result.pageId);
  } catch {
    throw new Error('Duplicate result did not include a valid authoritative page id');
  }
  if (resultPageId !== receipt.proof.createdPageId) {
    throw new Error('Duplicate result authoritative page id does not match its proof');
  }
  const index = receipt.proof.pageIds.indexOf(resultPageId);
  if (index < 0 || index !== receipt.proof.resolvedPageIndex) {
    throw new Error('Duplicate authoritative page id does not resolve to the proof index');
  }
  return index;
}

export type StoredAuthoringOperation =
  | { requestHash: string; state: 'pending' }
  | { requestHash: string; state: 'complete'; receipt: HostedOperationReceipt };

export type AuthoringIdempotencyDecision =
  | { action: 'new' }
  | { action: 'replay'; receipt: HostedOperationReceipt }
  | { action: 'in-progress' }
  | { action: 'reject'; code: 'OPERATION_ID_REUSED' };

export function decideAuthoringIdempotency(
  existing: StoredAuthoringOperation | null,
  requestHash: string,
): AuthoringIdempotencyDecision {
  if (!existing) return { action: 'new' };
  if (existing.requestHash !== requestHash) {
    return { action: 'reject', code: 'OPERATION_ID_REUSED' };
  }
  return existing.state === 'complete'
    ? { action: 'replay', receipt: existing.receipt }
    : { action: 'in-progress' };
}

export function authoringErrorStatus(code: AuthoringErrorCode): number {
  if (code === 'INVALID_AUTHORING_REQUEST') return 400;
  if (code === 'STUDIO_READ_ONLY') return 403;
  if (code === 'CONTENT_NOT_FOUND') return 404;
  if (
    code === 'STALE_STUDIO_HEADS' ||
    code === 'OPERATION_ID_REUSED' ||
    code === 'OPERATION_IN_PROGRESS' ||
    code === 'PAGE_IDENTITY_STALE'
  ) {
    return 409;
  }
  if (code === 'UNSUPPORTED_SOURCE_SHAPE') return 422;
  return 500;
}
