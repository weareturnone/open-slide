import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunStructuralMutation } from '@/components/hosted-operation-provider';
import type { PageId } from '../page-identity.ts';
import { submitInspectorEditBatch } from './use-editor.ts';

describe('submitInspectorEditBatch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('routes hosted inspector writes through the coordinated operation provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const runStructuralMutation = vi.fn(async (options: Record<string, unknown>) => ({
      result: { changed: true, results: [{ ok: true }] },
      status: {
        draftSha: 'a'.repeat(40),
        mainSha: 'b'.repeat(40),
        deployedSha: 'b'.repeat(40),
        operation: { targetMainSha: 'b'.repeat(40) },
      },
      options,
    })) as unknown as RunStructuralMutation;

    const result = await submitInspectorEditBatch(
      {
        slideId: 'deck',
        kind: 'slide',
        pageId: 'slides/deck/index.jsx#cover' as PageId,
        edits: [{ line: 4, column: 2, ops: [{ kind: 'set-text', value: 'Updated' }] }],
      },
      { hosted: true, runStructuralMutation },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runStructuralMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/__edit/batch',
        method: 'POST',
        protocolKind: 'inspector.batch-edit',
      }),
    );
    expect(result.results).toEqual([{ ok: true }]);
    expect(result.version).toMatchObject({ draftSha: 'a'.repeat(40), mainSha: 'b'.repeat(40) });
  });
});
