import { useCallback } from 'react';
import type { RunStructuralMutation } from '@/components/hosted-operation-provider';
import type { AuthoringVersionSnapshot } from '../authoring';
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

type InspectorBatchRequest = {
  slideId: string;
  kind: ContentKind;
  pageId: PageId;
  edits: Edit[];
};

export async function submitInspectorEditBatch(
  request: InspectorBatchRequest,
  options: { hosted: boolean; runStructuralMutation?: RunStructuralMutation },
): Promise<EditBatchResult> {
  let body: EditResponseBody;
  let version: AuthoringVersionSnapshot | undefined;
  const payload = {
    ...request,
    edits: request.edits.map((edit) => ({ ...edit, strict: true })),
  };
  if (options.hosted) {
    if (!options.runStructuralMutation) {
      throw new Error('Hosted inspector coordination is unavailable');
    }
    const hosted = await options.runStructuralMutation<EditResponseBody>({
      label: 'Save inspector edits',
      protocolKind: 'inspector.batch-edit',
      endpoint: '/__edit/batch',
      method: 'POST',
      body: payload,
    });
    body = hosted.result;
    version = {
      draftSha: hosted.status.draftSha,
      mainSha: hosted.status.mainSha,
      deployedSha: hosted.status.deployedSha,
      hasDraftChanges: hosted.status.draftSha !== hosted.status.mainSha,
    };
  } else {
    const response = await fetch('/__edit/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    body = (await response.json().catch(() => ({}))) as EditResponseBody;
    if (!response.ok) {
      throw new Error(body.error ?? `POST /__edit/batch → ${response.status}`);
    }
    version = versionFromBody(body);
  }
  if (!Array.isArray(body.results) || body.results.length !== request.edits.length) {
    throw new Error(
      'Studio returned an incomplete save result. Your edits are still in this tab; try again.',
    );
  }
  return { results: body.results, version, changed: body.changed };
}

export class NoOpEditError extends Error {
  constructor() {
    super(
      'Edit completed but the source file did not change — the target JSX may already match, or the target element may not be directly editable here.',
    );
    this.name = 'NoOpEditError';
  }
}

export function useEditor(
  slideId: string,
  kind: ContentKind = 'slide',
  pageId: PageId | null = null,
  pageIdentityError: PageIdentityError | null = null,
  runStructuralMutation?: RunStructuralMutation,
) {
  const currentPageId = useCallback((): PageId => {
    if (pageIdentityError) throw pageIdentityError;
    if (!pageId) {
      throw new PageIdentityUnavailableError(
        undefined,
        'The current page identity is unavailable.',
      );
    }
    return pageId;
  }, [pageId, pageIdentityError]);

  const applyEdit = useCallback(
    async (line: number, column: number, ops: EditOp[]) => {
      const identity = currentPageId();
      const batch = await submitInspectorEditBatch(
        { slideId, kind, pageId: identity, edits: [{ line, column, ops }] },
        { hosted: !import.meta.env.DEV, runStructuralMutation },
      );
      const result = batch.results[0];
      if (!result?.ok) {
        throw new Error(result?.error ?? 'Studio could not save the inspector edit');
      }
      if (batch.changed === false) {
        throw new NoOpEditError();
      }
      return batch.version;
    },
    [slideId, kind, currentPageId, runStructuralMutation],
  );

  // Batch many element edits into one file write and one HMR tick.
  // Returns one result per input edit so callers can keep failed
  // edits buffered while clearing the ones that landed.
  const applyEdits = useCallback(
    async (edits: Edit[]): Promise<EditBatchResult> => {
      if (edits.length === 0) return { results: [] };
      const identity = currentPageId();
      return submitInspectorEditBatch(
        { slideId, kind, pageId: identity, edits },
        { hosted: !import.meta.env.DEV, runStructuralMutation },
      );
    },
    [slideId, kind, currentPageId, runStructuralMutation],
  );

  return { applyEdit, applyEdits };
}
