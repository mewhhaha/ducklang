# Bindings, Shadowing, And Core Syntax

## Goal

Implement and document immutable values with source-name shadowing.

## Source Sections

- Bindings and Shadowing
- Binding forms
- Minimal Grammar Sketch

## Work

- Parse runtime bindings:

```txt
let x = expr
```

- Parse same-type shadowing:

```txt
x = expr
```

- Parse type-changing shadowing:

```txt
x := expr
```

- Lower source-name shadowing to fresh internal bindings:

```txt
let x = 2
x = 3
x := "hello"
```

becomes:

```txt
let x#0: Int = 2
let x#1: Int = 3
let x#2: Text = "hello"
```

## Acceptance Criteria

- `let` creates a new binding in the current scope.
- `=` shadows an existing source name and rejects type changes.
- `:=` shadows an existing source name and permits type changes.
- Uses of a source name resolve to the latest binding in scope.
- Internal names are fresh and deterministic.

## Verification

- Add parser tests for `let`, `=`, and `:=`.
- Add resolver/lowering tests showing fresh internal names.
- Add type tests proving `=` rejects `Int -> Text` while `:=` accepts it.

## Implementation Status

- Implemented in the `Source` frontend parser and lowerer.
- `let`, same-type `=`, and type-changing `:=` shadowing lower to deterministic
  fresh Ic names. Same-type `=` preserves explicit frontend runtime type context
  when assigning otherwise unknown values. Frontend binding, assignment, and
  index-assignment shadowing live in `src/frontend/stmt/binding.ts`, behind the
  public statement-lowering facade in `src/frontend/stmt.ts`.
- The `Source -> Core` path also freshens sequential type-changing `:=`
  shadowing into new Core bindings before WAT emission, including closure-local
  shadows, so fixed-type Wasm locals are preserved.
- Tests cover fresh-name lowering, same-type rebinding, type-changing rebinding,
  Core/WAT type-changing shadowing, and rejection of accidental type changes
  through `=`.
- Same-type `=` now treats function parameter shape as part of equality:
  compatible function shadows must keep arity, `const`/linear flags, and
  annotation shape, while parameter names can differ. Built-in integer
  annotation aliases such as `Int`, `I32`, and `U32` normalize to the same i32
  parameter type. Regression tests cover arity changes, wrapper-preserved
  function values, dynamic function values, and annotated `Text` versus
  unannotated numeric closures.
- Same-type `=` now also checks known struct field-type facts. Struct shadows
  with identical field names but incompatible declared field payload types
  reject as type changes, while built-in integer field aliases such as `Int` and
  `I32` remain compatible. Anonymous object literals now expose shallow
  field-type facts when every field has a simple known type such as `Int`,
  `I64`, or `Text`, so anonymous/typed struct shadowing uses the same guard.
- Shorthand union cases now expose payload facts when the payload has a simple
  known type. Same-case shorthand union shadows such as `.ok(1)` to `.ok("Ada")`
  reject as type changes, while same payload types continue to rebind normally.
- Integer literals carry an Ic value type; source supports explicit `i32` and
  `i64` suffixes, while unsuffixed literals currently remain the MVP `Int`/i32
  convention. Runtime `I64` binding and parameter annotations also retag
  parse-time-default numeric primitives to i64 operations when both operands are
  known i64 values, including chained arithmetic whose intermediate primitive
  was parsed before the operand facts were known, dynamic branches whose result
  type depends on those retagged primitives, and no-else expression fallbacks
  whose integer zero must match an inferred `I64` then-branch.
- Frontend numeric literal parsing, truthiness lowering helpers, primitive
  result typing, and numeric primitive operand validation live in
  `src/frontend/numeric.ts`, with the main lowerer supplying expression
  inference and annotation-derived numeric facts.
- Binding annotations are preserved and checked for built-in scalar/type names
  in both the frontend and structured Core path. Direct struct/union type-value
  annotations provide shorthand aggregate context in both paths. In the frontend
  Ic path, explicit runtime binding annotations can also provide scalar, text,
  struct, or union type context for otherwise unknown runtime values. The
  structured Core path rejects unsupported annotations explicitly instead of
  treating them as comments. Fact-checker annotations over const or
  frontend-known aggregate values are checked in the frontend. Frontend
  annotation checks live in `src/frontend/annotation_check.ts`, with
  `src/frontend/annotations.ts` kept as the public annotation facade.
- Text literals lower to Ic text values and then to Expr `i32` pointers into
  length-prefixed UTF-8 module data.
- Visible text literals, bindings, fields, indexes, const-call results, simple
  block-local values, and dynamic text branches concatenate with `+` when both
  operands are visible.
- Text-typed values are rejected as numeric primitive operands unless the
  expression is a fully visible text concatenation, and other known non-numeric
  values are rejected before primitive Ic lowering.
- Core preserves visible text concatenation under the same rule and emits the
  resulting text values as length-prefixed UTF-8 data pointers.
- `len` over frontend-visible text values lowers to Ic `i32` byte lengths,
  including dynamic text `if` branches and dynamic indexes over visible text
  fields whose alternatives are visible.
- `len` over runtime values known to have type `Text` lowers through Ic to an
  `i32.load` from the length-prefixed text pointer, with WAT-to-Wasm coverage.
- `get(value, index)` over runtime values known to have type `Text` lowers
  through Ic to the same bounds-checked byte load as `value[index]`, with
  WAT-to-Wasm coverage.
