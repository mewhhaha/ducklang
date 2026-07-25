# AGENTS.md

## Goal

Build a functional source-language toolchain in Deno with one compiler target:

```txt
Source -> frontend -> semantic Core -> gpufuck Functional Core -> Wasm
```

Duck owns parsing, source elaboration, semantic checks, and Core construction.
Gpufuck owns semantic compilation and Wasm emission. Do not add another Duck
Wasm backend or a separate WAT route. The project should stay inspectable while
it grows. Prefer explicit compiler stages over clever abstractions.

## Style rules

- Do not use ternary expressions. Type-level conditionals are fine.
- Do not use the nullish coalescing operator.
- Do not silently default when compiler information is missing.
- Prefer explicit `if` blocks over compact expressions when the branch matters.
- Use `expect(value, message)` directly at invariant sites.
- Define `expect` as an assertion helper for its first argument so TypeScript narrows after it succeeds.
- Do not hide `expect` behind tiny wrapper helpers such as `expectType` or `expectArity`.
- If a helper function only calls another function or performs one trivial lookup, inline it at the call site.
- Keep semantic operations separate from concrete Wasm instructions.

The first two are enforced by `deno lint` through `scripts/lint_rules.ts`, so
they fail in CI rather than in review. Add a rule there whenever a style rule
becomes mechanically checkable.

## Invariants and diagnostics

These are different failures and get different treatment.

An **invariant** is a fact the compiler must already know: a binding that has to
be in scope by this pass, a type that has to have been resolved. If one is
missing the compiler is wrong, not the source, so throw — `expect(value,
message)` at the site.

A **diagnostic** is a problem with the user's program. Those return a verdict
instead of throwing, so a pass reports everything it found rather than stopping
at the first problem. `src/frontend/checked.ts` defines `Checked<value>`, a
`Validation` over an accumulating diagnostic semigroup:

```ts
const arity = check_arity(name, expected, actual, node);
const arguments_checked = call.args.map((arg, index) => check_argument(arg, index));

return all([arity, ...arguments_checked]);
```

Do not thread a mutable `SourceDiagnostic[]` through new code. Where existing
passes still do, `diagnostics.push(...diagnostics_of(check))` bridges the two
so a conversion can proceed one function at a time.

Accumulating is not the same as reporting everything. A check that cannot infer
a type returns `ok_unit()` and stays silent, so one root cause is reported once
instead of cascading into every expression derived from it. Keep that: it is
what `semantic validation keeps nested width errors structured and singular`
covers.

## Tests

Use Deno tests and keep them next to the implementation they cover:

```txt
src/frontend/parser.test.ts
src/core/from_source.test.ts
experiments/gpufuck/compiler.test.ts
```

When changing source lowering, cover the exact semantic Core shape when
possible and execute the behavior through `DuckCompiler` when it reaches the
target boundary.

Use the local helpers in `src/assert.ts` instead of adding external test dependencies.

## Numeric literals

Numeric literals must carry their value type in semantic Core. Do not silently default source numbers to `i32` during lowering.

Prefer this shape:

```ts
{ tag: "num", type: "i32", value: 21 }
```

Use `i64` explicitly for 64-bit literals:

```ts
{ tag: "num", type: "i64", value: 21n }
```

## Primitive operations

Represent primitive operations as explicit primitive nodes, not as top-level tags.

Prefer this shape:

```ts
{ tag: "prim", prim: "add", args: [left, right] }
```

Do not represent each operation like this:

```ts
{ tag: "add", left, right }
```

The primitive table owns metadata such as display text, arity, and typed Wasm instructions. This keeps the tree shape stable when adding more primitive functions.

Check arity from the table when formatting, reducing, lowering, or emitting:

```ts
const expected = arity(expr.prim);
expect(expr.args.length === expected, "error message");
```

Numeric primitive calls may fold during source evaluation, but runtime
primitive behavior must remain explicit for the gpufuck target.

Do not use an `isOp` style type guard to detect primitive names as tags.

## Typeclasses

Compiler traits are typeclasses built on `@mewhhaha/typeclasses` (JSR). The trait definitions live in `src/trait.ts`: each trait exports its structural type, a token symbol, and a typeclass object created with the library's `typeclass()` whose static methods dispatch through the instance registered under the token.

```ts
export const format_typeclass = Symbol("ducklang.Format");

export type Format<self> = {
  fmt: (value: self) => string;
};

export const Format = typeclass(format_typeclass, {
  register<self>(impl: Format<self>): void {/* install_instance */},
  fmt<self>(impl: Format<self>, value: self): string {/* dispatch */},
});
```

`src/trait.ts` defines two traits: `Format` (`fmt`, plus a derived `all`) and
`Callable` (`type`, plus a derived `arity`). `src/op.ts` is the reference
implementation. Derived methods live on the typeclass and dispatch through
`this`, so instances supply only the primitive members — never re-implement a
derived method on the companion.

Define the data type and an empty function with the same exported name. The
function is the namespace-like value that instances are installed onto:

```ts
export type Prim =
  | { tag: "num"; type: ValType; value: number | bigint }
  | { tag: "var"; name: string };

export function Prim() {}
```

Attach methods directly to the function, one per trait member:

```ts
Prim.fmt = function fmt(prim: Prim): string {
  if (prim.tag === "num") {
    return prim.value.toString() + ":" + prim.type;
  }

  if (prim.tag === "var") {
    return prim.name;
  }

  prim satisfies never;
  throw new Error("panic");
};

Prim.type = function type(prim: Prim): CallableType<ValType> {/* ... */};
```

`Callable.arity(Prim, p)` then works without `Prim` defining `arity` — the
typeclass derives it from `type`.

Register the companion at the bottom of the implementation file, after every
method is assigned. Registration checks the trait shape structurally and
installs the instance under the typeclass token:

```ts
Format.register<Prim>(Prim);
Callable.register<Prim, ValType>(Prim);
```

Call sites keep the explicit dictionary shape: `Format.fmt(Prim, node)`. Registering `Format` also installs the library's `Show` instance, so wrapped values created with `as_data(Prim, node)` work with the library's `Show.show`. Do not keep registrations in `main.ts`. Do not replace this pattern with object literals or constructor casts.

New traits belong in `src/trait.ts`, where `register` calls `install_instance` and each method dispatches with `call_typeclass_method`. Keep the dispatch helpers there rather than spreading them across implementation files.

`@mewhhaha/typeclasses` is excluded from the `minimumDependencyAge` gate in `deno.json` so fresh releases of first-party packages resolve immediately; other dependencies stay behind the age gate.
