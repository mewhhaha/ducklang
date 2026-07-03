# Mutation, Layout, And Error Model

## Goal

Implement value-based updates, linear/mutable index updates, compile-time layout
helpers, and the error model.

## Source Sections

- Mutation and Update
- Compile-Time Layout
- Error Model

## Work

- Implement pure struct update by copy/rebuild:

```txt
user = user { age: user.age + 1 }
```

- Require facts proving linearity, uniqueness, or mutable capability for index
  updates:

```txt
buf[i] = x
```

- Plan the memory ownership layer around explicit storage facts: `scalar_local`,
  `unique_heap`, `borrow_view`, `frozen_shareable`, and `scratch_backed`.
- Treat runtime heap values as unique by default. `borrow value` creates a
  read-only lexical view, `freeze value` consumes unique ownership and produces
  immutable shareable data, and `scratch { ... }` creates a temporary
  bump-allocation scope with a return value.
- Make linear participation storage/fact driven. Scalar and frozen/shareable
  values remain freely usable; unique heap owners, mutable capabilities,
  ownership-transfer arguments, and future explicit region-owner packages must
  participate in exact-use or move/consume analysis.
- Use an analysis-first baseline policy. The compiler should make ownership,
  borrow, scratch escape, and cleanup facts precise enough for supported
  programs; otherwise it should reject before WAT emission rather than asking a
  runtime GC to decide.
- Insert cleanup/reset edges at known lifetime ends. Scratchpad reset is
  required on fallthrough, `return`, `break`, and `continue`; unique heap drops
  may initially lower to no-ops for the bump allocator but should still be
  represented in analysis.
- Reject scratch-backed returns unless the result is scalar, proven
  scratch-free, or explicitly frozen/promoted into non-scratch storage. Do not
  use a GC fallback in the baseline linear-memory backend.
- Treat `scratch { ... }` as the first region-like scope. Later named arenas or
  regions should reuse the same lifetime ids, reset/drop edges, and return-value
  escape facts instead of adding implicit managed storage.
- Treat scratchpads as the ergonomic temporary-computation surface. They are for
  building temporary, easily shareable values under a lexical reset boundary; if
  a value must leave that boundary, the compiler must prove it is scratch-free
  or emit an explicit freeze/promotion before the reset.
- Keep `scratch { ... }` as a scratchpad with a value result, not an implicit
  region object. Values tied to a longer-lived region are a future explicit
  owner-package feature, separate from ordinary scratchpad returns.
- A scratch scope has a value result, but it does not return an attached live
  region in the MVP. A result that would point into reset scratch storage must
  be frozen, promoted, proven scratch-free, or rejected.
- Treat attached-region returns as a later explicit feature, not as an implicit
  fallback for scratchpad escapes. If added later, Core should represent the
  returned region owner and the values tied to it so cleanup remains explicit.
- Insert cleanup for compiler-created temporaries at their proven lifetime end;
  scratch-backed temporaries reset with the scratchpad, and unique-heap
  temporaries keep drop facts even if the first bump allocator lowers drops to
  no-ops.
- Make the static analysis complete enough for supported mutation and scratchpad
  programs. Do not add baseline GC as a fallback for values whose lifetime,
  borrow state, or scratch escape cannot be proven.
- The latest baseline decision is to skip GC by making the proof proper, not by
  relying on a runtime collector for uncertain temporaries or scratchpad
  results. Hard cases should become narrower proof/rejection fixtures or future
  explicit region/managed-storage tasks.
- This is an implementation requirement for supported mutation and memory
  slices: there is no temporary "accepted because GC will clean it up" state. If
  the proof is not precise enough, split the task by value category and escape
  shape until it can be accepted with facts or rejected deterministically.
- When analysis is hard, refine the task by value category and escape shape
  instead of accepting the case with GC: scalar, static aggregate, static union,
  runtime aggregate, runtime union payload, runtime text, closure environment,
  or host boundary.
- Treat skipping GC as the MVP requirement, not as a best-effort optimization:
  before WAT emission, every supported runtime value must have a storage class,
  lifetime id, escape decision, borrow status, and cleanup/drop/reset decision.
  Missing facts reject deterministically.
- Treat the memory model as a defined implementation queue: `unique_heap`
  ownership, lexical `borrow` views, lexical `scratch { ... }` scratchpads,
  explicit `freeze`/promotion, cleanup for source and compiler-created
  temporaries, and storage-driven linear participation must be proven first.
  Named regions, attached-region returns, reusable allocators, destructors,
  tracing GC, managed storage, and Wasm-GC are future explicit profiles, not
  mutation/layout prerequisites.
- Lock the baseline no-GC policy into the mutation and memory slices. A
  mutation, scratchpad, borrow, freeze, host-boundary, or temporary-cleanup case
  is done only when it has either an accepted proof fixture or a rejected
  diagnostic fixture. Do not accept a case by adding hidden region attachment,
  implicit promotion, tracing, Wasm-GC, managed storage, or "runtime decides"
  behavior.
- Treat task refinement as part of implementation. When a memory/lifetime case
  is too broad to prove, split it by value category and escape shape, then land
  either an accepted proof fixture or a rejected diagnostic fixture. Do not mark
  the case accepted by adding implicit GC, implicit promotion, or a hidden
  attached region.
- Add accepted/rejected analysis fixtures for mutation-adjacent ownership
  behavior: owner replacement, borrowed-owner barriers, frozen-value mutation,
  scratch-backed returns, and lowering-created temporaries. Accepted fixtures
  must expose the facts WAT emission uses; rejected fixtures must assert the
  deterministic diagnostic.
- Classify every new memory/mutation case using the Task 12 no-GC acceptance
  matrix: accepted with proof facts, rejected with a named missing fact, or
  deferred to an explicit future region/managed-storage profile.
- Follow Task 12's final no-GC implementation roadmap for memory work: proof
  inventory gate, unique heap ownership, borrow/view checking, lexical
  `scratch {}` scratchpads, explicit freeze/promotion, cleanup for source and
  lowering-created temporaries, storage-driven linear participation, and only
  then future explicit region or managed-storage profiles.
- Keep the efficient baseline simple: scalar values stay in locals,
  scratch-backed temporaries are reclaimed by pointer reset, frozen values are
  immutable/shareable, and unique-heap values carry drop facts for a later
  reusable allocator even when the first bump allocator lowers drops to no-ops.
- Implement compile-time layout helpers with `snake_case` names:

```txt
const layout = t => {
  if is_struct(t) {
    ...
  }

  if is_union(t) {
    ...
  }
}
```

- Support layout facts for Wasm:

```txt
user_layout.fields.name
user_layout.fields.age
user_layout.size
user_layout.align
```

- Implement compile-time `fail`, runtime `panic`, and recoverable errors through
  explicit unions such as `result_type`.

## Acceptance Criteria

- Pure struct updates do not mutate the original value.
- Frontend-known aggregate index assignment rebuilds the aggregate.
- Unknown or general memory-backed index assignment is rejected without
  linear/mutable facts; runtime `Text` byte assignment is the supported narrow
  memory-backed case.
- Scratchpad results are rejected when escape analysis cannot prove that the
  returned value is scalar, non-scratch-backed, frozen, or promoted.
- Attached-region results are not part of the MVP `scratch {}` semantics; they
  require an explicit future region-owner representation.
- The default backend does not use a GC fallback for uncertain scratch escapes.
- The default backend also does not use a GC fallback for uncertain owner moves,
  active borrows, compiler-created temporaries, freeze/promotion, or unknown
  host/import escape behavior.
- Baseline proof output identifies the target as unmanaged/no-GC, for example
  with `managed_storage: "disabled"`, so an accepted fixture cannot hide a
  managed-storage fallback.
- Every accepted memory/mutation fixture includes proof facts for storage class,
  lifetime id, borrow/view validity, scratch escape, freeze/promotion,
  cleanup/drop/reset, and host-boundary behavior when relevant. Every rejected
  fixture names the missing edge.
- Unsupported memory/lifetime shapes are refined into smaller proof tasks or
  rejected with deterministic diagnostics; they are not accepted by hidden
  region attachment, implicit promotion, or managed storage.
- The baseline no-GC proof gate stays ahead of WAT emission with
  `managed_storage` disabled. Accepted mutation-adjacent fixtures expose the
  exact storage, lifetime, escape, borrow/view, scratch reset, freeze/promotion,
  and drop/cleanup facts used by codegen.
- Host/import bounded-borrow contracts are represented in Core proof output.
  Direct unique owners still cannot cross a host boundary without an explicit
  transfer contract; wrapping the owner in `borrow` may satisfy a bounded-borrow
  contract.
- Direct ownership-transfer contracts are represented in Core proof and drop
  output. They consume direct `unique_heap` owners and record `host_transfer`
  facts; borrowed views and scratch-backed values remain separate follow-up
  slices.
- Host-returned owner contracts are represented in Core proof, final-result, and
  drop output for imported pointer results marked as owned or frozen/shareable.
- Accepted ownership/mutation fixtures expose storage, lifetime, escape, borrow,
  cleanup, and drop facts before WAT emission.
- Unique heap values that are overwritten, discarded, or leave scope produce
  deterministic drop-plan entries, even when the initial bump allocator lowers
  those entries to no-ops.
- Borrowed values cannot be returned, captured by escaping closures, or used
  after their owner lifetime ends.
- Frozen values are immutable and shareable, and mutation through a frozen value
  or read-only borrow is rejected.
- Values with unique ownership, mutable capability facts, ownership-transfer
  facts, or future explicit region-owner packages participate in linear
  consume/move checking.
- Layout helpers can compute struct and union size/alignment.
- Compile-time `fail` reports a compiler error when executed during `comptime`
  or fact checking.
- Runtime `panic` remains a runtime trap.
- Recoverable errors use explicit union values.

## Verification

- Add tests for struct update lowering.
- Add tests for frontend-known aggregate index assignment.
- Add tests for invalid unknown or general memory-backed index update without
  mutation facts, plus runtime `Text` byte assignment.
- Add tests for `scratch {}` returning scalars, resetting storage on all exit
  edges, rejecting escaping borrows, and rejecting uncertain scratch-backed
  aggregate returns.
- Add future tests for explicit attached-region values only if named regions are
  added after scratchpad semantics are stable.
- Add tests for drop-plan entries on overwritten, discarded, and scope-ending
  unique heap owners.
- Add tests for `borrow` read-only views and `freeze` shareable values once the
  ownership layer is implemented.
- Add no-GC proof-gate tests showing accepted cases expose the required
  ownership facts and uncertain cases reject before WAT emission.
- Add one triage fixture for each new memory/lifetime shape: accepted with proof
  facts, rejected with a deterministic diagnostic, or explicitly deferred to a
  future region/managed-storage profile.
- Rejected fixtures should name the missing edge: scratch escape, borrow/view
  lifetime, freeze/promotion, host/import escape, or lowering-created temporary
  cleanup.
- Add host/import fixtures for known bounded-borrow imports, direct
  ownership-transfer imports, borrowed-view rejection for transfer, direct
  use-after-transfer diagnostics, deeper interprocedural transfer analysis, and
  unknown non-scalar import rejection.
- Add compile-time layout tests for structs and unions.
- Add tests distinguishing `fail`, `panic`, and `result_type`.

## Implementation Status

- Implemented pure struct updates by rebuild, including direct struct-update
  expressions and assignment syntax that shadows the source name without
  mutating earlier values.
- `Core.emit` rebuilds static-shaped struct update expressions and snapshots
  runtime update values in hidden locals so later shadowing does not affect the
  updated aggregate.
- Implemented frontend-known aggregate and typed runtime struct index assignment
  by rebuild/shadowing, including static and runtime index cases, runtime scalar
  payloads whose declared field types preserve the integer width, and declared
  or homogeneous visible `Text` fields as `i32` data-pointer selections.
- The `Source -> Core` structured path preserves unknown index assignments for
  later fact-directed memory/codegen work, and `Core.emit` applies static and
  dynamic index assignments to statically bound aggregate shapes by capturing
  runtime index and value expressions in hidden locals as needed. Visible `Text`
  update values remain visible to later text operations after the assignment and
  later shadowing. Inlineable static closures clone captured static aggregate
  shapes and static aggregate arguments per call before applying those rebuilds.
- `Core.emit` lowers runtime locals known to have type `Text` through
  bounds-checked byte index assignment using `i32.store8`, including lifted
  first-class closure bodies and captured runtime `Text` locals inside
  first-class closure environments, with WAT-to-Wasm coverage for successful
  mutation and out-of-bounds traps.
- Implemented compile-time layout helpers and structural layout facts for
  structs and unions.
- Implemented compile-time `fail`, runtime `panic` as an Ic trap primitive and
  Core WAT `unreachable`, and recoverable errors through explicit union values.
- Tests cover valid/invalid struct updates, frontend-known aggregate and typed
  runtime struct index assignment including runtime scalar payloads and visible
  text fields, invalid unknown index update reservation, structured-core unknown
  index assignment preservation, Core static-shaped struct update WAT lowering,
  Core static and dynamic aggregate index assignment WAT lowering including
  visible `Text` update values, runtime `Text` byte index assignment and
  out-of-bounds traps, captured static aggregate index assignment WAT lowering,
  captured runtime `Text` byte assignment through first-class closures, Core
  panic trap WAT lowering, layout facts, `fail`, `panic`, and
  `result_type`-style unions.
- General index assignment with linear/mutable memory facts is represented in
  `Core`. The first runtime aggregate memory-backed slice is implemented for
  stored unique aggregate pointers with known struct layouts and top-level
  scalar, `Text`, union-pointer, or inline nested aggregate fields: static
  indexes emit direct offset stores, dynamic indexes evaluate index/value once
  and trap on out-of-bounds indexes. Dynamic stores reject mixed
  scalar/`Text`/union-pointer/nested target field facts before WAT emission.
  Captured runtime aggregate scalar, `Text`, union-pointer, and inline nested
  mutation is supported through inline and first-class closures. Broader
  memory-backed mutation remains reserved for arrays/slices and reusable
  allocator/destructor cleanup. Static/frozen-shareable text bindings now stay
  immutable static data and reject indexed mutation with a deterministic
  frozen/shareable binding diagnostic instead of falling through to an unbound
  local error. Static-shaped aggregate bindings created through `freeze { ... }`
  now follow the same immutable compiler-fact path: field reads stay scalarized,
  the no-GC proof records an allowed frozen/shareable edge, and indexed mutation
  rejects before WAT emission.
- Core host/import bounded-borrow and direct ownership-transfer contracts are
  implemented as part of the no-GC proof surface. Known imports can declare
  scalar, bounded-borrow, or ownership-transfer arguments; bounded borrows
  accept explicit `borrow` views; ownership transfer consumes direct
  `unique_heap` owners and records `host_transfer` facts; proof output records
  the host-boundary signature and argument decision; direct use-after-transfer
  diagnostics reject later direct owner use; module emission writes the WAT
  import/call. Host-returned owners are implemented. Scratch-backed Core import
  arguments accept explicit bounded borrows and reject ownership transfer before
  WAT emission. Source-level contract syntax is implemented for scalar numeric
  ABI values and the first `Text` ownership contracts; broader non-`Text`
  pointer contracts and deeper interprocedural transfer analysis remain
  reserved.
- The planned general memory model is now unique-by-default runtime heap values,
  block/loop/call/scratchpad-bounded read-only `borrow` views, explicit `freeze`
  for immutable shareable values, and `scratch {}` as a temporary bump-allocated
  arena with a return value. The baseline policy is analysis-first: supported
  programs must have precise ownership, borrow, scratch escape, and cleanup
  facts before WAT emission; unsupported or uncertain cases reject rather than
  falling back to GC. Scratch reset must be emitted on all structured exit
  edges, while unique heap drop points may initially lower to no-ops for the
  bump allocator. A scratch result cannot carry an attached live region in the
  MVP; it must be scalar, frozen, promoted, proven scratch-free, or rejected.
  Scratchpads are the source-level ergonomic region for temporary work, not an
  implicit managed heap. Values produced there may be freely shared only when
  they are frozen/shareable or proven not to reference reset storage. Optional
  region-like scopes should reuse scratch/arena lifetime analysis, not implicit
  managed storage. Allocation sites should record their storage class and escape
  reason. `Core.drops(...)` now records deterministic analysis-only unique-heap
  drop facts for overwritten owners, discarded unique expressions, scope-ending
  owners, `return`/`break`/`continue` exits, terminal expression branches,
  branch assignments to existing unique owners, and closure-local owners in
  closure bodies, while the first bump allocator lowers those drops to no-ops.
  Direct named-owner discards and direct named-owner moves through static
  aliases now produce drop facts without forcing static owner values through
  runtime expression typing. Compile-time-only `const` values, including type
  values and const type-constructor results, are now kept in static drop context
  without creating runtime owners or requiring runtime expression typing. Direct
  block-expression result moves such as `{ f }`, discarded `{ f }`,
  `let g = { f }`, and block-local owner results now preserve owner facts across
  the block boundary. Expression-level `if` and `if let` branches now scan owner
  results path-sensitively, dropping non-selected owners in branch scopes and
  moving, escaping, or discarding the selected owner according to the
  surrounding expression context. Lowering-created temporaries still need full
  cleanup coverage from ownership facts. Unknown host/import calls should be
  treated as escaping unless their signature explicitly accepts a bounded
  borrow, and scratch-to-heap promotion must be an explicit Core step. GC is
  deferred out of the baseline backend; the remaining work is to complete the
  static proof surface for supported programs and reject missing proofs
  deterministically. Freeze of direct named, block-result, and branch-result
  unique owners is now modeled as consuming the source owner in the drop plan,
  including discarded, bound, block-wrapped, branch-local, returned, and
  self-shadowed freeze expressions, but immutable heap-copy/promotion codegen
  remains pending. Attached-region results remain a future explicit region-owner
  feature rather than part of MVP `scratch {}` semantics. Bounded unique-heap
  borrows for immediate read-only consumers are now accepted through the Core
  borrow gate. The same borrow gate now rejects named-owner and simple local
  alias move/replacement, index mutation, and `freeze` while a bounded borrow is
  active in that lexical scope. Stored borrow-view locals are now accepted when
  bounded to the current block, and returning, storing, or closure-capturing the
  view rejects with a borrow-escape diagnostic. Branches and loops that assign a
  stored borrow view into an outer name now merge that view fact back to the
  parent scope, so later owner mutation or view escape cannot ignore the
  branch/loop-created borrow. Direct field/index borrows and simple field-owner
  aliases, such as `borrow user.name`, `let name = user.name`, and aliases of
  those field values, now canonicalize back to the containing owner for
  borrowed-owner barriers. Replacing the aggregate or mutating through the field
  alias while the field borrow is active rejects. Branch, `if let`, and loop
  assignments into outer locals now merge field-owner aliases, including joins
  where a local may refer to more than one containing owner. Expression-valued
  `if` and `if let` results that return field aliases also preserve every
  possible containing owner for later borrow barriers. Expression-valued `if`
  and `if let` results that return stored borrow views now preserve those
  possible borrow views and protect their owners after the binding.
  Multi-statement block results that return field aliases or stored borrow views
  also carry that ownership fact to the outer binding. Field aliases assigned
  through block-prefix `if`, `if else`, `if let`, and loop statements are joined
  into the returned block result as possible containing owners. Runtime
  aggregate pointer materialization, stored pointer facts, nested aggregate
  field aliases, captured aggregate pointers, and direct scalar/Text field loads
  are now implemented for the persistent heap path. The first scratch-backed
  runtime aggregate slice also materializes temporary aggregates inside
  `scratch {}` on the scratch heap when the value dies before the scratch reset.
  Runtime text concatenation and runtime union value materialization now follow
  the same scratch heap path inside an active scratch body. Scalarized
  static-shaped aggregates, static union cases, and dynamic static-union `if`
  results with scratch-free conditions/payloads can now leave `scratch {}` as
  frozen/shareable proof edges. Heap-backed escaping aggregate/text/union values
  still reject until explicit freeze/promotion or field/value-level scratch-free
  proofs exist. General fact-directed memory mutation remains pending. Optional
  statement branches that contain `freeze` now produce conservative no-op bump
  drop facts for the paths where the branch may not run, including no-else `if`
  and typed `if let` bodies; conditional destructor emission for a future
  reusable allocator remains pending.
