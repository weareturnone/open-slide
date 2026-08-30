import { describe, expect, it } from 'vitest';
import {
  authoringErrorStatus,
  authoringRequestHash,
  decideAuthoringIdempotency,
  parseAuthoringMutationRequest,
  parseHostedOperationReceipt,
} from './authoring-protocol.ts';

const draftSha = 'a'.repeat(40);
const mainSha = 'b'.repeat(40);
const requestHash = `sha256:${'c'.repeat(64)}`;
const operationId = '7dc1b749-ff9f-4d7c-a150-7c4f2f2868a2';

describe('authoring mutation protocol', () => {
  it('parses every identity-sensitive request with required hosted coordination', () => {
    const coordination = {
      operationId,
      requestHash,
      expectedDraftSha: draftSha,
      expectedMainSha: mainSha,
    };
    const requests = [
      [
        'slide.reorder',
        { ...coordination, slideId: 'deck', kind: 'slide', pageIds: ['slides/deck/index.jsx#a'] },
      ],
      [
        'page.duplicate',
        { ...coordination, slideId: 'deck', kind: 'slide', pageId: 'slides/deck/index.jsx#a' },
      ],
      [
        'page.delete',
        { ...coordination, slideId: 'deck', kind: 'slide', pageId: 'slides/deck/index.jsx#a' },
      ],
      [
        'catalog.insert',
        {
          ...coordination,
          slideId: 'deck',
          kind: 'slide',
          templateId: 'agenda',
          afterPageId: 'slides/deck/index.jsx#a',
        },
      ],
      [
        'inspector.batch-edit',
        {
          ...coordination,
          slideId: 'deck',
          kind: 'slide',
          pageId: 'slides/deck/index.jsx#a',
          edits: [{ line: 12, column: 4, ops: [{ kind: 'set-text', value: 'Hello' }] }],
        },
      ],
    ] as const;

    for (const [kind, value] of requests) {
      expect(parseAuthoringMutationRequest(kind, value, { hosted: true }).kind).toBe(kind);
    }
  });

  it('rejects partial coordination and malformed identity fields', () => {
    expect(() =>
      parseAuthoringMutationRequest(
        'page.delete',
        {
          operationId,
          expectedDraftSha: draftSha,
          expectedMainSha: mainSha,
          slideId: 'deck',
          kind: 'slide',
          pageId: 'slides/deck/index.tsx#a',
        },
        { hosted: true },
      ),
    ).toThrow(/requestHash/);
    expect(() =>
      parseAuthoringMutationRequest('slide.reorder', {
        slideId: 'deck',
        kind: 'slide',
        pageIds: ['C:\\repo\\slides\\deck\\index.tsx#a'],
      }),
    ).toThrow();
  });

  it('hashes a canonical method, endpoint, and body independent of object key order', async () => {
    const first = await authoringRequestHash('post', '/__edit/batch?kind=slide&z=2', {
      expectedMainSha: mainSha,
      edits: [{ column: 2, line: 1 }],
      operationId,
      expectedDraftSha: draftSha,
    });
    const second = await authoringRequestHash('POST', '/__edit/batch?z=2&kind=slide', {
      expectedDraftSha: draftSha,
      operationId: 'different-operation-id',
      edits: [{ line: 1, column: 2 }],
      expectedMainSha: mainSha,
    });

    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });
});

describe('hosted operation receipts and idempotency', () => {
  const receipt = parseHostedOperationReceipt({
    version: 1,
    operationId,
    requestHash,
    kind: 'page.duplicate',
    artifactId: 'deck',
    baseDraftSha: draftSha,
    baseMainSha: mainSha,
    draftCommitSha: 'd'.repeat(40),
    targetMainSha: 'e'.repeat(40),
    proof: {
      version: 1,
      kind: 'page.duplicate',
      sourceModule: 'slides/deck/index.jsx',
      pageIds: ['slides/deck/index.jsx#a', 'slides/deck/index.jsx#a-copy'],
      focusPageId: 'slides/deck/index.jsx#a-copy',
      resolvedPageIndex: 1,
      sourcePageId: 'slides/deck/index.jsx#a',
      createdPageId: 'slides/deck/index.jsx#a-copy',
    },
    createdAt: '2026-08-31T00:00:00.000Z',
  });

  it('accepts an exact receipt and rejects a response for another request', () => {
    expect(
      parseHostedOperationReceipt(receipt, {
        operationId,
        requestHash,
        expectedDraftSha: draftSha,
        expectedMainSha: mainSha,
      }),
    ).toEqual(receipt);
    expect(() =>
      parseHostedOperationReceipt(
        { ...receipt, requestHash: `sha256:${'f'.repeat(64)}` },
        {
          operationId,
          requestHash,
          expectedDraftSha: draftSha,
          expectedMainSha: mainSha,
        },
      ),
    ).toThrow(/request hash/i);
  });

  it('distinguishes new, replay, in-progress, and operation-ID reuse', () => {
    expect(decideAuthoringIdempotency(null, requestHash)).toEqual({ action: 'new' });
    expect(
      decideAuthoringIdempotency({ requestHash, state: 'complete', receipt }, requestHash),
    ).toEqual({ action: 'replay', receipt });
    expect(decideAuthoringIdempotency({ requestHash, state: 'pending' }, requestHash)).toEqual({
      action: 'in-progress',
    });
    expect(
      decideAuthoringIdempotency(
        { requestHash: `sha256:${'f'.repeat(64)}`, state: 'pending' },
        requestHash,
      ),
    ).toEqual({ action: 'reject', code: 'OPERATION_ID_REUSED' });
  });

  it('pins public error codes to HTTP status classes', () => {
    expect(authoringErrorStatus('INVALID_AUTHORING_REQUEST')).toBe(400);
    expect(authoringErrorStatus('STUDIO_READ_ONLY')).toBe(403);
    expect(authoringErrorStatus('CONTENT_NOT_FOUND')).toBe(404);
    expect(authoringErrorStatus('STALE_STUDIO_HEADS')).toBe(409);
    expect(authoringErrorStatus('OPERATION_ID_REUSED')).toBe(409);
    expect(authoringErrorStatus('UNSUPPORTED_SOURCE_SHAPE')).toBe(422);
    expect(authoringErrorStatus('INTERNAL_AUTHORING_ERROR')).toBe(500);
  });
});
