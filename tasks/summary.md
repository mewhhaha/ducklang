# Draft Language Specification Tasks

Source: user-provided draft specification, "A Minimal Capability-Oriented
Language Lowering to Interaction Calculus and Wasm".

These tasks turn the draft into implementation and documentation work for a
small language with shared runtime/compile-time syntax, immutable values with
shadowing, explicit linear capabilities, type-values, structural fact checking,
specialization, interaction-calculus-style graph IR, and Wasm code generation.

The normalized language specification lives in `docs/language.md`.

## Naming Rule

All tasks assume the semantic casing convention:

- Use `snake_case` for runtime values, const values, type-values, type
  constructors, protocols, fact-checker values, functions, methods, fields, and
  modules.
- Built-in type names such as `Int`, `I64`, `Text`, and `Unit` keep their
  builtin spelling.

Draft examples that used non-`snake_case` user-defined identifiers should be
normalized in implementation docs and fixtures. Representative normalized names
are:

- `make_adder`
- `read_number`
- `invalid_digit`
- `size_of`
- `align_of`
- `fields_of`
- `cases_of`
- `is_struct`
- `is_union`
- `align_to`
- `tag_size`
- `max_payload`
- `max_align`
- `tag_offset`
- `payload_offset`
- `user_layout`

## Memory And Lifetime Direction

The baseline backend targets `core-3-nonweb`: structured Wasm plus linear
memory. It should not depend on Wasm-GC or any proposal-only feature.

Current locked task update: implement the baseline with static ownership and
lifetime proofs, not with a GC fallback. The memory model is a mix of
`unique_heap` runtime owners, lexical `borrow` views, lexical value-returning
`scratch { ... }` scratchpads, immutable `frozen_shareable` values, and
storage-driven linear analysis for values whose storage or effect role requires
it. Compiler-created temporaries follow the same cleanup/drop/reset facts as
source values.

For `core-3-nonweb`, a memory/lifetime case is accepted only when the proof
surface exposes storage class, lifetime id, borrow/view validity, scratch escape
decision, freeze/promotion decision, host-boundary behavior when relevant, and
cleanup/drop/reset facts before WAT emission. If those facts are missing, split
the task by value category and escape shape until it has an accepted proof
fixture, a deterministic rejected diagnostic, or a deferred future profile.

`scratch { ... }` is a scratchpad, not a hidden region object. It may return a
value, but the scratch pointer resets on every exit edge. A returned value must
be scalar, already frozen/shareable, explicitly promoted/frozen into persistent
storage, or proven scratch-free at the value, field, and payload level. Future
attached-region returns, named arenas, managed storage, tracing GC, and Wasm-GC
must be explicit separate profiles with their own Core representation, ABI,
proof facts, and tests.

The detailed source of truth is Task 12.2 in
[12-remaining-generalization-tasks.md](12-remaining-generalization-tasks.md).

Locked decision from the latest memory discussion: the task backlog assumes a
mixed static memory model with unique ownership for runtime heap values, lexical
`borrow`/view syntax, optional `scratch { ... }` scratchpads for temporary
shareable work, and `freeze` for immutable shareable values. The baseline skips
GC by making the analysis precise enough for the supported surface. This is now
an acceptance gate: if ownership, lifetime, borrow, scratch-escape,
freeze/promotion, host-boundary, or cleanup facts are missing, the task must be
split into a smaller accepted proof fixture or a deterministic rejected
diagnostic, not accepted by a GC or "runtime decides" fallback.

Latest task update: the implementation queue now starts with a no-GC proof audit
instead of a managed-storage fallback. Accepted WAT-emitting features must show
storage/lifetime facts, borrow/view facts, scratch reset and escape facts,
freeze/promotion facts, drop/cleanup facts for source values and
lowering-created temporaries, and host-boundary decisions when imports are
involved. Missing facts become narrower proof tasks or rejected diagnostics.
This supersedes the earlier fallback idea of letting a GC decide uncertain
scratchpad or temporary lifetimes.

Latest locked memory update: this is now a defined implementation split, not an
open research choice. The baseline path is:

1. Prove or reject every accepted memory feature before WAT emission.
2. Treat runtime heap values as `unique_heap` unless static, frozen, or
   scratch-backed facts say otherwise.
3. Use `borrow owner` / `let view = borrow owner` for read-only, non-owning
   views that make lifetime edges explicit.
4. Use `scratch { ... }` as the only MVP region-like surface: a lexical
   scratchpad with a value result and reset on every exit edge.
5. Let scratch results escape only when scalar, frozen/shareable, explicitly
   promoted/frozen into persistent storage, or proven scratch-free.
6. Insert cleanup for source values and compiler-created temporaries from the
   same ownership/lifetime facts.
7. Apply path-sensitive linear/unique analysis only to source `!` capabilities,
   `unique_heap` owners, active `borrow_view` barriers, `scratch_backed` values,
   and closure slots containing those values.
8. Keep named arenas, attached-region return packages, reusable allocators,
   destructors, tracing GC, managed storage, and Wasm-GC as future explicit
   profiles.

The immediate memory/lifetime work is no longer an open design choice. Treat it
as this implementation queue:

1. Finish the no-GC proof gate for accepted WAT-emitting features.
2. Complete `unique_heap` storage facts for runtime text, aggregates, unions,
   and closure environments.
3. Keep `borrow owner` / `let view = borrow owner` as the MVP view surface and
   reject active-borrow owner moves, mutation, freeze, transfer, return, or
   escaping capture.
4. Keep `scratch { ... }` as a lexical scratchpad with a value result, reset it
   on every exit edge, and reject scratch-backed escapes unless scalar,
   frozen/shareable, explicitly promoted/frozen, or proven scratch-free.
5. Implement `freeze` and scratch-to-persistent promotion as explicit Core
   edges, not implicit repairs.
6. Insert cleanup/drop/reset facts for source values and lowering-created
   temporaries.
7. Apply linear/path-sensitive analysis only to capabilities, unique owners,
   active borrow barriers, scratch-backed values, and closure slots containing
   those values.

The broad cases still need refinement during implementation. Split them by value
category and escape shape until each slice has either an accepted proof fixture
or a rejected diagnostic fixture.

The memory/lifetime work is source-language and compiler-analysis behavior, not
a new Wasm feature. The default target should lower to baseline locals, globals,
tables, indirect calls, structured control flow, and linear memory. Wasm-GC or
managed fallback storage is a possible future backend target only; it must not
be used to rescue uncertain lifetimes in the baseline backend. The
implementation split follows linear/unique validation, lifetime and escape
analysis, arena-style scratch allocation, builder/freeze reuse, drop
elaboration, and explicit host-boundary ownership contracts.

Research basis for this split:

- Language lowering should keep a typed IR and make memory layout, ownership,
  and cleanup contracts explicit before WAT emission.
- Region/arena allocation is the right fit for `scratch { ... }`: allocation is
  cheap inside the scope, reset is lexical, and escaping values must be promoted
  or rejected by escape analysis.
- Lifetime and escape analysis should classify returns, closure captures,
  heap/global/module stores, scratch returns, and host/import calls before
  storage selection.
- Linear checks are enforced in typed Core and validation, while the runtime
  representation remains ordinary Wasm locals and linear-memory pointers.

Runtime memory should use a small explicit ownership model:

- Scalar locals are copy values.
- Runtime heap values are unique by default.
- `borrow value` creates a read-only view with a lexical lifetime.
- `freeze value` consumes a unique value and produces immutable shareable data.
- `scratch { ... }` creates a temporary bump-allocation scope with a return
  value.
- Every runtime allocation site records whether it is static data, scalarized,
  persistent unique heap, frozen heap, scratch-backed, or rejected because its
  escape lifetime cannot be proven.
- Scratchpads are the MVP region-like surface for temporary work. They make
  temporary values cheap to allocate and share inside the scope, but they do not
  implicitly extend lifetimes after reset.

Borrowed views are scoped to the current block, loop iteration, function call,
or scratchpad scope. A borrow cannot be returned, stored in an escaping closure,
or retained by a value whose lifetime may outlive the borrow. While a borrow is
active, the borrowed unique value cannot be mutated, moved, or frozen.

`scratch { ... }` is a scratchpad, not a general region object exposed to user
code. The compiler saves the scratch pointer on entry and resets it on every
exit edge, including fallthrough, `return`, `break`, and `continue`. The result
may escape only when it is scalar, already frozen/shareable, explicitly
promoted/frozen into non-scratch heap storage, or proven not to reference
scratch storage. If escape analysis is uncertain, the baseline compiler must
reject with a deterministic diagnostic instead of silently falling back to GC.
Unknown imports and host calls are treated as escaping unless their signature
explicitly accepts a bounded borrow.

Optional region-like allocation should be modeled as lexical scratch/arena
scopes with explicit lifetime ids and return-value escape facts. The MVP source
surface is `scratch { ... }`; later named arenas should reuse the same analysis
instead of adding implicit managed storage to the default backend.
Attached-region returns are a future explicit feature, not a fallback for
ordinary scratch results. If added, Core should return a live region owner plus
values tied to that owner; the MVP `scratch { ... }` form resets before a
returned value can observe dangling scratch storage.

Cleanup should be elaborated at known lifetime ends. For the first bump-heap
backend, cleanup of escaping heap values may be a no-op, but the compiler should
still compute drop points so a later reusable allocator or destructor path has a
clear contract. Scratch cleanup is required because it resets temporary storage.
Temporaries introduced during lowering should also get cleanup from the same
ownership/lifetime facts. Promotion out of scratch storage must be explicit in
Core; the default backend does not implicitly copy or defer to a collector when
the analysis is uncertain.

The intended efficient baseline is static cleanup rather than runtime tracing:
scalar values stay in locals, scratch-backed values are reclaimed by pointer
reset, frozen values are immutable/shareable, and unique heap values carry drop
facts even if the first bump allocator lowers those drops to no-ops.

Linear analysis should apply only to values whose storage facts require it:
source `!` capabilities, `unique_heap` owners, `borrow_view` barriers,
`scratch_backed` owners, and closure-environment slots that contain any of those
values. Plain scalar locals and already-frozen values stay copy/share values and
should not be forced through exactly-once capability rules.

This makes GC a deferred backend choice, not an MVP escape hatch. The baseline
compiler must skip GC by proving the necessary facts before WAT emission:
runtime values need storage classes and lifetime ids, borrows need owner and
target-lifetime proofs, scratch results need scratch-free/frozen/promoted/scalar
proofs, unique owners need move/drop/return decisions, lowering-created
temporaries need cleanup points, and unknown host/import calls need to be
treated as escaping unless marked as bounded-borrow consumers. If any of those
proofs are missing, the default target rejects deterministically. This is the
chosen baseline contract, not a performance optimization to add after a managed
fallback.

When a proof is difficult, the task should be split by value category and escape
shape instead of solved with implicit GC: scalar, static aggregate, static union
case, dynamic static-union `if`, runtime heap aggregate, runtime union payload,
runtime text, closure environment, and host boundary. Each split needs an
accepted proof fixture or a rejected diagnostic fixture before it can feed WAT
emission.

Latest memory/lifetime decision:

- The baseline target should skip GC by completing the static analysis for the
  supported source surface. GC or Wasm-GC is a future separate target, not an
  MVP fallback.
- The latest task update locks this in as a no-GC implementation queue. If a
  memory case is hard to prove, split it by value category and escape shape
  until it has either an accepted proof fixture or a rejected diagnostic
  fixture. Do not add an interim GC, hidden attached-region, implicit promotion,
  or runtime-cleanup path for `core-3-nonweb`.
- Scratchpads are lexical temporary arenas with value results. A result cannot
  keep the scratchpad alive implicitly; it must be scalar, frozen/shareable,
  explicitly promoted, or proven scratch-free before reset.
- Optional attached-region returns are deferred until `scratch {}` is stable. If
  added, they must return an explicit region owner plus values tied to that
  owner.
- `borrow owner` and `let view = borrow owner` are the MVP view syntax. Borrow
  views are read-only, non-owning, and bounded by the owner lifetime.
- Linear analysis should be storage-driven: source `!` capabilities,
  `unique_heap` owners, `borrow_view` barriers, `scratch_backed` values, and
  closure slots containing those values participate; scalar and frozen values
  stay copy/share values.
- Compiler-created temporaries follow the same cleanup rules as source values.
  Scratch temporaries reset with their scratchpad; unique heap temporaries get
  drop facts even while the first bump allocator lowers drops to no-ops.
- This closes the MVP design choice: for `core-3-nonweb`, implement the static
  proof path and deterministic rejections first. Do not add an interim "runtime
  decides" or managed-storage mode to unblock uncertain lifetimes.
- Treat this as a task-splitting rule as well as a backend policy. If a memory
  feature is hard to prove, split it by value category and escape shape, then
  add either an accepted proof fixture or a rejected diagnostic fixture. Do not
  turn that gap into a GC-backed accepted baseline case.

Task 12.2 is the gate for this model. It should first lock the static backend
policy, then add ownership facts, lexical lifetime scopes, escape analysis,
borrow/view checking, scratchpad reset insertion, freeze/promotion, and drop
elaboration. It should also add a no-GC proof harness: accepted fixtures expose
the facts WAT emission depends on, rejected fixtures assert deterministic
diagnostics, and no baseline fixture selects a GC/Wasm-GC escape path.
Cleanup/reset edges must be represented in Core before WAT emission, including
fallthrough, `return`, `break`, and `continue`.

The detailed source of truth is the memory/lifetime decision record and no-GC
implementation queue in
[12-remaining-generalization-tasks.md](12-remaining-generalization-tasks.md).
That queue puts host/import boundary facts, runtime aggregate ownership facts,
scratch allocation/escape enforcement, freeze/promotion codegen, and
lowering-created temporary cleanup ahead of broader runtime aggregate memory and
general mutation work.

Current implementation queue from that decision:

1. Audit the no-GC proof gate for every WAT-emitting feature.
2. Complete storage and lifetime facts for source values and lowering-created
   temporaries.
3. Keep `borrow owner` / `let view = borrow owner` as the MVP view surface and
   finish owner barriers for fields, loops, closures, and host calls.
4. Keep `scratch { ... }` as a lexical scratchpad with a value result; finish
   scratch allocation routing, reset insertion, and field-sensitive escape
   proofs.
5. Implement `freeze` and scratch-to-persistent promotion as explicit Core edges
   before scratch reset.
6. Insert cleanup/drop/reset facts from ownership and lifetime analysis, not
   from ad hoc WAT emission.
7. Apply path-sensitive linear/unique analysis only to capabilities,
   `unique_heap` owners, active `borrow_view` barriers, `scratch_backed` values,
   and closure slots containing those values.
8. Leave named arenas, attached-region return packages, reusable allocators,
   destructors, tracing GC, managed storage, and Wasm-GC as future explicit
   profiles.

The selected MVP memory model is now task-split as unique ownership, lexical
borrow/views, lexical `scratch { ... }` scratchpads, frozen/shareable values,
cleanup for source values and compiler-created temporaries, storage-driven
linear participation, and explicit host/import ownership contracts. Scratchpads
may return values, but they never implicitly keep a region alive; returned
values must be scalar, frozen/shareable, explicitly promoted, or proven
scratch-free. GC, Wasm-GC, named arenas, and attached-region return packages
remain separate future profiles and cannot rescue missing baseline proof facts.
The latest decision keeps that as a hard implementation rule: skip GC in the
baseline by proving the supported cases, use borrow/views to make lifetime edges
explicit, insert cleanup for lowering-created temporaries from the same facts as
source values, and split every uncertain memory case into an accepted proof
fixture or a rejected diagnostic fixture.

The decision is now represented as active implementation tickets:

- Proof gate: `managed_storage: "disabled"` plus storage, lifetime, borrow/view,
  escape, scratch reset, freeze/promotion, host-boundary, and cleanup/drop facts
  before WAT emission.
- Unique ownership: runtime heap values are move-only `unique_heap` by default
  unless static/frozen or scratch-backed facts say otherwise.
- Borrow/views: `borrow owner` and `let view = borrow owner` are read-only,
  non-owning, owner-bounded views that block owner mutation, move, freeze, or
  consuming transfer while active.
- Scratchpads: `scratch { ... }` is a lexical temporary arena with a value
  result and reset on every exit edge; it never returns a hidden live region.
- Freeze/promotion: `freeze` consumes a unique owner or explicitly promotes a
  scratch-backed value into persistent immutable storage before reset.
- Temporary cleanup: lowering-created aggregate, text, union, closure, and
  promotion temporaries use the same cleanup/drop/reset facts as source values.
- Storage-driven linear analysis: source `!` capabilities, `unique_heap` owners,
  active `borrow_view` barriers, `scratch_backed` values, and closure slots
  containing them participate; scalar and frozen values stay copy/share.
- Future profiles: named arenas, attached-region return packages, reusable
  allocators, destructors, managed GC, and Wasm-GC are explicit later profiles,
  not fallback states for `core-3-nonweb`.

The next memory/lifetime implementation slices are now explicit:

- Finish immutable heap-copy promotion for broader existing aggregate/union
  owners. The first block-local runtime aggregate alias promotion slice is
  implemented for supported known-layout fields, including nested union-pointer
  fields, and the block-local runtime union alias promotion slice is implemented
  for scalar/`Text`/`Unit`, union-pointer, and supported aggregate-pointer
  payloads; direct constructor scratch freeze remains a separate path.
- Make scratch escape facts field-sensitive for heap-backed aggregate fields and
  union payloads. The first rejected static-shaped scratch return diagnostic now
  names the offending aggregate field or union payload path.
- Finish cleanup/drop/reset facts for lowering-created temporaries from
  aggregate materialization, text copy/concat loops, union payload construction,
  closure environment setup, and promotion.
- Extend the implemented Core and source-level host/import bounded-borrow,
  ownership-transfer, host-returned owner, frozen/shareable, and scratch-backed
  boundary-policy slices with deeper interprocedural transfer analysis and any
  future scratch-backed promotion policy that intentionally crosses the host
  boundary.
- Record closure-environment ownership per slot so reusable closure capture is
  limited to scalar or frozen/shareable data until linear closure calls are
  implemented. The current proof-visible slice distinguishes scalar,
  frozen/shareable, unique heap, stored borrow-view, and scratch-backed local
  captures. Stored borrow-view, scratch-backed local, and `unique_heap text`
  captures now reject before WAT emission; remaining non-text unique heap
  captures still need either reusable/frozen proof facts, deterministic
  rejection, or real linear closure values. Existing runtime aggregate pointer,
  runtime union pointer, and closure-pointer capture paths now report allowed
  proof decisions, with runtime union pointer capture covered through
  WAT-to-Wasm `call_indirect`.
- Keep named arenas, attached-region return packages, reusable allocators,
  destructors, managed GC, and Wasm-GC as later explicit profiles only.

Current runtime aggregate progress: the persistent-heap slice now covers
aggregate allocation, scalar/Text/union-pointer field stores, stored aggregate
pointer facts, type-annotation checks for runtime aggregate pointers, and direct
field loads from stored pointers. Runtime aggregate pointers are now visible to
ownership and proof analysis as unique heap values, can be captured by
first-class closures, and support nested field aliases such as
`let name = user.name`. Persistent runtime aggregate freeze now consumes a
`unique_heap runtime_aggregate` pointer as immutable shareable storage, keeps
struct/text field facts visible through proof and emission, rejects later
mutation through the frozen binding, and runs through WAT-to-Wasm field loads.
Persistent runtime union freeze now consumes a `unique_heap runtime_union`
pointer as immutable shareable storage, keeps union facts visible through
annotation, proof, and `if let` emission, records an allowed freeze edge, and
runs through WAT-to-Wasm matching. Persistent runtime closure freeze now
consumes a `unique_heap closure` environment pointer as immutable shareable
storage, keeps closure call facts visible through proof and emission, records an
allowed freeze edge, and runs through WAT-to-Wasm `call_indirect`. The first
scratch-backed slices also route temporary runtime aggregate materialization,
runtime text concatenation, and runtime union value materialization inside an
active `scratch {}` body to `__scratch_heap` when the scratch result itself is
scalar or otherwise scratch-free. Mixed persistent and scratch allocation use
separate heap globals, with scratch starting in its own arena when persistent
heap allocation is also needed. Direct, block-local, and branch-selected scratch
first-class closure freeze now let `scratch { freeze ((x: Int) => ...) }`,
`scratch { let inner = (x: Int) => ...; freeze inner }`, and
`scratch { if flag { freeze closure_a } else { freeze closure_b } }` return a
frozen/shareable closure pointer, record the allowed closure freeze edges, keep
closure allocation on persistent heap storage, and round-trip through
WAT-to-Wasm `call_indirect`. Direct runtime `Text` scratch freeze is now the
first explicit scratch-to-persistent promotion slice: direct
`scratch { freeze append(...) }`, block-local
`scratch { let temp = append(...); freeze temp }`, inlineable helper-returned
`Text` temporaries, expression-valued `if` branches whose branches each freeze
runtime `Text`, and expression-valued `if let` branches over dynamic/runtime
union payloads now build the temporary text in scratch storage, copy the frozen
result into persistent heap storage before reset, and expose both allocation
facts in the no-GC proof. The same `if let` shape without `freeze` or explicit
promotion rejects before WAT emission. Returning other scratch-backed aggregate,
text, or union values still rejects without explicit freeze/promotion or a
scratch-free proof. The first returned-field scratch-free proof is implemented
for scalarized static-shaped aggregate results: if every returned field is
scalar, static/frozen data, or otherwise scratch-free, the value can bind
outside `scratch {}` without a scratch heap allocation. This now includes
annotated static-shaped struct values such as
`let user: user_type = scratch { user_type { age: x, name: "Ada" } }`, while the
same aggregate shape still rejects when a field is scratch-built runtime data
without freeze/promotion. Static union cases with scratch-free payloads can also
bind outside `scratch {}` and lower through static `if let` without scratch heap
allocation. Dynamic static-union `if` results with scratch-free conditions and
branch payloads use the same proof path and can lower through static `if let`
without a scratch heap allocation. Runtime union payloads now store struct-typed
payloads as aggregate pointers, preserve aggregate and union-pointer facts
through direct/static and stored runtime `if let` matching, and support nested
matching through union-valued aggregate fields. The remaining
aggregate/text/union work is narrower now: direct aggregate and union
constructors returned as `scratch { freeze constructor(...) }` can materialize
on persistent heap storage before scratch reset, retain aggregate/union facts,
record allowed freeze edges, and run through WAT-to-Wasm after the scratch
reset. Block-local aggregate alias promotion such as
`scratch { let temp = user_type { ... }; freeze temp }` now copies supported
known-layout runtime aggregates into persistent frozen storage before reset,
including persistent copies for `Text` fields, and runs through WAT-to-Wasm
after the reset. Block-local runtime union alias promotion such as
`scratch { let temp = result_type.ok(...); freeze temp }` now copies
scalar/`Text`/`Unit` runtime unions, union-pointer payloads, and supported
aggregate-pointer payloads into persistent frozen storage before reset,
including recursive persistent copies for nested union payloads, `Text`
payloads, aggregate union fields, and aggregate `Text` fields, and runs through
WAT-to-Wasm after the reset. Static-shaped existing aggregate aliases such as
`let existing: user_type = user_type { ... }; scratch { let temp = existing; freeze temp }`
now plan through the aggregate fact and use the same persistent aggregate/text
copy path. Branch-selected existing runtime union aliases such as
`let existing: result_type = if flag { result_type.ok(...) } else { result_type.err(...) }; scratch { let temp = existing; freeze temp }`
now preserve dynamic-union aliases and `Text` payload facts through static
planning, text layout, scratch freeze, and WAT-to-Wasm matching. Branch-assigned
existing runtime union aliases such as
`let existing: result_type = result_type.err(...); if flag { existing = result_type.ok(...) } else { existing = result_type.err(...) }; scratch { let temp = existing; freeze temp }`
now merge compatible static union-case assignments and keep branch-generated
payload facts visible for scratch freeze and matching. Broader existing owner
copies, broader scratch-backed closure promotion beyond
direct/block-local/branch-selected persistent closure freeze, field-level
scratch escape proof for heap-backed returned aggregate values, remaining
scratch-backed text promotion shapes, deep closure-capture freeze/linear
ownership checks, payload ownership/drop transfer facts, and reusable
allocator/destructor cleanup integration remain pending. Dynamic loops that
would carry static aggregate/union compiler facts, including aliases to those
facts, now reject deterministically instead of treating a loop-body static
assignment as an unconditional post-loop value; loop-specific promotion remains
in the pending broader existing-owner bucket.

The concrete backlog shape is:

- Make static analysis strong enough for the baseline target instead of adding a
  GC fallback. If ownership, borrow, scratch escape, or promotion cannot be
  proven, reject deterministically.
- Put the no-GC proof gate before WAT emission. Accepted fixtures must expose
  storage class, lifetime id, escape edge, borrow validity, scratch reset edge,
  freeze/promotion edge, and drop/transfer decisions for runtime values and
  lowering-created temporaries.
- Use ordinary `borrow owner` and `let view = borrow owner` syntax for read-only
  views; views are non-owning and must not outlive the owner.
- Treat `scratch { ... }` as the MVP region/scratchpad surface. Later named
  arenas are optional and should reuse the same lifetime ids, return-value
  escape facts, and reset/drop edges.
- Defer attached-region return objects until scratchpad analysis is stable, and
  require them to be explicit Core region owners rather than implicit GC-like
  lifetime extension.
- Track owner state for unique heap values so moves, mutation, `freeze`, and
  active borrows can be checked consistently.
- Compute cleanup for source values and compiler-created temporaries. Scratch
  reset emits real WAT; unique heap drops may initially be analysis-only no-ops
  under the bump allocator.
- Add accepted/rejected proof fixtures for ownership, borrows, scratch resets,
  freeze/promotion, closure captures, lowering-created temporaries, and unknown
  host/import calls.
- Keep GC or Wasm-GC as a future separate target only, not a silent fallback for
  the baseline linear-memory backend.

The immediate memory/lifetime task split is:

- Static proof gate: keep `managed_storage: "disabled"` for the baseline target
  and require every accepted fixture to expose the facts the WAT emitter uses.
  Unsupported or uncertain ownership, borrow, scratch escape, freeze/promotion,
  temporary cleanup, or host/import behavior rejects before emission.
- Ownership and storage facts: classify every runtime allocation and
  lowering-created temporary as `scalar_local`, `unique_heap`, `borrow_view`,
  `frozen_shareable`, `scratch_backed`, or rejected with a reason.
- Lifetime and escape facts: assign lexical lifetime ids to blocks, loops,
  calls, closure environments, and scratchpads; record every return, capture,
  branch merge, scratch return, heap/global store, and host/import escape edge.
- Borrow/view checking: keep the source surface as `borrow owner` and
  `let view = borrow owner`; views are read-only, non-owning, and bounded by the
  owner lifetime.
- Scratchpads: make `scratch { ... }` the MVP region-like feature for temporary
  shareable work. It returns a value, resets on all exits, and rejects results
  that may point into reset scratch storage unless they are scalar,
  frozen/shareable, explicitly promoted, or proven scratch-free. The first
  implemented allocation slices cover temporary runtime aggregate
  materialization, runtime text concatenation, and runtime union value
  materialization that die inside the scratch scope. Returned aggregate scratch
  values still need per-field scratch-freedom or explicit promotion/freeze, not
  only an outer pointer check; rejected static-shaped aggregate/union returns
  now name the unsafe field or payload path.
- Scratch branch promotion: expression-valued branches, including `if let`, must
  preserve text/aggregate/union ownership facts through branch contexts. A
  branch result that freezes a scratch-backed runtime value should expose a
  promotion edge before reset; the same shape without freeze/promotion should
  reject when the result may reference scratch storage.
- Frozen values: make `freeze value` consume a unique value and produce
  immutable shareable storage. Scratch-to-persistent promotion must be an
  explicit Core operation with owner, lifetime, destination-storage, and cleanup
  facts, not an implicit typechecker or WAT-emitter fallback.
- Linear and unique state: reuse the path-sensitive control-flow machinery for
  source `!` capabilities and move-only `unique_heap` owners, while keeping
  capability tokens unfrozen and unborrowed as shareable data. Do not make every
  type linear; require linear/unique analysis only when the value's storage
  class, capability role, borrow state, scratch lifetime, or closure capture
  makes copying unsound.
- Cleanup and proof: compute cleanup/drop/reset points for source values and
  compiler-created temporaries before WAT emission. The baseline proof gate must
  reject missing facts instead of selecting GC. Temporaries introduced by
  runtime aggregate materialization, text copy/concat loops, union payload
  construction, closure environment setup, and promotion get the same cleanup
  treatment as source values.
- Future profiles: named arenas, attached-region return packages, reusable
  allocators, destructors, managed GC, or Wasm-GC are separate follow-up targets
  after the no-GC baseline proof is complete.

These are now the defined Task 12 implementation buckets: static proof gate,
ownership/storage facts, borrow/view checking, scratchpad regions, explicit
freeze/promotion, cleanup for source values and temporaries, host/import
boundary facts, and deferred managed/region profiles. When a bucket is still too
broad, split it by value category and escape shape instead of adding a GC
fallback.

## Task Order

1. [01-normalize-naming-and-spec.md](01-normalize-naming-and-spec.md)
2. [02-bindings-shadowing-and-core-syntax.md](02-bindings-shadowing-and-core-syntax.md)
3. [03-const-comptime-and-specialization.md](03-const-comptime-and-specialization.md)
4. [04-functions-closures-and-control-flow.md](04-functions-closures-and-control-flow.md)
5. [05-linear-capabilities-and-modules.md](05-linear-capabilities-and-modules.md)
6. [06-type-values-structs-unions-and-facts.md](06-type-values-structs-unions-and-facts.md)
7. [07-extensions-and-protocol-fact-checkers.md](07-extensions-and-protocol-fact-checkers.md)
8. [08-recursion-loops-break-continue-and-linear-state.md](08-recursion-loops-break-continue-and-linear-state.md)
9. [09-mutation-layout-and-error-model.md](09-mutation-layout-and-error-model.md)
10. [10-lowering-pipeline-to-ic-and-wasm.md](10-lowering-pipeline-to-ic-and-wasm.md)
11. [11-mvp-grammar-and-scope-control.md](11-mvp-grammar-and-scope-control.md)
12. [12-remaining-generalization-tasks.md](12-remaining-generalization-tasks.md)

The remaining-task order now puts the baseline memory policy before allocator or
runtime aggregate work: unique ownership by default, lexical `borrow` views,
explicit `freeze`, lexical `scratch {}` regions with return-value escape facts,
cleanup for lowering-created temporaries, a no-GC proof harness, and
deterministic rejection when analysis cannot prove safety. `scratch {}` does not
attach a live region to its return value in the MVP, and unknown host/import
calls are escaping unless their signatures explicitly declare bounded-borrow or
ownership-transfer behavior.

The updated memory task contract is: skip GC in the baseline by proving the
facts we need. Every accepted `core-3-nonweb` program must reach WAT with
storage class, lifetime id, borrow/view validity, scratch escape decision,
freeze/promotion decision, host-boundary behavior, and cleanup/drop/reset facts
for source values and compiler-created temporaries. If a fact is missing, the
compiler rejects before emission. Scratchpads remain lexical temporary arenas
with return values; returning from `scratch {}` never keeps an attached region
alive. Future attached-region values, named arenas, reusable allocators,
destructors, managed GC, or Wasm-GC are separate follow-up targets after the
static baseline proof is stable. The current task split is implementation ready:
start with Task 12.2's proof/storage/lifetime/borrow/scratch/freeze/drop slices,
then broaden runtime aggregate, union, text, closure, and mutation features only
when those proof facts exist for the new slice. The chosen path is to make the
analysis precise enough for the supported surface instead of adding a temporary
GC path. Any feature whose lifetime, borrow, scratch escape, promotion,
host-boundary, or cleanup facts are still unknown stays in the
rejected-diagnostic bucket until those facts are available. When extending this
list, keep new items in one of three states: accepted with proof facts, rejected
with a deterministic diagnostic, or deferred to a future explicit
region/managed-storage profile. Avoid adding "accepted by runtime cleanup/GC" as
a fourth baseline state.

Latest task update: the no-GC choice is now treated as a baseline requirement,
not an optimization. Hard cases should be refined by value category and escape
shape until they have an accepted proof fixture or a rejected diagnostic
fixture. `scratch {}` stays a value-returning scratchpad with lexical cleanup;
it never returns a hidden live region. Future region packages or managed storage
must be explicit profiles with their own owner/lifetime facts.

Final memory-policy rule: skip GC in the baseline by making the analysis proper.
A baseline case is accepted only when storage class, lifetime id, borrow/view
validity, scratch escape, freeze/promotion, host-boundary behavior, and
cleanup/drop/reset facts are known before WAT emission. Otherwise the task must
be split into a narrower accepted proof fixture, a rejected diagnostic fixture,
or a deferred future profile.

Latest task update: the no-GC rule also covers hard scratchpad, temporary,
closure-capture, aggregate, union-payload, text, and host-boundary cases. There
is no interim "GC will clean it up" acceptance state for the baseline. If a case
is too broad to prove, refine it during implementation by value category and
escape shape, then land either proof facts, a deterministic rejection, or a
future explicit managed/region profile.

Task triage rule: each memory/lifetime item should now be classified as accepted
with proof facts, rejected with a deterministic diagnostic, or deferred to a
future explicit profile. Do not add a fourth baseline state where GC, implicit
promotion, hidden attached regions, or runtime cleanup decides an otherwise
unproven case.

The immediate queue now starts with a no-GC proof audit. For each accepted
`Core.emit(...)`, `Core.mod(...)`, and source-to-Core/Wasm feature, prove the
storage, lifetime, borrow/view, escape, scratch reset, freeze/promotion,
host-boundary, and cleanup/drop facts before WAT emission. If a current feature
cannot expose those facts, split it into a narrower accepted fixture or move it
behind a deterministic rejected diagnostic. Future attached-region returns must
be explicit owner packages with their own Core representation and cleanup rules;
ordinary `scratch {}` never infers that package.

## Completion Criteria

- Each task has an implementation target, acceptance criteria, and verification
  notes.
- User-defined source examples use `snake_case`.
- Remaining non-`snake_case` names in snippets are builtin type names such as
  `Int`, `Text`, `I64`, and `Unit`.
- The task set covers every major section of the draft specification.

## Current Implementation Snapshot

The current frontend has an Ic-lowerable MVP slice behind the `src/frontend.ts`
facade, with implementation modules in `src/frontend/` and tests in
`src/frontend.test.ts`. `src/frontend/lower.ts` is the stable lowerer facade,
while `src/frontend/lower_graph.ts` owns the internal hook composition and
environment-threading graph. Frontend call-specialization graph delegates live
in `src/frontend/lower_call_graph.ts`, keeping const-call, deferred-call,
runtime-call, and specialization wrapper wiring out of the lowerer root.
`src/frontend/lower_call_facade.ts` keeps lazy call-graph forwarding for cyclic
lowerer dependencies out of `src/frontend/lower_graph.ts`. Frontend value graph
delegates live in `src/frontend/lower_value_graph.ts`, keeping struct/union
value resolution, union-case inference, and aggregate access wrapper wiring out
of the lowerer root. `src/frontend/lower_value_facade.ts` keeps lazy
aggregate/union graph forwarding for cyclic lowerer dependencies out of
`src/frontend/lower_graph.ts`. Frontend expression/call/if/index hook assembly
lives in `src/frontend/lower_expression_hooks_adapter.ts`, and
prepare/eval/statement/inference hook assembly lives in
`src/frontend/lower_program_hooks_adapter.ts`, keeping repeated lower-graph hook
wiring out of `src/frontend/lower_graph.ts`. Lazy lower/eval/prepare/infer and
`if`/`if let` bridge wrappers live in `src/frontend/lower_graph/bridge.ts`,
keeping cyclic hook access explicit. Ic sharing/erasure helpers live in
`src/frontend/ic_share.ts`, keeping that graph-specific machinery separate from
source semantic lowering. Static-rec text result lowering lives in
`src/frontend/rec_text.ts`, keeping `Text` length, `get`, and byte-index Ic
construction out of the recursion unrolling module. Static-rec runtime struct
projection and index lowering lives in `src/frontend/rec_struct.ts`, keeping
aggregate selector Ic construction out of that same recursion unrolling module.
Shared runtime typed-struct type discovery, nested field-projection type
discovery, projection/index selection, and indexed-field type helpers live in
`src/frontend/runtime_struct.ts`, so ordinary frontend lowering and static-rec
struct lowering use the same field selection rules. Frontend runtime-struct hook
composition and runtime-struct adapter glue live in
`src/frontend/lower_runtime_struct_adapter.ts`, keeping runtime typed-struct
projection and type-discovery hook wiring out of `src/frontend/lower_graph.ts`.
Declared static-shaped struct field/index value resolution, access retagging,
and indexed-result classification live in `src/frontend/struct_access.ts`,
keeping that type-sensitive aggregate access logic out of the main semantic
lowering pass. Frontend struct-access hook composition and dynamic aggregate
index adapter glue live in `src/frontend/lower_struct_access_adapter.ts`,
keeping aggregate field/index resolver wiring out of
`src/frontend/lower_graph.ts`. Frontend declared struct-value validation, struct
type-value resolution, frontend-known struct-value discovery, declared
field-type discovery, pure struct-update rebuilds, and handler-encoded
struct-value Ic lowering live in `src/frontend/struct_values.ts`, with the main
lowerer supplying nested expression lowering and environment-sensitive
resolution hooks. Frontend union construction, typed constructor validation,
union type-value resolution, and shorthand union-case inference live in
`src/frontend/union_values.ts`, while dynamic union branch case-shape inference
lives in `src/frontend/union_infer.ts` with shared dynamic union-if case merging
in `src/frontend/dynamic_union_cases.ts` and shared inlineable helper-call
result discovery in `src/frontend/union_call_inline.ts`. Frontend aggregate
index assignment rebuilds live in `src/frontend/index_assignment.ts`, keeping
static and runtime typed-struct update construction out of the main semantic
lowering pass. Frontend dynamic index selection over frontend-known aggregates
and typed runtime structs lives in `src/frontend/index_access.ts`. Ic lowering
for builtins and frontend-known method calls lives in
`src/frontend/builtin_call.ts`, with the main lowerer supplying type inference,
text lowering, compile-time builtin evaluation, and aggregate index hooks.
Compile-time structural builtins, layout helpers, and `has(...)` fact queries
live in `src/frontend/const_builtin.ts`. Ic primitive folding and select
reduction live in `src/ic/prim_reduce.ts`, keeping numeric primitive behavior
separate from the active-pair rewrite rules in `src/ic/reduce.ts`; primitive
propagation over superpositions includes unary memory loads, and dynamic selects
retag to `i64.select` when reduction exposes i64 branches. The exported `Ic`
companion also satisfies the generic `Reduce<ctx, from, to>` pattern, so
context-free top-level reduction can be called through `Reduce.reduce`.
Source-file loading and import resolution live in `src/frontend/load.ts`,
keeping filesystem concerns out of the `Source` companion facade. The structured
Core entrypoint follows the same facade shape: `src/core.ts` re-exports the
backend, AST, formatter, source-lowering, backend utilities, and text data
helpers grouped under `src/core/`. Core top-level WAT artifact assembly,
lifted-closure function/table aggregation, data segment exposure, and `Mod`
construction live in `src/core/artifact_emit.ts`, while
`src/core/backend/entry/artifact.ts` owns the backend adapter that composes
text-layout, statement emission, lifted-closure, and result-type hooks. The Core
backend keeps `src/core/backend.ts` as the public trait facade, with the `Core`
companion implementation in `src/core/backend/core.ts`;
`src/core/backend/graph.ts` stays the public backend entrypoint facade. Backend
composition lives in `src/core/backend/graph/instance.ts`; analysis, emission,
static-value/text, runtime/control-flow, and entry/artifact wiring live in
`src/core/backend/graph/analysis.ts`, `src/core/backend/graph/emit.ts`,
`src/core/backend/graph/values.ts`, `src/core/backend/graph/runtime.ts`, and
`src/core/backend/graph/entry.ts`, with lazy graph dependencies described in
`src/core/backend/graph_deps.ts` and assembled in
`src/core/backend/graph/deps.ts`. The combined backend graph contract lives in
`src/core/backend/graph/types.ts`. Analysis graph construction is split under
`src/core/backend/graph/analysis/` for local-fact, expression-type, and
type-check service adapters. Emit graph construction is split under
`src/core/backend/graph/emit/` for expression and statement WAT-emitter service
adapters. Values graph construction is split under
`src/core/backend/graph/values/` for static-call, static-value, struct, and text
service adapters. Runtime graph construction is split further under
`src/core/backend/graph/runtime/` for closure, runtime-union, control-flow, and
recursion services; entry graph construction is split under
`src/core/backend/graph/entry/` for app, index, local-collection, and artifact
services. Backend utility helpers are grouped under `src/core/backend/util/`,
with `src/core/backend/util.ts` kept as a compatibility facade. Core emission
context construction, branch cloning, recursive body context creation,
lifted-closure body context creation, and runtime-union match branch binding
live in `src/core/emit_ctx.ts`, keeping backend hook wiring separate from the
shared WAT-emission context shapes. Core type-level static evaluation and
type-constructor substitution live in `src/core/type_static.ts`, keeping that
metaprogramming path separate from WAT emission. Core binding/parameter
annotation validation, direct struct/union annotation context, structural
type-pattern checks, and value type-name checks live in
`src/core/type_check.ts`, with the backend supplying text, union, static-call,
and expression-typing hooks. Core backend type-check adapter glue lives in
`src/core/backend/analysis/type_check.ts`, with hook-object assembly in
`src/core/backend/analysis/type_check/hooks.ts` and the adapter contract in
`src/core/backend/analysis/type_check/types.ts`, keeping annotation,
type-pattern, value-type-name, and const type-value wiring out of
`src/core/backend.ts`. Core closure-function, text-local, and runtime
union-local fact tracking lives in `src/core/local_facts.ts`, with the backend
supplying closure typing, runtime-union type lookup/equality, and static type
hooks. Core backend local-fact adapter glue lives in
`src/core/backend/analysis/local_facts.ts`, with hook-object assembly in
`src/core/backend/analysis/local_facts/hooks.ts`, keeping function-type,
text-local, and runtime union-local fact wiring out of `src/core/backend.ts`.
Core local/context collection facade lives in `src/core/local_collect.ts`, with
the shared context/hook contract in `src/core/local_collect/types.ts` and the
main statement/expression traversal split into `src/core/local_collect/stmt.ts`
and `src/core/local_collect/expr.ts`. Core backend local-collection adapter glue
lives in `src/core/backend/entry/local_collect.ts`, with hook-object assembly in
`src/core/backend/entry/local_collect/hooks.ts` and its backend contract in
`src/core/backend/entry/local_collect/types.ts`, keeping type, static, union,
text, closure, recursion, and index hook wiring out of `src/core/backend.ts`.
Core recursion-specific local collection lives in
`src/core/local_collect_rec.ts`, and Core `if let` local collection lives in
`src/core/local_collect_if_let.ts`. Core closure-valued local collection lives
in `src/core/local_collect_closure.ts`, block-expression final statement
collection lives in `src/core/local_collect_block.ts`, static `if/else`
statement branch collection lives in `src/core/local_collect_if_else.ts`, and
range/static/text collection-loop local collection lives in
`src/core/local_collect_loop.ts`, keeping those feature-specific traversal rules
out of the main collector. Core const-call inlining delegates lexical expression
substitution to `src/core/substitute.ts`, mirroring the frontend substitution
module while keeping block, loop, lambda, and `if let` shadowing rules out of
the WAT emitter. Core scoped static-call expression rewriting stays exported
from `src/core/static_call_rewrite.ts`, while statement/block rewriting and
replacement-name shadowing live under `src/core/static_call_rewrite/`, keeping
statement-bodied inline-call AST rewriting separate from static-call planning
and WAT emission. Core static-call public exports live in
`src/core/static_call.ts`, while the implementation is split under
`src/core/static_call/`: `types.ts` owns the shared context/hook contract,
`arity.ts` owns arity checks, `target.ts` owns static-call/static-rec target
discovery and scope-free substitution, and `scoped.ts` owns scoped static-call
type/emission planning. Core backend static-call adapter glue lives in
`src/core/backend/values/static_call.ts`, its backend contract lives in
`src/core/backend/values/static_call/types.ts`, hook-object assembly lives in
`src/core/backend/values/static_call/hooks.ts`, and scoped-call versus
lookup/target wrappers live in `src/core/backend/values/static_call/scoped.ts`
and `src/core/backend/values/static_call/lookup.ts`, keeping static-call hook
wiring out of `src/core/backend.ts`. Core static text recognition, text
concatenation visibility checks, and static text length/index helpers live in
`src/core/text_static.ts`, keeping that text-specific analysis separate from the
backend control-flow emitter. Core visible/runtime text fact recognition and
runtime text-concat operand detection live in `src/core/text_facts.ts`, with the
backend supplying expression-type, static struct, and static text hooks. Core
text data layout scanning and heap-start calculation live in
`src/core/text_layout.ts`, which now re-exports the split layout builder, layout
types, and parameter-type helper from `src/core/text_layout/`. Core runtime text
WAT helpers for heap concatenation, length loads, byte loads, and byte
assignment live in `src/core/runtime_text.ts`. Core backend text hook
composition and text-specific adapter glue is composed by
`src/core/backend/text.ts`, with static text adapters in
`src/core/backend/text/static.ts`, text fact adapters in
`src/core/backend/text/facts.ts`, text layout adapters in
`src/core/backend/text/layout.ts`, and runtime text emission adapters in
`src/core/backend/text/runtime.ts`, keeping static/runtime text hook wiring out
of `src/core/backend.ts`. Core memory-layout helpers for scalar sizes,
alignment, loads, and stores live in `src/core/memory.ts`. Core runtime-union
value/type recognition, pointer-target discovery, case metadata, and match-case
metadata are exported through `src/core/runtime_union.ts`, with the
implementation split under `src/core/runtime_union/` into focused modules for
runtime value discovery, type-expression/equality checks, case metadata, target
resolution, match metadata, and union storage size. Runtime-union payload
layout, static-shaped struct payload validation, and packed payload-size
calculation live in `src/core/runtime_union_payload.ts`. Runtime-union match
payload fact binding, static/core branch context creation, and temporary
payload-local construction live in `src/core/runtime_union_match.ts`.
Runtime-union heap materialization and pointer `if let` control flow live in
`src/core/runtime_union_emit.ts`, while packed struct payload stores and payload
loads for pointer matches live in `src/core/runtime_union_payload_emit.ts`. Core
backend union hook composition and union-specific adapter glue is composed by
`src/core/backend/union.ts`, with static union adapters in
`src/core/backend/union/static.ts` and runtime union adapters in
`src/core/backend/union/runtime.ts`. Runtime union adapter contracts, type/match
metadata hooks, and local/WAT emission hooks live in
`src/core/backend/union/runtime/types.ts`,
`src/core/backend/union/runtime/info.ts`,
`src/core/backend/union/runtime/info/hooks.ts`,
`src/core/backend/union/runtime/info/query.ts`,
`src/core/backend/union/runtime/info/match.ts`, and
`src/core/backend/union/runtime/emit.ts`, keeping static/runtime union hook
wiring out of `src/core/backend.ts`. Core statement-level `if`/`if else` WAT
emission lives in `src/core/if_stmt.ts`, with the backend supplying condition
typing, expression/statement emission, static capture planning, and static
assignment merging hooks. Core general statement WAT dispatch, including binds,
assignments, loop/branch dispatch, final-expression handling, drops, and
index-assignment routing, lives in `src/core/stmt_emit.ts`, with the backend
supplying static-value, local-fact, loop, text, and nested emit hooks. Core
`if let` dispatch between static union, dynamic union-if, and runtime
union-pointer lowering lives in `src/core/if_let_dispatch.ts`, with the backend
supplying static, dynamic, and runtime target discovery hooks. Core `if let`
statement/expression WAT emission lives in `src/core/if_let.ts`, with the
backend supplying union-case lookup, dynamic union-if discovery, expression
typing, and nested emit hooks. Core static and emission-time `if let` payload
binding lives in `src/core/if_let_payload.ts`, with `src/core/emit_ctx.ts`
supplying branch context cloning and the backend supplying expression
emission/type hooks, static struct lookup, text facts, and local-fact clearing.
Core static union-case lookup, dynamic union-if discovery, and dynamic `if let`
payload binding live in `src/core/union_static.ts`, with the backend supplying
type-value, static-call, and expression-typing hooks. Core recursive-call result
typing, initial parameter binding, tail-call detection, and tail-call argument
validation live in `src/core/rec_type.ts`, with the backend supplying
annotation, expression typing, local-collection, and context-cloning hooks. Core
tail-recursive call/body WAT emission lives in `src/core/rec_emit.ts`, with the
backend supplying parameter annotation, tail-call validation, result typing,
context cloning, and nested emit hooks. Core backend recursion hook composition
and recursion-specific adapter glue live in `src/core/backend/runtime/rec.ts`,
keeping recursive typing/emission hook wiring out of `src/core/backend.ts`. Core
expression and final-statement result typing lives in `src/core/expr_type.ts`,
with the backend supplying application, text, union, static-value, closure,
block-local collection, and payload-fact hooks. Core backend expression-type
adapter glue and primitive operand specialization live in
`src/core/backend/analysis/expr_type.ts`, with hook-object assembly in
`src/core/backend/analysis/expr_type/hooks.ts`, keeping result-type hook wiring
out of `src/core/backend.ts`. Core application result typing for `len`, `get`,
`panic`, recursive calls, static calls, scoped static calls, and dynamic closure
calls lives in `src/core/app_type.ts`, with the backend supplying collection,
text, recursion, static-call, and closure hooks. Core application WAT dispatch
for the same shapes lives in `src/core/app_emit.ts`, with the backend supplying
static analysis, text helpers, closure typing, and nested emit hooks. Core
backend application hook composition and application adapter glue live in
`src/core/backend/entry/app.ts`, keeping app typing/emission wiring out of
`src/core/backend.ts`. Core first-class closure environment allocation and
dynamic `call_indirect` emission live in `src/core/closure_emit.ts`, shared
closure runtime shapes and constants live in `src/core/closure_runtime.ts`,
closure lift registration/environment layout/type registration lives in
`src/core/closure_lift.ts`, and lifted closure function emission lives in
`src/core/closure_lift_emit.ts`, with the backend supplying closure typing and
nested expression/local hooks. Core closure-valued `if` WAT emission lives in
`src/core/closure_if_emit.ts`, with the backend supplying closure type
refinement, nested statement/expression emission, and runtime closure emission
hooks. Core first-class closure function-type discovery, selected-branch closure
type checking, and closure-call argument validation live in
`src/core/closure_type.ts`, with the backend supplying expression typing,
runtime-union result facts, capture discovery, annotation checks, and scoped
static-call hooks. Core lambda runtime-capture discovery and static capture
snapshot planning live in `src/core/closure_capture.ts`, with the backend
supplying static struct-binding lookup for supported captured aggregate
index-assignment cases; unused capture-free runtime-local traversal has been
removed so the module only carries active capture planning and assignment
analysis. Core backend closure hook composition and closure-specific adapter
glue is composed by `src/core/backend/closure.ts`, with capture adapters in
`src/core/backend/closure/capture.ts`, closure type adapters in
`src/core/backend/closure/type.ts`, runtime closure emission adapters in
`src/core/backend/closure/emit.ts`, and closure-valued `if` adapters in
`src/core/backend/closure/if.ts`, keeping closure capture/type/emission hook
wiring out of `src/core/backend.ts`. Core static aggregate index-assignment
planning/emission lives in `src/core/index_assign.ts`, with the backend
supplying type checks, static text/value planning, expression stability, and
nested emit hooks. Core backend index-specific adapter glue lives in
`src/core/backend/entry/index.ts`, with hook-object assembly in
`src/core/backend/entry/index/hooks.ts`, keeping static index assignment,
dynamic index emission, and collection item-type hook wiring out of
`src/core/backend.ts`. Core expression-level WAT emission lives in
`src/core/expr_emit.ts`, with the backend supplying static value/text facts,
app/if-let/closure emitters, runtime text helpers, and nested
statement/expression hooks. Core backend expression-emission adapter glue and
closure-valued `if` dispatch live in `src/core/backend/emit/expr.ts`, with
hook-object assembly in `src/core/backend/emit/expr/hooks.ts`, keeping
expression emit hook wiring out of `src/core/backend.ts`. Core backend
statement-emission adapter glue lives in `src/core/backend/emit/stmt.ts`, with
hook-object assembly in `src/core/backend/emit/stmt/hooks.ts`, keeping bind,
loop, branch, text assignment, and static index assignment dispatch wiring out
of `src/core/backend.ts`. Core dynamic index selection over static aggregate
shapes lives in `src/core/index_expr.ts`, and pure visible text byte-index
expression construction lives in `src/core/text_index.ts`. Core assigned-name
discovery for statement merge analysis lives in `src/core/assigned_names.ts`.
Core scope analysis for static-call statement scope and assignment-through-AST
checks lives in `src/core/scope_analysis.ts`. Core static-value stability
analysis for static captures, merge planning, and index-assignment planning
lives in `src/core/static_stability.ts`. Core statement-level static `if/else`
assignment merging lives in `src/core/static_merge.ts`, with the backend
supplying static struct-capture planning. Core backend control-flow hook
composition and control-flow adapter glue is composed by
`src/core/backend/control_flow.ts`, with range and collection-loop adapters in
`src/core/backend/control_flow/loop.ts`, `if let` and payload adapters in
`src/core/backend/control_flow/if_let.ts`, `if let` hook builders in
`src/core/backend/control_flow/if_let/hooks.ts`, and `if` statement/static-merge
adapters in `src/core/backend/control_flow/if_stmt.ts`, keeping range-loop,
collection-loop, `if`, `if let`, runtime-union `if let`, payload binding, and
static branch-merge wiring out of `src/core/backend.ts`. Core static
struct-value resolution, static struct updates, dynamic struct-if reshaping, and
static collection-field projection live in `src/core/struct_static.ts`, with the
backend supplying expression-type and static-call hooks. Core backend
static-struct hook composition and struct-specific adapter glue live in
`src/core/backend/values/struct.ts`, keeping static struct hook wiring out of
`src/core/backend.ts`. Core static value capture planning for structs, unions,
text, dynamic aggregate branches, and static-value recognition lives in
`src/core/static_values.ts`, which now re-exports the split static-value
contracts, recognition, and planning modules from `src/core/static_values/`,
with the backend supplying text, union, struct, runtime-union, expression-type,
and nested emit hooks. Core backend static-value hook composition and
static-value adapter glue live in `src/core/backend/values/static_value.ts`,
with its backend contract in `src/core/backend/values/static_value/types.ts`,
hook adapters in `src/core/backend/values/static_value/hooks.ts`, recognition
wrappers in `src/core/backend/values/static_value/recognition.ts`, and capture
planning wrappers in `src/core/backend/values/static_value/plan.ts`, keeping
static-value hook wiring out of `src/core/backend.ts`. Frontend numeric literal
parsing, truthiness lowering helpers, primitive result typing, and numeric
primitive operand validation live in `src/frontend/numeric.ts`, with the main
lowerer supplying expression inference and annotation-derived numeric facts.
Frontend visible-text primitives live in `src/frontend/text.ts`, frontend text
length lowering lives in `src/frontend/text_lower.ts`, and static/runtime text
byte-index lowering lives in `src/frontend/text_lower/byte_index.ts` behind a
shared hook contract in `src/frontend/text_lower_types.ts`. Visible-text value
discovery and text-concat operand checks live in `src/frontend/text_visible.ts`,
keeping visible text recognition separate from UTF-8 byte-length and text
byte-load Ic construction. Frontend text-lowering hook composition and
text-specific lowerer adapter glue live in `src/frontend/lower_text_adapter.ts`,
keeping text hook wiring out of `src/frontend/lower_graph.ts`. Frontend static
range and collection loop expansion lives in `src/frontend/static_loop.ts`, with
the main lowerer supplying only the environment-sensitive static evaluation and
type-resolution hooks; statically decidable nested `if` `break`/`continue` edges
and statically known `if let` `break`/`continue` edges are unrolled there, while
terminal `return` stops further unrolling, nested static loops are flattened
with inner `break`/`continue` scoped to the inner loop, and simple dynamic
`if { break }`, `if { continue }`, `if let { break }`, and `if let { continue }`
bodies lower through synthesized active/step flags before Ic lowering for static
range loops and statically expanded collection loops over const-known
aggregates, typed runtime structs, and frontend-visible text bytes. Those
dynamic loop-control branches may run simple local-binding, assignment, or
expression prefix statements before the terminal `break` or `continue`; the same
dynamic-control path supports top-level non-linear integer, `Text`, resolvable
static-shaped struct, and resolvable same-case union `let` bindings before later
dynamic `break`/`continue` checks by binding an explicit inactive fallback
branch with the correct integer width, an empty text value, recursively
synthesized field fallbacks, or recursively synthesized payload fallbacks.
Nested dynamic `if` and `if let` loop-control bodies lower by recursively
guarding statements after inner `break`/`continue`, so non-terminal trailing
assignments are skipped once the active step is cleared. Frontend static-loop
hook composition and static-loop adapter glue live in
`src/frontend/lower_static_loop_adapter.ts`, keeping static loop hook wiring out
of `src/frontend/lower_graph.ts`. Static-loop shared hook/item contracts live in
`src/frontend/static_loop/types.ts`, loop binding/read-only helpers live in
`src/frontend/static_loop/binding.ts`, static loop body expansion and dynamic
loop-control need detection live in `src/frontend/static_loop/body.ts`,
collection item materialization lives in `src/frontend/static_loop/items.ts`,
static `if let` payload binding lives in
`src/frontend/static_loop/if_let_payload.ts`, dynamic loop-control flag
generation and loop-control scanning live in
`src/frontend/static_loop/dynamic_control.ts`, and guarded dynamic-control
statement expansion lives in `src/frontend/static_loop/expand_dynamic.ts`,
keeping that helper weight out of `src/frontend/static_loop.ts`. Frontend static
expression lowering and static `i32` evaluation lives in
`src/frontend/static_expr.ts`, with the main lowerer supplying dynamic fallback,
lookup, and field/index resolution hooks. Frontend static-expression hook
composition and static-expression adapter glue live in
`src/frontend/lower_static_expr_adapter.ts`, keeping static-expression hook
wiring out of `src/frontend/lower_graph.ts`. Frontend const-known expression and
block analysis lives in `src/frontend/const_known.ts`. Frontend
visible-parameter specialization analysis lives in
`src/frontend/visible_params.ts`, with root-name checks, dependency scanning,
and collection-iteration scanning split under `src/frontend/visible_params/`,
keeping call-site aggregate/text deferral traversal separate from source
semantic lowering. Frontend deferred aggregate and visible-text value detection
lives in `src/frontend/call_deferred.ts`. Frontend const/runtime call argument
specialization checks and argument binding live in `src/frontend/call_args.ts`,
with call specialization supplying annotation, inference, deferred-value, and
environment hooks. Frontend call-target and dynamic function-branch target
resolution lives in `src/frontend/call_target.ts`, with the call-specialization
hook contract in `src/frontend/call_specialize_types.ts`, reusable target
wrappers in `src/frontend/call_resolve.ts`, call specialization predicates in
`src/frontend/call_specialize_decision.ts`, dynamic function-branch argument
checks in `src/frontend/call_dynamic_args.ts`, const/runtime call inlining in
`src/frontend/call_inline.ts`, and call-result union inference in
`src/frontend/call_union_result.ts`; `src/frontend/call_specialize.ts` remains
the specialized Ic application facade. Frontend expression type inference keeps
`src/frontend/infer.ts` as the facade, with hook contracts, primitive/builtin
inference, runtime-struct field/index inference, statement-result inference, and
the main expression dispatcher split under `src/frontend/infer/`; the main
lowerer supplies text, struct, union, and index resolution hooks. Frontend
expression-to-Ic dispatch lives in `src/frontend/expr_lower.ts`, with the shared
hook contract in `src/frontend/expr_lower_types.ts`, binding/lambda/linear
lowering in `src/frontend/expr_lower_binding.ts`, and app/field/index lowering
in `src/frontend/expr_lower_access.ts`; the main lowerer supplies
specialization, builtin, struct, union, text, index, and recursive-call hooks.
Frontend statement sequencing, binding/assignment shadowing, static
statement-loop expansion, statement-level `if`/`if let`, and non-final
expression erasure live in `src/frontend/stmt.ts`, with the main lowerer
supplying expression, type, annotation, loop, index-assignment, and
value-resolution hooks. Frontend const/runtime value preparation, including
union-constructor normalization, struct update rebuild validation, deferred
const-call capture, and extension base capture, lives in
`src/frontend/prepare.ts`, with the main lowerer supplying struct, union, call,
and capture hooks. Frontend compile-time value and block evaluation lives in
`src/frontend/eval.ts`, with the main lowerer supplying annotation, call, loop,
index-assignment, type, and value-resolution hooks. Frontend compile-time
expression and extension-field resolution lives in
`src/frontend/const_resolve.ts`, with the main lowerer supplying const-builtin,
const-call, static-index, simple-block, and index-resolution hooks. Frontend
const-resolution hook composition and const-resolution adapter glue live in
`src/frontend/lower_const_resolve_adapter.ts`, keeping const builtin and const
expression/field resolver wiring out of `src/frontend/lower_graph.ts`. Frontend
`if` expression lowering lives in `src/frontend/if_expr.ts`, with the main
lowerer supplying branch inference, dynamic struct/union reshaping, and nested
Ic-lowering hooks. Shared direct-lambda selection helpers for dynamic
function-valued branches live in `src/frontend/function_if.ts`, so ordinary
dynamic `if` and function-valued dynamic `if let` use the same parameter
annotation and alias rules. Frontend `if let` union-handler orchestration and
dynamic union-if branch selection live in `src/frontend/if_let.ts`; shared
`if let` type/default/handler helpers live in `src/frontend/if_let_common.ts`,
and handler-encoded union-result lowering lives in
`src/frontend/if_let_union_result.ts`. Dynamic union-if target discovery through
captures, blocks, deferred calls, specialized calls, and aliases lives in
`src/frontend/if_let_target.ts`, with hook/type shapes in
`src/frontend/if_let_types.ts`. Frontend statement sequencing, static
statement-loop expansion, statement-level `if`/`if let`, and non-final
expression erasure live in `src/frontend/stmt.ts`; shared statement hook types
live in `src/frontend/stmt/types.ts`; and binding, assignment, index-assignment,
and deterministic binding-body shadowing live in `src/frontend/stmt/binding.ts`.
Frontend reserved linear effect detection lives in
`src/frontend/linear_effect.ts`, separate from path-sensitive statement
validation in `src/frontend/linear_stmt.ts`, expression consumption in
`src/frontend/linear_expr.ts`, and carried-state helpers in
`src/frontend/linear_state.ts`; `src/frontend/linear.ts` remains the public
facade. Frontend local/aliased/simple-block/static-branch linear closure
tracking lives in `src/frontend/linear_closure.ts`. Frontend structural
type-pattern/fact-checker validation lives in `src/frontend/type_patterns.ts`,
with the main lowerer supplying the compile-time expression resolver hook.
Frontend dynamic branch lowering keeps `src/frontend/dynamic_branch.ts` as the
public facade, with shared hook/result shapes in
`src/frontend/dynamic_branch/types.ts`, dynamic struct/`if let` branch reshaping
in `src/frontend/dynamic_branch/struct.ts`, and dynamic union branch
handler-value lowering in `src/frontend/dynamic_branch/union.ts`. The dynamic
struct branch facade delegates to `src/frontend/dynamic_branch/struct/if.ts`,
`src/frontend/dynamic_branch/struct/if_let.ts`, and
`src/frontend/dynamic_branch/struct/helpers.ts` so dynamic `if`, dynamic
`if let`, and shared nested-struct shaping stay decoupled. The main lowerer
still supplies inference, value-resolution, and Ic-lowering hooks. Frontend
dynamic-branch hook composition and dynamic-branch lowerer adapter glue live in
`src/frontend/lower_dynamic_branch_adapter.ts`, keeping dynamic branch hook
wiring out of `src/frontend/lower_graph.ts`. Frontend tail-recursion validation
lives in `src/frontend/rec_validate.ts`. Static-rec lowering lives in
`src/frontend/rec.ts`, static-rec result-expression dispatch lives in
`src/frontend/rec_result.ts`, the shared static-rec hook contract lives in
`src/frontend/rec_hooks.ts`, recursive target/argument binding lives in
`src/frontend/rec_bind.ts`, static-rec `if` branch lowering lives in
`src/frontend/rec_if.ts`, static-rec union/`if let` lowering lives in
`src/frontend/rec_union.ts`, with dynamic union `if`, rec-aware `if let`, and
union-result `if let` application split under `src/frontend/rec_union/`.
Static-rec union handler application and case-to-handler Ic helpers live in
`src/frontend/rec_union_handlers.ts`, static-rec union case-shape inference
lives in `src/frontend/rec_union_infer.ts`, static-rec expression inference
lives in `src/frontend/rec_infer.ts`, and shared static-rec helpers live in
`src/frontend/rec_util.ts`, with static-rec lower-graph hook assembly in
`src/frontend/lower_static_rec_adapter.ts` and the main lowerer supplying
environment, type, static-loop, and Ic-lowering hooks. Frontend annotation hook
shapes live in `src/frontend/annotation_types.ts`, annotation type and numeric
resolution live in `src/frontend/annotation_resolve.ts`, direct struct/union
annotation context lives in `src/frontend/annotation_context.ts`, and binding
annotation checks live in `src/frontend/annotation_check.ts`;
`src/frontend/annotations.ts` keeps runtime binding annotation application and
assignment type selection as the public facade, with the main lowerer supplying
value-resolution and static-lowering hooks. Frontend annotation hook composition
and annotation adapter glue live in `src/frontend/lower_annotation_adapter.ts`,
keeping binding/type annotation wiring out of `src/frontend/lower_graph.ts`.
Frontend const-call inlining delegates lexical expression substitution to
`src/frontend/substitute.ts`, keeping shadowing rules for params, blocks, loops,
and `if let` payload names out of the semantic lowering pass. Frontend parser
token navigation lives in `src/frontend/parser_cursor.ts`, parameter and
annotation parsing lives in `src/frontend/parser_params.ts`, aggregate
field/type-pattern parsing lives in `src/frontend/parser_aggregate.ts`,
expression/postfix/block parsing lives in `src/frontend/parser_expr.ts`, and
parser support rules for reserved keywords, builtin type-reference names,
module-function normalization, operator precedence, and struct-value starts live
in `src/frontend/parser_support.ts`.

Implemented and verified:

- `let`, `const`, `comptime`, `=`, `:=`, closures, returns, `if`, no-else `if`,
  no-else scalar `if let` expressions with typed `i32`/`i64` zero fallbacks,
  no-else text `if`/`if let` expressions with `""` fallback, dynamic no-else
  `if` fallthrough, nested block return propagation before later fallthrough
  statements, known-case `if let` including runtime payloads and frontend-known
  field/static-index projections, rejection of known non-i32 conditions before
  Ic lowering, `&&`, `||`, static `rec`, static-rec bodies with static loops and
  const parameters, and Core dynamic tail-recursive loop lowering.
- Unsuffixed integer literals as current `Int`/`i32` values plus explicit
  `i32`/`i64` suffixes, with i64 arithmetic, comparisons, dynamic selects, and
  dynamic indexing preserving the value type. Runtime `I64` binding and
  parameter facts retag parse-time-default numeric primitives to i64 operations
  in both frontend Ic lowering and structured Core WAT emission, including
  chained arithmetic whose intermediate primitive was parsed before the operand
  facts were known, dynamic branches whose result type depends on those retagged
  primitives, no-else expression fallback zeros that inherit an inferred `I64`
  branch result, and no-else text fallbacks that materialize `""`.
- Const functions with binding-time capture environments, const parameters,
  specialization, reification of const values, scalar runtime parameter
  annotation checks, frontend annotated unknown runtime bindings and arguments
  through scalar/text/struct/union Ic paths, same-type reassignment preserving
  explicit frontend runtime type context for unknown values, static-rec
  preservation of that context for annotated `Text`, struct, and union
  parameters and rec-local bindings including text length, byte indexing, and
  `get`, struct projection, struct indexing, struct `get`, dynamic scalar/text
  `if` results, dynamic struct `if` result/projection/index lowering, dynamic
  statement-level `if`/`if let` fallthrough including typed union `if let`
  fallthrough inside dynamic static-rec branch inference, dynamic union `if let`
  result handler application through direct, deferred const-call, and inlineable
  runtime closure-call targets, dynamic struct index-assignment rebuilds, and
  dynamic union `if let` payload branches, known runtime text/struct/union type
  facts through unannotated frontend helper-call specialization, structured Core
  preservation of closure parameter annotations with built-in static-call
  parameter checks and direct struct/union parameter context, and const
  functions with loops/assignments. Simple const block values can resolve to
  union cases and type-values before Ic lowering. Dynamic ordinary function
  branches, including simple aliases to known closures, eta-expand to Ic lambdas
  when their applied bodies produce scalar or text-pointer results, preserve
  matching, one-sided, and alias-equivalent parameter annotations in selected
  closure branches, reject known incompatible selected-branch call arguments,
  recover i64 selected bodies from parameter/capture facts, and calls through
  those branches inline back to dynamic `if` expressions for frontend-known
  struct and union consumers.
- Binding annotations for built-in scalar/type checks and fact-checker checks,
  structured Core built-in scalar/type binding annotation validation, structured
  Core direct type annotation context for visible struct/union type-values,
  struct and union type-values, simple Core const aliases to visible type-values
  and builtin type names, frontend binding-time type-alias capture inside type
  fields and destructuring patterns, frontend non-final compile-time-only
  expression statement elision before Ic lowering, simple Core const
  type-constructor instantiation including curried calls, generic type
  constructors, typed constructors, direct annotation context for shorthand
  aggregate values and dynamic typed union-if branches, declared case payload
  context for shorthand object values in typed union annotations, structural
  builtins, destructuring fact checkers, runtime struct parameter and
  typed-union parameter fact-checker annotations, and `with` extensions with
  binding-time field capture.
- Pure linear functions and `let`/`const` bindings, pure specialized calls with
  linear parameters, pure explicit capability-function calls through
  const-specialized dependency objects, frontend-known method-style capability
  calls over linear receiver bindings and direct specialized known-capability
  arguments without treating ordinary object function fields as
  implicit-receiver methods, path-sensitive linear validation, module functions
  from explicit dependency objects, source-file import loading, and capability
  narrowing checks.
- The module layer emits and validates Wasm function imports, imported function
  exports, a single Wasm memory, and active data segments, with WAT-to-Wasm
  integration tests for host imports and initialized memory.
- Static range loops, static collection loops over const-known aggregate values,
  typed runtime structs, frontend-visible text bytes, and visible aggregate or
  concrete visible `Text` arguments specialized into closures that field-select,
  index, update, call `len`/`get`, or iterate their parameters, runtime-index
  `get` and bracket indexing over const-known aggregate values and typed runtime
  structs with runtime scalar/text payloads, typed runtime struct `len`, static
  `break`/`continue` including pure linear loop-edge rebinding, specialized
  runtime closure calls that preserve binding-time capture environments, typed
  pure union handler lowering for dynamic `if let` with numeric and text-pointer
  results, source-level erasure for unused runtime bindings, explicit Ic sharing
  for repeated runtime bindings, parameters, and free names, Ic cleanup for
  one-sided duplications, primitive superposition propagation for unary memory
  loads, pure struct-update expressions by rebuild, frontend-known aggregate and
  typed runtime struct index assignment by rebuild including runtime scalar/text
  payloads and visible text fields, dynamic typed struct `if` field selection,
  dynamic frontend-known object `if` field selection, same-case dynamic typed or
  locally inferred shorthand union `if` payload selection as handler-encoded
  values, standalone inferred shorthand union cases as one-case Ic handler
  lambdas including unknown runtime payloads, different-case dynamic typed or
  locally inferred shorthand union `if` as handler-encoded Ic values including
  unknown runtime payloads, different-case dynamic typed union `if` consumed by
  numeric/text-pointer `if let` including `Text` payloads used by `len` and
  named-struct payloads used by field access, including shorthand object
  payloads resolved from declared union-case context and typed unknown
  union-value branches matched by dynamic `if let`, including annotated helper
  calls that return dynamic `if` values over typed union parameters, i64 select
  retagging after direct handler-encoded union application, dynamic union
  `if let` expressions that produce handler-encoded union results through direct
  targets, deferred const-call results, inlineable runtime closure calls, and
  dynamic `if` branches whose union cases are produced by inlineable identity or
  constructor helper calls, inferred union case tables for unannotated
  union-result `if let` expressions preserved into later `=` shadowing checks,
  typed union case tables preserved through direct and simple block-bodied
  inlineable helper returns into `if let`, static-rec application of those bound
  handler-encoded union results, locally inferred shorthand dynamic union cases
  consumed by `if let` both directly and through statically bound dynamic `if`
  values, through deferred const-call results, and through inlineable runtime
  closure calls that return dynamic union values, binding-time payload capture
  for bound union cases, known union cases through frontend-known
  field/static-index projections, frontend-known object/typed-struct dynamic
  `if let` field-wise Ic value lowering, simple block-local frontend-known text
  values in visible text operations, simple block-local frontend-known struct
  and union values, simple const block union values and type-values, simple
  block-local dynamic union-if values consumed by `if let`, known runtime
  text/struct/union type facts through unannotated frontend helper calls,
  deferred const-call aggregate results consumed by field/index access, typed
  struct and frontend-known object values as Ic handler lambdas, text literals
  as length-prefixed UTF-8 data pointers, visible text concatenation with
  WAT-to-Wasm memory coverage, static visible text byte indexing including
  selected-branch traps for dynamic visible text branches, visible text equality
  and inequality over literals and dynamic visible branches, static slices and
  named `append` over literals and dynamic visible branches, bound visible slice
  and append results feeding later `len`/index/equality/nested visible
  operations, static and dynamic-union `if let` text results preserving visible
  facts through bindings, inlineable unannotated helper-returned visible
  `append`, `slice`, text `if`, and text `if let` results feeding later
  equality, rejection of text-typed values in numeric primitive operands outside
  fully visible text concatenation/equality and rejection of other known
  non-numeric values before primitive Ic lowering, dynamic text `if` by
  data-pointer selection, dynamic indexing and index assignment over visible
  text fields by data-pointer selection, `len`, byte indexing, and `get` over
  frontend-visible text values, dynamic visible text branches, and dynamic
  indexes over visible text fields, compile-time layout helpers, `fail`,
  `panic`, and explicit `result_type`-style unions.
- A minimal `Source -> Core` structured path preserves dynamic range loops,
  unknown collection loops, and unknown index assignments with carried-variable
  facts before Ic/Wasm codegen.
- `Core.emit` lowers `panic("...")` to WAT `unreachable`, with WAT-to-Wasm
  runtime trap coverage.
- `Core.emit` applies static and dynamic index assignments to statically bound
  object/struct shapes by capturing runtime index and value expressions in
  hidden locals as needed, with WAT-to-Wasm coverage. Visible `Text` update
  values stay available to later text operations after dynamic index assignment
  and shadowing. Inlineable static closure calls clone captured static aggregate
  shapes and static aggregate arguments before applying those index-assignment
  rebuilds.
- `Core.emit` rebuilds static-shaped struct update expressions and captures
  runtime update values in hidden locals, with WAT-to-Wasm coverage.
- `Core.emit` snapshots runtime field values, union payloads, and dynamic
  aggregate/union `if` bindings when binding or assigning statically shaped
  values, so later shadowing does not change the aggregate value, with
  WAT-to-Wasm coverage.
- `Core.emit` merges compatible static-shaped struct and visible text
  assignments across statement-level dynamic `if ... else` branches, preserving
  the selected static fact with WAT-to-Wasm coverage.
- `Core.emit` lowers scalar `i32` range loops to WAT `block`/`loop` control
  flow, evaluating start, end, and step once, rejecting statically zero steps,
  trapping dynamically zero steps, and supporting no-else `if`, statement-level
  dynamic `if ... else` assignment branches, `break`, and `continue`, with
  WAT-to-Wasm instantiation tests.
- `Core.emit` lowers scalar dynamic tail recursion to WAT `block`/`loop` control
  flow by carrying recursive parameters in locals and updating them before
  branching back to the loop, with WAT-to-Wasm instantiation tests. Source-level
  annotated dynamic tail recursion now reaches the same structured route through
  `Source.wat` without internal `rec(...)` tail calls being reported as host
  imports.
- `Core.emit` lowers static collection loops over literal, statically bound, or
  compatible dynamic `if` object/struct shapes by unrolling fields, scalarizes
  field/static-index access through those bindings, lowers `len`/`get` calls
  over those shapes, and lowers dynamic aggregate index expressions over
  homogeneous fields through structured typed `if` chains with trap fallbacks.
  It also lowers direct or simple const-call dynamic statically shaped aggregate
  `if` collection loops, static-call block bodies with local carried values and
  collection loops, direct dynamic statically shaped aggregate `if` field/index
  access, and same-case dynamic union `if` payload selection through `if let`.
  Dynamic union-if `if let` lowering works for direct and statically bound
  shorthand or typed-constructor union branches, with loop-local item/index
  bindings and `break`/`continue` edges covered by WAT-to-Wasm instantiation
  tests.
- `Core.emit` lowers visible text and runtime values known to have type `Text`
  to Wasm `block`/`loop` control flow over length-prefixed UTF-8 data, with
  item/index locals and `break`/`continue` edges covered by WAT-to-Wasm
  instantiation tests. Range-loop WAT emission now lives in
  `src/core/range_loop.ts`; static aggregate and `Text` collection-loop WAT
  emission lives in `src/core/collection_loop.ts`, with the backend adapter
  supplying the semantic hooks for static facts and nested expression/statement
  emission.
- `Core.emit` lowers static `if let` statements and expressions over literal or
  statically bound shorthand and typed-constructor union cases by emitting
  matching bodies and payload local bindings, with WAT-to-Wasm coverage for
  matching and non-matching cases.
- `Core.emit` materializes typed scalar/`Text`/`Unit` and static-shaped struct
  union values as heap objects with an `i32` tag, scalar/text-pointer payload
  slots, union-pointer payload slots, or packed nested struct-field slots, and
  `i32` pointer result for direct typed constructors and direct dynamic `if`
  branches over typed union cases, with WAT-to-Wasm memory inspection coverage.
- `Core.emit` statically inlines simple const-call results that produce dynamic
  union `if` values when they are consumed by `if let`, with WAT-to-Wasm
  coverage and captured condition locals preserving value semantics.
- `Core.emit` keeps type-level const bindings available to static Core analysis
  including simple const aliases to visible type-values and builtin type names,
  while validating and then eliding destructuring `type_check` statements from
  generated WAT, with WAT-to-Wasm coverage.
- The frontend validates and elides non-final expression statements proven to be
  compile-time-only, including type-values and `with` extension expressions,
  before Ic lowering; final type-value program results still fail as non-runtime
  values.
- `Core.emit` instantiates simple const type constructors returning struct/union
  type-values, including curried calls, before WAT emission, with WAT-to-Wasm
  coverage.
- `Core.emit` validates built-in scalar/type binding annotations during Core
  static analysis before WAT emission and rejects unsupported Core binding
  annotations explicitly, with WAT-to-Wasm coverage for valid annotated
  bindings.
- `Core.emit` preserves closure parameter annotations and checks built-in
  scalar/type parameter annotations while inlining static Core calls. Direct
  struct/union type-value parameter annotations also provide static call
  argument context, with WAT-to-Wasm coverage.
- `Core.emit` treats known `let` closures as inlineable static call targets,
  snapshots scalar runtime captures into hidden locals at binding time, and uses
  hidden parameter/block-local names for statement-bodied inline calls. It has
  WAT-to-Wasm coverage for text collection loops inside such closures,
  closure-local parameter assignment, caller-safe local shadowing, and
  later-shadowed scalar captures. `Core.mod` lowers first-class scalar closures
  with annotated scalar parameters by emitting environment-pointer closure
  values, lifted functions, function-table elements, a heap pointer global, and
  `call_indirect`; closure allocation lives in `src/core/closure_emit.ts`,
  closure layout/type registration lives in `src/core/closure_lift.ts`, lifted
  function WAT emission lives in `src/core/closure_lift_emit.ts`, closure type
  discovery and call argument validation are isolated in
  `src/core/closure_type.ts`, and runtime-capture discovery and static capture
  snapshots are isolated in `src/core/closure_capture.ts`, with unused
  capture-free runtime-local traversal removed from that module. Captured
  first-class closure pointers and closures returned from scoped static calls
  keep their callable signatures, including returned closures with annotated
  `I64` parameters/captures stored in 8-byte-aligned environment slots. Static
  text-layout scanning enters annotated lambda/rec bodies with scoped
  scalar/text parameter facts so those returned closure environments can be
  discovered before WAT emission. Selected first-class closure branches can
  derive one-sided `Int`/`I32`, `I64`, and `Text` parameter facts from the
  annotated branch, and Core tracks `Text` parameter facts separately from plain
  `i32` so `Int`/`Text` branch mismatches fail before WAT emission. Same-type
  assignment to captured scalar names lowers as per-call closure-local shadowing
  for both inlined static closures and first-class closure environments.
  Sequential type-changing shadowing freshens to new Core locals before WAT
  emission, including closure-local shadows. Runtime locals hidden inside
  captured static text values are captured into first-class closure environments
  before lifted closure emission. Inlineable static closures that index-assign
  captured statically shaped aggregates clone those aggregate shapes per call
  before rebuild. Runtime locals known to have type `Text` lower byte index
  assignment to bounds-checked `i32.store8`, including lifted first-class
  closure bodies and captured runtime `Text` locals inside first-class closure
  environments, with WAT-to-Wasm mutation and trap coverage. Stored runtime
  aggregate pointers with known struct layouts now support top-level scalar,
  `Text`, union-pointer, and inline nested aggregate index assignment through
  checked memory stores, including static offset stores, dynamic index branch
  chains, out-of-bounds traps, and rejection for mixed dynamic target field
  kinds. The same store path now works when the runtime aggregate pointer is
  captured by inline and first-class closures. Static/frozen-shareable text
  bindings now stay immutable static data, `borrow` and `freeze` over already
  shareable text preserve static text recognition, and indexed mutation through
  those bindings rejects with a deterministic frozen/shareable diagnostic.
  Broader array/slice mutation, frozen unique-heap store facts beyond current
  freeze-promotion reservations, and reusable allocator/destructor cleanup
  remain reserved.
- `Core.emit` applies direct struct/union type-value binding annotation context
  to shorthand object values, union-case values, and dynamic union-if branch
  values whose cases belong to the annotated union, with WAT-to-Wasm coverage.
  Visible `Text` payloads from those dynamic union values remain visible to
  later `if let` text operations after shadowing. Frontend dynamic union
  branches preserve explicitly named struct payloads and shorthand object
  payloads resolved through declared union-case context before Ic lowering, and
  Core dynamic union-if `if let` lowering keeps those payloads as branch-local
  static aggregate facts, with field access covered through WAT-to-Wasm.
- `Core.emit` materializes typed scalar/`Text`/`Unit` and static-shaped struct
  runtime union values as heap tag/payload objects and preserves typed
  union-pointer facts across annotated runtime bindings, first-class
  closure-call results, direct union-pointer payloads, and nested static-shaped
  struct payload fields, so stored pointer `if let` matches lower to tag and
  scalar/text-pointer, union-pointer, or struct-field payload loads, with
  WAT-to-Wasm coverage. The frontend also resolves nested runtime struct field
  types through annotations, so typed dynamic union payloads such as
  `user.name.first` remain visible to `Text` operations before Ic lowering.
- `Core.data` and `Core.emit` lower Core text literals to length-prefixed UTF-8
  module data pointers, with WAT-to-Wasm memory coverage.
- `Core.data` and `Core.emit` lower visible Core text concatenation to
  length-prefixed UTF-8 module data pointers, including dynamic indexes over
  visible text fields, with WAT-to-Wasm memory coverage.
- `Core.emit` lowers runtime `Text` concatenation to heap-allocated
  length-prefixed UTF-8 text by storing the combined byte length and copying
  both operands with structured Wasm loops. Simple static-call text results are
  also visited during data-layout collection so folded text has a data segment,
  with WAT-to-Wasm coverage. The runtime text WAT helpers are split into
  `src/core/runtime_text.ts`.
- `Core.emit` lowers `len` over visible text literals, bindings, dynamic text
  branches, and dynamic indexes over visible text fields to UTF-8 byte lengths,
  with WAT-to-Wasm coverage. It also lowers `len` over runtime values known to
  have type `Text` to an `i32.load` from the length prefix.
- `Core.emit` lowers static and dynamic byte indexes over visible text values
  and runtime values known to have type `Text` to UTF-8 byte values with
  out-of-range traps, with WAT-to-Wasm coverage.
- `Core.emit` lowers `get(text, index)` over visible text and runtime values
  known to have type `Text` to the same UTF-8 byte-index path, with WAT-to-Wasm
  coverage for in-range values and out-of-range traps.
- The frontend lowers `len` over runtime values known to have type `Text`
  through Ic/Expr to `i32.load` from the length-prefixed text pointer, with
  WAT-to-Wasm coverage.
- The frontend lowers byte indexes over runtime values known to have type `Text`
  through Ic/Expr to bounds-checked `i32.load8_u(pointer + 4 + index)`, with
  WAT-to-Wasm coverage for in-range values and out-of-range traps.
- The frontend lowers `get(value, index)` over runtime values known to have type
  `Text` through the same bounds-checked byte-load path, with WAT-to-Wasm
  coverage for in-range values and out-of-range traps.
- Static-rec application result typing preserves annotated static-shaped struct
  and nested `Text` fields after the rec call returns, including dynamic struct
  `if` branches with nested static-shaped struct fields.
- Static-rec union payload bindings preserve user-defined annotation type names,
  so recursive `if let` bodies can project nested struct payload fields and use
  runtime `Text` operations on them.
- The frontend lowers collection loops over frontend-visible text values as
  UTF-8 byte expansion through Ic. Concrete visible `Text` arguments passed to
  closures that index, call `len`/`get`, or iterate the parameter specialize
  before Ic expansion, with WAT-to-Wasm coverage. `Core.emit` lowers collection
  loops over visible text and runtime values known to have type `Text` as
  length-prefixed UTF-8 byte loops, including first-class closure bodies.
- The frontend lowers direct non-escaping local closure calls, including
  parameterized calls, simple local aliases, simple block-local aliases/direct
  block calls, literal-condition static closure branches, and dynamic ordinary
  function branches, including simple aliases to known closures, with
  scalar/text-pointer Ic results plus frontend-known struct/union consumers,
  rejecting incompatible dynamic function branch parameter shapes before generic
  dynamic `if` lowering, and dynamic union-if `if let` expressions whose
  branches return direct non-linear closures with compatible parameter shapes,
  including i64 selected bodies recovered from matching, one-sided, and
  alias-equivalent parameter/capture facts, while validating outer linear-value
  consumption at the call site before Ic reduction.
- The parser reserves excluded language-family keywords such as `class`,
  `trait`, `macro`, `instance`, `extends`, `inherits`, and `where` so they
  produce explicit unsupported diagnostics instead of ordinary identifiers.
- The parser enforces lowercase-leading `snake_case` for source identifiers
  across bindings, parameters, loop binders, linear-value references, field
  access, union cases, `if let` payload binders, type-pattern fields, and
  user-defined type references while preserving builtin type spellings such as
  `Int`, `I64`, `Text`, `Unit`, and `Type`.
- The public frontend route is split between strict pure-Ic lowering and
  structured Core/Wasm lowering. `Source.compile` remains the Ic-only helper,
  while `Source.core`, `Source.mod`, and `Source.wat` accept source text or
  parsed source for structured programs. Ic-only diagnostics for dynamic range
  bounds, unknown collection loops, untyped dynamic `if let`, rec values/dynamic
  rec cases, unknown field access, and unknown index expressions or
  memory-backed index assignment now point to the structured route.
- Remaining memory/generalization work is planned around unique-by-default
  runtime heap values, read-only `borrow` views whose lifetimes are bounded by
  the current block, loop iteration, function call, or `scratch {}` scope,
  explicit `freeze` for immutable shareable values, and `scratch {}` as a
  temporary bump-allocated arena with a return value. The latest baseline
  decision is no GC fallback for `core-3-nonweb`: make the static ownership,
  lifetime, borrow, scratch-escape, freeze/promotion, and cleanup analysis
  precise enough for supported programs, then reject uncertain facts before WAT
  emission. Any managed or Wasm-GC strategy is a separate future backend target.
  Optional region-like scopes should reuse scratch/arena lifetime analysis
  rather than introduce implicit managed storage. Scratch reset must be emitted
  on every structured exit edge, and unique heap drop points should be computed
  even while the initial bump allocator makes those drops runtime no-ops.
  Lowering-created temporaries also need cleanup points from ownership/lifetime
  facts. Allocation sites should record their storage class and escape reason,
  unknown host/import calls should be treated as escaping unless marked as
  bounded-borrow consumers, and scratch-to-heap promotion should be explicit in
  Core rather than an implicit fallback.
- `borrow expr`, `freeze expr`, and `scratch { ... }` are reserved in the
  frontend grammar and source formatter. Source-to-Core now preserves them as
  explicit ownership nodes, and Core type/emit lowers them transparently for
  integer scalar results, already-shareable static text values, persistent
  runtime `Text` freeze, persistent runtime aggregate freeze, persistent runtime
  union freeze, and persistent first-class closure freeze. Core structural
  analysis passes traverse those nodes for locals, captures, static-call
  substitution, type substitution, stability, and text layout. Direct
  source-to-Ic lowering accepts the same scalar subset plus statically
  visible/shareable text expressions, including visible text bindings, simple
  visible text concatenations, and frontend-known struct/union handler values
  wrapped in `borrow`, `freeze`, or `scratch`. Pure closure values wrapped in
  those forms also erase on the Ic route, while the existing closure lowerer
  still rejects unsupported linear effects. Those safe wrapper expressions now
  preserve their inferred frontend type for `=` shadowing checks, so
  wrapper-bound structs, unions, and closures still reject accidental type
  changes. Immediate scalar text reads over annotated runtime `Text` now also
  erase wrappers on the Ic route, so `len(borrow message)`,
  `get(freeze message, index)`, and `(scratch { message })[index]` recursively
  lower to the usual Ic memory-read shape without letting the wrapped value
  escape. Dynamic text, unknown, and ownership-bearing heap results still reject
  on that Ic-only route until the full ownership/lifetime analysis can prove
  them pure-Ic lowerable. The first explicit Core ownership fact surface now
  lives in `src/core/ownership.ts`, with facts for `scalar_local`,
  `unique_heap`, `frozen_shareable`, `borrow_view`, and `scratch_backed`; Core
  scalar-only diagnostics use these facts to explain current rejections. Core
  `scratch { ... }` can now return frozen/shareable static text in addition to
  scalar locals, while unfrozen unique heap scratch results remain rejected
  unless an implemented freeze/promotion path produces `frozen_shareable`
  storage. Core `freeze expr` is now accepted for scalar and
  already-frozen/shareable values such as static text. Static-shaped aggregate
  values wrapped in `freeze` remain scalarized/static compiler facts, pass the
  no-GC proof gate, and reject indexed mutation with the frozen/shareable
  binding diagnostic. Persistent `unique_heap text` values can now be consumed
  by `freeze` as immutable shareable storage; frozen runtime text locals carry a
  frozen fact through Core typing/emission/proof contexts and reject later
  indexed mutation. Direct scratch runtime text freeze such as
  `scratch { freeze append(value, "!") }`, block-local scratch text freeze such
  as `scratch { let temp = append(...); freeze temp }`, inlineable
  helper-returned `Text` temporaries, and branch results whose `if` arms each
  freeze runtime `Text` now emit an explicit persistent copy before scratch
  reset and record both the scratch temporary and persistent promotion
  allocation in the no-GC proof. Persistent runtime aggregate, union, and
  closure owners also freeze as immutable shareable storage; direct,
  block-local, and branch-selected scratch closure freeze keep the frozen
  closure on persistent heap storage and can leave `scratch {}` as
  `frozen_shareable`. Scratch-backed aggregate, union, broader closure, and
  remaining text promotion still require future copying work. Core `borrow expr`
  is also accepted for scalar and already-frozen/shareable values, and bounded
  unique-heap borrows can now be used by immediate read-only consumers such as
  `len(borrow message)` inside annotated closure bodies. Escaping unique-heap
  borrows still reject. The first Core lifetime policy module now lives in
  `src/core/lifetime.ts`; Core type checking and emission use it to explain
  reserved `borrow`, `freeze`, and `scratch` cases in terms of missing lexical
  borrow tracking, immutable heap copy/promotion, or scratch escape handling.
  `src/core/borrow.ts` and `Core.borrows(...)` now expose deterministic borrow
  edges with source/target lifetime scopes, operand ownership, and lifetime
  decisions. Static Core calls are scanned through their substituted call body,
  so direct calls of unannotated scalar closures can produce function-call-scope
  borrow edges. Annotated closure values are scanned with closure-local
  parameter facts; unannotated escaping closure values are still reported as
  skipped analysis until closure-local inference is available.
  `Core.validate_borrows(...)` and `Core.check_borrows(...)` add deterministic
  validation/throwing gates for rejected borrow edges and skipped closure-body
  analysis, including context-aware allowed decisions for bounded unique-heap
  borrows. Core type checking, expression emission, and module generation now
  run the borrow gate before WAT emission. `src/core/escape.ts` and
  `Core.escape(...)` now expose the first allocation/escape analysis result for
  final Core values, recording ownership, selected storage class, whether the
  value escapes, and the decision reason. `src/core/cleanup.ts` and
  `Core.cleanup(...)` now expose the first cleanup plan for scratch scopes,
  including deterministic scratch scope names, return-value escape facts, and
  fallthrough/`return`/`break`/`continue` reset edges.
  `src/core/lifetime_scope.ts` and `Core.lifetimes(...)` now expose
  deterministic lexical scopes for programs, blocks, loop iterations, function
  calls, closure environments, and scratchpads. Core WAT emission now saves and
  restores `__scratch_heap` around `scratch {}` on normal fallthrough, stores
  the scratch body result in a temporary before reset, emits scratch resets
  before `return`/`break`/`continue` when those control transfers leave the
  active scratch scope, and leaves nested-loop control alone when it remains
  inside an outer scratchpad. `Core.mod` emits the `__scratch_heap` global and
  memory when scratch is used, including scratch inside lifted closure bodies.
  `src/core/drop.ts` and `Core.drops(...)` now expose deterministic unique-heap
  drop facts for straight-line owner replacement, discarded unique expressions,
  final-result escape, scope-exit drops, and `return`/`break`/`continue` exits.
  Terminal expression branches do not also report false fallthrough drops, and
  branch assignments to existing unique owners merge into the outer owner state.
  Branch-local owners and closure-local owners inside closure bodies now produce
  deterministic drop facts at their boundary. The first runtime is still the
  bump allocator, so drop steps are explicit `no_op_bump_allocator` analysis
  facts rather than emitted WAT. Direct named-owner discards and direct
  named-owner moves through static aliases now produce drop facts without
  forcing static owner values through runtime expression typing.
  Compile-time-only `const` values, including type values and const
  type-constructor results, stay in the static drop-analysis context and do not
  create runtime owners or require runtime expression typing. The borrow plan
  now rejects named-owner and simple-local-alias move/replacement, index
  mutation, and `freeze` while a bounded borrow is active in the same lexical
  scope. Stored borrow-view locals are now accepted when bounded to the current
  block, protect their owner while live, and reject returning, storing, or
  closure-capturing the view. Branches and loops that assign a stored borrow
  view into an outer name merge that view fact back to the parent scope, so
  owner mutation or view escape after the merge is rejected. Direct field/index
  borrows and simple field-owner aliases now canonicalize back to the containing
  owner, so replacing `user` after `borrow user.name`, replacing `user` after
  `let name = user.name; borrow name`, or mutating through the field alias while
  the borrow is live rejects. Field-owner aliases assigned through branches,
  `if let` bodies, or loop bodies into an outer local are also merged into the
  parent borrow state; if the local may alias multiple containing owners, a
  later borrow protects each possible owner. Expression-valued `if` and `if let`
  results that return field aliases also preserve every possible containing
  owner for later borrow barriers. Expression-valued `if` and `if let` results
  that return stored borrow views now preserve those possible views and protect
  their owners after the binding. Multi-statement block results that return
  field aliases or stored borrow views also carry that ownership fact to the
  outer binding. Field aliases assigned through block-prefix `if`, `if else`,
  `if let`, and loop statements are joined into the returned block result as
  possible containing owners. Broader borrow escape enforcement, full runtime
  aggregate memory ownership, nested aggregate alias chains, explicit
  freeze/promotion codegen, reusable allocator/destructor lowering, and cleanup
  planning for lowering-created temporaries remain pending. Direct
  block-expression owner result moves such as `{ f }`, discarded `{ f }`,
  `let g = { f }`, and block-local owner results are covered by the current drop
  plan. The same drop plan now treats `freeze` of direct named, block-result,
  and branch-result unique owners as consuming the source owner, including
  discarded, bound, block-wrapped, branch-local, returned, and self-shadowed
  freeze expressions. Optional statement branches containing `freeze`, including
  no-else `if` and typed `if let` bodies, now avoid runtime typing of static
  owner values and produce conservative no-op bump drop facts for paths where
  the branch may not run; conditional destructor emission for reusable
  allocators is still pending. `src/core/proof.ts`, `Core.proof(...)`, and
  `Core.check_proof(...)` now expose an explicit `core-3-nonweb` no-GC proof
  harness with managed storage disabled. It aggregates final-result escape
  facts, borrow validation, explicit `freeze` edges, scratch cleanup/reset
  facts, unique-owner drop facts, and lifetime scopes. Accepted scalar/scratch
  fixtures and scalarized static-shaped aggregate fixtures expose the facts WAT
  emission would use, including allowed `freeze` edges over scalarized
  static-shaped aggregates and scratch-return edges for scratch-free
  static-shaped aggregate results, and rejected unique-heap `freeze` or
  scratch-return fixtures produce deterministic proof issues rather than
  selecting a GC fallback. Static-shaped aggregate values, aggregate updates,
  and extension objects are now treated as ownerless compiler facts in the
  drop/proof path, matching the current scalarized Core/Wasm representation.
  Static-call-only unannotated `lam` and `rec` values are also treated as
  ownerless compiler call targets, while annotated runtime closures still
  produce unique-heap drop facts when materialized. Drop-analysis type-value
  probing is non-fatal for ordinary static function calls, so specialized static
  runtime calls are not mistaken for type-constructor applications. Annotated
  closure bodies are now pre-collected for drop/proof local facts, covering
  closure-local accumulators and collection-loop item/index locals. Static
  shorthand union cases, ownerless static union `if` values, and
  static/dynamic/runtime `if let` payload branch contexts are now covered by the
  proof path. The inline Core proof audit now passes for every typed snippet;
  deliberately unsupported unknown collection-loop bodies are skipped by drop
  analysis because emission still rejects them before WAT. `Core.emit(...)` and
  `Core.mod(...)` now run `Core.check_proof(...)` before producing WAT/module
  artifacts, while `Core.type(...)` remains a type-query surface rather than the
  WAT emission gate. Persistent heap-backed aggregate, union, and closure freeze
  is implemented; direct, block-local, and branch-selected scratch closure
  freeze are implemented; block-local scratch aggregate alias promotion is
  implemented for supported known-layout fields; block-local scratch runtime
  union alias promotion is implemented for scalar/`Text`/`Unit`, union-pointer,
  and supported aggregate-pointer payloads. Actual immutable heap copy/promotion
  for static-shaped existing aggregate aliases is implemented, and
  branch-selected plus branch-assigned existing runtime union aliases preserve
  payload facts through scratch freeze. Dynamic loops that would carry static
  aggregate/union facts now reject until loop-specific promotion facts exist.
  Broader existing owners, broader closure shapes, and remaining text shapes are
  still pending. Expression-level `if` and `if let` owner results are now
  path-sensitive: non-selected owners drop in branch scopes, while the selected
  owner is moved, escaped, or discarded by the surrounding context. These are
  baseline static-analysis tasks: the compiler should make ownership, borrow,
  scratch escape, and cleanup facts precise enough for supported programs, then
  reject uncertain cases before WAT emission. `scratch {}` is the MVP
  region-like construct with a value result, but it does not return a live
  attached region after reset; escaping results must be scalar, frozen,
  promoted, proven scratch-free, or rejected. GC/Wasm-GC remains a future
  separate backend target rather than a fallback. Direct use of a static-shaped
  struct as a runtime value now materializes a standalone
  `unique_heap runtime_aggregate` pointer through the shared `__closure_heap`,
  while existing static field/index scalarization remains allocation-free.
  Closure-valued `if let` expressions in structured Core now reuse first-class
  closure storage over direct dynamic union-if targets and stored runtime-union
  pointer targets. Matching branches may capture the bound payload in the lifted
  closure environment, fallback branches call indirectly through the else
  closure, and one annotated branch can establish the signature for an
  unannotated branch. WAT-to-Wasm coverage validates both matching and fallback
  stored-runtime-union cases through `call_indirect`. Frontend same-type `=`
  shadowing now compares function parameter shape instead of accepting every
  `fn` tag as equivalent. Arity, `const`/linear flags, and annotation shape must
  match; parameter names may differ, and built-in integer annotation aliases
  normalize together. Known struct field-type facts now participate in frontend
  same-type `=` shadowing as well, so same-field structs with incompatible
  payload types reject before Ic lowering. Anonymous object literals now
  contribute shallow field-type facts when every field has a simple known type,
  so typed-to-anonymous and anonymous-to-anonymous struct shadows are guarded
  before Ic lowering too. Shorthand union cases now contribute simple payload
  facts as well, so `.ok(1)` cannot be same-type shadowed with `.ok("text")`.

The first host/import proof and codegen slices are implemented for Task 12.2:
`Core.host_imports` can describe scalar, bounded-borrow, frozen/shareable, and
ownership-transfer argument contracts. `Core.host_boundaries(...)` and
`Core.proof(...).host_boundaries` report matched signatures and per-argument
decisions before WAT emission, `Core.drops(...)` records `host_transfer` facts
for consumed direct unique owners, `Core.proof(...)` reports direct
use-after-transfer issues, and `Core.mod(...)` emits known host imports and
direct calls. Bounded-borrow imports accept explicit `borrow owner` views.
Ownership-transfer imports accept direct `unique_heap` arguments and reject
borrowed views. Host-returned owner contracts are implemented for Core import
results, including proof-visible signatures, owned final-result escape facts,
scope-exit drops for bound unique results, and WAT import calls. Unknown
`unique_heap`, `borrow_view`, and `scratch_backed` boundary arguments reject
with diagnostics that name the missing bounded-borrow or ownership-transfer
contract. Frozen/shareable Core import arguments now have proof and WAT fixture
coverage. Scratch-backed Core import arguments now classify bounded-borrow views
as call-bounded reads and reject ownership transfer before WAT emission.
Source-level host import declarations now lower scalar numeric ABI signatures
and ownership contracts to the same Core `host_imports` surface:
`bounded_borrow Text`, `ownership_transfer Text`, `frozen_shareable Text`,
non-Text pointer owner reasons such as `runtime_aggregate`, `runtime_union`, and
`closure`, user-defined aggregate/union type-value owner references such as
`bounded_borrow user_type`, `ownership_transfer result_type`, and
`unique_heap user_type`, and host-returned `unique_heap` or `frozen_shareable`
pointer owners. `Source.core(...)` resolves preceding top-level `const` struct
type-values to `runtime_aggregate` and union type-values to `runtime_union`,
including simple const aliases, while missing or non-type owner references
reject before Core emission. Pure Ic lowering rejects those declarations with a
structured Core/Wasm route diagnostic, while `Source.wat(...)` emits the WAT
import and call. The first interprocedural transfer slice is implemented for
direct calls to top-level statically bound lambda wrappers with variable
arguments; wrapper calls now record caller-owner `host_transfer` drops and
reject later use of the transferred owner. Single-expression block-bodied
wrappers such as `let send = msg => { host_take(msg) }` are covered by the same
proof/drop path. Multi-statement block-bodied wrappers such as
`let send = msg => { let code = host_take(msg); code }` are now covered by the
same transfer/drop path. Closure-returning helper bodies are skipped by the
transfer-only drop scan so ordinary first-class closure helpers are not probed
as transfer wrappers. Branch-selected top-level wrappers with annotated closure
branches, such as
`let send = if flag { (msg: Text) => host_take(msg) } else { (msg: Text) => host_take(msg) }`,
now record branch-scoped caller-owner `host_transfer` facts, reject later use of
the transferred owner, and compile through WAT-to-Wasm `call_indirect`.
Top-level ownership-transfer wrappers now also accept unique temporary
expression arguments such as `send(append("a", "b"))`; transfer validation
records a synthetic temporary owner, drop planning records an ownerless
`host_transfer` step, and the wrapper call compiles through WAT-to-Wasm. Static
wrapper transfer validation now proves aliased non-variable arguments before
recording synthetic transfers: branch-created runtime text temporaries are
accepted as `unique_heap`, while scalar named or temporary arguments reject
before WAT emission with an invalid transfer-argument diagnostic. Branch-local
wrapper definitions such as
`if flag { let send = msg => host_take(msg); send(message) }` are now visible to
later statements in that lexical analysis scope, record caller-owner transfer
facts, and reject use-after-transfer after branch merges. Statically bound `rec`
wrapper values such as `let send = rec (msg: Text) => host_take(msg)` now use
the same proof/drop path, record caller-owner `host_transfer` facts, reject
use-after-transfer, and compile through WAT-to-Wasm. Const function-parameter
higher-order wrappers such as `let relay = (const f, msg) => f(msg)` can now
receive a statically bound transfer wrapper, preserve that argument as a static
function during scoped static-call typing/emission, record the nested
caller-owner `host_transfer`, reject use-after-transfer, and compile through
WAT-to-Wasm. Remaining work is deeper transfer analysis for dynamic or more
general higher-order wrappers, truly self-recursive transfer shapes, plus any
future scratch-backed promotion policy that intentionally crosses the host
boundary.

Latest task update: the memory/lifetime queue is locked to the no-GC baseline.
If a case cannot prove ownership, lifetime, borrow/view validity, scratch
escape, freeze/promotion, host-boundary behavior, and cleanup/drop/reset facts
before WAT emission, split it by value category and escape shape or reject it
with a deterministic diagnostic. The next implementation slices remain
field-sensitive scratch escape for heap-backed aggregate/union payloads, cleanup
for lowering-created temporaries, deeper interprocedural transfer analysis, and
proof-gating or linearizing reserved closure captures. Accepted baseline
fixtures should keep `managed_storage: "disabled"` or an equivalent no-GC
profile marker visible in the proof output, including cases for compiler-created
temporaries and scratchpad returns. Per-slot closure capture ownership is now
proof-visible through `Core.closure_ownership(...)` and
`Core.proof(...).closure_ownership`: scalar and frozen/shareable captures are
allowed, selected runtime aggregate pointer, runtime union pointer, and closure
pointer captures report their supported decisions, and every reserved
closure-capture slot now rejects through the baseline proof gate before WAT
emission. Remaining closure work is to explicitly accept more reusable/frozen
capture classes or implement real linear closure calls. Named arenas,
attached-region return packages, reusable allocators, destructors, managed GC,
and Wasm-GC stay future explicit profiles.

Latest task refinement: Task 12 now has a final no-GC implementation roadmap.
The order is proof inventory gate, unique heap ownership by default,
`borrow`/view checking, lexical value-returning `scratch {}` scratchpads,
explicit `freeze`/promotion, cleanup for source values and lowering-created
temporaries, storage-driven linear participation, and only then future explicit
region or managed-storage profiles. The immediate slices are temporary cleanup
facts, field/payload-sensitive scratch escape proofs, broader explicit
freeze/promotion copies, closure capture linearization or rejection, and deeper
host/import transfer analysis.

Latest implementation slice: discarded runtime aggregate materialization now
participates in the drop plan. A discarded aggregate expression records an
ownerless `heap_drop` on `discarded_expr` with `unique_heap runtime_aggregate`,
so the cleanup proof matches the runtime aggregate allocation fact instead of
silently relying on the bump allocator or backend emission. This covers direct
aggregate construction and static aggregate facts that are materialized by
expression use before being discarded.

Latest proof-gate slice: unsupported Core codegen nodes now participate in
`Core.proof(...)`. Covered shapes now include unknown `collection_loop`
statements, preserved unknown field/index expressions, and preserved unsupported
`if let` expression/statement targets. Final unsupported app expressions are
also proof-gated before Core type inference, as are final direct or named
type-level Core values. They produce `unsupported_codegen` proof issues and fail
in `Core.check_proof(...)` before Core typing or `Core.emit(...)` reaches the
WAT fallback.

Latest host-transfer slice: higher-order ownership-transfer wrappers now handle
local static function aliases inside the wrapper body. A shape such as
`let relay = (const f, msg) => { let g = f; g(msg) }` preserves `g` as a static
function alias through scoped static-call local collection, transfer validation,
drop planning, and WAT emission, so the nested `host_transfer` is proof-visible
and use-after-transfer still rejects before codegen. This shape now also has
WAT-to-Wasm runtime coverage through the host import.

Latest task split update: Task 12 now turns the no-GC memory decision into seven
implementation slices: proof inventory gating, lowering-created temporary
cleanup, field/payload scratch-escape proofs, explicit freeze/promotion copies,
borrow/view barriers, closure capture ownership, and deeper host/import transfer
analysis. Each slice should land as an accepted proof fixture plus the nearest
rejected diagnostic fixture. The baseline remains `core-3-nonweb` with no GC
fallback; hard cases are split by value category and escape shape.

Intentionally reserved or still incomplete:

- General dynamic structured-loop codegen, unknown dynamic `if let` outside
  typed/direct union-if or the implemented inlineable helper-call/closure-call
  union-result shapes, memory-backed index assignment beyond runtime `Text`
  bytes and runtime aggregate scalar/`Text`/union-pointer/inline nested fields,
  general first-class linear closure captures, unknown runtime collection
  codegen, mutable collection fact checking/codegen, runtime union payload
  storage/matching outside the implemented scalar, `Text`, `Unit`,
  union-pointer, and aggregate-pointer struct payload cases, runtime text/string
  operations outside the supported visible literal/concat/equality/data-pointer
  cases and runtime `Text` length, byte-load, `get`, byte assignment,
  collection-loop, and Core runtime concat/freeze/scratch-promotion subset,
  unknown effectful method-style capability lowering, frontend aggregate
  memory/codegen representation, general array, slice, frozen unique-heap
  memory-backed index mutation beyond current freeze-promotion reservations, and
  broader structured-core/Wasm codegen. These have been split into implementable
  follow-up tickets in
  [12-remaining-generalization-tasks.md](12-remaining-generalization-tasks.md).

Latest verification passed with 307 tests:

```txt
deno fmt --check main.ts test.ts src docs tasks
deno check main.ts test.ts src/**/*.ts
deno test --allow-read --allow-write --allow-run
```
