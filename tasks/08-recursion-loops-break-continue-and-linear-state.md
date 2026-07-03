# Recursion, Loops, Break, Continue, And Linear State

## Goal

Implement `rec`, `for`, `break`, `continue`, and loop-edge linearity rules.

## Source Sections

- Loops and Tail Recursion
- Break, Continue, and Linear State

## Work

- Parse `rec` functions.
- Enforce that `rec(...)` calls are only valid in tail position.
- Parse range loops:

```txt
for i in 0..n {
  body
}

for i in a..b by s {
  body
}
```

- Evaluate loop start, end, and step once.
- Enforce nonzero step.
- Support collection loops:

```txt
for x in xs { ... }
for i, x in xs { ... }
```

- Lower collection loops using facts:

```txt
range -> range_loop
indexable -> indexed_loop as range_loop + get
iterable -> iterator_loop
otherwise fail
```

- Validate linear state across `break`, `continue`, and fallthrough.
- Preserve ownership cleanup edges across loop control. A `break` or `continue`
  that leaves a scratchpad or unique-owner lifetime must run the same reset/drop
  elaboration as normal fallthrough; control transfers that stay inside the
  lifetime must not reset it early.

## Acceptance Criteria

- Non-tail `rec(...)` is rejected.
- Range loops lower to structured loop IR.
- Loop index bindings are fresh and read-only.
- `continue` jumps to the step phase.
- `break` exits the loop.
- Every loop edge leaves carried linear variables valid.
- Loop `break` and `continue` cannot bypass scratch resets or planned unique
  owner drops for lifetimes they exit.

## Verification

- Add tests for valid and invalid `rec`.
- Add parser/lowering tests for range and collection loops.
- Add linearity tests for `break`, `continue`, and fallthrough paths.

## Implementation Status

- Implemented parsing for `rec`, range loops, collection loops, `break`, and
  `continue`.
- Implemented tail-position validation for `rec` and static unrolling for
  compile-time reducible recursive calls, including rec bodies with static
  loops, frontend-known aggregate index assignment, compile-time-known const
  parameters, and bound dynamic union `if let` result handler application.
  Tail-recursion validation lives in `src/frontend/rec_validate.ts`. Static-rec
  lowering lives in `src/frontend/rec.ts`, static-rec result-expression dispatch
  lives in `src/frontend/rec_result.ts`, the shared static-rec hook contract
  lives in `src/frontend/rec_hooks.ts`, recursive target/argument binding lives
  in `src/frontend/rec_bind.ts`, static-rec union/`if let` lowering lives in
  `src/frontend/rec_union.ts`, with dynamic union `if`, rec-aware `if let`, and
  union-result `if let` application split under `src/frontend/rec_union/`.
  Static-rec union case-shape inference lives in
  `src/frontend/rec_union_infer.ts`, static-rec expression inference lives in
  `src/frontend/rec_infer.ts`, and shared static-rec helpers live in
  `src/frontend/rec_util.ts`, with `src/frontend/lower_static_rec_adapter.ts`
  assembling the lower-graph static-rec hook object behind the public lowerer
  facade.
- Implemented static range-loop expansion, static collection-loop expansion over
  const-known aggregate values, typed runtime structs, and frontend-visible text
  bytes, read-only loop bindings, nonzero step checks, and static
  `break`/`continue`, plus terminal `return` propagation and nested static-loop
  flattening, including statically decidable nested `if` statements, statically
  known matching/non-matching `if let` statements, and loop-index/payload
  conditions. Inner-loop `break`/`continue` stay scoped to the inner loop, while
  inner `return` exits the function. Simple dynamic `if` or `if let` statements
  with a terminal `break` or `continue` lower inside static Ic-expanded range
  loops and statically expanded collection loops over const-known aggregates,
  typed runtime structs, and frontend-visible text bytes through synthesized
  active/step flags. Those branches may run simple local-binding, assignment, or
  expression prefix statements before the terminal loop control. Nested dynamic
  loop-control bodies remain rejected explicitly instead of being silently
  unrolled. Closures that field-select, index, update, call `len`/`get`, or
  iterate a parameter defer lowering so visible aggregate or concrete visible
  `Text` arguments can specialize the call before Ic expansion.
- Implemented runtime-index `get(xs, i)` and `xs[i]` lowering over const-known
  aggregate values and typed runtime structs as pure Ic `select` chains with
  out-of-range trap fallbacks, including declared runtime scalar fields and
  declared or homogeneous visible `Text` fields as `i32` data-pointer results.
- Added a minimal `Core` structured representation and `Source.core(...)` path
  that preserves dynamic range loops with start, end, step, body, and carried
  assignment facts before Ic/Wasm lowering.
- Implemented minimal `Core.emit` WAT lowering for scalar `i32` range loops with
  single-evaluated start/end/step values, compile-time rejection for statically
  zero steps, runtime traps for dynamically zero steps, local carried
  assignments, and Wasm `block`/`loop` control flow, including no-else `if`
  statements that can branch to loop `break` and `continue` labels.
- Implemented `Core.emit` WAT lowering for scalar dynamic tail-recursive calls
  by initializing recursive parameter locals and lowering tail `rec(...)` calls
  to parameter updates plus `br` back to a Wasm `loop`.
- Static-rec text-specific result lowering is split into
  `src/frontend/rec_text.ts`, and runtime struct projection/index lowering is
  split into `src/frontend/rec_struct.ts`, separate from recursive unrolling and
  control-flow handling.
- Static-rec `if` branch lowering is split into `src/frontend/rec_if.ts`, and it
  handles scalar/text dynamic `if` expressions and dynamic struct `if`
  result/projection/index lowering, including nested static-shaped struct
  fields, with rec-aware branch lowering, plus statement-level dynamic
  `if`/`if
  let` fallthrough, so final results, conditional statement updates,
  and dynamic index-assignment rebuilds preserve captured rec arguments and
  rec-local runtime type context.
- Static-rec application result typing now reuses the rec argument binding and
  result inference path, so values bound from static rec calls retain annotated
  struct/text field types for later frontend field access, `len`, and `get`
  lowering.
- Static-rec union payload binders now resolve user-defined annotation type
  names, so `if let` payloads such as `user_type` retain nested struct and
  `Text` field facts inside rec bodies.
- Static-rec result lowering handles dynamic union `if` targets consumed by
  `if let`, preserving captured rec arguments in matching payload branches.
- Implemented `Core.emit` WAT lowering for statement-level dynamic `if ... else`
  branches that update scalar locals.
- Implemented `Core.emit` WAT lowering for static collection loops over literal,
  statically bound, compatible dynamic `if`, or simple const-call dynamic `if`
  object/struct shapes by unrolling fields, including loop-local item/index
  bindings and `break`/`continue` labels, plus field and static-index
  scalarization through statically bound aggregate shapes.
- Implemented `Core.emit` WAT lowering for `len(collection)` and
  `get(collection, index)` when the collection resolves to a statically shaped
  object/struct value, including dynamic index trap fallbacks.
- Implemented `Core.emit` WAT lowering for visible text and runtime values known
  to have type `Text` as length-prefixed UTF-8 byte loops with item/index locals
  and `break`/`continue` labels.
- The same `Core` path preserves unknown collection loops with item/index names,
  collection expression, body, and carried assignment facts.
- Tests cover static `rec`, static-rec bodies with loops and aggregate index
  assignment, const rec parameters, annotated `Text`, struct, and union rec
  parameters and rec-local bindings including text length, byte indexing, and
  `get`, struct projection, struct indexing, struct `get`, dynamic scalar/text
  `if` results, dynamic struct `if` result/projection/index lowering including
  nested static-shaped struct fields returned from static-rec dynamic branches,
  statement-level dynamic `if`/`if let` fallthrough including dynamic outer `if`
  branches whose rec branch contains typed union `if let` fallthrough, and
  dynamic struct index assignment, dynamic union `if let` payload branches and
  handler-result applications including user-defined struct payload field
  access, invalid `rec`, Core dynamic tail-recursive WAT lowering and
  instantiation, range loops, collection loops, invalid ranges, typed runtime
  struct `len`, runtime-index `get`, runtime bracket indexing over known
  aggregates and typed runtime structs with runtime scalar/text payloads,
  bounds-checked runtime `Text` `get`, dynamic indexing over visible text
  fields, frontend visible aggregate and concrete visible `Text` arguments
  specialized into closures that field-select, index, update, call `len`/`get`,
  or iterate their parameters, frontend-visible and Core visible/runtime `Text`
  collection loops, dynamic-loop rejection, structured-core dynamic range-loop
  and unknown collection-loop preservation, Core range-loop WAT instantiation,
  dynamic positive and negative Core range-step WAT instantiation, dynamic zero
  range-step trap coverage, conditional Core range-loop `break`/`continue`
  codegen, frontend nested statically decidable `if` and statically known
  `if let` `break`/`continue` lowering, static-loop `return` propagation, nested
  static-loop return propagation with scoped inner `break`/`continue`, explicit
  dynamic conditional static-loop `if { break }`, `if { continue }`,
  `if let { break }`, and `if let { continue }` lowering across range loops and
  statically expanded collection loops, integer, `Text`, resolvable
  static-shaped struct, and resolvable same-case union top-level `let` bindings
  before dynamic loop-control checks, recursive nested dynamic loop-control
  lowering that skips trailing statements after inner `break`/`continue`,
  frontend pure linear static-range `break`/`continue` lowering with loop-edge
  rebinding checks, Core static and compatible dynamic shaped collection-loop
  WAT instantiation including const-call dynamic aggregate shapes, static-call
  block-local collection-loop WAT instantiation, Core visible and runtime `Text`
  collection-loop WAT instantiation, Core aggregate `len`/`get` WAT
  instantiation, and loop-edge linearity. The implemented Core range-loop and
  collection-loop emitters are split into `src/core/range_loop.ts` and
  `src/core/collection_loop.ts`; collection loops remain hook-driven through
  backend adapter static facts. Frontend static-loop shared contracts,
  binding/read-only helpers, body expansion, dynamic-control need detection,
  collection item materialization, static `if let` payload binding,
  dynamic-control scanning, and guarded dynamic-control expansion live under
  `src/frontend/static_loop/`.
- Unknown runtime collection-loop and broader structured-loop codegen remain
  reserved.
