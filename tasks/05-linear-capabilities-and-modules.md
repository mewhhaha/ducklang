# Linear Capabilities And Modules

## Goal

Implement explicit capabilities, linear values, and modules as functions from
dependencies to exports.

## Source Sections

- Linear Values and Capabilities
- Modules
- Break, Continue, and Linear State

## Work

- Parse linear parameters and bindings marked with `!`.
- Track linear values so they are consumed exactly once along every control-flow
  path.
- Model capabilities as ordinary objects with methods that consume and return
  capability values.
- Reject discarded linear results.
- Support capability narrowing by passing smaller objects.
- Represent modules as functions from dependency objects to export objects.
- Keep source-level linear capability checking aligned with the Core ownership
  model. Linear capabilities are explicit exactly-once values, while ordinary
  runtime heap values are unique/move-only by default when represented as
  `unique_heap`; both should share control-flow state machinery where useful
  without making all unique heap values source `!` capabilities.
- Treat capability tokens as unique linear values that cannot be frozen or
  borrowed as shareable data. Capability objects may expose bounded-borrow
  methods for ordinary data arguments, but the capability token itself still
  threads linearly from call to call.
- Treat unknown host/import capability calls as escaping their non-scalar
  arguments unless the signature explicitly marks those arguments as bounded
  borrows.

## Snake Case Examples

```txt
let main = (!io) => {
  io = io.print("hello")
  io
}
```

```txt
module logger = caps => {
  let log = (!io, msg) => {
    io = caps.print(!io, "[log] " + msg)
    io
  }

  {
    log: log
  }
}
```

## Acceptance Criteria

- A linear value must be consumed exactly once on every path.
- `io = io.print("hello")` is valid.
- `io.print("hello")` followed by another use of `io` is invalid.
- Module imports do not grant effects by themselves.
- Only passed capability objects grant effects.
- Capability narrowing prevents access to omitted operations.
- Linear capability calls, unique-owner moves, and borrowed-owner barriers use
  compatible path-sensitive state rules across branches and loops.
- Unknown imported capability methods reject borrowed, unique, or scratch-backed
  arguments unless the method signature has explicit bounded-borrow or ownership
  transfer facts.
- Known Core host imports with bounded-borrow contracts can accept explicit
  `borrow` views without transferring ownership; direct unique-owner transfer is
  accepted only through explicit ownership-transfer contracts and records a
  `host_transfer` drop-plan fact.

## Verification

- Add linearity tests for valid rebinding and invalid discarded results.
- Add branch/path tests for linear consumption.
- Add module tests showing explicit capability passing.

## Implementation Status

- Implemented linear parameter and pure linear `let`/`const` binding parsing,
  linear-use validation, path-sensitive branch validation, and pure linear
  functions and bindings that can lower to Ic, including pure specialized calls
  with linear parameters. Reserved linear effect detection lives in
  `src/frontend/linear_effect.ts`, separate from path-sensitive statement
  consumption validation in `src/frontend/linear_stmt.ts`, expression
  consumption in `src/frontend/linear_expr.ts`, and shared carried-state helpers
  in `src/frontend/linear_state.ts`. `src/frontend/linear.ts` remains the public
  linear facade. Local/aliased/simple-block/static branch linear closure
  tracking lives in `src/frontend/linear_closure.ts`.
- Implemented pure explicit capability-function calls through const-specialized
  dependency objects, so a field such as `caps.bump` can consume and return a
  linear value when it is an ordinary frontend-known function. Frontend-known
  linear runtime receiver bindings can also use method syntax, with the receiver
  passed as the implicit first argument, including direct specialized calls
  where the linear argument resolves to a frontend-known capability object.
  Ordinary object function fields remain ordinary function values and receive
  only their explicit call arguments.
- Implemented modules as functions from explicit dependency objects to export
  objects, with tests for capability narrowing.
- Tests cover valid rebinding, valid pure linear `let` and `const` binding
  consumption, invalid discarded linear results, branch/path behavior, pure
  specialized linear calls, direct non-escaping simple-block linear closure
  captures, explicit capability-function calls, frontend-known method-style
  capability calls, specialized known-capability method calls, module
  specialization, and rejection when a narrowed capability is missing an
  operation.
- Source `import` statements are resolved by `Source.load`/`Source.compile_file`
  before Ic lowering, with tests for imported module use and missing exports.
- Unknown effectful method-style capability lowering is intentionally reserved;
  current diagnostics reject unknown host-style methods before Ic lowering.
- The first Core host/import boundary slice is implemented below the source
  module layer: `Core.host_imports` records scalar and bounded-borrow argument
  contracts, `Core.proof(...).host_boundaries` reports the matched signature and
  per-argument decision, and `Core.mod(...)` emits the WAT import/call. Direct
  ownership-transfer contracts are also implemented for `unique_heap` owners and
  record `host_transfer` facts in `Core.drops(...)`. Direct use-after-transfer
  diagnostics are implemented in `Core.proof(...)`. Core-level host-returned
  owner contracts are implemented for imported results. Scratch-backed Core
  import arguments accept explicit bounded borrows and reject ownership
  transfer. Source syntax for declaring scalar numeric ABI contracts, `Text`
  ownership contracts, explicit non-`Text` pointer owner reasons, and
  user-defined aggregate/union owner references is implemented. Deeper
  interprocedural transfer analysis, dynamic higher-order wrappers, truly
  self-recursive transfer shapes, and any intentional scratch-backed
  cross-boundary promotion policy remain pending.
