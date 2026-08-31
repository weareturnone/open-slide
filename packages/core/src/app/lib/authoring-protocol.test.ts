import { describe, expect, it } from 'vitest';
import {
  type AuthoringMutationKind,
  authoringErrorStatus,
  authoringRequestHash,
  decideAuthoringIdempotency,
  duplicateResultPageIndex,
  parseAuthoringMutationRequest,
  parseHostedOperationReceipt,
} from './authoring-protocol.ts';

const draftSha = 'a'.repeat(40);
const mainSha = 'b'.repeat(40);
const requestHash = `sha256:${'c'.repeat(64)}`;
const operationId = '7dc1b749-ff9f-4d7c-a150-7c4f2f2868a2';

describe('authoring mutation protocol', () => {
  it('parses every structural request with required hosted coordination', () => {
    const coordination = {
      operationId,
      requestHash,
      expectedDraftSha: draftSha,
      expectedMainSha: mainSha,
    };
    const requests = [
      [
        'slide.reorder',
        {
          ...coordination,
          slideId: 'deck',
          kind: 'slide',
          pageIds: ['slides/deck/index.jsx#a'],
          focusPageId: 'slides/deck/index.jsx#a',
        },
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
          pageCount: 1,
          afterPageId: 'slides/deck/index.jsx#a',
        },
      ],
    ] as const;

    for (const [kind, value] of requests) {
      expect(parseAuthoringMutationRequest(kind, value, { hosted: true }).kind).toBe(kind);
    }
  });

  it('permits an empty catalog target but requires a boundary for non-empty content', () => {
    const base = { slideId: 'deck', kind: 'slide', templateId: 'agenda' };
    expect(
      parseAuthoringMutationRequest('catalog.insert', { ...base, pageCount: 0 }),
    ).toMatchObject({ pageCount: 0, beforePageId: undefined, afterPageId: undefined });
    expect(() =>
      parseAuthoringMutationRequest('catalog.insert', { ...base, pageCount: 1 }),
    ).toThrow(/boundary/i);
    expect(() =>
      parseAuthoringMutationRequest('catalog.insert', {
        ...base,
        pageCount: 1,
        beforePageId: null,
        afterPageId: null,
      }),
    ).toThrow(/beforePageId|afterPageId/);
  });

  it('retains the reorder focus identity in the parsed contract', () => {
    const parsed = parseAuthoringMutationRequest('slide.reorder', {
      slideId: 'deck',
      kind: 'document',
      pageIds: ['documents/deck/index.ts#a', 'documents/deck/index.ts#b'],
      focusPageId: 'documents/deck/index.ts#b',
    });
    expect(parsed).toMatchObject({
      contentKind: 'document',
      focusPageId: 'documents/deck/index.ts#b',
    });
  });

  it('rejects inspector saves as structural operations', () => {
    expect(() =>
      parseAuthoringMutationRequest(
        'inspector.batch-edit' as AuthoringMutationKind,
        {
          operationId,
          requestHash,
          expectedDraftSha: draftSha,
          expectedMainSha: mainSha,
          slideId: 'deck',
          kind: 'slide',
          pageId: 'slides/deck/index.jsx#a',
          edits: [{ line: 12, column: 4, ops: [{ kind: 'set-text', value: 'Hello' }] }],
        },
        { hosted: true },
      ),
    ).toThrow(/unsupported authoring mutation kind/i);
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
        focusPageId: 'C:\\repo\\slides\\deck\\index.tsx#a',
      }),
    ).toThrow();
  });

  it('hashes a canonical method, endpoint, and body independent of object key order', async () => {
    const first = await authoringRequestHash('put', '/__slides/deck/reorder?kind=slide&z=2', {
      expectedMainSha: mainSha,
      pageIds: ['slides/deck/index.tsx#a'],
      operationId,
      expectedDraftSha: draftSha,
    });
    const second = await authoringRequestHash('PUT', '/__slides/deck/reorder?z=2&kind=slide', {
      expectedDraftSha: draftSha,
      operationId: 'different-operation-id',
      pageIds: ['slides/deck/index.tsx#a'],
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

  it('binds receipt source, artifact, page, and focus proof to the original request', () => {
    const request = parseAuthoringMutationRequest(
      'page.duplicate',
      {
        operationId,
        requestHash,
        expectedDraftSha: draftSha,
        expectedMainSha: mainSha,
        slideId: 'deck',
        kind: 'slide',
        pageId: 'slides/deck/index.jsx#a',
      },
      { hosted: true },
    );
    expect(
      parseHostedOperationReceipt(receipt, request.coordination ?? undefined, request),
    ).toEqual(receipt);

    const contradictions = [
      { ...receipt, artifactId: 'other' },
      { ...receipt, proof: { ...receipt.proof, sourceModule: 'slides/other/index.jsx' } },
      { ...receipt, proof: { ...receipt.proof, sourcePageId: 'slides/deck/index.jsx#other' } },
      { ...receipt, proof: { ...receipt.proof, focusPageId: 'slides/deck/index.jsx#a' } },
      { ...receipt, proof: { ...receipt.proof, resolvedPageIndex: 0 } },
    ];
    for (const contradictory of contradictions) {
      expect(() =>
        parseHostedOperationReceipt(contradictory, request.coordination ?? undefined, request),
      ).toThrow();
    }
  });

  it('binds catalog receipts to the exact requested insertion boundary', () => {
    const request = parseAuthoringMutationRequest(
      'catalog.insert',
      {
        operationId,
        requestHash,
        expectedDraftSha: draftSha,
        expectedMainSha: mainSha,
        slideId: 'deck',
        kind: 'slide',
        templateId: 'agenda',
        pageCount: 2,
        afterPageId: 'slides/deck/index.jsx#a',
        beforePageId: 'slides/deck/index.jsx#b',
      },
      { hosted: true },
    );
    const catalogReceipt = {
      ...receipt,
      kind: 'catalog.insert' as const,
      proof: {
        version: 1 as const,
        kind: 'catalog.insert' as const,
        sourceModule: 'slides/deck/index.jsx',
        pageIds: [
          'slides/deck/index.jsx#a',
          'slides/deck/index.jsx#created',
          'slides/deck/index.jsx#b',
        ],
        focusPageId: 'slides/deck/index.jsx#created',
        resolvedPageIndex: 1,
        templateId: 'agenda',
        createdPageId: 'slides/deck/index.jsx#created',
      },
    };

    expect(
      parseHostedOperationReceipt(catalogReceipt, request.coordination ?? undefined, request),
    ).toEqual(catalogReceipt);

    const invalidPageOrders = [
      ['slides/deck/index.jsx#a', 'slides/deck/index.jsx#b', 'slides/deck/index.jsx#created'],
      ['slides/deck/index.jsx#created', 'slides/deck/index.jsx#a', 'slides/deck/index.jsx#b'],
      ['slides/deck/index.jsx#a', 'slides/deck/index.jsx#created', 'slides/deck/index.jsx#other'],
    ];
    for (const pageIds of invalidPageOrders) {
      expect(() =>
        parseHostedOperationReceipt(
          {
            ...catalogReceipt,
            proof: {
              ...catalogReceipt.proof,
              pageIds,
              resolvedPageIndex: pageIds.indexOf('slides/deck/index.jsx#created'),
            },
          },
          request.coordination ?? undefined,
          request,
        ),
      ).toThrow(/catalog proof/i);
    }
  });

  it('uses the authoritative duplicate result when concurrent suffix allocation changes the id', () => {
    const concurrentReceipt = parseHostedOperationReceipt({
      ...receipt,
      proof: {
        ...receipt.proof,
        pageIds: ['slides/deck/index.jsx#a', 'slides/deck/index.jsx#a-copy-2'],
        focusPageId: 'slides/deck/index.jsx#a-copy-2',
        createdPageId: 'slides/deck/index.jsx#a-copy-2',
      },
    });

    expect(
      duplicateResultPageIndex(concurrentReceipt, {
        pageId: 'slides/deck/index.jsx#a-copy-2',
      }),
    ).toBe(1);
    expect(() =>
      duplicateResultPageIndex(concurrentReceipt, { pageId: 'slides/deck/index.jsx#a-copy' }),
    ).toThrow(/authoritative page id/i);
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
