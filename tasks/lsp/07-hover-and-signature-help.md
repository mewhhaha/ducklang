# Hover And Signature Help

## Goal

Hover is where Ix's semantics become visible: show not just a type but the
compile-time story — const value, binding-time environment, effect row,
ownership class. Signature help tracks calls including const parameters.

## Work

- `textDocument/hover` for name occurrences: kind, declared or inferred type
  fact, and provenance (runtime binding, const binding with its folded value
  when the evaluator knows it, linear capability, frozen/scratch wrapper,
  type-value, effect).
- Render const values through the existing frontend formatter (`format_source`
  fragments) fenced as `ix` code, with size caps and depth truncation for large
  aggregates.
- Hover on closures shows parameter shape (arity, `const`/`!` markers,
  annotations) and the inferred latent effect row; hover on a call shows the
  instantiated row.
- Hover on `type`/struct/union names shows the full declaration plus layout
  facts (`size_of`, `align_of`, field offsets) from the const builtins.
- Attach doc comments: consecutive `//` lines directly above a declaration
  become its documentation for hover, completion resolve, and signature help.
- `textDocument/signatureHelp`: active parameter tracking through nested calls,
  showing parameter labels with `const`/`!` markers and annotations; effect
  operation calls show the declared operation signature.

## Acceptance Criteria

- Hovering `add_three` in the README comptime example shows a const closure with
  its captured `n = 3`.
- Hovering a linear `!token` names the consume point or "not yet consumed".
- Signature help inside `apply_const(21, |)` highlights the `const f` parameter
  with its marker.

## Verification

- Caret fixtures asserting exact hover markdown and signature help payloads.

## Implementation Status

Implemented.

Hover now renders compiler/index provenance as deterministic Markdown: binding
kind, declared/nominal/inferred type, linear consume locations, ownership class,
closure parameter shape, latent effect row, const value, and a bounded formatted
value representation. An editor-only evaluator safely specializes known const
calls and snapshots closure environments, so the README `add_three` example
exposes its folded closure and captured `n = 3` without changing compiler
lowering.

Type hovers include the full formatted declaration plus size, alignment, field
offsets, and union tag/payload offsets when layout is computable. Effect and
member hovers show declarations/signatures. Consecutive `//` or `///` comments
attach consistently to hover, completion resolve, and signature help. Frozen,
scratch-backed, borrowed, scalar, static, unique, and linear provenance is
surfaced explicitly; large values are length-capped and deep values report depth
truncation.

Signature help tracks unmatched nested call delimiters, active comma position,
`const`/`!` parameter markers, annotations, inferred effect rows, and declared
effect-operation signatures, while continuing to work in incomplete calls. The
server advertises hover and signature triggers. Exact fixtures cover the folded
const capture, linear consume status, type layout/docs, effect rows, ownership
wrappers, const active parameters, nested effect calls, and protocol routing.
