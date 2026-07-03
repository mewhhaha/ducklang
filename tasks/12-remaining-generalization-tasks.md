# Remaining Generalization Tasks

## Goal

Refine the broad reserved surface into implementable tasks. These tasks are
based on the current code, diagnostics, and tests after the MVP source-to-Ic and
source-to-Core/Wasm work.

Target profile: `core-3-nonweb`. Use baseline structured Wasm control flow,
locals, linear memory, globals, tables, and indirect calls. Do not depend on
proposal-only Wasm features. The default backend is analysis-first: make
ownership/lifetime analysis complete for the supported source surface, and
reject uncertain escapes with deterministic diagnostics instead of adding a GC
fallback.

Feature classification for this task set:

- Baseline Wasm: structured control flow, locals, globals, tables, indirect
  calls, and linear memory.
- Source-language/static analysis: unique ownership, bounded borrows, frozen
  shareable values, scratchpad lifetimes, escape facts, promotion decisions, and
  cleanup insertion.
- Future separate target only: Wasm-GC or managed fallback storage. It must not
  change the default linear-memory semantics.

Latest scratchpad/GC decision:

- The baseline does not include a "let the GC decide" path. Skipping GC is a
  requirement for `core-3-nonweb`, not just an optimization.
- This replaces any temporary GC-assisted acceptance path for hard scratchpad,
  temporary, closure-capture, aggregate, union-payload, text, or host-boundary
  cases. A collector can only appear later as an explicit managed backend
  profile with its own Core representation, ABI rules, proof facts, and tests.
- `scratch { ... }` is a value-returning scratchpad for temporary shareable
  computation. It resets lexically and never returns a hidden live region.
- A scratch result can leave only when it is scalar, already frozen/shareable,
  explicitly promoted/frozen into persistent storage, or proven scratch-free at
  the value, field, and payload level.
- Borrow/view syntax is the analysis aid for local lifetime reasoning:
  `borrow owner` and `let view = borrow owner` create read-only, non-owning
  views bounded by the owner lifetime.
- Cleanup for compiler-created temporaries is inserted from the same ownership
  and lifetime facts as source cleanup. Scratch temporaries reset with the
  scratchpad, unique temporaries record drop points, and scalar/frozen
  temporaries need no runtime cleanup.
- If analysis is hard, refine the task by value category and escape shape until
  it is accepted with proof facts or rejected with a deterministic diagnostic.
  Do this refinement work as part of the implementation task instead of leaving
  the case broad and accepting it by runtime cleanup. Named arenas,
  attached-region return packages, managed storage, tracing GC, and Wasm-GC are
  future explicit profiles with their own Core/ABI/proof work.

Implementation anchors from the research pass:

- Language-to-Wasm lowering should pass through typed Core, keep ownership and
  layout facts explicit, and validate the proof surface before WAT emission.
- Region/arena allocation is appropriate for `scratch { ... }` because it gives
  cheap temporary allocation and O(1) reset while keeping escape decisions in
  the compiler.
- Lifetime and escape analysis must run before storage selection; hard cases
  become narrower accepted proof slices or rejected diagnostic slices, not
  runtime-managed fallbacks.
- Linear checks enforce ownership in typed Core while lowering values to
  ordinary Wasm locals and linear-memory pointers.
- Linear and unique values keep ordinary Wasm representations. Correctness comes
  from typed-Core facts, path-sensitive validation, and a proof gate before WAT
  emission.
- Lifetime and escape analysis must classify returns, closure captures,
  heap/global/module stores, branch merges, scratch returns, and host/import
  calls before choosing storage.
- Scratchpads are arena-style scopes: allocate from a bump pointer, reset on
  every exit edge, and reject or explicitly promote any result that may point
  into reset storage.
- `freeze` is the builder/freeze reuse path. It consumes unique ownership and
  produces immutable shareable storage; destructive reuse is only an internal
  optimization when uniqueness proves no observable aliases.
- Cleanup is elaborated from ownership facts, not discovered by code emission.
  Scratch reset is real WAT, while unique drops can stay analysis-only until a
  reusable allocator or destructor path exists.
- Host/import boundaries need explicit bounded-borrow or ownership-transfer
  contracts. Unknown non-scalar host calls are escaping by default.

## Memory/Lifetime Decision Record

These decisions are the source of truth for the remaining memory tasks:

- Current locked update: implement the default `core-3-nonweb` backend with
  static ownership and lifetime proofs, not GC. The selected model is
  `unique_heap` runtime owners by default, lexical `borrow` views,
  value-returning lexical `scratch { ... }` scratchpads, explicit
  `freeze`/promotion into `frozen_shareable` storage, cleanup/drop/reset facts
  for source values and lowering-created temporaries, and storage-driven linear
  analysis for capabilities, unique owners, active borrow barriers,
  scratch-backed values, and ownership-bearing closure slots.
- A baseline case is accepted only when proof output contains storage class,
  lifetime id, borrow/view validity, scratch escape decision, freeze/promotion
  decision, host-boundary behavior when relevant, and cleanup/drop/reset facts
  before WAT emission. Missing facts become a smaller accepted proof fixture, a
  deterministic rejected diagnostic, or a deferred future profile.
- `scratch { ... }` is a scratchpad, not an attached region. It has a return
  value and resets on every exit edge. A returned value must be scalar,
  frozen/shareable, explicitly promoted/frozen into persistent storage, or
  proven scratch-free at the value, field, and payload level. Hidden attached
  regions, implicit promotion, tracing GC, managed storage, and Wasm-GC are not
  baseline rescue paths.
- Latest locked update: the baseline skips GC by making the static ownership,
  lifetime, borrow/view, scratch escape, freeze/promotion, host-boundary, and
  cleanup analysis precise enough for the supported source surface. If a case
  cannot expose those facts, the task is to split it into a smaller accepted
  proof fixture, a deterministic rejected diagnostic, or a future explicit
  profile. Do not add an interim GC, hidden attached region, implicit promotion,
  or runtime-discovered cleanup path for `core-3-nonweb`.
- Locked baseline decision: use a mixed static memory model with unique
  ownership, lexical borrow/views, optional `scratch { ... }` scratchpads, and
  frozen/shareable values. The `core-3-nonweb` backend skips GC by making the
  static analysis precise enough for the supported source surface.
- Acceptance gate: a baseline memory feature is accepted only when its storage
  class, lifetime id, borrow/view validity, scratch escape, freeze/promotion,
  host-boundary behavior, and cleanup/drop/reset facts are available before WAT
  emission.
- No "let the GC decide" acceptance path exists for the baseline. If ownership,
  lifetime, borrow, scratch escape, freeze/promotion, temporary cleanup, or
  host-boundary behavior cannot be proven, the compiler rejects before WAT
  emission.
- Task refinement rule: every hard memory case must be split into a narrower
  accepted proof slice or a rejected diagnostic slice. Managed storage, tracing,
  Wasm-GC, and attached-region return packages are future explicit profiles, not
  interim baseline repairs.
- The default target skips GC. If the compiler cannot prove ownership, lifetime,
  borrow, scratch escape, promotion, temporary cleanup, or host-call behavior,
  it rejects before WAT emission with a deterministic diagnostic.
- Runtime heap values start as `unique_heap`. A unique value may be moved,
  consumed, borrowed, frozen, returned, or dropped, but it is never implicitly
  copied.
- `borrow value` is the source-level view syntax. `let view = borrow value`
  stores a non-owning, read-only view whose lifetime must be no longer than the
  owner. While the view is live, the owner cannot be moved, mutated, frozen, or
  consumed by another owning operation.
- `freeze value` consumes a unique value and produces immutable
  `frozen_shareable` storage. Frozen values may be duplicated, captured,
  branch-merged, and returned.
- `scratch { ... }` is the MVP region-like construct. It is a lexical scratchpad
  for temporary work, has a value result, and resets on every exit that leaves
  the scratch lifetime.
- Returning from `scratch { ... }` does not attach or extend the scratch region.
  A result may escape only when it is scalar, already frozen/shareable,
  explicitly promoted/frozen into non-scratch storage, or proven scratch-free.
- Cleanup is inserted from analysis facts. Scratch reset emits real WAT on
  fallthrough, `return`, `break`, and `continue`; unique heap drops may remain
  no-op bump-allocator facts in the first backend, but they must still exist in
  the proof.
- Compiler-created temporaries follow the same ownership and cleanup rules as
  source values. The backend must not rely on WAT emission or a runtime
  collector to discover temporary lifetimes.
- Cleanup insertion is part of the proof, not a backend cleanup pass of last
  resort. Source values, scratch temporaries, promotion temporaries, closure
  environments, aggregate materialization, text copy loops, and union payload
  construction all need storage, lifetime, escape, and cleanup facts before
  codegen can accept them.
- Optional named arenas or attached-region returns are future features. If they
  are added, Core must represent a live region owner plus values tied to that
  owner explicitly; ordinary `scratch { ... }` never smuggles an implicit live
  region out of the reset boundary.
- Cleanup for compiler-created temporaries is inserted from the same ownership
  and lifetime facts as source cleanup. Scratch temporaries reset with the
  scratchpad, unique temporaries record drop points, and scalar or frozen
  temporaries need no runtime cleanup.
- Linear capability tokens and ordinary unique heap owners can share
  path-sensitive state machinery, but they are distinct concepts. Capabilities
  are exactly-once effect tokens and cannot become frozen/shareable data.
- Linear analysis is storage-driven, not a universal mode for all values. Apply
  it to source `!` capabilities, `unique_heap` owners, `borrow_view` barriers,
  `scratch_backed` values, and closure-environment slots that contain those
  values. Scalars and already-frozen values remain copy/share values.
- Unknown host/import calls are treated as escaping for non-scalar values unless
  their signatures explicitly declare bounded-borrow or ownership-transfer
  behavior.

The implementation consequence is that every accepted `core-3-nonweb` program
must reach WAT with proof facts for storage class, lifetime id, escape edge,
borrow/view validity, scratch reset edges, freeze/promotion edges, and
drop/transfer decisions. Managed storage remains a separate future backend
profile, not a fallback path inside these tasks.

If one of those proofs is hard to implement, split the case into a narrower
accepted proof slice and a rejected diagnostic slice. Do not bridge the gap with
baseline GC, implicit promotion, hidden attached regions, or "runtime decides"
lifetime behavior.

Current concrete task split from this decision:

1. Proof gate audit: require `managed_storage: "disabled"` plus storage,
   lifetime, borrow/view, escape, scratch reset, freeze/promotion,
   host-boundary, and cleanup/drop/transfer facts before WAT emission.
2. Unique ownership: classify runtime text, aggregate, union, and closure
   environment pointers as `unique_heap` unless static/frozen/shareable or
   scratch-backed facts apply.
3. Borrow/views: support `borrow owner` and `let view = borrow owner` as
   read-only, non-owning views tied to owner-bounded lexical lifetimes.
4. Scratchpads: keep `scratch { ... }` as a lexical temporary arena with a value
   result; reset it on fallthrough, `return`, `break`, and `continue`.
5. Scratch escape: accept scratch results only when scalar, frozen/shareable,
   explicitly promoted/frozen, or proven scratch-free at the value, field, and
   payload level.
6. Freeze/promotion: make `freeze` consume unique ownership, and make
   scratch-to-persistent copies explicit Core edges before reset.
7. Cleanup: insert cleanup/drop/reset facts for source values and
   compiler-created aggregate, text, union, closure, and promotion temporaries.
8. Storage-driven linear analysis: apply exact-use/move analysis only to
   capabilities, `unique_heap`, active `borrow_view`, `scratch_backed`, and
   closure slots containing those values.
9. Deferred profiles: named arenas, attached-region return packages, reusable
   allocators, destructors, tracing GC, managed storage, and Wasm-GC stay out of
   the baseline and need separate Core/ABI/proof tasks.

Locked no-GC analysis contract:

- The selected baseline is static analysis, not a temporary GC-assisted mode.
  `core-3-nonweb` stays on linear memory with `managed_storage: "disabled"`.
- Skipping GC is allowed because the compiler must make the analysis precise
  enough for every supported case before code generation. A case is supported
  only when storage class, lifetime id, borrow/view validity, scratch escape,
  freeze/promotion, host-boundary behavior, and cleanup/drop/reset facts are
  available before WAT emission.
- If the compiler can prove ownership, borrow validity, scratch escape,
  freeze/promotion, host-boundary behavior, and cleanup for a case, implement
  that case with proof fixtures before WAT emission.
- If the proof is too broad, split the task by value category and escape shape
  until it is either accepted with facts or rejected with a deterministic
  diagnostic. Do not accept the case by adding tracing, Wasm-GC, hidden attached
  regions, implicit promotion, or runtime-discovered cleanup.
- `scratch { ... }` remains a lexical scratchpad with a value result. A result
  never keeps the scratchpad alive implicitly; it must be scalar,
  frozen/shareable, explicitly promoted, or proven scratch-free before reset.
- Future named arenas or attached-region returns must be explicit owner packages
  in Core, for example a live region owner plus values tied to that owner. They
  are separate profile tasks, not a repair path for ordinary scratchpad returns.

This is also the task refinement rule for the remaining backlog: every
ownership, borrow, scratch, freeze, cleanup, closure-capture, aggregate,
union-payload, text, or host-boundary item should land as either an accepted
proof fixture or a rejected diagnostic fixture. Managed storage is not an
intermediate success state for `core-3-nonweb`.

The selected MVP memory model is therefore a mix of:

- unique ownership for runtime heap values
- lexical borrow/view syntax for read-only non-owning access
- lexical `scratch { ... }` scratchpads for cheap temporary allocation and
  sharing inside the scope
- frozen/shareable values for immutable data that can cross branches, closures,
  and scratchpad boundaries
- storage-driven linear analysis for values whose representation makes copying
  unsound
- explicit cleanup/drop/reset facts for source values and compiler-created
  temporaries

This is not a general region system yet. A scratchpad may return a value, but
the return must be scalar, frozen/shareable, explicitly promoted, or proven
scratch-free before reset. If a future feature needs a value tied to a live
region, that region must be an explicit returned owner package. The MVP should
not infer attached regions from ordinary scratch returns.

GC remains out of the baseline task list. When a proof is hard, the task is to
split the proof by value category and escape shape, then either implement the
accepted slice or add a rejected diagnostic fixture. Do not add tracing,
Wasm-GC, or "let the GC decide" behavior to make an uncertain `core-3-nonweb`
program pass.

## Final No-GC Implementation Roadmap

The memory/lifetime backlog should now be implemented in this order. Each item
must land with proof fixtures before broader feature work builds on it.

1. Proof inventory and gate

   - Keep `managed_storage: "disabled"` visible in the baseline proof surface.
   - For every accepted WAT-emitting feature, prove storage class, lifetime id,
     escape decision, borrow/view status, scratch reset edge, freeze/promotion
     edge, host-boundary decision when relevant, and cleanup/drop/transfer
     decision.
   - If one fact is missing, reject before WAT emission and name the missing
     edge.

2. Unique ownership as the default heap rule

   - Treat runtime text, aggregate, union, and closure-environment pointers as
     `unique_heap` unless they are static/frozen/shareable or allocated inside a
     `scratch {}` scope.
   - Unique owners can move, be consumed by transfer, be borrowed, be frozen, be
     returned, or be dropped. They cannot be implicitly copied.
   - Replacement, discarded expression results, scope exits, and transfer calls
     must all produce explicit drop/transfer facts.

3. Borrow/view surface

   - Keep MVP syntax to `borrow owner` and `let view = borrow owner`.
   - Views are read-only and non-owning, tied to lexical lifetime ids, and block
     owner mutation, move, freeze, and consuming transfer while live.
   - Host calls may receive views only through explicit bounded-borrow import
     contracts.

4. Scratchpad surface

   - Treat `scratch { ... }` as a lexical scratchpad for temporary, easily
     shareable computation with a value result.
   - Reset the scratch pointer on every exit edge that leaves the scratch
     lifetime.
   - A result may escape only when it is scalar, already frozen/shareable,
     explicitly frozen/promoted into persistent storage, or proven scratch-free
     at the value, field, and payload level.
   - Do not attach a hidden live region to the result.

5. Freeze and promotion

   - `freeze value` consumes a unique owner and produces immutable
     `frozen_shareable` storage.
   - Scratch-to-persistent promotion is an explicit Core edge emitted before
     scratch reset, not an implicit typechecker or WAT-emitter repair.
   - Already-frozen values may stay idempotent; mutation through frozen values
     stays rejected.

6. Cleanup for source values and lowering-created temporaries

   - Insert cleanup from ownership/lifetime facts, not as a late backend guess.
   - Scratch-backed temporaries reset with their scratch scope.
   - Unique temporaries from aggregate materialization, text copy/concat loops,
     union payload construction, closure environment setup, and promotion record
     drop facts even if the first bump allocator lowers those drops to no-ops.
   - Scalar and frozen temporaries need no runtime cleanup.

7. Storage-driven linear participation

   - Apply path-sensitive linear/unique analysis to source `!` capabilities,
     `unique_heap` owners, active `borrow_view` barriers, `scratch_backed`
     values, and closure-environment slots containing those values.
   - Scalars and already-frozen values remain normal copy/share values.
   - First-class closures that capture unique, borrow, scratch-backed, or
     capability slots either become true linear closure values or reject before
     WAT emission.

8. Future explicit profiles

   - Named arenas, attached-region return packages, reusable allocators,
     destructors, tracing GC, managed storage, and Wasm-GC stay outside the
     baseline.
   - If attached-region returns are added later, Core must return an explicit
     live region owner plus values tied to that owner, with separate ABI,
     lifetime, escape, and cleanup rules.
   - These profiles must not make an uncertain `core-3-nonweb` baseline program
     accepted.

The immediate implementation queue is therefore the following concrete slices.
Each slice needs one accepted fixture exposing proof facts and one rejected
fixture for the nearest uncertain case:

1. Proof inventory audit

   - Assert `managed_storage: "disabled"` in accepted proof output.
   - Reject WAT emission when storage class, lifetime id, borrow/view status,
     scratch escape, freeze/promotion, host-boundary, or cleanup/drop/reset
     facts are missing.

2. Lowering-created temporary cleanup

   - Cover aggregate materialization, text concat/copy loops, union payload
     construction, closure environment setup, and promotion temporaries.
   - Scratch-backed temporaries reset with the scratchpad; unique temporaries
     record deterministic drop facts; scalar and frozen temporaries need no
     cleanup.

3. Field and payload scratch-escape proofs

   - Accept static-shaped aggregate and union results from `scratch {}` only
     when every returned field or payload is scalar, frozen/shareable,
     explicitly promoted, or proven scratch-free.
   - Reject heap-backed aggregate, union, text, or closure results that still
     point into scratch storage.

4. Explicit freeze/promotion copies

   - Make `freeze` consume a unique owner and produce `frozen_shareable`
     storage.
   - Emit scratch-to-persistent promotion before the scratch reset when a
     supported value leaves the scratchpad.
   - Reject unsupported aggregate, union, text, or closure promotion shapes with
     a diagnostic that names the missing promotion edge.

5. Borrow/view barriers

   - Keep `borrow owner` and `let view = borrow owner` tied to lexical lifetime
     ids.
   - Reject owner mutation, move, freeze, consuming host transfer, return, or
     escaping closure capture while a borrow view is live.

6. Closure capture ownership

   - Accept scalar and frozen/shareable captures as reusable closure slots.
   - Either linearize closures that capture `unique_heap`, `borrow_view`,
     `scratch_backed`, or capability slots, or reject them before WAT emission
     with a proof-gate issue.

7. Deeper host/import transfer analysis

   - Continue extending bounded-borrow and ownership-transfer contracts through
     static aliases, branch-selected wrappers, and interprocedural static calls.
   - Unknown non-scalar host/import calls remain escaping and reject unless
     their contract is explicit.

GC is skipped because the compiler is expected to prove or reject each supported
case before codegen. If a slice cannot be proved in that form, split it again by
value category and escape shape rather than adding a managed fallback.

Latest refinement from the scratchpad and GC decision:

- Keep the baseline as `core-3-nonweb` with `managed_storage: "disabled"`. The
  implementation task is to prove ownership, lifetime, borrow, scratch-escape,
  freeze/promotion, and cleanup facts for supported programs.
- Do not add an interim "let the GC decide" path. When analysis is incomplete,
  add a smaller accepted fixture with the needed facts or a rejected fixture
  with a deterministic diagnostic.
- Treat `scratch { ... }` as a scratchpad with a value result, not as an
  escaping region object. A returned value must be scalar, frozen/shareable,
  explicitly promoted, or proven scratch-free before the scratch pointer reset.
- Keep future attached-region returns explicit. If a region outlives a block,
  Core must return a live region owner plus values tied to that owner; ordinary
  `scratch {}` must not infer that package.
- Use borrow views to make lifetime analysis local and predictable:
  `borrow owner` and `let view = borrow owner` are read-only, non-owning, and
  bounded by the owner lifetime.
- Insert cleanup for lowering-created temporaries from the same facts as source
  values. Scratch temporaries reset with their scratch scope, and unique
  temporaries record drop points even when the first bump allocator lowers them
  to no-ops.

Closed MVP decisions:

- Memory is handled by compiler facts first: storage class, lexical lifetime id,
  escape edge, borrow/view validity, scratch reset edge, freeze/promotion edge,
  and drop/transfer decision. WAT emission is not responsible for discovering
  those facts.
- Efficient baseline lowering means scalar locals for copy values, O(1)
  scratchpad reset for temporary arena data, immutable sharing for frozen
  values, and explicit drop facts for unique heap owners. The first bump
  allocator may lower unique drops to no-ops, but the drop plan still exists.
- `scratch { ... }` is the MVP temporary region surface. It has a return value,
  but returning never keeps the scratchpad alive implicitly. Escaping scratch
  data must be scalarized, frozen/promoted to persistent storage, proven
  scratch-free, or rejected.
- Optional named regions and attached-region returns are later features. If
  added, they must return an explicit live region owner plus values tied to that
  owner. They are not inferred from ordinary `scratch { ... }`.
- Borrow/view syntax stays simple for the MVP: `borrow owner` and
  `let view = borrow owner`. Views are read-only, non-owning, and bounded by the
  owner lifetime; active views block owner mutation, move, freeze, or consuming
  transfer.
- Linear participation is storage-driven. Track source `!` capabilities,
  `unique_heap` owners, active `borrow_view` barriers, `scratch_backed` values,
  and closure slots containing those values. Do not force scalar locals or
  already-frozen values through exactly-once capability rules.
- Compiler-created temporaries use the same cleanup machinery as source values.
  Scratch temporaries reset with their scratchpad; unique heap temporaries get
  drop facts; scalar and frozen temporaries need no runtime cleanup.
- Do not add GC, Wasm-GC, tracing, or "let the runtime decide" behavior to the
  baseline task queue. If a proof is missing, split the case into a smaller
  accepted proof fixture or a rejected diagnostic fixture.

Current execution order for the no-GC memory model:

1. Lock the proof gate first.

   - Keep `managed_storage: "disabled"` in the baseline proof surface.
   - Every accepted fixture must expose the facts the WAT emitter depends on.
   - Every unsupported or uncertain fixture must reject before WAT emission.

2. Make storage facts complete for accepted runtime values.

   - Classify allocations and lowering-created temporaries as `scalar_local`,
     `unique_heap`, `borrow_view`, `frozen_shareable`, `scratch_backed`, or
     rejected with a reason.
   - Preserve layout/type facts alongside storage facts for runtime aggregate,
     union, text, and closure values.

3. Treat `borrow owner` and `let view = borrow owner` as the only MVP view
   syntax.

   - Views are non-owning, read-only, and tied to lexical lifetime ids.
   - While a view is live, the owner cannot be moved, mutated, frozen, or
     consumed.
   - Passing a view across a host/import boundary requires an explicit
     bounded-borrow contract.

4. Treat `scratch { ... }` as the only MVP region-like construct.

   - It is a scratchpad for temporary shareable computation and has a value
     result.
   - It resets on every exit that leaves the scratch lifetime.
   - A result may escape only when scalar, frozen/shareable, explicitly
     promoted/frozen, or proven scratch-free at the value and field level.
   - If the proof is hard or missing, reject. Do not attach the scratchpad to
     the result and do not select GC.
   - The implemented proof targets include static-shaped aggregates, static
     union cases, and dynamic static-union `if` results whose condition and case
     payloads are scratch-free. Heap-backed returns need explicit
     promotion/freeze or a field-level scratch-free proof.

5. Implement `freeze` and promotion as explicit Core facts.

   - `freeze` consumes `unique_heap` ownership and produces immutable
     `frozen_shareable` storage.
   - Freezing a scratch-backed escaping value emits a persistent non-scratch
     copy before scratch reset.
   - Already-frozen values keep `freeze` idempotent; mutation through frozen
     values remains rejected.

6. Insert cleanup from ownership/lifetime facts.

   - Scratch reset emits real WAT.
   - Unique heap drops remain proof/drop-plan facts while the first bump
     allocator lowers them to no-ops.
   - Lowering-created temporaries get the same cleanup/drop/reset treatment as
     source values.

7. Keep scratchpad returns lexical.

   - Returning from `scratch {}` never keeps the scratchpad alive.
   - Values tied to scratch storage must be frozen/promoted, proven
     scratch-free, or rejected before reset.
   - Later attached-region returns must be explicit owner packages in Core.

8. Defer named arenas, attached-region return packages, reusable allocators,
   destructors, managed GC, and Wasm-GC until the baseline proof surface is
   stable.

The task split below is now the concrete plan for the no-GC baseline. It is not
a research placeholder: implement the proof/storage/lifetime/borrow/scratch/
freeze/drop slices first, then expand runtime aggregate, union, text, closure,
and mutation features only when the same proof surface can accept or reject the
new behavior deterministically.

Latest implementation tickets from the memory decision:

- Proof gate first: keep `managed_storage: "disabled"` and require storage
  class, lifetime id, borrow/view status, escape decision, scratch reset edge,
  freeze/promotion edge, host-boundary decision when relevant, and
  cleanup/drop/transfer decision before WAT emission.
- Unique ownership by default: runtime heap text, aggregate, union, and closure
  values are `unique_heap` unless they are static/frozen or allocated in a
  scratchpad. They can move, borrow, freeze, transfer, return, or drop, but they
  cannot be implicitly copied.
- Borrow/view syntax: keep the MVP surface to `borrow owner` and
  `let view = borrow owner`. Views are read-only, non-owning, bounded by the
  owner lifetime, and block owner move, mutation, freeze, and consuming transfer
  while active.
- Scratchpads: `scratch { ... }` is a lexical temporary arena with a value
  result. It resets on fallthrough, `return`, `break`, and `continue`; returning
  does not attach a live region to the result. Escaping values must be scalar,
  frozen/shareable, explicitly promoted/frozen, or proven scratch-free at the
  field and payload level.
- Freeze and promotion: `freeze` consumes unique ownership and produces
  immutable shareable storage. Scratch-to-persistent promotion is an explicit
  Core edge before reset, never an implicit repair in the typechecker or WAT
  emitter.
- Cleanup for temporaries: compiler-created aggregate materialization, text
  copy/concat loops, union payload construction, closure environment setup, and
  promotion temporaries use the same cleanup/drop/reset facts as source values.
- Linear participation: apply path-sensitive linear/unique analysis to source
  `!` capabilities, `unique_heap` owners, active `borrow_view` barriers,
  `scratch_backed` values, and closure slots containing those values. Scalars
  and already-frozen values remain copy/share values.
- Future regions: named arenas and attached-region returns are explicit future
  owner-package profiles. They need their own Core representation, ABI,
  lifetime, escape, and cleanup rules, and must not be inferred from ordinary
  `scratch {}` returns.
- No GC fallback: if one of these facts is missing, split the case by value
  category and escape shape into an accepted proof fixture, a rejected
  diagnostic fixture, or a deferred future profile. Do not accept the baseline
  case by adding tracing, Wasm-GC, hidden attached regions, implicit promotion,
  or runtime-discovered cleanup.

MVP task contract:

- First make the static proof gate complete for supported programs.
- Then extend allocation and mutation only when the required proof facts already
  exist or can be added in the same slice.
- Do not add tracing GC, Wasm-GC, reference-counting, or "runtime decides"
  lifetime behavior to unblock the baseline backend.
- Treat every missing ownership, lifetime, borrow, scratch escape,
  freeze/promotion, host-boundary, or temporary-cleanup fact as a compiler
  diagnostic before WAT emission.
- Keep `scratch { ... }` as a scratchpad with a return value. It is useful for
  temporary shareable computation, but returning from it never keeps the
  scratchpad alive.
- If a later feature needs values tied to an escaping region, add an explicit
  region-owner value and separate tasks for its ABI, ownership facts, and
  cleanup rules.

No-GC triage rule:

- Every memory/lifetime item must land in exactly one baseline state: accepted
  with proof facts, rejected with a deterministic diagnostic, or deferred to a
  future explicit profile.
- Accepted proof facts must include storage class, lifetime id, borrow/view
  validity, scratch escape decision, freeze/promotion decision, host-boundary
  behavior when relevant, and cleanup/drop/reset decisions for source values and
  lowering-created temporaries.
- Rejected diagnostics should name the missing proof edge, for example unknown
  host escape, active borrow, scratch-backed result escape, unsupported
  promotion, or missing temporary cleanup.
- Deferred profiles include named arenas, attached-region return packages,
  reusable allocators, destructors, managed GC, and Wasm-GC. They must not make
  an uncertain `core-3-nonweb` program accepted.
- If a proof is too broad, split by value category and escape shape before
  implementation: scalar, static aggregate, static union case, dynamic
  static-union `if`, runtime heap aggregate, runtime union payload, runtime
  text, closure environment, or host boundary.

## Current Agreed Memory Task Split

This is the concrete split for the selected no-GC baseline. These are defined
implementation tasks, not just research topics. If a task is still too broad,
split it by value category and escape shape: scalar, static aggregate, static
union case, dynamic static-union `if`, runtime heap aggregate, runtime union
payload, runtime text, closure environment, and host boundary.

Task status from the latest memory decision:

- Defined upfront: no-GC proof gate, `unique_heap` default storage, lexical
  borrow/views, lexical `scratch {}` scratchpads with value results,
  `frozen_shareable` values, explicit freeze/promotion, cleanup for source and
  lowering-created temporaries, and storage-driven linear participation.
- Refine during implementation: each runtime heap aggregate, runtime union
  payload, runtime text, closure environment, host-boundary, scratch escape, and
  promotion shape. The refinement is mechanical: either expose the proof facts
  and accept it, reject with a named missing edge, or defer it to a future
  explicit region/managed-storage profile.
- Not part of the baseline: hidden attached-region returns, implicit promotion,
  tracing GC, Wasm-GC, managed fallback storage, or runtime-discovered cleanup.

Definition of done for each memory/lifetime slice:

- Accepted cases expose proof facts before WAT emission: storage class, lifetime
  id, borrow/view validity, escape decision, scratch reset edge,
  freeze/promotion edge, host-boundary decision when relevant, and
  drop/cleanup/transfer decision.
- Rejected cases fail before WAT emission with a diagnostic that names the
  missing edge, such as active borrow, scratch-backed escape, unsupported
  promotion, missing temporary cleanup, or unknown host/import ownership.
- Deferred cases are explicitly future profiles. Named arenas, attached-region
  return packages, reusable allocators, destructors, managed GC, tracing GC, and
  Wasm-GC do not make the baseline case accepted.

Locked task refinement from the latest memory decision:

- Implement the baseline without GC by making the analysis precise enough for
  the supported source surface.
- Keep `scratch { ... }` as a value-returning scratchpad. It is useful for
  temporary shareable computation, but it never returns a hidden live region.
- Any value leaving a scratchpad must be scalar, already frozen/shareable,
  explicitly promoted/frozen into persistent storage, or proven scratch-free at
  the value, field, and payload level.
- Use `borrow owner` / `let view = borrow owner` as the MVP view syntax to make
  lifetime analysis local and predictable. Views are read-only, non-owning, and
  bounded by the owner lifetime.
- Insert cleanup for source values and compiler-created temporaries from the
  same ownership/lifetime facts. Scratch-backed values reset with the scratch
  scope; unique heap values record drop facts; scalar and frozen values need no
  runtime cleanup.
- Apply linear/path-sensitive analysis only where the storage class or effect
  role requires it: source `!` capabilities, `unique_heap` owners, active
  `borrow_view` barriers, `scratch_backed` values, and closure slots containing
  those values.
- If an attached region is needed later, add an explicit region-owner package
  with its own Core representation, ABI, lifetime facts, escape facts, and
  cleanup rules. Do not infer that package from ordinary `scratch {}` returns.
- When analysis is incomplete, split by value category and escape shape, then
  land either an accepted proof fixture or a rejected diagnostic fixture. Do not
  accept the baseline case through GC, hidden region attachment, implicit
  promotion, or runtime-discovered cleanup.

Current implementation status for that split:

- Done enough to build on: baseline `Core.proof(...)` with
  `managed_storage: "disabled"`, explicit storage classes, borrow-view
  validation for the current owner/alias surface, scratch reset insertion on
  fallthrough/`return`/`break`/`continue`, static-shaped scratch-free aggregate
  and union returns, persistent freeze for runtime text/aggregate/union/closure
  owners, direct scratch runtime text promotion, direct/block-local/branch
  scratch closure freeze, direct aggregate/union constructor scratch freeze,
  block-local scratch runtime aggregate alias promotion with scalar, `Text`, and
  nested aggregate fields, block-local scratch runtime union alias promotion for
  scalar/`Text`/`Unit`, union-pointer, and supported aggregate-pointer payloads,
  no-op bump-allocator drop facts for many source-owner paths, and the first
  Core host/import contract slices. `Core.host_imports` now carries explicit
  argument contracts, `Core.proof(...).host_boundaries` records the matched
  signature and per-argument decisions, bounded-borrow imports accept
  `borrow_view` arguments, ownership-transfer imports consume direct
  `unique_heap` arguments, `Core.drops(...)` records `host_transfer` facts, and
  `Core.mod(...)` emits the corresponding WAT imports and calls.
- Still active baseline work: true immutable heap-copy promotion for broader
  aggregate/union existing owners, broader scratch-backed text and closure
  promotion shapes, field-sensitive scratch escape facts for heap-backed
  aggregate/union payloads, deeper closure-capture ownership and linear
  participation, source-level import-contract syntax, deeper interprocedural
  transfer analysis, and cleanup/drop facts for every lowering-created
  temporary.
- Deferred profiles: named arenas, attached-region return packages, reusable
  allocators, destructors, tracing GC, managed storage, and Wasm-GC. These are
  future targets only; they must not make an uncertain `core-3-nonweb` program
  accepted.

1. Static proof gate

   - Keep `managed_storage: "disabled"` for `core-3-nonweb`.
   - Reject before WAT emission when a storage, lifetime, borrow, scratch
     escape, freeze/promotion, cleanup, or host-boundary fact is missing.
   - Add accepted fixtures that expose the facts used by WAT emission and
     rejected fixtures that assert deterministic diagnostics.

2. Ownership and storage facts

   - Track `scalar_local`, `unique_heap`, `borrow_view`, `frozen_shareable`, and
     `scratch_backed` for source values and lowering-created temporaries.
   - Treat runtime heap values as unique by default, frozen values as
     copy/share, and scratch-backed values as bounded by the active scratch
     lifetime.
   - Keep static type values, static-shaped aggregates, and static union cases
     as ownerless compiler facts until a runtime pointer is materialized.

3. Borrow/view syntax and checking

   - Use only `borrow owner` and `let view = borrow owner` for the MVP view
     surface.
   - Views are read-only and non-owning. They cannot be returned, stored into a
     longer-lived place, captured by escaping closures, or carried past the
     owner lifetime.
   - While a view is active, the owner cannot be moved, replaced, mutated,
     frozen, or consumed by an owning operation.

4. Scratchpad regions

   - Treat `scratch { ... }` as a lexical temporary arena with a value result.
   - Save the scratch pointer on entry and reset it on fallthrough, `return`,
     `break`, and `continue` exits that leave the scratch lifetime.
   - A returned value may escape only when it is scalar, already
     frozen/shareable, explicitly promoted/frozen into persistent storage, or
     proven scratch-free at the value or field level.
   - Do not attach the scratchpad to the result in the MVP. Attached-region
     returns are a future explicit owner-package feature.

5. Freeze and promotion

   - `freeze value` consumes a unique owner and produces immutable
     `frozen_shareable` storage.
   - Scratch-to-persistent promotion is an explicit Core edge emitted before
     scratch reset, not an implicit typechecker or WAT-emitter repair.
   - Preserve idempotent freeze for already-frozen values and reject mutation
     through frozen values.

6. Cleanup and temporaries

   - Insert cleanup from ownership/lifetime facts for source values and
     compiler-created temporaries.
   - Scratch-backed temporaries reset with the scratchpad.
   - Unique heap temporaries record drop points even while the first bump
     allocator lowers those drops to no-op code.

7. Host/import boundary facts

   - Treat unknown non-scalar host/import calls as escaping.
   - Accept borrowed or unique heap values across the boundary only when the
     import signature declares bounded-borrow or ownership-transfer facts.
   - Include those boundary decisions in `Core.proof(...)`.
   - Implemented first slices: Core import signatures distinguish scalar,
     bounded-borrow, frozen/shareable, and ownership-transfer argument
     contracts. Bounded-borrow contracts accept explicit `borrow` views and
     reject direct `unique_heap` arguments unless the caller wraps them in
     `borrow`. Ownership-transfer contracts accept direct `unique_heap`
     arguments, record `host_transfer` drop-plan facts, and reject borrowed
     views. Direct use-after-transfer validation rejects later use of a
     transferred owner before WAT emission. Unknown non-scalar imports still
     reject before WAT emission. Host-returned owner result contracts are
     implemented for Core imports.
   - Source-level contract declarations are implemented for scalar numeric ABI
     values, Text ownership contracts, explicit non-Text pointer owner reasons,
     and user-defined aggregate/union type-value owner references. Remaining
     slices are deeper interprocedural transfer analysis and any future
     scratch-backed promotion policy that crosses the boundary intentionally.

8. Deferred profiles

   - Named arenas, attached-region return values, reusable allocators,
     destructors, tracing GC, and Wasm-GC are separate follow-up profiles.
   - They must not weaken the baseline proof gate or rescue accepted baseline
     fixtures with managed storage.
   - A future managed profile may accept cases the baseline rejects, but only
     with separate storage classes, ABI rules, proof output, and tests.

### No-GC Acceptance Matrix

Use this matrix when refining any memory/lifetime task:

- Accepted baseline cases must expose storage class, lifetime id, borrow/view
  validity, escape decision, scratch reset edge, freeze/promotion edge,
  host-boundary decision when relevant, and drop/cleanup/transfer decision
  before WAT emission.
- Rejected baseline cases must fail before WAT emission and name the missing
  fact: active borrow, moved owner, scratch-backed escape, unsupported
  promotion, missing temporary cleanup, unsupported closure capture, or unknown
  host/import ownership.
- Deferred profile cases are named arenas, attached-region return packages,
  reusable allocators, destructors, tracing GC, managed storage, and Wasm-GC.
  They need separate source/API shape, Core representation, ABI, proof output,
  and tests before they can accept programs the baseline rejects.
- `scratch {}` results are accepted only when scalar, already frozen/shareable,
  explicitly promoted/frozen into persistent storage, or proven scratch-free at
  the value or field/payload level.
- Compiler-created temporaries follow the same matrix as source values. Scratch
  temporaries reset with the scratch scope, unique temporaries produce drop
  facts, and scalar or frozen temporaries need no runtime cleanup.

Concrete proof inventory for each accepted baseline memory slice:

- Storage/lifetime row: source or lowering-created value, storage class,
  lifetime id, owner id when relevant, and reason for the selected storage.
- Borrow/view row: borrowed owner, view lifetime, view end point, and the owner
  operations blocked while the view is live.
- Scratch row: scratch lifetime id, saved pointer, reset edges for normal and
  early exits, result escape classification, and field/payload path when a
  returned value is proven scratch-free or rejected.
- Freeze/promotion row: consumed owner, source storage, destination storage,
  copied fields/payloads, and cleanup/reset ordering.
- Drop/cleanup row: owner or temporary id, normal/early exit edge, drop/reset
  action, and whether the first bump allocator lowers the action to no-op WAT.
- Host-boundary row: import signature contract, argument/result ownership
  decision, transfer/drop decision, and diagnostic for unknown or unsupported
  non-scalar escapes.

## Immediate Memory/Lifetime Next Slices

Use these as the next reviewable implementation slices. Each slice needs an
accepted proof fixture or a rejected diagnostic fixture before it is considered
done.

Current queue from the latest no-GC decision:

1. Audit the proof gate against every currently accepted `Core.emit(...)`,
   `Core.mod(...)`, and source-to-WAT feature. A feature is accepted only when
   the proof exposes the storage, lifetime, escape, borrow, scratch,
   freeze/promotion, host-boundary, and cleanup facts WAT emission depends on.
2. Normalize allocation facts for source values and lowering-created
   temporaries. Runtime text, aggregates, unions, and closure environments start
   as `unique_heap`; scratch allocations are `scratch_backed`; frozen values are
   `frozen_shareable`; scalars remain `scalar_local`.
3. Keep `borrow owner` and `let view = borrow owner` as the MVP view syntax.
   Finish field-owner, loop/branch merge, closure-capture, and host/import
   barriers before adding broader view forms.
4. Keep `scratch { ... }` lexical. It has a value result and resets on every
   exit edge. Finish scratch allocation routing and field/payload-level escape
   proofs before accepting broader heap-backed aggregate, union, text, or
   closure results.
5. Make `freeze` and scratch-to-persistent promotion explicit Core edges.
   Promotion must happen before scratch reset; unsupported shapes reject instead
   of implicitly promoting or selecting managed storage.
6. Complete cleanup for source values and lowering-created temporaries from the
   same ownership/lifetime facts. Scratch temporaries reset with the scratchpad;
   unique temporaries record drop facts even while the bump allocator lowers
   them to no-op code.
7. Apply path-sensitive linear/unique analysis only where storage or effects
   require it: source `!` capabilities, `unique_heap` owners, active
   `borrow_view` barriers, `scratch_backed` values, and closure slots containing
   those values.
8. Defer named arenas, attached-region returns, reusable allocators,
   destructors, tracing GC, managed storage, and Wasm-GC to explicit future
   profiles with separate Core representation, ABI, proof output, and tests.

9. Baseline no-GC proof audit

   - Audit every currently accepted `Core.emit(...)`, `Core.mod(...)`, and
     source-to-Core/Wasm feature against the proof-gate contract.
   - Start with fixture groups that already emit WAT: runtime text, runtime
     aggregate pointers, runtime union pointers, first-class closures, scratch
     allocation/promotion, host imports, and lowering-created temporaries.
   - Add missing proof output for accepted features or move the feature to a
     rejected diagnostic before WAT emission.
   - Include lowering-created temporaries in the same audit as source values:
     aggregate materialization, text copy loops, union payload construction,
     closure environment setup, and promotion.
   - For each group, assert the concrete proof inventory above instead of only
     asserting that WAT was emitted.
   - Keep `managed_storage: "disabled"` in every accepted baseline fixture. If
     the proof is hard, split the case by value category and escape shape
     instead of enabling a GC or hidden attached region.

10. Scratch-backed aggregate/union alias promotion

    - Implemented the first aggregate alias shape:
      `scratch { let temp = user_type { ... }; freeze temp }` now copies a
      known-layout runtime aggregate into persistent frozen storage before
      reset. Scalar fields are copied directly, `Text` fields are copied through
      the persistent text freeze-copy path, and nested aggregate fields recurse
      through the same layout copy.
    - Implemented the first runtime union alias shape:
      `scratch { let temp = result_type.ok(...); freeze temp }` now copies the
      source union record into persistent frozen storage before reset when the
      union payload surface is scalar/`Text`/`Unit` or a supported aggregate
      pointer, and now recurses through union-pointer payload slots. `Text`
      payload slots, aggregate `Text` fields, and nested union payloads are
      copied through persistent freeze-copy paths so the frozen union does not
      retain scratch pointers.
    - Implemented aggregate alias promotion for supported union-pointer fields:
      `scratch { let temp = box_type { result: result_type.ok(...) }; freeze temp }`
      now copies the aggregate and recursively copies the union field into
      persistent frozen storage before scratch reset.
    - Implemented static-shaped existing aggregate aliases in scratch freeze:
      `let existing: user_type = user_type { ... }; scratch { let temp = existing; freeze temp }`
      now resolves the alias through the static-shaped aggregate fact, plans the
      aggregate fields, and emits the same persistent aggregate/text copy path.
    - Implemented branch-selected existing runtime union aliases in scratch
      freeze:
      `let existing: result_type = if flag { result_type.ok(...) } else { result_type.err(...) }; scratch { let temp = existing; freeze temp }`
      now preserves the dynamic-union static alias through local collection,
      text-layout scanning, and payload capture planning, so `Text` payload
      facts survive into the persistent union/text freeze-copy path.
    - Implemented branch-assigned existing runtime union aliases in scratch
      freeze:
      `let existing: result_type = result_type.err(...); if flag { existing = result_type.ok(...) } else { existing = result_type.err(...) }; scratch { let temp = existing; freeze temp }`
      now merges compatible static union-case assignments, keeps generated
      branch temporaries visible outside the branch, and preserves payload facts
      through scratch freeze and matching.
    - Dynamic range/text collection loops that carry static aggregate/union
      compiler facts, including aliases to those facts, now reject
      deterministically instead of treating a loop-body static assignment as an
      unconditional post-loop value. The rejection is covered through type,
      proof, and emission entry points. Loop-carried existing aggregate/union
      promotion remains pending until the loop-runs/last-iteration value and
      cleanup facts can be represented explicitly.
    - Remaining alias work: broader existing aggregate/union owner copies across
      more complex multi-step assignment, branch, and loop shapes, plus
      field-sensitive scratch-free proofs for returned heap-backed values.
    - Distinguish this from the already implemented direct constructor case,
      where `scratch { freeze user_type { ... } }` can materialize directly on
      persistent heap storage before reset.
    - Preserve aggregate/union type facts, source owner facts, destination
      frozen storage facts, and scratch cleanup facts through the promotion.

11. Field-sensitive scratch escape facts

    - Track scratch-backed status per aggregate field and union payload, not
      only on the outer pointer.
    - Accept returned heap-backed aggregates/unions only when every reachable
      field or payload is scalar, static/frozen, explicitly promoted, or
      otherwise proven scratch-free.
    - Reject mixed values with a diagnostic that names the escape edge and the
      field or payload that may reference reset scratch storage.
    - Implemented the first rejected diagnostic slice for static-shaped scratch
      aggregate and union returns: when a field or payload may reference reset
      scratch storage, the type/proof diagnostic names the offending field or
      payload path instead of only reporting the outer aggregate/union pointer.

12. Lowering-created temporary cleanup

    - Add cleanup/drop/reset facts for temporaries introduced by runtime
      aggregate materialization, runtime text copy/slice/concat loops, runtime
      union payload construction, closure environment setup, and promotion.
    - Keep scratch temporaries reclaimed by scratch reset and unique heap
      temporaries represented as drop facts while the first bump allocator still
      lowers drops to no-ops.
    - Ensure each new accepted WAT-emitting feature has a proof fixture showing
      the temporary cleanup facts it depends on.
    - Implemented first runtime aggregate temporary cleanup slice: a discarded
      materialized aggregate expression such as `user_type { name: value }; 1`
      now records an ownerless `heap_drop` with `edge: "discarded_expr"` and
      `ownership: unique_heap runtime_aggregate`, matching the allocation fact
      emitted for the same expression. The same drop fact is recorded when a
      static aggregate fact is used as an expression and materialized into a
      runtime aggregate pointer before being discarded.

13. Host/import ownership contracts

    - Implemented bounded-borrow and direct ownership-transfer import slices. A
      `Core.host_imports` entry can describe scalar, bounded-borrow,
      frozen/shareable, and ownership-transfer argument contracts; proof records
      the signature and per-argument decision; `Core.drops(...)` records
      `host_transfer` facts for consumed direct unique owners; `Core.mod(...)`
      emits the WAT import and call.
    - Bounded-borrow imports accept `borrow owner` views and reject direct
      `unique_heap` arguments with a deterministic diagnostic. Scalar arguments
      remain ownership-neutral but still require a known import signature.
    - Direct use-after-transfer diagnostics are implemented for named owners
      consumed by ownership-transfer imports.
    - Core-level host-returned owner contracts are implemented for import
      results. A `Core.host_imports` entry can mark an imported result as
      `unique_heap` or `frozen_shareable`, and the proof/drop/final-result paths
      carry that ownership through WAT emission.
    - Frozen/shareable argument fixtures are implemented for Core imports, with
      proof-visible ownership decisions and WAT-to-Wasm coverage.
    - Scratch-backed Core import argument policy is implemented for the first
      boundary slice: explicit bounded-borrow views over scratch-backed values
      are accepted for call-bounded reads, while ownership-transfer contracts
      reject scratch-backed values before WAT emission.
    - Source-level host import contract syntax is implemented for the first
      scalar/Text slice:
      `host_import host_read from "env.read" (bounded_borrow Text) => I32`,
      `ownership_transfer Text`, `frozen_shareable Text`, scalar numeric
      parameters/results, and host-returned `unique_heap Text` or
      `frozen_shareable Text` results lower to the existing Core `host_imports`
      contract surface. Pure Ic lowering rejects those declarations with a
      structured Core/Wasm route diagnostic.
    - Source-level host import contract syntax now also accepts non-Text pointer
      ownership reasons: `bounded_borrow runtime_aggregate`,
      `ownership_transfer runtime_union`, `frozen_shareable closure`, and
      returned `unique_heap` or `frozen_shareable` owners for `runtime_union`,
      `runtime_aggregate`, and `closure`. The frontend preserves those owner
      names for formatting and lowers them to the existing Core contract
      surface.
    - Source-level host import contract syntax also accepts user-defined
      aggregate and union type-values in owner-contract positions, for example
      `bounded_borrow user_type`, `ownership_transfer result_type`, and returned
      `unique_heap user_type`. `Source.core(...)` resolves preceding top-level
      `const` struct type-values to `runtime_aggregate` and union type-values to
      `runtime_union`, including simple const aliases, while missing or non-type
      owner references reject before Core emission.
    - Implemented the first interprocedural transfer-analysis slice for direct
      calls to top-level statically bound lambda wrappers with variable
      arguments. A wrapper such as `let send = msg => host_take(msg)` now
      records the caller's owner as a `host_transfer`, removes it from the drop
      plan, and rejects later use of that owner before WAT emission.
    - Implemented the next wrapper-transfer slice for top-level block-bodied
      lambda wrappers whose body is a single transfer expression or return. A
      wrapper such as `let send = msg => { host_take(msg) }` now records the
      same caller-owner transfer and rejects use-after-transfer.
    - Implemented the multi-statement block-bodied wrapper slice for wrappers
      whose block contains ownership-transfer calls before a scalar/block
      result, for example
      `let send = msg => { let code = host_take(msg); code }`. Transfer
      validation and drop planning now agree on the caller-owner
      `host_transfer`, while closure-returning helper bodies are skipped by the
      transfer-only drop scan.
    - Implemented the branch-selected top-level wrapper slice for annotated
      closure branches, for example
      `let send = if flag { (msg: Text) => host_take(msg) } else { (msg: Text) => host_take(msg) }`.
      Transfer validation records branch-scoped caller-owner `host_transfer`
      facts, drop planning records matching branch transfer steps, use after the
      wrapper transfer rejects before WAT emission, and WAT-to-Wasm coverage
      exercises the selected closure through `call_indirect`.
    - Implemented the first non-variable-argument wrapper slice for unique
      temporary expression arguments. A call such as `send(append("a", "b"))`
      through a top-level ownership-transfer wrapper now records a synthetic
      temporary transfer in validation, records an ownerless `host_transfer`
      drop-plan step for the temporary unique value, and compiles through
      WAT-to-Wasm.
    - Implemented the broader non-variable wrapper argument proof gate. Static
      wrapper transfer validation now checks the aliased argument ownership
      before recording a synthetic transfer: branch-created runtime text
      temporaries such as
      `send(if flag { append("a", "b") } else { append("c", "d") })` are
      accepted as `unique_heap`, while scalar named or temporary arguments such
      as `send(value)` or `send(1)` reject before WAT emission with a
      deterministic invalid transfer-argument diagnostic.
    - Implemented the branch-local wrapper-definition slice. A wrapper bound
      inside a statement list, such as
      `if flag { let send = msg => host_take(msg); send(message) }`, is now
      visible to subsequent statements in that lexical analysis scope, records
      caller-owner transfer facts, emits matching drop-plan transfer steps, and
      rejects use-after-transfer after branch merges.
    - Implemented the first recursive-wrapper slice for statically bound `rec`
      wrapper values, for example
      `let send = rec (msg: Text) => host_take(msg)`. Transfer validation and
      drop planning now treat the wrapper body like a lambda wrapper, record the
      caller-owner `host_transfer`, reject use-after-transfer, and compile the
      direct rec-wrapper call through WAT-to-Wasm.
    - Implemented the first higher-order wrapper slice for const function
      parameters. A helper such as `let relay = (const f, msg) => f(msg)` can
      now receive a statically bound ownership-transfer wrapper like `send`,
      keep the function argument as a static function value during scoped
      static-call typing/emission, record the nested caller-owner
      `host_transfer`, remove the owner from the drop plan, reject later use of
      that owner, and compile through WAT-to-Wasm.
    - Implemented the local static-function alias wrapper slice for higher-order
      transfers. A helper such as
      `let relay = (const f, msg) => { let g = f; g(msg) }` now keeps `g` as a
      static function alias during scoped static-call local collection, transfer
      validation, drop planning, and WAT emission. The nested `host_transfer` is
      recorded under `static_call/g`, use-after-transfer rejects before WAT
      emission, and WAT-to-Wasm coverage exercises the alias wrapper through the
      host import.
    - Remaining work: deeper interprocedural transfer analysis for dynamic or
      more general higher-order wrappers and truly self-recursive transfer
      shapes, plus any future scratch-backed promotion policy that intentionally
      crosses the host boundary.

14. Closure ownership participation

    - Record per-slot ownership facts for closure environments.
    - Allow reusable closure capture only for scalar or `frozen_shareable`
      slots.
    - Make closures with captured `unique_heap`, `borrow_view`,
      `scratch_backed`, or source `!` values linear or reject them until linear
      closure calls are implemented end to end.
    - Implemented first proof-visible slice: `Core.closure_ownership(...)` and
      `Core.proof(...).closure_ownership` record closure capture slots with
      their ownership class. Scalar and frozen/shareable captures are marked
      allowed; `unique_heap`, `borrow_view`, and `scratch_backed` captures are
      marked reserved for linear closure ownership support. The current slice
      records the facts without changing existing closure codegen yet.
    - Implemented follow-up classification for stored `borrow` views and
      scratch-local temporaries captured by closures, so the proof surface can
      now distinguish `borrow_view` and `scratch_backed` captures instead of
      reporting them as ordinary unique heap captures.
    - Implemented first proof-gated rejection slice: reusable closures that
      capture stored `borrow_view` values or `scratch_backed` local temporaries
      now reject before WAT emission with closure-capture diagnostics.
    - Implemented follow-up proof-gated rejection slice: reusable closures that
      capture `unique_heap text` values now reject before WAT emission unless
      the text is frozen/shareable first.
    - Implemented proof-visible accepted slices for the existing non-linear
      runtime aggregate pointer, runtime union pointer, and closure-pointer
      capture paths. These now report allowed capture decisions instead of
      generic reserved unique captures, and stored runtime union pointer
      captures round-trip through WAT-to-Wasm `call_indirect`.
    - Implemented a generic proof-gate check for reserved closure-capture
      decisions. Any capture slot reported as reserved now rejects before WAT
      emission, including future non-text `unique_heap` capture classes that are
      not explicitly allowed.
    - Remaining work: make any other non-text `unique_heap` capture classes
      either explicitly accepted through reusable/frozen proof facts or real
      linear closure values once linear closure calls are implemented.

15. Future explicit region package design

    - Keep ordinary `scratch {}` lexical and reset-on-exit.
    - If escaping region values are added later, model them as an explicit live
      owner package such as `{ region, value }` with Core lifetime, ownership,
      escape, and cleanup facts.
    - Do not infer attached regions from unsafe scratch returns.
    - Split this future profile into separate tasks before implementation:
      source/API shape, Core representation, region-owner lifetime facts, values
      tied to the owner, cleanup/reset/drop behavior, and host/import boundary
      rules.

## Memory Direction

The baseline memory model is:

- Runtime heap values are unique by default. They can be moved, consumed,
  borrowed, frozen, or explicitly dropped, but they cannot be implicitly copied.
- `borrow value` creates a lexical read-only view. It is a convenience for
  analysis and API contracts, not a new owning value.
- `freeze value` consumes unique ownership and produces immutable shareable
  storage. Freezing or promoting out of scratch storage must be an explicit Core
  operation before WAT emission.
- `scratch { ... }` is the MVP region-like construct: a lexical scratchpad with
  a value result. It does not return an attached live region. Any returned value
  must be scalar, frozen, promoted, or proven not to reference reset scratch
  storage.
- Scratchpads are the source-level scratch-region surface for temporary
  computations. They are allowed to make temporary values easy to share inside
  the scope, but the reset boundary remains lexical and explicit.
- Cleanup is inserted from facts. Scratch scopes reset on every exit edge;
  unique heap values record drop facts at known lifetime ends; scalar and
  already-frozen values need no runtime cleanup.
- Optional named or nested regions can be considered after `scratch {}` is
  stable, but they should reuse the same lifetime ids, escape facts, and
  cleanup/reset machinery.
- A future attached-region value can be explored as an explicit owning package
  such as `{ region, value }`, where the returned value is tied to the returned
  region lifetime. This is not the MVP surface. The MVP should first prove the
  simpler `scratch { ... }` rule: reset the scratchpad before the result can
  observe dangling scratch storage.
- GC, Wasm-GC, or tracing storage is a future separate backend profile. It is
  not a fallback for missing facts in the baseline linear-memory backend.
- If a scratch, borrow, freeze, closure, or host-boundary case is hard to
  analyze, split it into narrower proof fixtures or reject it deterministically.
  Do not keep the case accepted by adding "let GC decide" behavior to the
  baseline.
- The baseline efficiency target is static cleanup: scalar locals copy, scratch
  storage resets in O(1), frozen values share without tracing, and unique-heap
  drops are represented even while the first bump allocator treats them as
  no-ops.

## Research Notes

- Dynamic behavior that needs loops, mutation, memory, or first-class closure
  storage should go through structured `Core` before WAT. The Ic frontend should
  stay focused on pure scalar/text-pointer graph lowering, static expansion, and
  interaction-calculus reductions.
- `Core` already preserves unknown `collection_loop`, `index`, and
  `index_assign` nodes, and already emits dynamic `range_loop` control flow. The
  missing piece for unknown collections is mostly facts and memory/runtime
  representation, not a new loop syntax.
- Runtime closures and runtime union values already use a shared bump-allocation
  model through `closure_heap_global`. Runtime aggregates should reuse that heap
  path instead of introducing another allocator.
- Runtime union payload support is already layout-driven for scalar, `Text`,
  `Unit`, union-pointer, and aggregate-pointer struct payloads. Broader payloads
  should extend that layout path instead of adding case-specific emitters.
- Linear checking already validates many source paths before lowering. The main
  unresolved design is how a first-class closure owns captured linear values and
  how an effectful capability method maps to imports or runtime function
  pointers.
- Runtime heap aggregate values should be unique by default. Sharing mutable
  heap values requires explicit `borrow` or `freeze`.
- `borrow value` creates a read-only view whose lifetime is bounded by the
  current block, loop iteration, function call, or scratchpad scope. Borrowed
  views cannot escape, and the borrowed unique value cannot be moved, mutated,
  or frozen until the borrow ends.
- The concrete borrow/view source shape is `borrow owner`; a stored view is just
  `let view = borrow owner`. A stored view remains non-owning and read-only, and
  its lifetime must be proven no longer than the owner lifetime.
- `freeze value` consumes a unique owned value and produces an immutable
  shareable value. It may copy or promote out of scratch storage as needed.
- `scratch { ... }` is a temporary bump-allocation scope with a return value.
  Scratch storage is reset at block exit. The returned value must be scalar,
  proven not to reference scratch storage, or explicitly moved/promoted/frozen
  into non-scratch storage.
- `scratch { ... }` is not intended to grow into an implicit region object. If a
  later design needs a region to outlive the block, that should be an explicit
  value such as a region owner plus values tied to that owner.
- The baseline backend should use static lifetime and escape analysis. Do not
  add a GC fallback for uncertain scratchpad escapes. A future Wasm-GC backend
  may be a separate compile target, but it should not change baseline linear
  memory semantics.
- The compiler should insert cleanup at known lifetime ends. Scratch cleanup is
  required and resets the scratch pointer on all exits. General unique-heap drop
  points may initially lower to no-ops with the bump allocator, but the analysis
  should still produce them.
- `scratch { ... }` is a lexical scratchpad scope, not a general region object
  exposed to source programs. It has a return value, but that value must not
  carry a pointer into reset scratch storage unless the compiler can prove it is
  scratch-free or explicitly promotes/freezes it.
- Optional region-like allocation should reuse the same lifetime machinery as
  scratchpads instead of adding implicit managed storage. The MVP source surface
  is `scratch { ... }`; later named or nested arenas should still produce
  explicit lifetime ids, reset/drop edges, and return-value escape facts.
- If later region values are allowed to escape a block, make that escape
  explicit in Core as a live region owner plus values tied to that owner. Do not
  infer an attached region implicitly from an unsafe scratch return.
- Temporaries created by lowering should receive cleanup at their proven
  lifetime end. Scalar and frozen temporaries need no runtime cleanup,
  scratch-backed temporaries reset with the scratch scope, and unique-heap
  temporaries record drop points even if the initial bump allocator lowers them
  to no-ops.
- The baseline backend should make allocation choices from static facts. Do not
  add a "let GC decide" fallback to the default target. If an escape, borrow, or
  scratch lifetime cannot be proven, fail with a deterministic diagnostic and
  leave managed GC as a future separate backend target.
- The practical requirement is to make the baseline analysis complete enough for
  the supported source surface, not to compensate with runtime tracing. GC or
  Wasm-GC can be researched later as a different backend profile with different
  storage and boundary rules.

## Memory Model Decisions

Use these storage/lifetime facts throughout the remaining tasks:

```txt
scalar_local      copyable Wasm local value
unique_heap       owned linear-memory pointer, mutable if facts allow it
borrow_view       read-only view tied to a lexical lifetime
frozen_shareable  immutable value that may be duplicated freely
scratch_backed    pointer into the active scratchpad scope
```

Rules:

- Runtime aggregate, text, union, and closure-environment pointers start as
  `unique_heap` unless produced inside `scratch {}`.
- A `borrow_view` may be copied as a view, but it cannot outlive its owner and
  cannot be used for mutation.
- A `unique_heap` value cannot be copied. It can be moved, borrowed, frozen, or
  consumed by a linear operation.
- A `frozen_shareable` value is immutable and may cross branches, closures, and
  scratch boundaries.
- A `scratch_backed` value may be used freely inside the active scratchpad
  according to its ownership facts, but it cannot escape unless promoted,
  frozen, scalarized, or proven scratch-free.
- A value returned from `scratch { ... }` carries the scratch lifetime until
  escape analysis proves otherwise. Returning does not extend the scratchpad
  lifetime; it either produces a scratch-free value, emits explicit
  promotion/freeze before reset, or rejects.
- Cleanup/reset edges must be explicit in Core before WAT emission so structured
  Wasm `block`/`loop`/`br` lowering cannot skip them.
- Every runtime allocation site should record the selected storage class and the
  reason for that choice: static data, scalarized local, persistent unique heap,
  frozen heap, scratch arena, or rejected uncertain escape.

## Static Analysis Gate

The baseline implementation should skip GC by making the analysis precise enough
for the supported source surface. A program may reach WAT emission only after
the compiler can prove all of these facts:

- Each runtime value has a storage class and lifetime id.
- Each borrow has a source owner, target lifetime, and proof that the target
  cannot outlive the owner.
- Each scratch result is scalar, frozen/shareable, explicitly promoted, or
  proven not to reference scratch storage before the scratch pointer resets.
- Each unique heap owner is moved, consumed, returned, or assigned a
  deterministic drop point.
- Each lowering-created temporary is cleaned up at the same proven lifetime end
  as an equivalent source value.
- Each ownership-bearing value that needs path sensitivity is tracked by the
  same linear/unique state engine, while scalar and frozen values bypass that
  engine as copy/share values.
- Each unknown host/import call is treated as escaping unless its signature
  explicitly accepts a bounded borrow.

If any proof is missing, the baseline backend must reject with a deterministic
diagnostic. It must not silently promote, trace, or hand the value to a runtime
collector. Managed GC or Wasm-GC can be added later only as a separate target
profile with its own storage facts, boundary rules, and tests.

## No-GC Proof Harness

Task 12.2 should grow a small harness that proves the baseline target is
analysis-complete for the accepted surface instead of relying on managed
storage. The harness should cover:

- ownership decisions for source values and lowering-created temporaries
- borrow creation, stored borrow views, owner barriers, and borrow escapes
- `freeze` over direct owners, block/branch results, and scratch-backed values
- `scratch {}` fallthrough, `return`, `break`, and `continue` reset edges
- optional branches and loops where a value may or may not be consumed
- closure captures by storage class: frozen, unique, borrowed, and
  scratch-backed
- unknown host/import calls as escaping unless they declare bounded-borrow facts

Each accepted fixture should expose the facts used by WAT emission: storage
class, lifetime id, escape edge, cleanup/reset edge, and drop or ownership
transfer decision. Each rejected fixture should assert the deterministic
diagnostic. No accepted baseline fixture should select a GC or Wasm-GC escape
path; those remain separate future target profiles. The proof output should make
this visible with `managed_storage: "disabled"` or an equivalent baseline
profile marker.

## No-GC Memory Implementation Queue

Use this queue before broadening runtime aggregates, general mutation, or
effectful imports. Each item should add proof output, accepted fixtures, and
rejected diagnostics before the next item depends on it.

No queue item may accept a baseline fixture by selecting managed storage. The
required shape is: prove the value's storage/lifetime facts, emit explicit
cleanup/reset/promotion where needed, or reject with a deterministic diagnostic.
When the proof shape is too broad, split the task by value category, for example
scalar, static aggregate, static union case, dynamic static-union `if`, runtime
heap aggregate, runtime union payload, runtime text, and closure environment.
This triage rule also applies to compiler-created temporaries and source-level
scratchpad returns; both need the same proof facts as ordinary values before
they can reach WAT emission.

1. Proof contract and no-GC acceptance gate

   - Make the baseline proof check the gate before WAT emission. Accepted
     programs must expose storage class, lifetime id, escape edge, borrow
     validity, scratch reset edge, freeze/promotion edge, and drop/transfer
     decisions for every runtime value and lowering-created temporary.
   - The proof must state whether a value participates in linear/unique
     path-sensitive analysis. Participation is required for capabilities, unique
     owners, active borrow barriers, scratch-backed owners, and captured
     ownership-bearing closure slots, and should be absent for scalar/frozen
     copy/share values.
   - Add fixtures that prove skipped GC is an intentional backend contract:
     accepted fixtures show the facts used by emission, and rejected fixtures
     fail with deterministic missing-fact diagnostics.

- Do not allow any later queue item to accept a case by silently promoting,
  tracing, or delegating lifetime decisions to a managed runtime.
- Keep each queue item reviewable by pairing every newly accepted shape with a
  proof fixture and every unsupported shape with a deterministic rejection. A
  case is not done just because it could be handled by a future collector.

2. Host/import boundary facts

   - Implemented Core signature slices for scalar, bounded-borrow,
     frozen/shareable, and direct ownership-transfer argument contracts on
     `Core.host_imports`.
   - `Core.host_boundaries(...)` and `Core.proof(...)` report matched import
     signatures and per-argument decisions before WAT emission.
   - `Core.drops(...)` reports `host_transfer` facts when an ownership-transfer
     import consumes a direct `unique_heap` owner.
   - `Core.proof(...)` reports transfer-validation issues when a transferred
     owner is used later in the same Core program path.
   - `Core.mod(...)` emits WAT imports and direct calls for known host imports.
   - Bounded-borrow contracts accept explicit `borrow` views. Unknown imports
     and direct `unique_heap`, `borrow_view`, or `scratch_backed` arguments
     without a matching contract reject before WAT emission.
   - Core-level host-returned owner contracts are implemented for imported
     results, including proof-visible signatures, owned final-result escape
     facts, scope-exit drops for bound unique results, and WAT import calls.
   - Frozen/shareable Core import arguments have proof and WAT fixture coverage.
   - Scratch-backed Core import arguments have proof coverage: bounded-borrow
     views are accepted, and ownership transfer rejects scratch-backed storage.
   - Source-level contract declarations are implemented for scalar numeric ABI
     values, Text ownership contracts, explicit non-Text pointer owner reasons,
     and user-defined aggregate/union type-value owner references. Direct,
     single-expression block, multi-statement block, and branch-selected
     annotated closure top-level transfer wrappers are covered, including
     temporary unique expression arguments such as `send(append(...))` and
     branch-local wrapper definitions visible to later statements in the same
     lexical analysis scope. Remaining work is deeper interprocedural transfer
     analysis for higher-order/recursive wrappers, broader non-variable-argument
     wrappers, and any future scratch-backed promotion policy that crosses the
     boundary intentionally.

3. Runtime aggregate ownership facts

   - Materialized structs/objects need pointer, layout, storage class, lifetime,
     and owner facts.
   - Static-shaped aggregate facts remain compiler facts until an expression
     actually materializes a runtime pointer.

4. Scratch allocation selection

   - Route temporary aggregate/text/union payload allocations inside
     `scratch {}` to the scratch pointer only when escape analysis proves they
     die inside the scope.
   - Mark those values as `scratch_backed` with the scratch lifetime id and the
     allocation reason, so later borrow, freeze, escape, and cleanup checks do
     not have to rediscover where the pointer came from.
   - Keep persistent heap allocation for values that are returned, captured, or
     otherwise proven to escape safely.
   - Implemented first slices: temporary runtime aggregate materialization,
     runtime text concatenation, and runtime union value materialization inside
     an active `scratch {}` body use `__scratch_heap` when the scratch result is
     scalar or otherwise scratch-free.

5. Scratch escape enforcement

   - Reject returned scratch-backed values unless they are scalar, frozen,
     promoted, or proven scratch-free.
   - If a returned value contains both scratch-backed and non-scratch fields,
     track that at the field/layout level instead of treating the whole value as
     safe by default.
   - Prove scratch-free static-shaped aggregate and static union results before
     heap-backed aggregate and union payload escapes. Dynamic static-union `if`
     results are accepted only when the condition and both case payloads are
     scratch-free.
   - Make every rejected case point at the escape edge that forced the decision.

6. Freeze and promotion codegen

   - Implement immutable heap copy/promotion for supported heap-backed values.
   - Promotion from scratch to persistent heap is an explicit Core edge emitted
     before the scratch reset; it is not an implicit repair in type checking,
     proof checking, or WAT emission.
   - Preserve idempotent `freeze` for already-frozen values and mutation
     rejection through frozen storage.

7. Temporary cleanup completion

   - Extend drop/reset planning to lowering-created temporaries from aggregate
     materialization, runtime text operations, union payload construction, and
     closure environment setup.
   - Cleanup facts must cover compiler-created temporaries even when the source
     expression is otherwise scalarized, so future materialization choices do
     not accidentally skip drops or scratch resets.
   - Keep bump-allocator drops as analysis facts until a reusable allocator or
     destructor path exists.

8. Runtime aggregate memory slice

   - The current implementation already has the first persistent-heap slice:
     runtime aggregate allocation, field stores, local/fact propagation for
     stored aggregate pointers, and field loads from those stored pointers.
   - Continue by integrating that representation with scratch allocation,
     scratch-backed aggregate rejection/promotion tests, full aggregate-pointer
     closure capture semantics, and the broader cleanup proof facts from the
     preceding items.

9. Future managed profile

   - Only after the no-GC baseline is stable, consider a separate managed or
     Wasm-GC target with its own storage classes, ABI, and tests.
   - Do not let that future profile weaken baseline proof requirements.
   - Do not use this item to unblock any `core-3-nonweb` fixture. A baseline
     fixture must either prove ownership/lifetime safety with explicit
     cleanup/reset/promotion or reject before WAT emission.

Immediate refinement tasks from the memory decision:

1. Finish the baseline proof gate audit.

   - Check every current `Core.emit` and `Core.mod` accepted feature against the
     no-GC contract.
   - Add missing proof facts or reject the feature before emission.
   - Include lowering-created temporaries in the same audit as source values.

2. Make scratch-backed facts field-sensitive.

   - Runtime aggregate, union payload, and text-operation temporaries can be
     scratch-backed internally, but returned aggregate values need field-level
     scratch-free, frozen, promoted, or scalar proofs.
   - Reject whole-value escapes when any field may still reference reset scratch
     storage.

3. Implement explicit freeze/promotion codegen.

   - Consume the source owner, allocate/copy into persistent frozen storage, and
     emit the promotion before scratch reset when the source is scratch-backed.
   - Record the resulting `frozen_shareable` fact so branch merge, closure
     capture, and return paths can duplicate the value safely.

4. Complete host/import ownership contracts.

   - Treat unknown imports as escaping.
   - Bounded-borrow signatures are implemented at the Core import boundary and
     accept explicit borrow views.
   - Direct ownership-transfer signatures are implemented for `unique_heap`
     owners and record `host_transfer` facts in `Core.drops(...)`.
   - Host-returned owner facts are implemented for Core import result contracts.
   - Frozen/shareable Core import arguments have proof and WAT fixture coverage.
   - Scratch-backed Core import arguments are classified at the boundary:
     explicit bounded borrows are accepted, and ownership transfer rejects them.
   - Source-level contract syntax is implemented for scalar numeric ABI values,
     Text ownership contracts, explicit non-Text pointer owner reasons, and
     user-defined aggregate/union type-value owner references. Add deeper
     interprocedural transfer analysis before allowing more wrapper shapes to
     transfer broader heap values across the boundary.

5. Extend cleanup from facts, not emit shape.

   - Add cleanup/drop/reset facts for temporaries introduced by runtime
     aggregate materialization, text copy/slice/concat loops, union payload
     construction, closure environment setup, and promotion.
   - Keep unique drops as no-op bump-allocator facts until reusable allocation
     or destructors are added.

## Task 12.2 Implementation Task Split

Use this split to make the no-GC baseline implementable and reviewable. Each
slice should add accepted fixtures, rejected fixtures, and proof output checks
before the next slice depends on it.

### 12.2.a Storage Classification

- Classify every runtime allocation site and lowering-created temporary as
  `scalar_local`, `unique_heap`, `borrow_view`, `frozen_shareable`,
  `scratch_backed`, or rejected.
- Record the source type, storage class, lifetime id, allocation reason, and
  escape reason for each allocation fact.
- Treat static-shaped aggregate values, static aggregate updates, extension
  objects, and type values as ownerless compiler facts unless they are
  materialized as runtime heap values.
- Reject any value that reaches WAT emission without a storage class.

Acceptance tests:

- Scalar, static text, static-shaped aggregate, closure environment,
  runtime-union payload, and scratch-produced values report the expected storage
  class.
- Unknown storage selection rejects with a deterministic diagnostic.
- Lowering-created temporaries appear in the same fact table as source values.

### 12.2.b Lifetime And Escape Facts

- Assign lexical lifetime ids for program bodies, blocks, loop iterations,
  function calls, closure environments, and scratchpads.
- Record escape edges for final results, explicit `return`, branch/loop merges,
  closure captures, heap/global/module stores, scratch returns, and unknown
  host/import calls.
- Treat unknown host/import calls as escaping unless their signature explicitly
  says an argument is a bounded borrow or ownership transfer. The first Core
  signature slices are implemented for bounded-borrow imports, direct
  ownership-transfer imports, and host-returned owner results.
- Reject values whose storage class cannot survive the target lifetime.

Acceptance tests:

- Returning, capturing, branch-merging, and scratch-returning values expose the
  edge that caused the escape decision.
- Unknown imports reject unique, borrowed, or scratch-backed arguments. Known
  bounded-borrow imports accept explicit `borrow owner` views and reject direct
  unique-owner arguments unless the signature uses ownership transfer. Known
  ownership-transfer imports consume direct unique-owner arguments and reject
  borrowed views.
- Optimization or static-call rewrites preserve lifetime ids and escape facts.

### 12.2.c Borrow/View Checking

- Keep the concrete source syntax as `borrow owner` and
  `let view = borrow owner`.
- A borrow view is read-only and non-owning. It can be copied as a view, but it
  cannot outlive the owner and cannot be used for mutation.
- While a borrow is active, the borrowed unique owner cannot be moved, mutated,
  frozen, or consumed by another owning operation.
- Support block-, loop-iteration-, function-call-, closure-body-, and
  scratchpad-bounded borrows.

Acceptance tests:

- `borrow owner` works for read-only consumers inside the bounded lifetime.
- Stored views are accepted when they remain in the current block and rejected
  when returned, captured, stored into longer-lived state, or carried past the
  owner.
- Owner mutation, move, replacement, and `freeze` reject while a view is live.

### 12.2.d Scratchpad Regions

- Treat `scratch { ... }` as the MVP region-like construct: a lexical scratchpad
  with a value result and an explicit reset boundary.
- Use scratchpads for temporary computations and easy sharing inside the scope;
  do not expose an implicit region object in the MVP.
- Save the scratch pointer on entry and reset it on fallthrough, `return`,
  `break`, and `continue` exits that leave the scratch lifetime.
- A scratch result may escape only when it is scalar, already
  `frozen_shareable`, explicitly promoted/frozen into non-scratch storage, or
  proven not to reference scratch storage.

Acceptance tests:

- Scratch reset facts and WAT resets exist on every exit edge.
- Scratch-backed temporary text/aggregate/union values are valid inside the
  scratch scope.
- Direct and block-local runtime text scratch freeze records a scratch
  allocation, persistent promotion allocation, and frozen scratch return without
  enabling managed storage.
- Returning a value that may point into reset scratch storage rejects unless an
  explicit promotion or `freeze` happened first.
- Unsupported non-text scratch temporary promotion remains rejected until the
  proof can tie the temp to a safe persistent promotion edge.

### 12.2.e Freeze And Promotion

- Make `freeze value` consume a `unique_heap` value and produce immutable
  `frozen_shareable` storage.
- Treat `freeze` over already-frozen values as idempotent.
- Implement scratch-to-persistent promotion as an explicit Core operation before
  scratch reset, not as an implicit typechecker or WAT-emitter repair.
- Reject mutation through frozen values and reject freeze when ownership is
  borrowed, already moved, or otherwise unavailable.

Acceptance tests:

- Freezing direct owners, block results, branch results, and accepted direct
  scratch-backed runtime text values records the owner-consumption or promotion
  edge.
- Frozen values can be duplicated, captured, branch-merged, and returned without
  unique-owner drops.
- Mutation through a frozen value rejects.
- Unsupported scratch-backed freeze shapes reject deterministically before WAT
  emission instead of selecting GC.

### 12.2.f Unique And Linear State

- Reuse path-sensitive control-flow state for source `!` capabilities and
  move-only `unique_heap` values where the rules align.
- Keep the concepts distinct: capability tokens are exactly-once linear values;
  ordinary unique heap values are owned values that may be moved, consumed,
  frozen, borrowed, returned, or dropped.
- Capability tokens cannot become `frozen_shareable` and should not be borrowed
  as shareable data.
- Closure environments must record per-slot ownership facts. A closure that
  captures a unique or linear value is reusable only when the capture is frozen
  or otherwise proven shareable; otherwise the closure itself must be linear or
  rejected.

Acceptance tests:

- Branches and loops merge source linear capability state and unique-owner state
  deterministically.
- Unique owners are never implicitly copied through assignment, branch merge,
  closure capture, or specialization.
- Capturing unique/linear values in first-class closures either produces a
  linear closure or rejects.

### 12.2.g Cleanup, Drops, And Proof Gate

- Insert cleanup for source values and compiler-created temporaries at their
  proven lifetime end.
- Scratch-backed values reset with the scratchpad. Unique heap values record
  drop facts even while the first bump allocator lowers drops to no-ops.
- Wire the final no-GC proof gate before WAT emission after `Core.drops(...)`
  covers every accepted Core feature.
- The proof gate must report storage classes, lifetime ids, escape decisions,
  borrow decisions, scratch reset edges, freeze/promotion edges, and unique
  owner drop or transfer decisions.

Acceptance tests:

- Accepted fixtures expose every fact WAT emission depends on.
- Rejected fixtures assert deterministic diagnostics for missing storage,
  lifetime, borrow, scratch escape, freeze/promotion, host-call, or cleanup
  facts.
- No accepted `core-3-nonweb` fixture selects managed GC or Wasm-GC storage.

### 12.2.h Future Region And Managed-Storage Profiles

- Defer named arenas and attached-region returns until `scratch {}` analysis is
  stable.
- If attached-region returns are added, represent them explicitly as a live
  region owner plus values tied to that owner. Do not infer them from ordinary
  scratch returns.
- Keep reusable allocators, destructors, managed GC, and Wasm-GC as separate
  follow-up backend profiles with separate storage and boundary rules.

Acceptance tests:

- Ordinary `scratch {}` cannot return a hidden attached region.
- A future attached-region value must carry an explicit owner/lifetime fact.
- Baseline proof output continues to show `managed_storage: "disabled"`.

### 12.2.i Decision-To-Fixture Matrix

Use this matrix to split future memory work into reviewable vertical slices.
Each accepted fixture must expose the proof facts it relies on; each unsupported
fixture must reject before WAT emission.

1. Unique ownership

   - Track moves, replacement, mutation, freeze, return, and drop for every
     `unique_heap` owner.
   - Reject implicit copies through assignment, branch merge, closure capture,
     specialization, or aggregate field aliases.
   - Fixtures: direct move, branch move, loop-carried owner, field alias owner,
     discarded temporary, and returned owner.

2. Borrow/views

   - Keep the source surface as `borrow owner` and `let view = borrow owner`.
   - Views are read-only and non-owning. They may be copied as views but cannot
     escape the owner lifetime.
   - Fixtures: bounded read-only call, stored local view, branch-created view,
     loop-created view, returned view rejection, captured view rejection, and
     owner mutation/freeze rejection while the view is live.

3. Scratchpads

   - Treat `scratch { ... }` as a lexical scratchpad with a value result and no
     hidden attached region.
   - Reset the scratch pointer on fallthrough, `return`, `break`, and `continue`
     exits that leave the scope.
   - Fixtures: scalar return, scratch-backed temporary used inside the scope,
     scratch-backed return rejection, field-sensitive scratch-free aggregate
     return, and branch/`if let` scratch result.

4. Frozen/shareable values

   - Make `freeze` consume a unique owner or promote a supported scratch-backed
     value into persistent immutable storage.
   - Frozen values can be duplicated, branch-merged, captured, and returned.
   - Fixtures: direct runtime text freeze, scratch text promotion, runtime
     aggregate freeze, runtime union freeze, closure-environment freeze, frozen
     mutation rejection, and idempotent freeze over already-frozen data.

5. Cleanup and temporaries

   - Insert cleanup from ownership/lifetime facts, not from ad hoc WAT emitter
     shape.
   - Scratch cleanup emits real resets. Unique heap drops may remain no-op facts
     under the first bump allocator, but they must still be present.
   - Fixtures: runtime aggregate materialization temp, text copy/concat temp,
     union payload temp, closure environment temp, promotion temp, discarded
     expression, early `return`, loop `break`, and loop `continue`.

6. Linear participation

   - Apply path-sensitive linear/unique analysis only to source `!`
     capabilities, `unique_heap` owners, active `borrow_view` barriers,
     `scratch_backed` values, and closure slots containing any of those values.
   - Keep scalar locals and already-frozen values copy/share values.
   - Fixtures: capability exactly-once use, unique-owner move, frozen capture,
     rejected unique capture in reusable closure, accepted linear closure, and
     rejected double call of a linear closure.
   - Implemented first closure fixture: proof output distinguishes scalar and
     frozen/shareable captures from unique captures that remain reserved for
     linear closure ownership.
   - Implemented follow-up closure fixture: stored borrow-view captures and
     scratch-backed local captures are now classified separately and remain
     proof-gated rejections until linear closure values are implemented.
   - Implemented `unique_heap text` closure-capture rejection. Existing runtime
     aggregate pointer, runtime union pointer, and closure-pointer captures now
     expose allowed proof decisions. Remaining closure fixtures need any broader
     capture shapes to land as reusable/frozen proof facts, deterministic
     rejections, or linear closure call support.

7. Host/import boundaries

   - Treat unknown non-scalar imports as escaping.
   - Accept heap-backed values only with explicit bounded-borrow or
     ownership-transfer signatures.
   - Implemented fixtures: scalar import argument, bounded-borrow import through
     `borrow owner`, direct ownership-transfer import for a unique owner,
     borrowed-value rejection for transfer, direct use-after-transfer rejection,
     host-returned owned and frozen/shareable results, frozen/shareable import
     arguments, scratch-backed bounded-borrow arguments, scratch-backed transfer
     rejection, and unknown/direct-owner rejection before WAT emission.
   - Implemented source-level fixtures: bounded-borrow `Text`, transfer `Text`,
     frozen/shareable `Text`, scalar numeric signatures, and host-returned
     `unique_heap Text` contracts lower to Core imports; source WAT output calls
     the imported function with the declared ownership contract.
   - Remaining fixtures: deeper interprocedural transfer analysis and any future
     scratch-backed promotion policy that intentionally crosses a host boundary.

## Recommended Order

1. Add compile-target routing and diagnostics.
2. Lock the analysis-first baseline memory policy: unique by default, lexical
   borrows, explicit `freeze`, lexical `scratch {}` regions, and deterministic
   rejection when escape analysis is uncertain.
3. Define ownership facts, lifetime scopes, escape analysis, and drop/reset
   elaboration.
4. Implement borrow/view checking on top of lexical lifetime scopes.
5. Implement scratchpad arena allocation and reset insertion.
6. Implement freeze and explicit scratch-to-heap promotion.
7. Add unique-heap drop planning for source values and lowering-created
   temporaries. Drops can lower to no-ops under the first bump allocator.
8. Add the no-GC proof harness for accepted/rejected ownership, borrow, scratch,
   freeze, closure-capture, temporary-cleanup, and host-call cases.
9. Implement runtime aggregate memory representation.
10. Implement fact-directed runtime indexing and collection loops.
11. Generalize memory-backed mutation.
12. Expand dynamic `if let` through structured Core.
13. Expand runtime union payloads on top of aggregate memory.
14. Add runtime text operations that need allocation/copy loops.
15. Add effectful capability method ABI.
16. Add first-class linear closure captures.
17. Sweep remaining `Cannot ... yet` Core/Ic diagnostics.

This order puts representation and facts before features that depend on them.

## Task 12.1: Compile-Target Routing

### Problem

The current frontend-to-Ic path rejects dynamic range loops, unknown collection
loops, unknown dynamic `if let`, memory-backed mutation, and effectful linear
capabilities. Some of these already have a structured `Core` representation and
should not be forced through Ic.

### Implementation

- Add an explicit API boundary for "pure Ic lowerable" versus "structured
  Core/Wasm required".
- Keep `Source.compile` or the current test helper strict if it is intended to
  prove Ic lowering.
- Add or document a `Source.mod`/`Source.wat` style path for source snippets
  that need structured Core.
- Improve diagnostics so they say whether a feature is unsupported entirely or
  only unavailable on the Ic path.

### Likely Modules

- `src/frontend/source.ts`
- `src/frontend/lower.ts`
- `src/core/from_source.ts`
- `test.ts`
- `src/frontend.test.ts`

### Acceptance Tests

- A dynamic range loop still rejects on the pure Ic helper.
- The same dynamic range loop compiles through `Source -> Core -> Mod -> WAT`.
- Unknown dynamic collection and `if let` diagnostics mention the required
  structured path when appropriate.

### Implementation Status

- `Source.compile` remains the strict pure-Ic entrypoint.
- `Source.core` now accepts either parsed source or source text and lowers
  through the structured Core bridge.
- `Source.mod` and `Source.wat` expose the structured Core/Wasm route for source
  text or parsed source. `Source.wat` emits a full WAT module through the
  existing `Core.mod` and `Mod.emit` path.
- Source-level annotated dynamic tail recursion now compiles through
  `Source.wat`; the host-boundary proof pass recognizes internal `rec(...)` tail
  calls and no longer records them as unknown host/import calls.
- Ic-only diagnostics for dynamic range bounds, unknown collection loops,
  untyped dynamic `if let`, rec values/dynamic rec cases, and unknown index
  expressions, unknown field access, or memory-backed index assignment now point
  callers to `Source.core`, `Source.mod`, or `Source.wat`.
- Core/WAT emission still requires typed Core locals. A source snippet with an
  unbound dynamic range bound can be preserved as Core for diagnostics, but it
  must be typed before WAT emission.

## Task 12.2: Ownership, Borrow, Freeze, And Scratchpad Analysis

### Problem

Runtime heap values need an ownership model before general memory-backed
aggregates, mutation, and temporary allocation can be safe. The default backend
should remain baseline linear-memory Wasm, so it cannot rely on GC to rescue
uncertain scratchpad escapes. The task is to make the static analysis precise
enough for the supported source surface, then reject programs outside that
surface until a separate managed backend exists.

Latest implementation direction: keep this task as the no-GC memory/lifetime
gate. It must cover unique ownership, borrow/view checking, value-returning
scratchpads, explicit freeze/promotion, cleanup for source values and
compiler-created temporaries, and storage-driven linear participation. When a
case is hard to analyze, split it by value category and escape shape instead of
adding GC, hidden attached regions, implicit promotion, or runtime-discovered
cleanup to the baseline.

### Implementation

Split the feature into small vertical slices:

1. Backend lifetime policy

   - Keep the default backend purely static for ownership/lifetime decisions. If
     the compiler cannot prove an escape, borrow, scratch lifetime, or promotion
     is valid, it must reject before WAT emission.
   - Do not add a "let GC decide" mode to the baseline backend. Managed or
     Wasm-GC storage can be explored later as a separate compile target with its
     own lowering rules.
   - Treat `scratch { ... }` as the MVP region surface: a lexical scratchpad
     scope with a return value and explicit reset/drop facts, not a first-class
     region object.
   - Require every allocation and compiler-created temporary to carry enough
     facts for cleanup planning: storage class, lifetime id, escape edge, and
     drop/reset behavior.
   - Elaborate cleanup/reset in Core before structured Wasm emission so
     fallthrough, `return`, `break`, and `continue` cannot bypass it.

2. Ownership fact surface

   - Add ownership/lifetime facts for runtime values: `scalar_local`,
     `unique_heap`, `borrow_view`, `frozen_shareable`, and `scratch_backed`.
   - Classify static text/data segments as `frozen_shareable`, integer/float
     locals as `scalar_local`, and runtime text/aggregate/union/closure pointers
     as `unique_heap` unless allocated inside a scratch scope.
   - Attach an allocation-site fact that records storage class, source type,
     layout facts if any, lifetime id, and escape reason.
   - Keep mutable writes gated by unique/linear ownership facts.

3. Lifetime scopes and escape analysis

   - Introduce lexical lifetime ids for function bodies, blocks, loop
     iterations, call arguments, closure environments, and scratchpads.
   - Mark a value as escaping when it is returned, stored in heap/global/module
     state, captured by a closure that may escape, merged into an outer branch
     result, or passed to an unknown host/import API.
   - Treat unknown imports and host calls as escaping unless their signature
     explicitly accepts a bounded borrow.
   - Reject values whose storage class cannot survive the target lifetime, with
     diagnostics that say which escape edge caused the rejection.

4. Borrow/view checking

   - Parse and represent `borrow expr`.
   - Treat `borrow` as a read-only view, not a copy of owned data.
   - Support stored views through normal binding syntax such as
     `let view = borrow owner`; do not introduce a separate region-reference
     type that can outlive the owner.
   - Give every borrow edge a source owner, lexical lifetime id, and target
     lifetime. The target lifetime must be no longer than the owner lifetime.
   - Model `borrow` over scalars and already-frozen values as a no-op view.
   - Reject returning, storing, or capturing a borrow when the target lifetime
     can outlive the borrowed owner.
   - Reject mutation, move, or `freeze` of a unique owner while a borrow is
     active.
   - End borrows at the nearest block, loop-iteration, call, or scratchpad
     lifetime boundary.

5. Scratchpad scopes

   - Parse and represent `scratch { ... }`.
   - Treat `scratch { ... }` as the first region-like construct: a lexical
     temporary arena with a value result, not a source-level region object that
     can be stored or passed around.
   - Use scratchpads for temporary computations that benefit from cheap sharing
     inside the scope. Reset remains lexical; sharing outside the scope requires
     a proven scratch-free value or an explicit freeze/promotion.
   - Add a scratch bump-pointer path that cannot rewind persistent heap
     allocations. This can be a distinct scratch pointer or a partitioned arena,
     but the choice must be documented in the memory helpers.
   - Save the scratch pointer on entry and reset it on every exit edge:
     fallthrough, `return`, `break`, and `continue`.
   - Allocate temporary runtime aggregates/text/union payloads from the
     scratchpad inside the scope when they do not need to escape.
   - Enforce that `scratch { ... }` may return scalars, frozen/promoted values,
     or values proven not to reference scratch storage.
   - Reject scratch returns when escape analysis is uncertain.

6. Freeze and promotion

   - Parse and represent `freeze expr`.
   - Make `freeze` consume a unique value and produce an immutable
     `frozen_shareable` value.
   - If the source is scratch-backed and the frozen value escapes, emit an
     explicit promotion/copy into non-scratch heap storage before scratch reset.
   - If the source is already frozen/shareable, keep `freeze` idempotent.
   - Reject mutation through frozen values and borrowed views.
   - Do not implicitly freeze or promote just because analysis is uncertain.

7. Drop and cleanup elaboration

   - Compute drop/reset points at known lifetime ends before WAT emission.
   - Insert cleanup for temporaries introduced during lowering, using the same
     ownership/lifetime facts as source values.
   - Lower scratch cleanup to a required pointer reset on all structured exits.
   - Let unique heap drops lower to no-ops for the first bump-heap backend, but
     preserve the Core drop facts so a future reusable allocator/destructor path
     has a stable contract.
   - Verify that `return`, `break`, `continue`, and branch fallthrough cannot
     bypass cleanup.

8. Baseline backend policy

   - Do not silently promote, copy, or fall back to GC when analysis is
     uncertain.
   - Skip GC in the default backend by completing the static ownership,
     lifetime, escape, borrow, scratch, and cleanup analysis for the supported
     source surface.
   - Do not add a GC fallback to the default backend. A managed backend may be a
     future separate compile target only after baseline facts are stable.
   - Prefer deterministic static cleanup over runtime tracing for the baseline:
     insert temporary cleanup and scratch resets from ownership/lifetime facts,
     and reject programs whose facts cannot be proven.
   - Keep this whole task targetable with baseline structured Wasm, locals,
     globals, linear memory, and ordinary control flow.

9. Analysis completeness checklist

   - Track allocation-site facts for source values and lowering-created
     temporaries: storage class, source type, lifetime id, escape edge, and
     cleanup/drop behavior.
   - Track owner state for `unique_heap` values. A unique value can be moved,
     consumed, borrowed, frozen, or dropped, but not implicitly copied.
   - Track active borrows so owner move, mutation, and `freeze` are rejected
     until the borrow lifetime ends.
   - Collect escape edges for returns, closure captures, heap/global stores,
     branch results, scratch returns, and unknown host/import calls.
   - Insert reset/drop actions at every scope edge that leaves the value's
     lifetime: fallthrough, `return`, `break`, `continue`, and discarded
     temporary expressions.
   - Make scratch-to-persistent promotion and `freeze` explicit Core operations.
     Do not hide implicit copying behind type checking or WAT emission.
   - Add accepted/rejected fixtures for each ownership edge. Accepted fixtures
     must expose the facts later WAT emission uses; rejected fixtures must
     assert a deterministic diagnostic and must not fall back to managed
     storage.

### Likely Modules

- `src/frontend/parser_expr.ts`
- `src/frontend/ast.ts`
- `src/frontend/linear_expr.ts`
- `src/frontend/linear_stmt.ts`
- `src/core/local_facts.ts`
- new `src/core/ownership.ts`
- new `src/core/lifetime.ts`
- new `src/core/lifetime_scope.ts`
- new `src/core/escape.ts`
- new `src/core/borrow.ts`
- new `src/core/cleanup.ts`
- new `src/core/scratch.ts`
- new `src/core/drop.ts`
- new `src/core/promotion.ts`

### Acceptance Tests

- `borrow x` can be passed to read-only consumers inside the same block.
- Returning a borrow from `scratch {}` or an inner block is rejected.
- Mutating, moving, or freezing an owned value while a borrow is active is
  rejected.
- `scratch { 1 + 2 }` returns a scalar and resets scratch storage.
- Scratch reset is emitted on normal fallthrough, `return`, `break`, and
  `continue` exits.
- Compiler-created temporaries get drop/reset points at their proven lifetime
  ends.
- Unique heap values that do not escape produce deterministic drop-plan entries,
  even if those entries lower to no-op code for the first bump allocator.
- Returning a scratch-backed aggregate without `freeze` or promotion is
  rejected.
- `freeze` allows a scratch-built aggregate to escape as immutable/shareable.
- Mutating a frozen value or a read-only borrow is rejected.
- Uncertain escape analysis fails with a diagnostic that says the value may
  reference scratch storage.
- Uncertain ownership, borrow, scratch, temporary-cleanup, or host-call escape
  analysis rejects before WAT emission instead of selecting a GC fallback.
- Unknown imports are treated as escaping unless their Core host signature
  declares a bounded-borrow contract.
- Static text/data remains frozen/shareable and does not allocate or require
  cleanup.
- Promotion from scratch to persistent heap is explicit in Core or rejected.

### Implementation Status

- Reserved frontend syntax now parses and formats `borrow expr`, `freeze expr`,
  and `scratch { ... }`. The source-to-Core bridge preserves them as explicit
  Core ownership nodes instead of unsupported placeholders.
- `scratch { ... }` now lowers through the source-to-Ic path when the scratch
  block result is inferred as an integer scalar or resolves to a statically
  visible/shareable text expression, including visible text bindings. Aggregate,
  unknown, dynamic text, and ownership-bearing heap results still reject on that
  Ic-only route until escape analysis can prove them pure-Ic lowerable.
- `borrow expr` and `freeze expr` now lower transparently when their operand is
  inferred as an integer scalar or resolves to statically visible/shareable
  text, including passing a borrowed scalar to a read-only function call.
  Aggregate, unknown, dynamic text, and ownership-bearing heap operands still
  reject until ownership/lifetime facts exist.
- Core type checking and emission also preserve `borrow`, `freeze`, and
  `scratch` nodes, lowering them transparently for scalar locals and
  already-shareable static text values where no ownership transition is needed.
- Core local collection, closure capture scanning, static-call substitution,
  static stability, type substitution, and text-layout scanning now traverse the
  ownership nodes structurally. Core scalar-only checks report ownership reasons
  for pointer-shaped values such as `Text`, runtime unions, and closures, while
  the accepted persistent freeze paths handle runtime aggregate, runtime union,
  and first-class closure owners explicitly.
- `src/core/ownership.ts` now defines the first explicit Core ownership fact
  surface: `scalar_local`, `unique_heap`, `frozen_shareable`, `borrow_view`, and
  `scratch_backed`. The public `Core.ownership(...)` helper classifies the final
  typed Core result, while direct analyzer tests cover scratch-backed values
  that are still ahead of current type/emission support.
- Core scalar-only `borrow`, `freeze`, and `scratch` diagnostics now report the
  ownership reason, for example frozen text, closure pointers, runtime-union
  pointers, or scratch-backed values. Bounded borrow escape checks, owner
  move/mutation/freeze protection while borrowed, control-flow drop coverage,
  and runtime text freeze promotion now have accepted proof slices. Broader
  aggregate/union/closure promotion and reusable cleanup are still pending.
- Core `scratch { ... }` now accepts results classified as `frozen_shareable` in
  addition to scalar locals. Static text literals inside `scratch` can return
  through Core type/emission because they are already frozen/shareable and do
  not reference scratch storage. Unfrozen unique heap scratch results still
  reject unless an implemented freeze/promotion path produces `frozen_shareable`
  storage.
- Core `freeze expr` now accepts scalar values and values that are already
  `frozen_shareable`, such as static text. Static-shaped aggregate values
  wrapped in `freeze` remain scalarized/static compiler facts, pass the no-GC
  proof gate as an allowed freeze edge, and reject indexed mutation with the
  frozen/shareable binding diagnostic. This keeps `freeze` idempotent for
  already-shareable values. Persistent runtime `Text` owners and scratch-backed
  runtime `Text` temporaries from direct or block-local `append(...)` can now be
  frozen/promoted with proof-visible allocation facts. Persistent runtime
  aggregate, runtime union, and first-class closure owners can now be frozen as
  immutable shareable storage. Direct, block-local, and branch-selected scratch
  first-class closure freeze now accept `scratch { freeze ((x: Int) => ...) }`,
  `scratch { let inner = (x: Int) => ...; freeze inner }`, and
  `scratch { if flag { freeze closure_a } else { freeze closure_b } }`, record
  frozen/shareable scratch returns and allowed closure freeze edges, and keep
  closure allocation on persistent heap storage. Scratch-backed aggregate,
  union, and broader closure promotion still reject until real copy/promotion
  exists for those shapes.
- Core `borrow expr` now accepts scalar values and values that are already
  `frozen_shareable`, such as static text. Borrowing those values is treated as
  a no-op for ownership because there is no mutable owner lifetime to protect.
  Borrowing unique heap values is now context-aware: bounded read-only uses such
  as `len(borrow message)` inside an annotated closure body are allowed when the
  borrow is confined to the immediate function-call scope, while returning or
  otherwise escaping the borrow still rejects.
- `src/core/borrow.ts` and `Core.borrows(...)` now expose the first borrow-edge
  analysis surface. It records deterministic borrow ids, source/target lifetime
  scope ids, operand ownership, and the current lifetime decision for each
  `borrow expr`. Static Core calls are scanned through their substituted call
  body, so direct calls of unannotated scalar closures can produce borrow edges
  in the function-call lifetime scope instead of being skipped. Annotated
  closure values can also be scanned with closure-local parameter facts.
  Unannotated closure values that escape or are otherwise not analyzed through a
  static call are reported explicitly as skipped analysis until closure-local
  inference is available. `Core.validate_borrows` returns a deterministic
  validation result for rejected borrow edges and skipped closure-body analysis,
  and `Core.check_borrows` throws the first validation issue for callers that
  need a hard gate. Core type checking, expression emission, and module
  generation now run the borrow gate first, so rejected borrow edges and untyped
  closure-body borrow skips fail before WAT emission. Borrow expression typing
  and emission defer lifetime rejection to that gate, which lets bounded
  unique-heap borrows lower as ordinary pointer reads after validation. Stored
  borrow-view locals such as `let view = borrow owner` are now accepted when the
  view is syntactically bounded to the current block. The borrow plan records
  the view-to-owner relation, rejects owner move/replacement, index mutation,
  and `freeze` while the view is live, and rejects returning, storing, or
  closure-capturing the view with a borrow-escape diagnostic. Branches and loops
  that assign a borrow view into an outer name now merge that view fact back to
  the parent scope, so later owner mutation or view escape cannot ignore a
  branch/loop-created borrow. Borrow-aware host/import signatures remain
  pending. The borrow plan also records borrowed-owner barrier issues for named
  owners and simple local aliases, rejecting move/replacement, index mutation,
  and `freeze` while a bounded borrow is still active in the current lexical
  scope.
- The frontend has a small static-shareable-text ownership helper backed by the
  existing visible-text resolver. The pure Ic path now accepts `borrow "text"`,
  `freeze "text"`, `scratch { "text" }`, visible text bindings, and simple
  visible text concatenations through these ownership forms, while still
  rejecting dynamic text and aggregate cases when the wrapped value would
  escape. Immediate scalar text reads are now accepted for annotated runtime
  `Text`: `len(borrow message)`, `get(freeze message, index)`, and
  `(scratch { message })[index]` recursively erase wrappers and lower to the
  usual Ic load/bounds-check shape. Pure-Ic diagnostics for non-scalar
  ownership-wrapper results now point callers to `Source.core`, `Source.mod`, or
  `Source.wat` for structured Core/Wasm lowering.
- Core ownership analysis now looks through simple block result expressions, so
  scratch blocks and other single-result blocks keep ownership facts from their
  final expression instead of falling back to plain scalar pointer typing.
- `src/core/lifetime.ts` now owns the first explicit lifetime/escape policy
  decisions for `borrow`, `freeze`, and `scratch` results. Core type checking
  and emission use those decisions instead of raw ownership booleans, so
  reserved unique-heap cases now report whether the missing work is lexical
  borrow tracking, immutable heap copy/promotion, or scratch escape handling.
- `src/core/escape.ts` and `Core.escape(...)` now expose the first allocation
  and escape-analysis surface for final Core results. The analysis records the
  ownership fact, selected storage class (`scalar_local`, `static_data`,
  `persistent_unique_heap`, `frozen_heap`, `scratch_arena`, `borrow_view`, or
  `rejected`), whether the value escapes its current scope, and the decision
  reason. It also reuses the same policy for `borrow`, `freeze`, and
  `scratch_return` edges in tests, so later allocation/reset code has a stable
  fact shape to consume. Whole-program escape-edge collection beyond final
  results and promotion codegen are still pending.
- `src/core/cleanup.ts` and `Core.cleanup(...)` now expose the first cleanup
  planning surface. It scans Core syntax for `scratch { ... }` scopes, assigns
  deterministic scratch scope names, records the scratch return-value escape
  analysis, and reports reset edges for fallthrough, `return`, `break`, and
  `continue`. Loop bodies are treated as break/continue boundaries so a `break`
  inside a nested loop does not get mistaken for a scratch-scope exit. Core WAT
  emission now saves `__scratch_heap` on `scratch {}` entry, stores the body
  result in a temporary, resets the scratch pointer, and reloads the result on
  normal fallthrough. It also emits scratch resets before `return`, `break`, and
  `continue` when those control transfers leave the active scratch scope; nested
  loop `break`/`continue` that remain inside an outer scratchpad do not reset
  that outer scope. `Core.mod` emits the `__scratch_heap` global and memory when
  a scratch expression is used, including scratch inside lifted closure bodies.
  Reusable allocator/destructor lowering and closure-body cleanup planning
  beyond this shared scratch state are still pending.
- `src/core/lifetime_scope.ts` and `Core.lifetimes(...)` now expose the first
  lexical lifetime-scope scan. It records deterministic program, block,
  loop-iteration, function-call, closure-environment, and scratchpad scopes with
  parent links. Scratch scopes reuse the cleanup exit-edge analysis so lifetime,
  escape, and cleanup planning agree on the same scratch boundary ids. Borrow
  escape enforcement and lifetime-aware move/freeze mutation checks are still
  pending.
- `src/core/drop.ts` and `Core.drops(...)` now expose the first unique-heap drop
  planning surface. It records deterministic `heap_drop` steps for unique owners
  that are overwritten, discarded as non-final expressions, or left behind at
  scope exit. It also records `return_exit`, `break_exit`, and `continue_exit`
  edges for control transfers that leave active unique owners behind. Final
  direct unique values and final named owners are treated as escaping results.
  Terminal expression branches, such as both sides of an expression-level `if`
  returning, do not also report a false fallthrough drop. The current runtime is
  explicitly `no_op_bump_allocator`, so these drops are analysis facts for later
  reusable allocation and destructor lowering rather than emitted WAT. Branches
  that assign existing unique owners merge the resulting owner back into the
  outer scope, while branch-local unique owners still drop at the branch
  boundary. Closure bodies are now scanned under deterministic `closure#N`
  scopes, so closure-local unique owners produce drop facts on closure
  fallthrough or closure-local `return` exits. Direct named-owner discards and
  direct named-owner moves through static aliases are now handled without
  forcing static owner values through runtime expression typing.
  Compile-time-only `const` values, including type values and const
  type-constructor results, stay in the static drop-analysis context and do not
  create runtime owners or require runtime expression typing. Freeze of a named,
  block-result, or branch-result unique owner is now modeled as an
  ownership-consuming edge in the drop plan, including discarded `freeze f`,
  `let frozen = freeze f`, `let frozen = { freeze f }`, branch-local
  `if { freeze f } else { freeze g }`, `return freeze f`, and self-shadowing
  `f := freeze f`; full immutable heap-copy/promotion codegen for unique values
  remains pending. Statement-level no-else `if` and typed `if let` bodies that
  contain `freeze f` now avoid forcing static owner values through runtime
  typing and produce conservative outer drop facts for paths where the optional
  branch does not run. Conditional drop/destructor emission for real reusable
  allocators remains pending; the current facts still target the
  `no_op_bump_allocator` runtime.
- `src/core/proof.ts`, `Core.proof(...)`, and `Core.check_proof(...)` now expose
  the first explicit baseline no-GC proof harness for the `core-3-nonweb`
  target. The proof aggregates final-result escape analysis, borrow validation,
  explicit `freeze` edges, scratch cleanup/reset facts, unique-owner drop facts,
  and lexical lifetime scopes, with `managed_storage: "disabled"`. Accepted
  scalar/scratch fixtures expose the facts WAT emission would use, while
  rejected unique-heap `freeze` and scratch-return fixtures report deterministic
  proof issues instead of selecting a GC fallback. The proof gate belongs before
  WAT/module emission; `Core.type(...)` remains a type-query surface rather than
  the final no-GC proof boundary.
- Drop/proof analysis now recognizes static-shaped aggregate values,
  static-shaped aggregate updates, and extension objects as ownerless compiler
  facts rather than runtime heap owners. This lets `Core.proof(...)` accept the
  existing scalarized aggregate path, including static aggregate iteration,
  dynamic static-aggregate indexing, visible text fields, and `freeze` over
  static-shaped aggregates, without inventing drops or heap-promotion failures
  for values that are not represented as heap allocations.
- Drop/proof analysis now also treats static-call-only unannotated `lam` and
  `rec` values as ownerless compiler call targets instead of forcing them
  through first-class runtime closure typing. Ordinary annotated `let` closures
  still produce unique-heap drop facts when materialized as runtime closure
  values. The static type-value probe used by drop analysis is non-fatal for
  ordinary static function calls, so specialized calls such as annotated `I64`
  closures do not get mistaken for type-constructor applications.
- Drop/proof analysis now pre-collects annotated closure-body local facts before
  scanning closure bodies for drops. This covers closure-local accumulators and
  collection-loop item/index locals in first-class closure branches. It also
  treats static shorthand union cases and ownerless static union `if` values as
  compiler facts, and scans `if let` payload branches with the same static,
  dynamic, or runtime union payload contexts used by Core typing/emission. The
  proof audit over inline Core test snippets now passes for every typed snippet;
  deliberately unsupported unknown collection-loop bodies are skipped by drop
  analysis because the emitter still rejects them before WAT. `Core.emit(...)`
  and `Core.mod(...)` now run `Core.check_proof(...)` before producing WAT or
  module artifacts, so borrow, freeze, scratch-return, and final-result proof
  failures cannot pass through to baseline codegen.

### Remaining Task 12.2 Work Breakdown

Break the remaining work into these implementation slices:

1. Stored borrow-view locals

   - Implemented the MVP accepted form: `let view = borrow owner` is valid when
     the stored view is used only inside the current lexical block, including
     read-only calls such as `len(view)`.
   - The borrow plan records `view -> owner`, rejects mutation, move, or
     `freeze` of `owner` while `view` is live, and rejects returning, storing,
     or closure-capturing `view`.
   - Diagnostics now distinguish stored-view escapes from borrowed-owner
     mutation barriers.
   - Branch and loop bodies that assign a stored borrow view into an outer name
     now carry that view fact back to the parent scope. Later owner mutation or
     view escape is rejected after the merge.
   - Remaining follow-up: carry the same stored-view facts through future
     aggregate field owners.

2. Branch and loop borrow barriers

   - Extend borrowed-owner barriers beyond the current named/simple-alias owner
     surface. The current borrow plan rejects move/replacement, index mutation,
     and `freeze` for a named unique owner or simple local alias while a bounded
     borrow is active in the same lexical scope.
   - Implemented stored-view branch/loop merge for assignments into outer names:
     a view assigned in one branch or loop body is treated as possibly live in
     the parent scope.
   - Plain non-stored borrows inside loop bodies still end at the loop
     iteration/body boundary, so owner mutation after the loop is allowed when
     no borrow view escapes the body.
   - Remaining follow-up: add path-sensitive `break`/`continue` merge rules for
     borrow views carried out through future richer loop/region state.

3. Field and aggregate owner barriers

   - Implemented the first field-owner slice for current Core aggregate facts:
     direct `borrow user.name` and `borrow user[index]` canonicalize the
     protected owner back to `user` when the field/index expression aliases
     aggregate-owned storage.
   - Implemented simple field alias propagation. Bindings such as
     `let name = user.name`, `let other = name`, and `borrow other` keep both
     the containing owner and the field value ownership, so replacing `user` or
     mutating through `name[index]` rejects while the borrow is active.
   - Implemented field-owner alias joins for branch, `if let`, and loop
     assignments into outer locals. If `name` may be `user.name` after an `if`,
     `if/else`, `if let`, or loop body, a later `borrow name` protects every
     possible containing owner represented by that join.
   - Implemented field-owner extraction through expression-valued `if` and
     `if let` results. Bindings such as
     `let name = if flag { user.name } else { other.name }` protect both
     possible containing owners when `name` is later borrowed.
   - Implemented stored borrow-view extraction through expression-valued `if`
     and `if let` results. Bindings such as
     `let view = if flag { borrow user.name } else { "fallback" }` protect the
     possible borrowed owner after the binding.
   - Implemented multi-statement block result extraction for field aliases and
     stored borrow views. A block such as `{ let inner = user.name; inner }` or
     `{ let inner = borrow user.name; inner }` carries the returned ownership
     fact to the outer binding without leaking unrelated block-local borrows.
     Field aliases assigned through block-prefix `if`, `if else`, `if let`, and
     loop statements are also joined into the returned block result, so a later
     borrow of that result protects every possible containing owner.
   - Implemented mutation barriers through the containing owner for field
     aliases that are currently emitted as memory-backed `Text` values.
   - Remaining follow-up: extend the same owner facts to full runtime aggregate
     memory representation, nested field/index alias chains through runtime
     aggregate pointers, future richer field-assignment syntax, and general
     fact-directed memory mutation.

4. Host/import borrow contracts

   - Treat unknown imports and host calls as escaping by default.
   - Implemented the first proof-visible host/import boundary slice:
     `src/core/host_boundary.ts`, `Core.host_boundaries(...)`, and
     `Core.proof(...).host_boundaries` now scan unknown Core app targets before
     WAT emission. Scalar arguments are reported as ownership-neutral but still
     require an explicit host/import signature; `unique_heap`, `borrow_view`,
     and `scratch_backed` arguments reject with a deterministic diagnostic that
     names the missing bounded-borrow or ownership-transfer contract.
   - Implemented explicit Core host import signatures on `Core.host_imports`.
     They can describe scalar, bounded-borrow, frozen/shareable, and
     ownership-transfer argument contracts. Known imports lower through
     `Core.mod(...)` as WAT imports and direct calls.
   - Bounded-borrow contracts accept explicit `borrow owner` views for imports
     that only read the view during the call. Direct unique-owner arguments
     still reject unless a future ownership-transfer contract consumes them.
   - Reject passing `borrow_view` to any import without a matching
     bounded-borrow contract.
   - Ownership-transfer contracts now consume direct `unique_heap` owners and
     record `host_transfer` facts in `Core.drops(...)`. Otherwise non-scalar
     unique values crossing the boundary remain rejected.
   - Include host/import escape facts in `Core.proof(...)`, so WAT emission can
     distinguish bounded read-only calls, ownership-transfer calls,
     host-returned owner results, scratch-backed argument policy, and rejected
     unknown calls.
   - Source-level host import declarations are implemented for scalar numeric
     ABI values, Text ownership contracts, explicit non-Text pointer owner
     reasons, and user-defined aggregate/union type-value owner references. The
     syntax is `host_import name from "module.field" (...) => ...`, with
     argument contracts such as `bounded_borrow Text`,
     `frozen_shareable runtime_aggregate`, and `ownership_transfer result_type`,
     plus result contracts such as `unique_heap Text`, `unique_heap user_type`,
     and `frozen_shareable runtime_union`.
   - Direct, block-bodied, multi-statement block-bodied, branch-selected
     annotated closure top-level ownership-transfer wrappers, and branch-local
     wrapper definitions are implemented, including temporary unique expression
     arguments that transfer without a source owner name. Higher-order const
     function wrapper calls are implemented for direct calls and local
     static-function aliases inside the wrapper body. Deeper interprocedural
     transfer analysis remains pending for dynamic higher-order wrappers,
     self-recursive transfer shapes, and broader non-variable-argument wrapper
     shapes.
   - Direct use-after-transfer diagnostics are implemented in the Core transfer
     validator: after a host/import transfer consumes a named owner, later
     direct use of that owner rejects before WAT emission unless the name is
     rebound.

5. Scratchpad allocation and escape enforcement

   - Implemented scratch reset emission on all exits that leave the scratch
     lifetime: fallthrough, `return`, `break`, and `continue`.
   - Implemented allocation-routing slices for temporary runtime aggregate
     materialization, runtime text concatenation, and runtime union value
     materialization: aggregate values, runtime text concat results, and runtime
     union values emitted inside an active `scratch { ... }` body use
     `__scratch_heap` when the surrounding result is scalar or otherwise
     scratch-free.
   - Implemented the first proof-visible allocation fact surface:
     `Core.allocations(...)` and `Core.proof(...).allocations` record persistent
     unique-heap allocation facts and scratch-backed allocation facts for
     accepted runtime allocation sites. Current covered reasons include runtime
     aggregates, runtime unions, runtime text allocations, and first-class
     closure storage.
   - Allocation proof scanning now enters analyzable annotated closure bodies,
     so scratch-backed runtime text temporaries introduced inside first-class
     closure bodies are reported by the no-GC proof instead of being visible
     only in emitted WAT.
   - Mixed persistent heap and scratch heap allocation now use separate globals;
     scratch starts in its own arena when persistent heap allocation is also
     needed, so scratch reset cannot rewind persistent allocations.
   - Remaining follow-up: make allocation facts field-sensitive for returned
     heap-backed aggregate/union payload values, extend cleanup proof output for
     richer lowering-created scratch temporaries, and keep allocation facts
     aligned with future promotion/destructor paths.
   - Reject a scratch result unless it is scalar, frozen/shareable, explicitly
     promoted, or proven scratch-free.
   - Implemented the first returned-field proof for scalarized static-shaped
     aggregate results: `scratch { { field: scalar_or_static } }` can bind a
     static aggregate outside the scratchpad when every field is scalar,
     static/frozen data, or otherwise scratch-free. The proof records an allowed
     scratch-return edge and WAT emission keeps the field reads scalarized.
     Annotated static-shaped struct results now use the same proof, so
     `let user: user_type = scratch { user_type { age: x, name: "Ada" } }` can
     bind outside the scratchpad when the annotated fields are scratch-free. The
     same annotated aggregate shape rejects if a field is scratch-built runtime
     data without explicit freeze/promotion.
   - Static union cases now use the same scratch-free proof for payloads:
     `scratch { result_type.ok(value) }` can leave the scratchpad when the
     payload is scalar, static/frozen data, or otherwise scratch-free. Dynamic
     static-union `if` results are allowed only when the condition and both
     branch payloads are scratch-free.
   - Implemented expression-valued `if let` scratch-promotion coverage for
     runtime or dynamic static-union text payloads. A scratch result such as
     `scratch { if let .ok(value) = result { freeze append(value, "!") } else { freeze append("fallback", "?") } }`
     records scratch text allocation plus persistent promotion before reset. The
     same shape without `freeze` or explicit promotion rejects if the returned
     value may point into scratch storage.
   - A scratch result that is an aggregate must prove every returned field is
     scratch-free, frozen, scalar, or promoted. Otherwise the whole result
     rejects before WAT emission.
   - Keep scratch results detached from the scratchpad lifetime in the MVP. A
     future attached-region result must be an explicit region-owner package, not
     an implicit lifetime extension for ordinary `scratch { ... }`.
   - Do not add a managed fallback for hard scratch-return cases. The supported
     paths are proof, explicit promotion/freeze, or deterministic rejection.

6. Freeze and scratch-to-persistent promotion

   - Implement `freeze` for supported heap-backed values by consuming
     `unique_heap` ownership and producing `frozen_shareable` storage.
   - If the source is `scratch_backed` and the frozen/promoted value escapes,
     emit the copy into persistent non-scratch storage before scratch reset.
   - Keep `freeze` idempotent for already-frozen values and reject mutation
     through frozen storage.
   - Implemented analysis-only drop-plan consumption for direct named and
     block/branch-result unique owners consumed by `freeze`, so the original
     owner is not dropped later as if it were still live.
   - Implemented conservative no-op bump drop facts for optional statement
     branches where `freeze` may not run, including no-else `if` and typed
     `if let` bodies. A later reusable allocator/destructor path still needs
     explicit conditional cleanup facts for the paths where the owner remains
     live.
   - Implemented the first persistent heap-backed freeze slice for runtime
     `Text`: `freeze` over `unique_heap text` consumes the owned buffer as
     immutable shareable storage, tracks frozen runtime locals through Core
     typing/emission/proof contexts, rejects later indexed mutation through the
     frozen binding.
   - Implemented the first persistent heap-backed freeze slice for runtime
     aggregates: `freeze` over `unique_heap runtime_aggregate` consumes the
     owned pointer as immutable shareable storage, keeps struct and text field
     facts visible in proof/emission contexts, records an allowed freeze edge,
     rejects later mutation through the frozen aggregate binding, and
     round-trips through WAT-to-Wasm field loads.
   - Implemented the first persistent heap-backed freeze slice for runtime
     unions: `freeze` over `unique_heap runtime_union` consumes the owned
     pointer as immutable shareable storage, keeps union facts visible through
     annotation, proof, and `if let` contexts, records an allowed freeze edge,
     and round-trips through WAT-to-Wasm matching.
   - Implemented the first persistent heap-backed freeze slice for first-class
     closures: `freeze` over `unique_heap closure` consumes the owned
     environment pointer as immutable shareable storage, keeps closure call
     facts visible through proof/emission contexts, records an allowed freeze
     edge, and round-trips through WAT-to-Wasm `call_indirect`.
   - Implemented the first direct, block-local, and branch-selected scratch
     closure freeze slice: `scratch { freeze ((x: Int) => ...) }`,
     `scratch { let inner = (x: Int) => ...; freeze inner }`, and
     `scratch { if flag { freeze closure_a } else { freeze closure_b } }` return
     frozen/shareable closure values, record allowed `unique_heap closure`
     freeze edges, keep allocation facts on persistent closure heap storage, and
     round-trip through WAT-to-Wasm `call_indirect`.
   - Implemented the first scratch-to-persistent promotion slices for runtime
     `Text`: direct `scratch { freeze append(...) }`, block-local
     `scratch { let temp = append(...); freeze temp }`, inlineable helper
     returned `Text` temporaries, expression-valued `if` branches whose arms
     each freeze runtime `Text`, and expression-valued `if let` branches whose
     selected result freezes runtime `Text` emit a persistent copy before
     scratch reset, record the scratch temporary and persistent promotion
     allocation facts, and leave managed storage disabled.
   - Implemented the first direct aggregate/union scratch-freeze slice:
     `scratch { freeze user_type { ... } }` and
     `scratch { freeze result_type.ok(...) }` materialize the direct constructor
     on persistent heap storage while the scratch reset is active, record
     allowed aggregate/union freeze edges, keep aggregate/union facts visible
     after the reset, and round-trip through WAT-to-Wasm.
   - Implemented the first alias-based aggregate promotion:
     `scratch { let temp = user_type { ... }; freeze temp }` now copies the
     known-layout aggregate into persistent frozen storage before reset. The
     proof records the scratch field temporaries, persistent aggregate
     destination, persistent `Text` field copies, and allowed
     `unique_heap runtime_aggregate` freeze edge. WAT-to-Wasm coverage reads the
     promoted aggregate after scratch reset.
   - Implemented the first alias-based runtime union promotion:
     `scratch { let temp = result_type.ok(...); freeze temp }` now copies
     scalar/`Text`/`Unit`, union-pointer, and supported aggregate-pointer
     payload aliases into persistent frozen storage before reset. The proof
     records the scratch source union, persistent union destination, persistent
     nested union or aggregate payload destination, persistent `Text`
     payload/field copies, and allowed `unique_heap runtime_union` freeze edge.
     WAT-to-Wasm coverage matches the promoted union and reads its text, nested
     union, or aggregate payload after scratch reset.
   - Implemented static-shaped existing aggregate alias planning, so previously
     bound aggregate facts can be frozen through a scratch-local alias without
     failing static-value planning on the alias variable.
   - Remaining follow-up: emit immutable heap copy/promotion for broader
     existing aggregate/union owners across branch/loop/assignment shapes; add
     broader scratch-backed closure shapes beyond direct, block-local, and
     branch-selected persistent closure freeze; broaden scratch-backed text
     shapes; track the resulting frozen storage facts through Core
     typing/emission; then add conditional cleanup/destructor emission for
     optional consumption paths. Deep closure-capture ownership checks for
     linear or ownership-bearing capture slots remain part of the first-class
     linear closure task.
   - Keep promotion as a visible Core fact with source owner, destination
     storage class, lifetime id, and cleanup/drop decision. Do not let a later
     pass infer promotion only because an escape would otherwise fail.
   - Preserve static-shaped frozen values as ownerless compiler facts when they
     can stay scalarized/static, while reserving heap-copy codegen for real
     `unique_heap` or `scratch_backed` runtime storage.
   - Implemented for static-shaped aggregate values: the proof scanner records
     their `freeze` edges as `frozen_shareable` and `Core.emit(...)` keeps field
     reads scalarized. Persistent runtime heap-backed aggregate freeze is
     implemented. Persistent runtime heap-backed union freeze is implemented;
     persistent runtime heap-backed closure freeze is implemented. Direct,
     block-local, and branch-selected scratch closure freeze are implemented.
     Direct aggregate/union constructor scratch freeze is implemented by
     materializing those constructors on persistent heap storage before scratch
     reset. Block-local scratch runtime aggregate alias promotion is implemented
     for supported known-layout fields. Block-local scratch runtime union alias
     promotion is implemented for scalar/`Text`/`Unit`, union-pointer, and
     supported aggregate-pointer payloads. Static-shaped existing aggregate
     aliases can now be planned through scratch freeze, while branch-selected
     and branch-assigned existing runtime union aliases preserve payload facts
     through scratch freeze. Broader existing owner copies and broader closure
     promotion remain pending.

7. Cleanup for compiler-created temporaries

   - Extend Core drop-plan analysis to all lowering-created unique temporaries.
     The current surface covers straight-line owner replacement, discarded
     unique expressions, final-result escape, scope-exit drops, terminal
     expression branches, branch assignment owner merges, closure-body owners,
     direct named-owner discards, direct named-owner moves, and explicit
     `return`/`break`/`continue` exit drops.
   - Direct block-expression result moves now preserve owner facts across the
     block boundary, including final `{ f }`, discarded `{ f }`,
     `let g = { f }`, and block-local owner result expressions.
   - Path-sensitive expression-branch owner results are implemented for
     expression-level `if` and `if let`: each branch scans with its own owner
     map, drops non-selected owners in branch scopes, and lets the surrounding
     expression context move, escape, or discard the selected result.
   - Insert drop/reset actions at the same proven lifetime ends used for source
     values. Scratch-backed temporaries reset with their scratch scope; unique
     heap temporaries record drops even if the first bump allocator lowers them
     to no-ops.
   - Extend cleanup/reset emission for reusable allocator/destructor paths into
     branch merges and lowering-created temporaries.
   - Remaining follow-up: extend the same owner/drop facts to future richer
     lowering-created temporaries and reusable allocator/destructor emission.
   - Prioritize temporaries introduced by runtime aggregate materialization,
     text concatenation/copy loops, union payload construction, closure
     environment setup, and future broader scratch-to-persistent promotion.

8. Baseline no-GC proof harness

   - Implemented the explicit `Core.proof(...)` and `Core.check_proof(...)`
     surface for `core-3-nonweb`, with managed storage disabled.
   - The proof reports final-result escape facts, borrow validation, explicit
     `freeze` edges, scratch cleanup/reset facts, drop facts, and lifetime
     scopes in one result.
   - Static-shaped aggregates and aggregate updates are recognized as ownerless
     compiler facts in the drop/proof path, matching the current scalarized
     Core/Wasm representation.
   - `freeze` over static-shaped aggregate values is covered by the proof gate
     as an allowed frozen/shareable edge rather than a missing unique-heap
     promotion.
   - Rejected proof issues now cover borrow failures, missing unsupported
     unique-heap freeze/promotion, rejected scratch returns, rejected
     final-result escapes, and unsupported Core codegen nodes that must fail
     before WAT emission.

- Implemented the first unsupported-codegen proof slice for unknown
  `collection_loop` statements. They now appear in `Core.proof(...)` as
  `unsupported_codegen` issues and `Core.check_proof(...)` rejects before
  `Core.emit(...)` reaches the structured-codegen fallback.
- Implemented the follow-up unsupported-codegen proof slice for preserved
  unknown field and index expressions. `Source.core(...)` can still preserve
  those expressions for structured diagnostics, but `Core.proof(...)` now
  records deterministic `unsupported_codegen` issues and `Core.check_proof(...)`
  rejects before final-result typing or WAT emission tries to inspect missing
  field/index facts.
- Implemented the unsupported-codegen proof slice for preserved unsupported
  `if let` expression and statement targets. Static union, dynamic static-union,
  and runtime-union matches remain accepted; unknown targets now produce
  deterministic `unsupported_codegen` issues before Core typing, local lookup,
  or WAT emission.
- Implemented the final-expression unsupported app proof slice. A final Core app
  expression whose call shape is not one of the supported builtins, static
  calls, closure calls, rec calls, runtime text calls, runtime-union
  materialization paths, or declared host imports now produces
  `Cannot emit core app expression yet` from `Core.proof(...)` and
  `Core.check_proof(...)` instead of throwing from Core type inference first.
- Implemented the final-expression type-value proof slice. Direct or named
  type-level Core values preserved by `Source.core(...)` now produce
  `Cannot emit core type value expression yet` from `Core.proof(...)` and
  `Core.check_proof(...)` instead of throwing from Core type inference first.
- `Core.emit(...)` and `Core.mod(...)` now run `Core.check_proof(...)` before
  WAT/module artifact emission. `Core.type(...)` remains a type-query surface
  and is not the WAT emission gate.
  - Remaining follow-up: keep broadening the proof facts as new Core features
    become accepted by WAT emission, especially runtime aggregate memory and
    host/import escape facts.
  - Add a proof audit fixture for every newly accepted memory feature. The
    fixture should prove `managed_storage` remains disabled and should expose
    the feature's storage class, lifetime id, escape decision, and cleanup/drop
    behavior.
  - Treat missing proof coverage as unfinished implementation, not as a reason
    to enable GC. If the feature cannot expose the required facts yet, keep it
    rejected with a deterministic diagnostic.

9. Optional attached regions after scratchpads

   - Treat optional region work as a follow-up to `scratch {}`. A future named
     arena may return values tied to a lifetime id only by returning an explicit
     live region owner and values that reference it.
   - Represent that attached-region escape in Core with ownership, lifetime,
     escape, and cleanup facts. Do not infer it from ordinary `scratch { ... }`.
   - Keep the MVP scratchpad semantics simple: `scratch {}` resets before the
     returned value can observe dangling scratch storage.

10. GC deferral and future managed backend profile

- Keep GC out of the baseline linear-memory path. The current task is to make
  the ownership/lifetime analysis complete enough for supported programs, not to
  compensate for missing facts with tracing.
- If ownership, borrow validity, scratch escape, freeze/promotion, temporary
  cleanup, or host/import escape behavior cannot be proven for a source program,
  the result is a deterministic compiler error before WAT emission.
- Keep managed GC or Wasm-GC as a separate future backend profile with different
  storage and boundary rules. It should not change the baseline task list or
  hide missing ownership, borrow, scratch escape, or temporary cleanup analysis.

## Task 12.3: Runtime Aggregate Memory Representation

### Problem

Static-shaped structs and objects can be scalarized or rebuilt. Runtime
aggregate values do not yet have a general pointer representation with layout
facts, so field/index access, mutation, captured aggregates, and collection
loops only work for special cases.

### Implementation

- Define a runtime aggregate fact: pointer local plus static type/layout value.
- Extend layout helpers to compute field offsets for runtime struct/object
  values using the existing `align_to`, `val_type_size`, `load_instr`, and
  `store_instr` helpers.
- Reuse `closure_heap_global` as the bump pointer for unique/frozen runtime
  aggregate allocation.
- Use the scratchpad bump pointer for values allocated inside `scratch {}` that
  do not need to escape.
- Emit aggregate constructors as heap allocation plus field stores.
- Emit field access as pointer plus offset load.
- Preserve existing static-shape scalarization for const-known values; only
  allocate when a runtime aggregate value must exist as a pointer.
- Record whether the emitted pointer is unique, frozen, borrowed, or
  scratch-backed.

### Likely Modules

- `src/core/memory.ts`
- new `src/core/runtime_aggregate.ts`
- `src/core/text_layout/build.ts`
- `src/core/expr_emit.ts`
- `src/core/expr_type/expr.ts`
- `src/core/local_facts.ts`
- `src/core/backend/analysis/local_facts.ts`
- `src/core/backend/emit/expr.ts`

### Acceptance Tests

- Runtime struct construction returns an `i32` pointer and stores scalar/Text
  fields at stable offsets.
- Field access over a runtime aggregate emits a load and round-trips through
  WAT-to-Wasm.
- Capturing a runtime aggregate in a first-class non-linear closure snapshots
  the pointer and preserves field access after shadowing.
- Missing layout facts throw deterministic errors.
- Scratch-backed aggregate pointers cannot escape unless frozen/promoted.

### Implementation Status

- Added `src/core/runtime_aggregate.ts` for standalone runtime aggregate layout
  and materialization. The layout uses the existing `align_to`, `val_type_size`,
  `val_type_align`, and `store_instr` helpers, starts standalone struct field
  offsets at `0`, and supports scalar, `Text`, union-pointer, `Unit`, and nested
  static-shaped struct fields.
- Direct use of a static-shaped struct as a runtime value now materializes a
  unique heap pointer through the shared `__closure_heap` bump pointer. Existing
  static-shaped field/index access remains scalarized and does not allocate.
- Core expression typing reports materialized aggregate values as `i32`
  pointers, while `Core.ownership(...)` and `Core.proof(...)` classify them as
  `unique_heap runtime_aggregate` with `persistent_unique_heap` final-result
  storage.
- Core local collection reserves deterministic aggregate pointer temps only when
  the aggregate itself is emitted as a value. Static field/index scalarization
  still collects only the selected field expressions.
- Tests now cover runtime aggregate pointer materialization, aligned scalar/i64
  and `Text` field stores, binding-time snapshots of runtime field values, and
  no-GC proof classification.
- Runtime aggregate local facts now track struct type facts for stored pointer
  locals across local collection, statement emission, closure typing/lifting,
  static-call planning, type annotations, text facts, and expression
  typing/emission.
- Runtime aggregate pointer locals are now visible to ownership and proof
  analysis as `unique_heap runtime_aggregate` values, rather than plain scalar
  `i32` locals.
- Field access over a stored runtime aggregate pointer now emits a pointer load
  at the field offset. Direct scalar and `Text` fields can be used after a
  first-class closure returns an aggregate pointer, for example
  `len(user.name) + user.age`. This path now has both focused Core WAT checks
  and WAT-to-Wasm round-trip coverage.
- First-class closures can capture stored runtime aggregate pointers and later
  load fields through the captured pointer. Nested runtime aggregate fields can
  also be used directly or bound as pointer aliases, including nonzero inline
  offsets such as `let name = user.name`.
- Persistent runtime aggregate pointers can now be frozen. The frozen binding
  retains aggregate type and runtime text field facts through the no-GC proof
  gate and WAT emission, can load scalar/Text fields after freeze, and rejects
  later index mutation with the frozen/shareable binding diagnostic.
- Temporary runtime aggregate values, runtime text concat results, and runtime
  union values inside an active `scratch {}` body can now allocate from
  `__scratch_heap` when the result of the scratch expression is scalar or
  otherwise scratch-free. Mixed persistent closure/aggregate/text/union heap use
  and scratch temporaries use separate globals so scratch reset does not rewind
  persistent allocations.
- Scalarized static-shaped aggregate results can now leave `scratch {}` when
  each returned field is scalar, static/frozen data, or otherwise scratch-free.
  The no-GC proof records the scratch return as an allowed frozen/shareable
  aggregate edge, and WAT emission keeps the field reads scalarized without
  emitting a scratch allocation.
- Static union cases with scratch-free payloads can also leave `scratch {}`;
  their proof edge records a frozen/shareable union result and static `if let`
  lowering keeps the payload scalarized.
- Dynamic static-union `if` results with scratch-free conditions and branch
  payloads can also leave `scratch {}`; their proof edge records a
  frozen/shareable union result, and static `if let` lowering keeps the selected
  payload scalarized.
- Returning a scratch-backed aggregate still rejects unless the value is
  explicitly frozen/promoted or proven scratch-free at the returned-field level.
  Promotion/freeze codegen and reusable allocator/destructor cleanup integration
  remain pending.

## Task 12.4: Runtime Indexing And Collection Facts

### Problem

`Core` can preserve unknown index and collection-loop nodes, but the emitter
only handles static aggregates and `Text`. Unknown runtime collections need
facts for `len`, `get`, element type, and optional index value.

### Implementation

- Add an indexable fact shape:

```txt
len: (collection) -> i32
get: (collection, i32) -> element
element_type: ValType or aggregate/union fact
```

- Lower `for x in xs` to a dynamic range loop over `0..len(xs)` plus `get`.
- Lower `for i, x in xs` similarly, binding `i` to the range index and `x` to
  `get(xs, i)`.
- Start with runtime arrays/slices or runtime aggregate-backed collections once
  Task 12.3 exists.
- Keep non-indexable unknown collections as explicit errors.
- Preserve ownership facts on indexed results: scalar values copy out, borrowed
  fields remain tied to the source lifetime, and frozen aggregate fields remain
  shareable.

### Likely Modules

- `src/core/collection_loop.ts`
- `src/core/index_expr.ts`
- `src/core/app_type.ts`
- `src/core/app_emit.ts`
- `src/core/local_facts.ts`
- `src/core/backend/entry/app.ts`
- `src/frontend/static_loop.ts`

### Acceptance Tests

- Unknown collection without indexable facts still rejects.
- Runtime indexable collection loop emits `block`/`loop` WAT and runs through
  Wasm.
- `break` and `continue` preserve carried scalar locals.
- Element type mismatch in a loop body is rejected before WAT emission.
- Borrowed loop item views cannot escape the loop body.

### Implementation Status

- Implemented the first runtime aggregate-backed collection fact slice. Stored
  runtime aggregate pointer locals with known struct layout now expose synthetic
  field expressions through the existing collection-field hook.
- `len(pointer)`, `get(pointer, i)`, `pointer[i]`, and `for i, value in pointer`
  now work for homogeneous scalar runtime aggregate fields. The emitted WAT
  loads each field from the stored aggregate pointer at the layout offset, and
  the WAT-to-Wasm test covers `len`, dynamic `get`, static index syntax, and
  loop iteration in one program.
- Homogeneous runtime aggregate `Text` fields now preserve text facts through
  dynamic `get`, static index syntax, and collection loop item bindings. This
  lets text operations such as `len(get(names, i))`, `len(names[0])`, and
  `len(name)` inside `for index, name in names` lower through Core/WAT. Mixed
  text/scalar dynamic collection item facts reject deterministically instead of
  treating text pointers as plain `i32`.
- Nested runtime aggregate fields can now act as collection sources when the
  nested struct has homogeneous scalar fields. Constructing an outer runtime
  aggregate from a nested aggregate pointer copies the nested fields into the
  inline layout, and `for index, item in user.scores` loads the nested fields
  from the stored aggregate pointer offsets.
- Borrowing a non-scalar item from a runtime aggregate-backed collection now
  records the source collection owner. A stored loop item view such as
  `view = borrow name` can be read after the loop while the collection owner
  remains live, and later mutation of that owner rejects through the normal
  borrowed-owner barrier.
- Unknown collections without facts still reject, and heterogeneous non-text
  runtime aggregate fields reuse the existing item-type mismatch diagnostic
  before WAT emission.
- Remaining follow-up: general runtime array/slice facts, dynamic loop lowering
  over unknown-length collections, borrowed item lifetime rules for future
  iterator-backed collections, and ownership merge facts for non-scalar indexed
  results.

## Task 12.5: General Memory-Backed Index Mutation

### Problem

Index assignment works for static-shaped aggregate rebuilds and runtime `Text`
byte assignment. General memory-backed mutation needs ownership/fact checks and
store emission.

### Implementation

- Require a mutable or linear/unique fact before emitting memory-backed stores.
- Reuse runtime aggregate layout facts from Task 12.3.
- Support scalar field/index stores first.
- Preserve current static rebuild behavior for pure values.
- Add bounds checks for runtime index mutation.
- Reject stores through borrowed or frozen values.

### Likely Modules

- `src/core/index_assign.ts`
- `src/core/stmt_emit.ts`
- `src/core/runtime_text.ts`
- `src/core/local_facts.ts`
- `src/frontend/index_assignment.ts`
- `src/frontend/linear_stmt.ts`

### Acceptance Tests

- Linear runtime aggregate index assignment emits a checked store.
- Non-linear non-mutable aggregate mutation is rejected.
- Frozen and borrowed aggregate mutation is rejected.
- Out-of-bounds dynamic assignment traps.
- Static aggregate rebuild tests remain unchanged.

### Implementation Status

- Implemented the first runtime aggregate field-store slices. A stored runtime
  aggregate pointer with known struct layout can now handle `target[i] = value`
  for top-level scalar, `Text`, union-pointer, and inline nested aggregate
  fields. Static indexes emit direct offset stores; dynamic indexes evaluate the
  index/value once, emit a checked branch chain, and trap through `unreachable`
  when the index is out of bounds. Dynamic stores require every possible target
  field to agree on scalar-vs-`Text`-vs-union-pointer-vs-nested facts.
- Static aggregate rebuild behavior is unchanged and still takes precedence for
  frontend-known aggregate values. Runtime `Text` byte assignment remains the
  separate byte-store path.
- Runtime aggregate union-pointer and inline nested aggregate fields are
  supported for direct and captured aggregate pointers, with matching
  union/aggregate type checks before WAT emission. Static/frozen-shareable text
  bindings now remain immutable static data and reject indexed mutation with a
  deterministic frozen/shareable binding diagnostic. Frozen unique-heap store
  facts beyond the current freeze-promotion reservation, arrays, slices, and
  reusable allocator/destructor cleanup remain follow-up work. Active borrow
  views already block mutation of the borrowed runtime aggregate owner through
  the existing borrow gate.
- Tests cover Core WAT shape, WAT-to-Wasm mutation behavior, dynamic
  out-of-bounds traps, captured scalar and `Text` mutation through inline and
  first-class closures, borrowed-owner mutation rejection, frozen/shareable
  static text mutation rejection, and deterministic rejection for text/scalar
  mismatches and mixed dynamic text/scalar target fields.

## Task 12.6: Dynamic `if let` Through Structured Core

### Problem

The Ic frontend supports several typed/direct union-if shapes. Unknown dynamic
`if let` and non-scalar branch results still reject on the Ic path.

### Implementation

- Require a known union type from annotation, local fact, helper return type, or
  runtime union pointer fact.
- Lower unknown dynamic `if let` to structured `Core.if_let` rather than Ic when
  branch results need memory, closures, or statement control flow.
- For pure scalar/Text-pointer expressions, keep existing Ic select lowering.
- For closure-valued branches, reuse first-class closure support in Core.
- Preserve current rejection for truly untyped targets.
- Merge ownership/lifetime facts across branches. Branches must produce
  compatible ownership states: both unique, both frozen, both scalar, or a
  rejected mismatch.

### Likely Modules

- `src/frontend/if_let.ts`
- `src/frontend/if_let_target.ts`
- `src/frontend/if_let_union_result.ts`
- `src/core/if_let.ts`
- `src/core/if_let_dispatch.ts`
- `src/core/expr_type/if_let.ts`
- `src/core/runtime_union_match.ts`

### Acceptance Tests

- Untyped dynamic `if let` still rejects.
- Annotated runtime union pointer `if let` with scalar branches runs through
  WAT-to-Wasm.
- Closure-valued `if let` branches compile through Core and call indirectly.
- Non-matching no-else `if let` produces the correct implicit fallback for the
  inferred result type.
- Branches that return scratch-backed values cannot escape the active
  scratchpad.

### Implementation Status

- Implemented the first closure-valued branch slice in Core. `Core` closure type
  inference, local collection, and closure emission now handle `if_let`
  expressions over direct dynamic union-if targets and stored runtime-union
  pointer targets. Matching branches can capture the bound payload in the lifted
  closure environment, non-matching branches call the else closure, and one
  annotated closure branch can establish the function type for an unannotated
  branch. WAT-to-Wasm coverage now validates both matching and fallback
  stored-runtime-union cases through `call_indirect`.

## Task 12.7: Runtime Union Payload Generalization

### Problem

Runtime union payload storage/matching is implemented for scalar, `Text`,
`Unit`, union-pointer, and aggregate-pointer struct payloads. Broader runtime
payload shapes, payload ownership transfer, and scratch escape/promotion rules
remain reserved.

### Implementation

- Extend `RuntimeUnionPayload` to reference runtime aggregate layouts from Task
  12.3.
- Store aggregate payloads as pointers first.
- Add optional inline payload storage only after pointer payloads are stable.
- Keep match binding fact-directed: payload binders should carry text, union,
  aggregate, or scalar facts.
- Preserve payload ownership facts. Matching a frozen payload yields a frozen
  value or read-only borrow; matching a unique payload must not duplicate it.

### Likely Modules

- `src/core/runtime_union_payload.ts`
- `src/core/runtime_union_payload_emit.ts`
- `src/core/runtime_union_match.ts`
- `src/core/runtime_union/`
- `src/core/backend/union/runtime/`

### Acceptance Tests

- Union case with runtime aggregate payload stores and matches by pointer.
- Nested union payload facts survive `if let` branch binding.
- Payload type mismatch fails before emission.
- Existing scalar/Text/static-shaped payload tests still pass.
- A union case cannot smuggle a scratch-backed payload outside `scratch {}`.

### Implementation Status

- Implemented the first aggregate-pointer payload slice. Struct-typed runtime
  union payloads now store an aggregate pointer at payload offset `4` instead of
  copying inline scalar leaves into the union object.
- Direct/static `if let` payload binding and runtime-union pointer matching now
  preserve scalar, `Text`, aggregate, and union-pointer facts. This covers
  nested `if let` over a union payload and `if let` over a union-valued field
  inside a runtime aggregate.
- Proof-visible allocation facts now include the aggregate pointer allocation
  emitted for directly constructed struct-typed runtime union payloads, so the
  no-GC proof reports both the runtime union object and the runtime aggregate
  payload allocation.
- Local collection now reserves setup temporaries created by static-value
  payload capture, so WAT locals match the aggregate/union temps used by
  emission.
- WAT-to-Wasm tests cover direct aggregate payload memory inspection, stored
  runtime union pointer matching, aggregate payload field loads, nested union
  payloads, union-valued aggregate fields, and frontend dynamic union struct
  payload lowering.
- Remaining follow-up: attach precise ownership/drop/freeze facts to unique
  aggregate payload transfers from existing owners, implement
  scratch-to-persistent promotion for escaping scratch-backed payloads, and
  generalize beyond struct/union pointer payload shapes only when the proof gate
  can validate the facts.

## Task 12.8: Runtime Text/String Operations

### Problem

Text support covers literals, visible concat/data pointers, runtime length,
byte-load, `get`, byte assignment, collection loops, and a Core runtime concat
subset. Broader text operations need allocation and byte-copy loops.

### Implementation

- Decide the next operations explicitly, for example runtime concat, equality,
  slice, or append.
- Reuse length-prefixed UTF-8 representation.
- Implement allocation through the shared heap pointer for escaping values and
  through the scratchpad pointer for temporary values inside `scratch {}`.
- Emit copy/compare loops in structured Core.
- Treat returned text pointers as unique, frozen, borrowed, or scratch-backed
  according to the producing expression.

### Likely Modules

- `src/core/runtime_text.ts`
- `src/core/text_facts.ts`
- `src/core/text_layout/`
- `src/core/app_type.ts`
- `src/core/app_emit.ts`
- `src/frontend/text_lower.ts`

### Acceptance Tests

- Runtime concat allocates new text and preserves source buffers.
- Equality or slice traps/checks bounds according to the chosen operation.
- Text operations inside closures preserve captured text pointers.
- Scratch-backed text cannot escape unless frozen/promoted.

### Implementation Status

- Implemented the runtime text equality slice. Core now recognizes
  `Text == Text` and `Text != Text` as runtime text operations with an `i32`
  result instead of treating text pointers as numeric operands.
- `Core.emit` lowers runtime text equality to a structured byte-compare loop
  over the existing length-prefixed UTF-8 representation. It checks lengths
  first, compares bytes with `i32.load8_u`, and inverts the boolean result for
  `!=`.
- Implemented the runtime text slice operation. `slice(text, start, end)` is a
  Core/WAT text operation over byte offsets. It validates `i32` start/end
  operands, traps when bounds are invalid, allocates a new length-prefixed text
  buffer from the selected heap, and copies bytes with a structured loop.
- The pure Ic frontend path folds statically visible text slices, including
  dynamic visible text branch operands by applying the slice to each branch and
  preserving the branch shape. Bound visible slice results remain visible to
  later `len`, indexing, equality, and nested visible operations. Runtime text
  slices still reject with a structured Core/Wasm route diagnostic. Inlineable
  unannotated helper calls that return visible slices now preserve those facts
  through bindings as well.
- Local collection reserves deterministic hidden locals for text equality loops,
  text slice loops, and backend text facts/runtime adapters expose the text
  operations through the same hook pattern used by runtime concat.
- Core function types now carry a `result_text` fact alongside `param_texts`.
  Text-producing closure calls such as a runtime `slice` helper can satisfy
  `Text` binding annotations and propagate runtime text locals through proof and
  WAT emission instead of being treated as plain `i32` values.
- The pure Ic frontend path folds visible literal text equality to `i32`.
  Equality and inequality over dynamic visible text branches now lower to nested
  `i32.select` expressions over branch-local static text comparisons, while
  runtime `Text` equality still rejects with a structured Core/Wasm route
  diagnostic.
- Text-valued `if let` expressions over statically known union cases and dynamic
  union-if targets with visible branch payloads preserve visible text facts
  through bindings, so later `len`, indexing, equality, and slice-style
  operations stay on the pure Ic path. Inlineable helper-returned text `if` and
  visible `if let` results now participate in the same pure Ic fact path.
- Runtime text slice allocation is covered by the baseline no-GC proof harness:
  `Core.proof(...).allocations` records the `slice(...)` app as a
  `persistent_unique_heap` / `unique_heap text` / `runtime_text` allocation with
  managed storage disabled.
- Implemented the `append(left, right)` text operation as a shadowable source
  builtin. Literal append and append over dynamic visible text branches fold
  through the Ic path. Bound visible append results remain visible to later
  `len`, indexing, equality, and slice operations. Inlineable unannotated helper
  calls that return visible append results preserve the same facts through
  bindings. Runtime append lowers through structured Core/Wasm using the
  existing runtime text concat allocation and copy-loop path. The baseline no-GC
  proof records runtime append as a `persistent_unique_heap` /
  `unique_heap text` / `runtime_text` allocation with managed storage disabled.
- Runtime text operation temporaries now have proof-locked drop coverage for the
  current no-op bump allocator path: discarded append temporaries emit
  `discarded_expr` drop facts, bound runtime text temporaries emit `scope_exit`
  drop facts, and the append proof fixture exposes both slice and append owner
  drops with managed storage disabled.
- Persistent runtime text `freeze` now reuses the consumed unique text buffer as
  frozen/shareable storage, exposes an allowed `freeze` proof edge, rejects
  mutation through the frozen runtime text binding, and supports direct,
  block-local, inlineable helper-returned, and branch-result scratch promotion
  shapes by copying the frozen result into persistent heap storage before
  scratch reset.
- The scratch promotion proof records the `append(...)` allocation as
  scratch-backed runtime text and the `freeze` edge as a persistent runtime text
  allocation with managed storage disabled for both
  `scratch { freeze append(...) }` and
  `scratch { let temp = append(...); freeze temp }`, and records one promotion
  edge per frozen `if` branch when the scratch result is selected by a branch.
- Remaining follow-up: broader scratch-backed escaping text promotion/freeze and
  reusable allocator/destructor cleanup beyond the current no-op bump drop
  facts.

## Task 12.9: Effectful Capability Method ABI

### Problem

Pure linear capability calls and frontend-known method-style calls work, but
unknown host-style effectful methods are intentionally rejected before Ic
lowering. A Wasm ABI is needed before lowering them generally.

### Implementation

- Define capability methods as explicit imports or as fields in a runtime
  capability object.
- Keep effects explicit: method calls consume `!cap` and return the next cap.
- Represent imported host functions in `Mod` with stable parameter/result
  signatures.
- Reject missing capability methods during type/fact checking.
- Keep frontend-known pure method calls specialized as they are today.
- Capability tokens are linear/unique values, not frozen or borrowed values.

### Likely Modules

- `src/mod.ts`
- `src/core/app_type.ts`
- `src/core/app_emit.ts`
- `src/frontend/linear_effect.ts`
- `src/frontend/builtin_call.ts`
- `src/frontend/linear_stmt.ts`
- `src/frontend/source.ts`

### Acceptance Tests

- `io = io.print("hello")` lowers to an imported function call with explicit
  token threading.
- Discarding the returned capability still fails linear validation.
- A narrowed capability object exposes only passed methods.
- Missing host method facts produce deterministic errors.

## Task 12.10: First-Class Linear Closure Captures

### Problem

Non-linear first-class closure storage exists. General first-class closures that
capture linear values remain reserved because closure environments currently
snapshot values that may be duplicated or called more than once.

### Implementation

- Represent a stored closure as a function/table target plus an environment
  pointer and an environment layout fact.
- Mark each environment slot with ownership and lifetime facts. Frozen captures
  may be shared, unique captures move into the environment, borrow captures are
  valid only while the borrow lifetime outlives the closure value, and
  scratch-backed captures require a non-escaping proof.
- Distinguish reusable closure values from linear closure values in Core facts
  before WAT emission.
- Mark closures that capture linear values as linear closure values.
- A linear closure call must consume the closure exactly once.
- Store captured linear values in the closure environment without exposing copy
  paths.
- Reject aliasing, duplication, or branch paths that call the same linear
  closure more than once.
- Start with direct first-class calls, then add closure-valued branches.
- A closure may capture a frozen value freely, may borrow only within the borrow
  lifetime, and may capture a unique value only if the closure itself becomes
  linear.

### Likely Modules

- `src/frontend/linear_closure.ts`
- `src/frontend/linear_expr.ts`
- `src/frontend/linear_stmt.ts`
- `src/core/closure_capture/`
- `src/core/closure_emit.ts`
- `src/core/closure_type/`

### Acceptance Tests

- A closure that captures `!io` can be called once and returns the next `io`.
- Calling or storing the same linear closure twice fails validation.
- Branches must consume the same linear captures.
- Non-linear closure tests continue to use ordinary reusable closure values.
- Capturing a scratch-backed value is rejected unless the closure cannot escape
  the scratchpad.

## Task 12.11: Broader Structured-Core/Wasm Cleanup

### Problem

The codebase still contains intentional `Cannot ... yet` diagnostics in Core
typing and emission. Some are real reserved features; others should become more
specific after the tasks above land.

### Implementation

- Audit each remaining `Cannot ... yet` diagnostic after Tasks 12.1-12.10.
- Convert broad diagnostics into feature-specific errors.
- Add tests proving each remaining unsupported node is either unreachable from
  valid source or deliberately reserved.
- Keep parser-reserved language-family features rejected.

### Likely Modules

- `src/core/expr_emit.ts`
- `src/core/stmt_emit.ts`
- `src/core/expr_type/expr.ts`
- `src/core/app_emit.ts`
- `src/core/app_type.ts`
- `src/frontend/expr_lower.ts`
- `src/frontend/stmt.ts`

### Acceptance Tests

- Every remaining unsupported source feature has a test.
- Every remaining Core unsupported emitter/type path has a deterministic
  diagnostic.
- Full format, typecheck, and test suite pass.

## Locked Defaults

- Dynamic loops, memory-backed aggregates, and effectful capabilities remain
  Core/Wasm-only. The Ic path stays pure and graph-oriented.
- Runtime heap aggregates are unique by default.
- `borrow expr` creates a read-only view with block, loop-iteration, function
  call, or scratchpad-bounded lifetime.
- `freeze expr` consumes a unique value and produces immutable shareable data.
- `scratch { ... }` is a temporary arena scope with a return value, not a
  general ownership container.
- Optional region-like scopes should be modeled as scratch/arena lifetimes with
  explicit return-value escape facts, not as implicit GC-managed storage.
- Scratch-backed values cannot escape unless proven scratch-free or explicitly
  frozen/promoted.
- If scratch escape analysis is hard or uncertain, reject. Do not add a GC
  fallback to the default backend.
- Cleanup for lowering-created temporaries must be inserted from ownership and
  lifetime facts before WAT emission.
- A future Wasm-GC backend may use managed GC values, but that is a separate
  target from the baseline linear-memory backend.
- Scratch pointer reset must be emitted on every structured exit edge.
- Unique heap drop points should be computed even if the initial bump allocator
  makes them runtime no-ops.
- The first capability ABI should use direct Wasm imports per method.
- Keep the hybrid aggregate model: scalarize static/known aggregates and
  allocate only runtime/escaping aggregates.
