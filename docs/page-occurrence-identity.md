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

The writer uses page identity as its only source-selection authority. A number in a URL or navigation
state can choose what the viewer displays, but it cannot choose an expression to mutate.

### Source grammar and entry path

One parser is authoritative for identity resolution, reorder, duplicate, delete, catalog insertion,
legacy registration, and migration. It accepts either form below:

```tsx
export default [page('cover', Cover), Closing] satisfies Page[];

const pages: Page[] = ([page('cover', Cover), Closing] satisfies Page[]);
export default pages;
```

The named form must use one unambiguous top-level `const` initialized directly with an array. The
binding cannot be imported, shadowed, reassigned, or mutated. Holes and spread elements are rejected.
Parentheses, `as`, and `satisfies` wrappers do not change the rule.

An authored call must resolve to a value import from `@open-slide/core`. These imports are valid:

```tsx
import { page } from '@open-slide/core';
import { page as definePage } from '@open-slide/core';
import * as OpenSlide from '@open-slide/core';
```

The corresponding calls are `page(...)`, `definePage(...)`, and `OpenSlide.page(...)`. Type-only
imports, local spelling matches, computed members, and imports from another package are not page
factories. Generated writes reuse an existing alias or namespace. If none exists, the writer adds a
collision-free value import.

Entry discovery and mutation share the extension order `.tsx`, `.jsx`, `.ts`, `.js`. The chosen
entry's actual relative path is its `sourceModule`; the writer never rewrites an `index.jsx` page ID
as `index.tsx`. Source modules are slash-normalized repository-relative paths. Absolute Unix paths,
Windows drive paths, traversal, `./`, empty segments, query strings, and fragments are invalid.

### Local endpoints

| Operation | Request body | Success response |
| --- | --- | --- |
| `slide.reorder`, `PUT /__slides/:id/reorder` | `{ "pageIds": PageId[], "focusPageId"?: PageId }` | `200 { "ok": true, "slideId": string, "pageIds": PageId[] }` |
| `page.duplicate`, `POST /__slides/:id/pages/duplicate` | `{ "pageId": PageId }` | `200 { "ok": true, "slideId": string, "index": number, "pageId": PageId }`; `pageId` is the persisted copy |
| `page.delete`, `DELETE /__slides/:id/pages` | `{ "pageId": PageId }` | `200 { "ok": true, "slideId": string, "index": number, "pageId": PageId }`; `pageId` is the deleted occurrence |
| `catalog.insert`, `POST /__catalog` | `{ "slideId": string, "kind": ContentKind, "templateId": string, "beforePageId"?: PageId, "afterPageId"?: PageId }` | `200 { "ok": true, "componentName": string, "index": number, "pageId": PageId, "kind": ContentKind }` |
| `inspector.edit`, `POST /__edit` | `{ "slideId": string, "kind": ContentKind, "pageId": PageId, "line": number, "column": number, "ops": EditOp[], "strict": true }` | `200 { "ok": true, "changed": boolean }` |
| `inspector.batch-edit`, `POST /__edit/batch` | `{ "slideId": string, "kind": ContentKind, "pageId": PageId, "edits": (Edit & { "strict": true })[] }` | `200 { "ok": true, "changed": boolean, "results": [{ "ok": true }, ...] }` |

Immediate inspector actions use the direct endpoint. Buffered Save uses the batch endpoint. Both
send the current page ID. Document edits use `"kind": "document"` in the request body.

Catalog neighbors identify one exact boundary. At the start, only `beforePageId` is present. At the
end, only `afterPageId` is present. Both are absent for an empty array. Between pages, both are
present and must still be adjacent when the locked transaction reads the file. A missing or
non-adjacent neighbor is stale; the writer does not fall back to an index.

Every source mutation runs as one per-file transaction: canonical-path lock, read, identity
resolution, transformation, same-directory exclusive temporary write, file sync, mode-preserving
atomic rename, and directory sync where supported. A failed transform leaves the original file
untouched. Cleanup removes only the temporary file that the transaction created exclusively.

### Hosted inspector draft saves

The host maps the same direct inspector endpoints to authenticated draft writers. A successful
hosted response adds the current `draftSha`, `mainSha`, optional `deployedSha`, and
`hasDraftChanges`. Each hosted request also sends `expectedHead`, set to the latest known draft SHA.
The server rejects a stale head instead of applying the edit to an unexpected draft. Inspector Save
stops after the draft commit. It does not add structural coordination fields, return an operation
receipt, publish to main, or poll deployment status. `Publish all` remains the only non-structural
publication action.

### Hosted structural request envelope

Production adds all four fields below to every structural request:

```ts
type AuthoringCoordination = {
  operationId: string;       // UUID
  requestHash: string;       // `sha256:` plus 64 lowercase hex characters
  expectedDraftSha: string;  // 40- or 64-character Git object ID
  expectedMainSha: string;   // 40- or 64-character Git object ID
};
```

The structural body also carries `slideId` and the content `kind`. Reorder requires `pageIds` and
`focusPageId`. Duplicate and delete require the exact `pageId`. Catalog insert includes
`templateId` and `pageCount`, and includes only non-null neighbors. An empty artifact uses
`pageCount: 0` with no neighbors. A non-empty artifact requires at least one neighbor.

`requestHash` is SHA-256 over canonical JSON containing the uppercase HTTP method, normalized path
and sorted query string, and request body. Object keys are sorted recursively. Array order is kept.
`operationId` and `requestHash` are omitted from the hashed body; expected heads remain in it. This
makes a retry of the same logical request hash identically even when transport code rebuilds the
object in another key order.

Before a structural mutation starts, the client stores the operation ID, hash, expected heads,
endpoint, method, and complete JSON body in session storage. If the response is lost, retry replays
that exact stored request. A storage failure prevents dispatch.

The operation store applies these rules before reading or writing repository content:

| Existing `operationId` | Hash relation | Decision |
| --- | --- | --- |
| None | n/a | Reserve as pending and execute |
| Complete | Same | Return the stored receipt without another mutation |
| Pending | Same | Return `409 OPERATION_IN_PROGRESS`; the client polls status |
| Any state | Different | Return `409 OPERATION_ID_REUSED`; never execute |

Reservation is not concurrency control for Git. The writer reads both refs and requires exact
matches with `expectedDraftSha` and `expectedMainSha` before it reads source. It builds the draft
commit with `expectedDraftSha` as parent. Immediately before updating the draft ref, it reads both
refs again and aborts with `STALE_STUDIO_HEADS` if either changed. The draft ref update is a
compare-and-swap whose expected old value is `expectedDraftSha`. Publishing performs the same check
on main and updates main only while its old value is `expectedMainSha`. A main conflict after the
draft CAS leaves the durable draft commit available for status and recovery, but it cannot produce a
ready receipt or claim that the change reached main.

### Receipt and proof

A completed hosted mutation returns its operation-specific result plus this exact receipt:

```ts
type HostedOperationReceipt = {
  version: 1;
  operationId: string;
  requestHash: string;
  kind: 'slide.reorder' | 'page.duplicate' | 'page.delete' | 'catalog.insert';
  artifactId: string;
  baseDraftSha: string;
  baseMainSha: string;
  draftCommitSha: string;
  targetMainSha: string;
  proof: AuthoringOperationProof;
  createdAt: string; // ISO 8601
};
```

Every proof has `version: 1`, `kind`, the exact `sourceModule`, final `pageIds`, `focusPageId`, and
`resolvedPageIndex`. The operation-specific fields are:

| Kind | Required proof fields |
| --- | --- |
| `slide.reorder` | `orderedPageIds` |
| `page.duplicate` | `sourcePageId`, `createdPageId` |
| `page.delete` | `deletedPageId` |
| `catalog.insert` | `templateId`, `createdPageId` |

The client rejects a receipt whose operation ID, request hash, base heads, kind, proof, source path,
or page IDs do not match the request contract. Status polling can use `focusPageId` and
`resolvedPageIndex` for navigation, but those fields never select source during the write.

### Errors and compatibility

Local identity failures use `{ "error": string, "name": string, "code": string }`.
`PAGE_IDENTITY_VALIDATION` is HTTP 400. `PAGE_IDENTITY_COLLISION` and `PAGE_IDENTITY_STALE` are
HTTP 409. `PAGE_IDENTITY_UNAVAILABLE` is HTTP 422. Missing content is HTTP 404, including a missing
catalog target. Unsupported source shapes are HTTP 422. A safe no-op remains HTTP 200.

Hosted failures use `{ "ok": false, "code": string, "message": string, "allowedActions": string[] }`.
The status mapping is fixed: invalid request 400, read-only 403, missing content 404, stale heads,
operation reuse, in-progress operation, or stale page identity 409, unsupported source shape 422,
and internal failure 500.

Old page-index-only writes do not mutate source. The legacy `/pages/:index` URL is tolerated only
when the body contains a valid `pageId`; the numeric segment is ignored. Plain arrays with unique
named components remain writable through `#legacy:ComponentName`. Repeated legacy occurrences still
render, but every identity-dependent write fails closed until the occurrences receive authored IDs.
