# Inlay Hints

## Goal

Inline ghost text for the facts Ix programmers otherwise reconstruct by hand:
inferred types, effect rows, ownership transfers, and comptime fold results.
This is rust-analyzer's signature feature adapted to Ix.

## Work

- `textDocument/inlayHint` with resolve support, computed per visible range.
- Type hints on unannotated `let` bindings and closure parameters where a type
  fact is inferred (`: I32`, `: Text`, struct/union type names).
- Effect row hints on closure bindings and call results where the row is
  inferred rather than written (`-> <Io.read> Text`).
- Ownership hints at call boundaries: mark arguments that transfer a unique
  owner, pass a bounded borrow (`&`), or pass frozen/shareable values, using the
  facts the proof gate already derives.
- Comptime hints: fold results next to `comptime` expressions and const bindings
  (`= 42`), and specialization hints at const-parameter call sites (which
  specialized instance a call resolves to).
- Loop expansion hints on statically expanded range/collection loops (iteration
  count) so the cost of Ic expansion is visible.
- Every hint category individually toggleable via configuration
  (initializationOptions and didChangeConfiguration); conservative defaults.

## Acceptance Criteria

- Hints never contradict hover: both read from the same fact interfaces.
- Hint positions remain correct after incremental edits earlier in the file.
- Disabling a category removes exactly that category.

## Verification

- Fixture dumps of (position, label, kind) per category over the examples,
  snapshot-tested.

## Implementation Status

Implemented.

- Added ranged `textDocument/inlayHint` and deferred `inlayHint/resolve` support
  with type, effect, ownership, comptime, specialization, and static loop-count
  hints.
- Hint positions are derived from the current syntax tree, and comptime/loop
  facts use the environment visible before the hinted expression so shadowing
  agrees with hover.
- Each category is independently configurable through initialization options and
  dynamic workspace configuration. Conservative defaults keep ownership and
  loop-cost hints disabled.
- Added exact per-category fixture dumps, range/edit stability coverage, and
  server request/configuration tests.
