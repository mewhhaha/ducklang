# Const, Comptime, And Specialization

## Goal

Implement the draft's compile-time model: `const`, `comptime`, const functions,
const parameters, and specialization.

## Source Sections

- Runtime, Static Knowledge, and Compile-Time Execution
- Const functions
- Const Parameters and Specialization

## Work

- Parse and represent `const` bindings as compiler-known values.
- Parse and evaluate `comptime expr` during compilation.
- Represent const functions as statically known closures with known code and
  known captured const environment.
- Support `const` parameters:

```txt
let map = (xs, const f) => { ... }
```

- Require const parameters to be known at the call site.
- Specialize functions when const parameters are passed.
- Allow const values to be reified as runtime values when passed to ordinary
  runtime parameters.

## Snake Case Examples

```txt
const make_adder = n => {
  x => x + n
}

const add_three = comptime make_adder(3)

let y = add_three(input)
```

```txt
const double = x => x * 2
let ys = map(xs, double)
```

## Acceptance Criteria

- `const` values are available to type checking and specialization.
- `comptime` executes only compiler-known computations.
- Const functions cannot capture runtime values.
- Const parameters reject runtime-only arguments.
- Specialized call output no longer needs runtime structural dispatch.

## Verification

- Add tests for successful and failing `comptime` evaluation.
- Add tests for const closure capture rules.
- Add specialization tests showing `map(xs, double)` can produce a specialized
  body.

## Implementation Status

- Implemented for compiler-known values, const closures with binding-time
  capture environments, const parameters, `comptime`, specialization, and
  reification of const values passed to ordinary runtime parameters. Simple
  const block values can resolve to union cases and type-values before Ic
  lowering.
- Const functions may execute supported compile-time control flow, including
  static loops and assignments.
- Tests cover successful and failing `comptime`, const binding and closure
  capture snapshots, const capture rejection, const-parameter rejection for
  runtime values, and specialized calls.
- Runtime parameter annotations on scalar values are checked at call-site
  specialization when the argument type can be proven by the current frontend.
  Frontend runtime binding and parameter annotations can also provide explicit
  scalar, text, struct, or union type context for otherwise unknown runtime
  values. Structured Core preserves closure parameter annotations and checks
  built-in scalar/type parameter annotations when static calls are inlined.
  Direct struct/union type-value parameter annotations provide static call
  argument context in Core.
- Core scoped static-call expression rewriting lives in
  `src/core/static_call_rewrite.ts`, statement/block rewriting and
  replacement-name shadowing live under `src/core/static_call_rewrite/`, and
  static-call contexts, arity checks, target discovery, and scoped planning live
  under `src/core/static_call/`, separate from backend static-call adapter glue
  and WAT emission.
- Runtime structural dispatch is intentionally excluded; generic and duck-typed
  paths are specialized before lowering.
