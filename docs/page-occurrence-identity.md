# Persistent page occurrence identity

OpenSlide page arrays support an authored occurrence ID:

```tsx
import { page, type Page } from '@open-slide/core';

const Shared: Page = () => <main>Shared layout</main>;

export default [page('opening', Shared), page('closing', Shared)] satisfies Page[];
```

`page('stable-id', Component)` returns a renderable `Page`. The ID must match
`^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$`. OpenSlide validates it when the
module loads.

The runtime scopes the authored ID to the source module. For example, `opening` in
`slides/demo/index.tsx` becomes `slides/demo/index.tsx#opening`. The same local ID can appear in
another slide or document without colliding.

## Compatibility

Plain component arrays still render:

```tsx
export default [Cover, Details, Closing] satisfies Page[];
```

A unique named legacy component gets a stable fallback such as
`slides/demo/index.tsx#legacy:Cover`. This fallback survives a reload and a reorder because it is
derived from the source module and authored component name. The OpenSlide source transform
registers that authored name before production minification, so a mangled runtime function name
does not change the fallback.

Two legacy occurrences of the same component, such as `[Shared, Shared]`, still render. They do not
have enough authored information to distinguish one occurrence from the other. OpenSlide reports a
`PageIdentityCollisionError` and blocks inspector saves, reorder, duplicate, delete, and catalog
insertion for that page array. It does not assign IDs from array position or render order.

An anonymous or otherwise unnamed legacy page also renders, but identity-dependent writes fail with
`PageIdentityUnavailableError`.

## Migration

Existing decks do not need a migration to render. Add `page()` when a page needs a durable authored
identity, especially before reusing one component more than once:

```diff
-import type { Page } from '@open-slide/core';
+import { page, type Page } from '@open-slide/core';

-export default [Cover, Shared, Shared] satisfies Page[];
+export default [
+  page('cover', Cover),
+  page('shared-primary', Shared),
+  page('shared-summary', Shared),
+] satisfies Page[];
```

`migrateLegacyPageOccurrencesInSource()` can wrap a legacy array when every component name is
unique. It derives IDs from component names and writes the `page` import into the same source file.
It refuses duplicate legacy occurrences because choosing which logical occurrence gets which ID
would require array position as authority.

Duplicating one unique legacy page is safe without a full migration. OpenSlide keeps the original
legacy fallback and writes the copy as an authored occurrence. For example, duplicating `Cover` in
`[Cover]` writes `[Cover, page('cover-copy', Cover)]`. Further copies use `cover-copy-2`,
`cover-copy-3`, and so on. The generated ID is derived from the selected page ID and the IDs already
present in source. No random value or process counter is involved.

## Structural and editing rules

Reorder requests send the ordered page IDs. The source writer resolves those IDs against the current
file and then moves the original source expressions. A numeric index can still appear in navigation
state, but it does not select the source occurrence to change.

Duplicate and delete requests target one page ID. Duplicate persists a new authored ID. Delete
removes the selected expression and never changes survivor IDs. Catalog insertion identifies its
boundary with the adjacent page IDs and writes an authored ID for the inserted page.

Inspector saves include the current page ID. The server verifies that ID against the latest source
before applying the element edit. A stale ID fails with `PageIdentityStaleError`.

Canvas, thumbnail, overview, presenter, preload, HTML, PDF, and image-PPTX roots all receive the same
normalized page ID. `useSlidePageIdentity()` exposes it inside a page component. Export root elements
also carry `data-slide-page-id`.

All content remains in the authored source module. OpenSlide does not create a sidecar identity
database or a second publication path.

## Writer API contract

The Vite-local writer uses page identity as the only source-selection authority. A hosted Studio
writer must implement the same contract before an identity-aware client is deployed against it.
Navigation indices may remain in URLs for old clients, but a writer must ignore them when choosing
an authored occurrence.

| Operation | Request body | Local success response |
| --- | --- | --- |
| Reorder, `PUT /__slides/:id/reorder` | `{ "pageIds": PageId[], "focusPageId": PageId }` | `200 { "ok": true, "slideId": string, "pageIds": PageId[] }` |
| Duplicate page, `POST /__slides/:id/pages/duplicate` | `{ "pageId": PageId }` | `200 { "ok": true, "slideId": string, "index": number, "pageId": PageId }`, where `pageId` is the persisted copy ID |
| Delete page, `DELETE /__slides/:id/pages` | `{ "pageId": PageId }` | `200 { "ok": true, "slideId": string, "index": number, "pageId": PageId }`, where `pageId` is the deleted occurrence ID |
| Single inspector edit, `POST /__edit` | `{ "slideId": string, "kind": ContentKind, "pageId": PageId, "line": number, "column": number, "ops": EditOp[], "strict": true }` | `200 { "ok": true, "changed": boolean }` |
| Batch inspector edit, `POST /__edit/batch` | `{ "slideId": string, "kind": ContentKind, "pageId": PageId, "edits": Edit[] }` | `200 { "ok": true, "changed": boolean, "results": [{ "ok": true }, ...] }` |
| Catalog insertion, `POST /__catalog` | `{ "slideId": string, "kind": ContentKind, "templateId": string, "beforePageId": PageId \| null, "afterPageId": PageId \| null }` | `200 { "ok": true, "componentName": string, "index": number, "pageId": PageId, "kind": ContentKind }` |

Document requests use `?kind=document` on slide routes. `focusPageId` preserves the logical focused
page for hosted coordination; it is not allowed to select the source expression. In production,
the hosted-operation wrapper adds `operationId`, `expectedDraftSha`, and `expectedMainSha` to every
structural request body. A hosted success response contains the operation-specific fields above plus
an `operation` receipt with `operationId`, `kind`, `artifactId`, `baseMainSha`, `draftCommitSha`,
`targetMainSha`, `requestHash`, `proof`, and receipt version. The existing status polling contract
then verifies and deploys that receipt.

For catalog insertion, the two neighbor IDs describe one boundary. At the beginning,
`afterPageId` is absent and `beforePageId` is the first page. At the end, `afterPageId` is the last
page and `beforePageId` is absent. For an empty deck both are absent. Between pages, both are present
and must still be adjacent when the server reads the latest source. A missing or non-adjacent
neighbor is stale and must not fall back to a numeric insertion index.

The writer resolves every request against the latest source text. It accepts authored `page()`
entries and unique named legacy entries. Reorder moves the original array expressions. Duplicate
writes a new `page('...-copy', Component)` expression. Delete removes only the selected expression.
Catalog insertion writes a new authored occurrence. Existing plain arrays continue to render, and a
unique legacy occurrence remains writable through its `#legacy:ComponentName` ID. Duplicate legacy
occurrences render but all identity-dependent writes fail closed.

Identity failures use a stable JSON shape: `{ "error": string, "name": string, "code": string }`.
The codes are `PAGE_IDENTITY_VALIDATION`, `PAGE_IDENTITY_COLLISION`, `PAGE_IDENTITY_STALE`, and
`PAGE_IDENTITY_UNAVAILABLE`. Validation errors use HTTP 400. Collisions and stale identities use
HTTP 409. Unavailable identity uses HTTP 422. Missing content remains 404, unsafe or unsupported
source transformations remain 422, and successful no-op writes remain 200. Hosted coordination
errors retain the existing `{ "ok": false, "code": string, "message": string,
"allowedActions": string[] }` shape.

Old numeric reorder bodies and page-index-only writes must not silently mutate source. The local
writer may accept the old `/pages/:index` URL only when a valid `pageId` body is also present, and it
ignores the numeric segment. During a staged hosted rollout an old request may receive an explicit
compatibility error, or an adapter may first resolve the current page ID and then call the
identity-aware writer. A hosted writer must parse both `page('id', Component)` and unique plain
component entries before enabling the new client contract.

The Studio hosted writer is outside this package. It must gain this parser and contract in a
separate companion change before the full Studio program can be called ready.
