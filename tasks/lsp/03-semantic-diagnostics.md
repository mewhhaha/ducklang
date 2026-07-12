# Semantic Diagnostics Beyond Parse Errors

## Goal

Report what the compiler knows — binding errors, annotation failures, const
violations, linearity and ownership rejections — as ranged diagnostics, not just
the first parse error. rust-analyzer's equivalent is cargo-check-level
diagnostics fused with its own analysis.

## Work

- Thread spans through frontend diagnostics: the frontend and Core passes
  currently throw plain `Error`s with prose messages. Introduce a diagnostic
  value with span, severity, code, and optional related spans; migrate the
  highest-traffic rejection sites first (binding/shadowing checks, const
  validation in `constness.ts`, linear-use checks, annotation checks).
- Decide per-route analysis depth: full compilation can fail for route-coverage
  reasons that are not user errors. Start with route-agnostic frontend analysis
  (parse, binding resolution, constness, linearity, annotation checks) and gate
  route-specific lowering diagnostics behind a configuration flag.
- Debounce analysis on didChange; always analyze on didOpen/didSave.
- Publish warnings distinct from errors (e.g. unused non-linear binding), and
  carry `relatedInformation` for two-location errors such as duplicate
  declarations or use-after-consume of a linear value.
- Map the comptime `fail("...")` diagnostic to the `comptime`/fact-checker call
  site span.

## Acceptance Criteria

- Every `examples/failures/compile/*.ix` fixture produces at least one ranged
  diagnostic pointing at the offending construct, not line 1.
- Valid examples produce zero diagnostics on every route-agnostic pass.
- A keystroke burst triggers at most one analysis per debounce window, and the
  published version matches the analyzed version.

## Verification

- Golden diagnostic fixtures (path, range, code, message) for each failure
  example; snapshot-tested.
- Latency budget test: analysis of the largest example under a fixed wall-clock
  ceiling in CI.

## Implementation Status

Implemented.

`Source.analyze` now combines tolerant syntax diagnostics with structured
frontend, const/comptime, linear-use, import, and optional Core ownership
diagnostics. Diagnostics carry stable codes, severities, exact UTF-16 source
spans, and related locations. Route-specific checks are opt-in, resolve valid
import graphs, and contain known backend coverage gaps instead of crashing
editor analysis.

The LSP caches analysis by document version, debounces change bursts, analyzes
open/save immediately, republishes invalidated importers, and preserves the
analyzed version in publications. Warning analysis distinguishes unused bindings
while respecting lexical binders, handlers, type tests, and annotation
references.

Verification covers every compile-failure golden, all 69 successful examples on
their configured routes, malformed and cyclic imports, contextual annotations,
diagnostic deduplication, dependency invalidation, UTF position mapping,
debounce/version behavior, and the fixed latency budget.
