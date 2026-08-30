# T-01 deterministic page and element identity spike

Date: 2026-08-30

Status: superseded by the authored occurrence model in
[`page-occurrence-identity.md`](./page-occurrence-identity.md). This document preserves the spike
evidence that ruled out array position and component occurrence counts. Its `RETHINK` decision
describes the former page model, not the current implementation.

Decision: **RETHINK**

The element identity inputs can be recovered consistently from independently mounted React roots. The current page array model cannot assign a stable identity to two occurrences of the same page component without adding persistent per-occurrence data to the source. T-02 must not assume that page identity is solved.

## Invariants

1. A source module identity is relative to the content root, slash-normalized, and independent of checkout location or Vite query parameters.
2. A page identity follows an authored page when pages reorder. It distinguishes duplicated page occurrences without using array index, render order, a process counter, or randomness.
3. An element identity contains the page identity, the ordered component invocation path, stable authored keys for repeated instances at one invocation, and the independently authored host element location or explicit element ID.
4. The same identity inputs produce the same identity in canvas, thumbnail, overview, presenter, and export roots.
5. Separate component invocation sites and distinct authored keys produce distinct identities.
6. Existing `id`, `data-slide-loc`, `data-slide-target`, and explicit provenance attributes remain unchanged. Missing identity metadata must not prevent rendering.
7. When the available source contains no stable discriminator, identity resolution must report a collision instead of inventing an identity.

## Existing render and editing paths

`SlideModule.default` is an array of React page component references. The canvas, thumbnail rail, overview grid, and presenter preload and transition layers each instantiate those components independently. HTML, PDF, and PPTX export create separate DOM and React render roots for page capture. `SlidePageProvider` supplies only the current array index and total page count.

The inspector currently anchors edits with `data-slide-loc` and protects a write with `data-slide-target`. The Vite location transform adds those attributes to host elements and to direct components that can safely forward them. The crop path uses the same metadata. `pageComponentIdentities` identifies pages as `ComponentName#occurrence`, so its occurrence suffix is array-order dependent. Duplicate-page editing writes another copy of the same array expression, such as `[Shared, Shared]`; it does not create a persistent occurrence record.

## Prototype

The Vite transform now emits two additional, additive provenance values for authored content modules:

- `data-slide-source` on independently taggable elements, using a canonical value such as `slides/deck/index.tsx`.
- `data-slide-callsite` on component invocations, using the canonical source module plus the authored JSX location.

React retains invocation props and authored `key` values on the fiber path even when a function component does not forward unknown props to the DOM. The browser test walks that mounted path from a nested host element and composes this candidate tuple:

```text
version, page identity, ordered (component callsite, authored key) path,
host source module, host source location, target fingerprint
```

The tuple is content-derived and contains no root, render-order, or runtime-random input. The prototype deliberately stops short of publishing `data-slide-identity` or wiring an editor API because the page invariant fails.

## Evidence

| Case | Result | Evidence |
| --- | --- | --- |
| Unique pages reordered | Pass | Component definition provenance remains stable. |
| Duplicate page component without per-occurrence IDs | Fail, collision detected | Both array entries expose the same module and component definition. |
| Duplicate pages with hypothetical persistent occurrence IDs | Pass | The composition test proves sufficiency, but the current source model has nowhere to store those IDs. |
| Separate canvas and thumbnail roots | Pass | Browser test produces equal candidate identities for the same nested leaf. |
| Two instances of one shared component | Pass | Their outer invocation locations differ while their shared inner invocation and leaf locations match. |
| Nested components that drop unknown props | Pass | The mounted React path retains both invocation records. |
| Repetition at one invocation site | Conditional | Stable authored React keys distinguish instances; unkeyed instances collide and are rejected. |
| Existing explicit element ID | Pass | The ID is preserved and can replace the host source location as the element anchor. |

The duplicate-page failure is not an implementation gap. Given `[Shared, Shared]`, both occurrences have the same module and component definition. Swapping them leaves the source and runtime values unchanged. A deterministic function therefore has no information with which to decide which logical occurrence moved. Array position and occurrence count violate the reorder invariant. A random or process-local ID violates determinism across roots. A sidecar registry creates a second content model.

The remaining solution class is a persistent authored occurrence ID, represented in the page array syntax or in a new page descriptor. That is a source-model change and requires a compatibility and migration design. It is outside this spike's constraints.

## Cross-root conclusion

The canvas and thumbnail result demonstrates the hard React behavior directly. Overview and presenter reuse the same transformed page component path, so the same mounted-path resolver has the same inputs there. HTML, PDF, and PPTX exports also create independent roots from the transformed component, but export would need to materialize the composed identity before each root unmounts. That propagation is intentionally not implemented while page identity is unresolved.

Existing decks and documents continue to render because every added attribute is optional and the page model is unchanged.

## Verification

- `pnpm exec vitest run packages/core/src/vite/loc-tags-plugin.test.ts packages/core/src/vite/identity-spike.test.ts packages/core/src/editing/slide-ops.test.ts`: 3 files and 115 tests passed.
- `pnpm test`: 24 files and 394 tests passed.
- `pnpm typecheck`: all three Turbo tasks passed.
- `pnpm build`: all four Turbo build tasks passed. The core build retained its known unresolved virtual-config warnings.
- `pnpm check`: passed with eight warnings in unchanged files.
- `pnpm --dir packages/core exec playwright test e2e/tests/inspector.spec.ts`: 11 browser tests passed.
- `OPEN_SLIDE_E2E_PORT=43118 pnpm --dir packages/core exec playwright test e2e/tests/inspector.spec.ts --grep "nested component provenance"`: the final focused browser proof passed after another worktree occupied the default test port.
- `git diff --check`: passed.

## Decision for T-02

T-02 is not safe to plan against the current page array interface. First choose and test a persistent page-occurrence representation that survives reorder and duplicate operations. If that requires automatic source migration or a sidecar model, the draft projection should be redesigned around that cost rather than treating identity as an internal implementation detail.
