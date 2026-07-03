# Extensions And Protocol Fact Checkers

## Goal

Implement `with` extensions and protocol-like abstractions as ordinary const
fact checkers.

## Source Sections

- Extending Type Values
- Protocols as Fact Checkers
- applicative
- monad

## Work

- Parse and evaluate `with` extension objects.
- Ensure `with` creates a new extended const value and shadows the previous
  name.
- Keep extensions lexical, not global.
- Implement fact checkers for extended type-values.
- Support protocol examples:

```txt
const functor = f_type => { ... }
const applicative = f_type => { ... }
const monad = m_type => { ... }
```

- Support generic functions constrained by const fact checkers:

```txt
let fmap = (const f_type: functor, fa, const f) => {
  f_type.map(fa, f)
}
```

## Acceptance Criteria

- `option_type = option_type with { ... }` shadows the previous `option_type`
  binding without mutation.
- Extended values are callable if the original value was callable.
- Static fields like `option_type.map` resolve after extension.
- `functor(f_type)` succeeds only when `f_type` exposes the expected `map`
  operation.
- `applicative` can depend on `functor`; `monad` can depend on `applicative`.
- Generic protocol-checked functions specialize before code generation.

## Verification

- Add tests for `with` shadowing.
- Add tests for extension field lookup.
- Add fact-checker tests for `functor`, `applicative`, and `monad` shapes.
- Add specialization tests for `fmap(option_type, a, inc)`.

## Implementation Status

- Implemented `with` extension objects, lexical shadowing of extended const
  values, binding-time extension field capture, extension field lookup, callable
  extended type constructors, and protocol-like const fact checkers.
- Tests cover extension lookup, binding-time extension field capture, computed
  facts through extensions, nested fact-checker execution, protocol failure
  diagnostics, and `functor`/`applicative`/`monad`-style specialization.
