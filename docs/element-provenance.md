# Element provenance

Date: 2026-08-30

OpenSlide now records two additive provenance fields while transforming authored slide and document modules:

- `data-slide-source` identifies the source module relative to the content root, for example `slides/deck/index.tsx` or `documents/report/index.tsx`.
- `data-slide-callsite` identifies an authored component invocation by source module and JSX location.

Host elements and components that safely forward editing props receive `data-slide-source`. Component invocations receive `data-slide-callsite`, including components that do not forward unknown props to a host element. React retains those invocation props on the mounted component path. This lets editor tooling recover the ordered call path for a nested rendered element.

The values are independent of checkout location, Vite query parameters, render order, and the React root. Existing authored `data-slide-source` and `data-slide-callsite` attributes are preserved. Slides and documents that do not use the metadata render as before.

## Scope boundary

This change provides element provenance inputs. It does not create a persistent page identifier or publish `data-slide-identity`.

The current page model exports an array of component references. Two occurrences of the same component have no persistent per-occurrence discriminator. Array index, render order, process counters, and random values would not survive reorder across independent roots. Solving that problem requires a separate source-model and migration decision, which is outside this change.

## Verification

Unit tests cover source namespacing, Windows and HMR path normalization, distinct component callsites, nested call paths, and preservation of explicit provenance. A browser test compares the raw provenance recovered from the same nested elements in the canvas and thumbnail roots. It also proves that two component invocation sites are distinguishable without claiming a durable page identity.
