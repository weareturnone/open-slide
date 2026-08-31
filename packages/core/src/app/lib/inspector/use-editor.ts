import { useCallback } from 'react';
import {
  type AuthoringVersionSnapshot,
  currentAuthoringVersion,
  rememberAuthoringVersion,
} from '../authoring-version';
import {
  type PageId,
  type PageIdentityError,
  PageIdentityUnavailableError,
} from '../page-identity';
import type { ContentKind } from '../sdk';

export type EditOp =
  | { kind: 'set-style'; key: string; value: string | null; prevText?: string }
  | { kind: 'set-text'; value: string; prevText?: string }
  | {
      kind: 'set-text-range-style';
      start: number;
      end: number;
      key: string;
      value: string | null;
      prevText?: string;
    }
  | { kind: 'set-attr-asset'; attr: string; assetPath: string; previewUrl: string }
  | { kind: 'replace-placeholder-with-image'; assetPath: string; targetFingerprint?: string }
  | { kind: 'delete-element'; targetFingerprint?: string };

export type Edit = { line: number; column: number; ops: EditOp[] };

export type EditResult = { ok: boolean; error?: string };
export type EditBatchResult = {
  results: EditResult[];
  version?: AuthoringVersionSnapshot;
  changed?: boolean;
};

type EditResponseBody = {
  error?: string;
  changed?: boolean;
  results?: EditResult[];
  draftSha?: string;
  mainSha?: string;
  deployedSha?: string | null;
  hasDraftChanges?: boolean;
};

type InspectorEditRequest = Edit & {
  slideId: string;
  kind: ContentKind;
  pageId: PageId;
  expectedHead?: string;
};

type InspectorBatchRequest = {
  slideId: string;
  kind: ContentKind;
  pageId: PageId;
  expectedHead?: string;
  edits: Edit[];
};

function versionFromBody(body: EditResponseBody): AuthoringVersionSnapshot | undefined {
  return typeof body.draftSha === 'string' &&
    typeof body.mainSha === 'string' &&
    typeof body.hasDraftChanges === 'boolean'
    ? {
        draftSha: body.draftSha,
        mainSha: body.mainSha,
        deployedSha: body.deployedSha,
        hasDraftChanges: body.hasDraftChanges,
      }
    : undefined;
}

async function postInspectorEdit(
  endpoint: '/__edit' | '/__edit/batch',
  payload: Record<string, unknown>,
): Promise<EditResponseBody> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as EditResponseBody;
  if (!response.ok) {
    throw new Error(body.error ?? `POST ${endpoint} → ${response.status}`);
  }
  return body;
}

export class NoOpEditError extends Error {
  constructor() {
    super(
      'Edit completed but the source file did not change. The target JSX may already match, or the target element may not be directly editable here.',
    );
    this.name = 'NoOpEditError';
  }
}

export function currentPageIdOrThrow(
  pageId: PageId | null,
  pageIdentityError: PageIdentityError | null,
): PageId {
  if (pageIdentityError) throw pageIdentityError;
  if (!pageId) {
    throw new PageIdentityUnavailableError(undefined, 'The current page identity is unavailable.');
  }
  return pageId;
}

export function expectedInspectorHeadOrThrow(
  hosted: boolean,
  version: AuthoringVersionSnapshot | null = currentAuthoringVersion(),
): string | undefined {
  if (!hosted) return undefined;
  if (!version?.draftSha) {
    throw new Error('The current Studio draft head is unavailable. Wait for status, then retry.');
  }
  return version.draftSha;
}

export async function submitInspectorEdit(
  request: InspectorEditRequest,
): Promise<AuthoringVersionSnapshot | undefined> {
  const body = await postInspectorEdit('/__edit', { ...request, strict: true });
  if (body.changed === false) throw new NoOpEditError();
  const version = versionFromBody(body);
  if (version) rememberAuthoringVersion(version);
  return version;
}

export async function submitInspectorEditBatch(
  request: InspectorBatchRequest,
): Promise<EditBatchResult> {
  const body = await postInspectorEdit('/__edit/batch', {
    ...request,
    edits: request.edits.map((edit) => ({ ...edit, strict: true })),
  });
  if (!Array.isArray(body.results) || body.results.length !== request.edits.length) {
    throw new Error(
      'Studio returned an incomplete save result. Your edits are still in this tab; try again.',
    );
  }
  const version = versionFromBody(body);
  if (version) rememberAuthoringVersion(version);
  return { results: body.results, version, changed: body.changed };
}

export function useEditor(
  slideId: string,
  kind: ContentKind = 'slide',
  pageId: PageId | null = null,
  pageIdentityError: PageIdentityError | null = null,
) {
  const currentPageId = useCallback(
    (): PageId => currentPageIdOrThrow(pageId, pageIdentityError),
    [pageId, pageIdentityError],
  );

  const applyEdit = useCallback(
    async (line: number, column: number, ops: EditOp[]) => {
      const identity = currentPageId();
      const expectedHead = expectedInspectorHeadOrThrow(!import.meta.env.DEV);
      return submitInspectorEdit({
        slideId,
        kind,
        pageId: identity,
        ...(expectedHead ? { expectedHead } : {}),
        line,
        column,
        ops,
      });
    },
    [slideId, kind, currentPageId],
  );

  // Batch many element edits into one file write and one HMR tick.
  // Returns one result per input edit so callers can keep failed
  // edits buffered while clearing the ones that landed.
  const applyEdits = useCallback(
    async (edits: Edit[]): Promise<EditBatchResult> => {
      if (edits.length === 0) return { results: [] };
      const identity = currentPageId();
      const expectedHead = expectedInspectorHeadOrThrow(!import.meta.env.DEV);
      return submitInspectorEditBatch({
        slideId,
        kind,
        pageId: identity,
        ...(expectedHead ? { expectedHead } : {}),
        edits,
      });
    },
    [slideId, kind, currentPageId],
  );

  return { applyEdit, applyEdits };
}
