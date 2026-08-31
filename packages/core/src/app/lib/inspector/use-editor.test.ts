import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type PageId,
  PageIdentityStaleError,
  PageIdentityUnavailableError,
} from '../page-identity.ts';
import {
  currentPageIdOrThrow,
  expectedInspectorHeadOrThrow,
  submitInspectorEdit,
  submitInspectorEditBatch,
} from './use-editor.ts';

const pageId = 'slides/deck/index.jsx#cover' as PageId;
const draftSha = 'a'.repeat(40);
const mainSha = 'b'.repeat(40);
const expectedHead = 'c'.repeat(40);

function editResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('inspector edit transport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts an immediate edit directly with the exact current page identity', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      editResponse({
        ok: true,
        changed: true,
        draftSha,
        mainSha,
        deployedSha: mainSha,
        hasDraftChanges: true,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const version = await submitInspectorEdit({
      slideId: 'deck',
      kind: 'slide',
      pageId,
      expectedHead,
      line: 4,
      column: 2,
      ops: [{ kind: 'set-text', value: 'Updated' }],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [endpoint, init] = fetchMock.mock.calls[0] ?? [];
    expect(endpoint).toBe('/__edit');
    expect(JSON.parse(String(init?.body))).toEqual({
      slideId: 'deck',
      kind: 'slide',
      pageId,
      expectedHead,
      line: 4,
      column: 2,
      ops: [{ kind: 'set-text', value: 'Updated' }],
      strict: true,
    });
    expect(version).toEqual({
      draftSha,
      mainSha,
      deployedSha: mainSha,
      hasDraftChanges: true,
    });
    expect(version?.draftSha).not.toBe(version?.mainSha);
  });

  it('posts a batch directly without structural or publication coordination', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      editResponse({
        changed: true,
        results: [{ ok: true }, { ok: true }],
        draftSha,
        mainSha,
        deployedSha: mainSha,
        hasDraftChanges: true,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitInspectorEditBatch({
      slideId: 'deck',
      kind: 'document',
      pageId,
      expectedHead,
      edits: [
        { line: 4, column: 2, ops: [{ kind: 'set-text', value: 'Updated' }] },
        { line: 8, column: 3, ops: [{ kind: 'set-style', key: 'color', value: '#123456' }] },
      ],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [endpoint, init] = fetchMock.mock.calls[0] ?? [];
    expect(endpoint).toBe('/__edit/batch');
    expect(JSON.parse(String(init?.body))).toEqual({
      slideId: 'deck',
      kind: 'document',
      pageId,
      expectedHead,
      edits: [
        {
          line: 4,
          column: 2,
          ops: [{ kind: 'set-text', value: 'Updated' }],
          strict: true,
        },
        {
          line: 8,
          column: 3,
          ops: [{ kind: 'set-style', key: 'color', value: '#123456' }],
          strict: true,
        },
      ],
    });
    expect(JSON.parse(String(init?.body))).not.toMatchObject({
      operationId: expect.anything(),
      requestHash: expect.anything(),
      expectedDraftSha: expect.anything(),
      expectedMainSha: expect.anything(),
    });
    expect(result).toEqual({
      changed: true,
      results: [{ ok: true }, { ok: true }],
      version: { draftSha, mainSha, deployedSha: mainSha, hasDraftChanges: true },
    });
    expect(result.version?.draftSha).not.toBe(result.version?.mainSha);
    expect(result.version?.hasDraftChanges).toBe(true);
  });

  it('fails closed on missing or stale client identity before dispatch', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      editResponse({}),
    );
    vi.stubGlobal('fetch', fetchMock);
    const dispatch = async (identity: PageId | null, error: PageIdentityStaleError | null) =>
      submitInspectorEdit({
        slideId: 'deck',
        kind: 'slide',
        pageId: currentPageIdOrThrow(identity, error),
        line: 4,
        column: 2,
        ops: [{ kind: 'set-text', value: 'Blocked' }],
      });

    await expect(dispatch(null, null)).rejects.toBeInstanceOf(PageIdentityUnavailableError);
    await expect(dispatch(pageId, new PageIdentityStaleError(pageId))).rejects.toBeInstanceOf(
      PageIdentityStaleError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when a hosted draft head is unavailable', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(() => expectedInspectorHeadOrThrow(true, null)).toThrow(/draft head is unavailable/i);
    expect(expectedInspectorHeadOrThrow(false, null)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
