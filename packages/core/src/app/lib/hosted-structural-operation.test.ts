import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchStoredStructuralRequest,
  prepareStoredStructuralRequest,
} from './hosted-structural-operation.ts';

const draftSha = 'a'.repeat(40);
const mainSha = 'b'.repeat(40);
const commitSha = 'c'.repeat(40);
const operationId = '7dc1b749-ff9f-4d7c-a150-7c4f2f2868a2';

describe('stored structural requests', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('persists before dispatch and replays the exact operation identity after response loss', async () => {
    const stored = await prepareStoredStructuralRequest({
      label: 'Duplicate slide',
      endpoint: '/__slides/deck/pages/duplicate',
      method: 'POST',
      protocolKind: 'page.duplicate',
      operationId,
      version: {
        draftSha,
        mainSha,
        deployedSha: mainSha,
        hasDraftChanges: true,
      },
      body: {
        slideId: 'deck',
        kind: 'slide',
        pageId: 'slides/deck/index.tsx#cover',
      },
    });
    const events: string[] = [];
    const bodies: string[] = [];
    let dispatchCount = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      events.push('fetch');
      bodies.push(String(init?.body));
      dispatchCount += 1;
      if (dispatchCount === 1) throw new Error('response lost');
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      return Response.json({
        pageId: 'slides/deck/index.tsx#cover-copy',
        operation: {
          version: 1,
          operationId: body.operationId,
          requestHash: body.requestHash,
          kind: 'page.duplicate',
          artifactId: 'deck',
          baseDraftSha: body.expectedDraftSha,
          baseMainSha: body.expectedMainSha,
          draftCommitSha: commitSha,
          targetMainSha: commitSha,
          proof: {
            version: 1,
            kind: 'page.duplicate',
            sourceModule: 'slides/deck/index.tsx',
            pageIds: ['slides/deck/index.tsx#cover', 'slides/deck/index.tsx#cover-copy'],
            focusPageId: 'slides/deck/index.tsx#cover-copy',
            resolvedPageIndex: 1,
            sourcePageId: 'slides/deck/index.tsx#cover',
            createdPageId: 'slides/deck/index.tsx#cover-copy',
          },
          createdAt: '2026-08-31T00:00:00.000Z',
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const persist = vi.fn(() => events.push('persist'));

    await expect(dispatchStoredStructuralRequest(stored, persist)).rejects.toThrow('response lost');
    const replay = await dispatchStoredStructuralRequest(stored, persist);

    expect(events).toEqual(['persist', 'fetch', 'persist', 'fetch']);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({
      operationId,
      requestHash: stored.requestHash,
      expectedDraftSha: draftSha,
      expectedMainSha: mainSha,
    });
    expect(replay.operation.operationId).toBe(operationId);
    expect(replay.operation.requestHash).toBe(stored.requestHash);
  });

  it('does not dispatch when durable persistence fails', async () => {
    const stored = await prepareStoredStructuralRequest({
      label: 'Delete slide',
      endpoint: '/__slides/deck/pages',
      method: 'DELETE',
      protocolKind: 'page.delete',
      operationId,
      version: { draftSha, mainSha, hasDraftChanges: false },
      body: {
        slideId: 'deck',
        kind: 'slide',
        pageId: 'slides/deck/index.tsx#cover',
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      dispatchStoredStructuralRequest(stored, () => {
        throw new Error('storage unavailable');
      }),
    ).rejects.toThrow('storage unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
