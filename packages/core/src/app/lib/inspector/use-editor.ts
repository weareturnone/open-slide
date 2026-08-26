import { useCallback } from 'react';
import type { AuthoringVersionSnapshot } from '../authoring';
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

export class NoOpEditError extends Error {
  constructor() {
    super(
      'Edit completed but the source file did not change — the target JSX may already match, or the target element may not be directly editable here.',
    );
    this.name = 'NoOpEditError';
  }
}

export function useEditor(slideId: string, kind: ContentKind = 'slide') {
  const applyEdit = useCallback(
    async (line: number, column: number, ops: EditOp[]) => {
      const res = await fetch('/__edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slideId, kind, line, column, ops, strict: true }),
      });
      const body = (await res.json().catch(() => ({}))) as EditResponseBody;
      if (!res.ok) {
        throw new Error(body.error ?? `POST /__edit → ${res.status}`);
      }
      if (body.changed === false) {
        throw new NoOpEditError();
      }
      return versionFromBody(body);
    },
    [slideId, kind],
  );

  // Batch many element edits into one file write and one HMR tick.
  // Returns one result per input edit so callers can keep failed
  // edits buffered while clearing the ones that landed.
  const applyEdits = useCallback(
    async (edits: Edit[]): Promise<EditBatchResult> => {
      if (edits.length === 0) return { results: [] };
      const res = await fetch('/__edit/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slideId,
          kind,
          edits: edits.map((edit) => ({ ...edit, strict: true })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as EditResponseBody;
      if (!res.ok) {
        throw new Error(body.error ?? `POST /__edit/batch → ${res.status}`);
      }
      if (!Array.isArray(body.results) || body.results.length !== edits.length) {
        throw new Error(
          'Studio returned an incomplete save result. Your edits are still in this tab; try again.',
        );
      }
      return { results: body.results, version: versionFromBody(body) };
    },
    [slideId, kind],
  );

  return { applyEdit, applyEdits };
}
