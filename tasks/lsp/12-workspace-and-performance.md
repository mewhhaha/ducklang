# Workspace, Performance, And Test Harness

## Goal

Cross-file correctness, responsiveness under load, and the fixture harness that
keeps every other task honest. rust-analyzer's equivalents: workspace loading,
salsa incrementality, cancellation, and its fixture test DSL.

## Work

- Workspace model: discover roots (`AGENTS.md`, `.git`), resolve the import
  graph, and load imported files from disk with editor overlays taking
  precedence. Cross-file goto/references/rename and workspace-wide diagnostics
  for reverse dependencies of an edited module.
- Invalidation: per-document analysis keyed by content hash; an edit invalidates
  the document and its reverse imports only. Measure and cap re-analysis
  fan-out.
- Cancellation: honor `$/cancelRequest` by checking a cancellation token between
  analysis phases; long analyses yield to newer versions of the same document.
- Progress reporting (`window/workDoneProgress`) for workspace loads.
- Configuration: `initializationOptions` + `workspace/didChangeConfiguration`
  for diagnostics depth, hint categories, and formatting-on-broken-buffer
  policy; document the schema.
- Test harness: a fixture DSL with caret/range markers usable by all tasks
  (`//^ def`, `//^ hover: ...`), a headless client driver over real framing, and
  golden-file snapshots. Migrate the existing e2e test onto it.
- Performance gates in CI: cold init, keystroke-to-diagnostics, and completion
  latency budgets over the largest examples; token/allocation counters for the
  incremental paths.
- Protocol conformance sweep: unknown methods answered per spec, request
  ordering preserved, shutdown/exit lifecycle, and graceful behavior when the
  client disconnects mid-request.

## Acceptance Criteria

- Editing a module republishes diagnostics for its dependents without
  reanalyzing unrelated files (fixture with a three-module import chain).
- A burst of rapid edits never leaves stale diagnostics published and never
  crashes an in-flight request.
- CI fails when a latency budget regresses.

## Verification

- Multi-file fixtures under the harness; soak test replaying a recorded editing
  session against the server.

## Implementation Status

Implemented.

- Added marker-root discovery, a cached disk workspace with editor overlays,
  import/reverse-import graphs, cross-file member definition/reference/rename,
  and diagnostics for open and closed reverse dependents.
- Document caches are content-hash keyed and expose computation, hit, byte, and
  invalidation counters. Reverse reanalysis is depth- and fanout-capped and
  measured on server state.
- Requests are deferred in protocol order so cancellation and newer document
  versions can supersede queued/in-flight results; stale results use the LSP
  content-modified error. Shutdown/exit, EOF, unknown methods, and queued
  cancellation have framed-process coverage.
- Added workspace load progress, initialization/dynamic configuration, and the
  schema in `docs/lsp-configuration.md`.
- Added the caret/range and multi-file fixture DSL, checked-in golden snapshots,
  a real-framing subprocess client, migrated CLI end-to-end coverage, and a
  recorded rapid-edit soak test.
- Added `deno task lsp:perf` and a CI gate for cold initialization,
  edit-to-diagnostics, completion, heap growth, syntax tokens, and analysis
  computation/byte counters.
