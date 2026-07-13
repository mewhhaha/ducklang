# Fixed-size homogeneous array type

## Status

Proposed, ready for design review.

## Summary

Add a genuinely new fixed-size, single-element-type array type, spelled
`[T; N]`, alongside — not replacing — the existing bracket product syntax:

```txt
type Row3 = [I32; 3]
let values: Row3 = [1, 2, 3]

values[0]
```

## Motivation

IDEAS.md proposed reserving `[]` exclusively for arrays and moving the
existing product syntax to parens:

```txt
Maybe we change our [.a = I32, .b = I32] to use tuples instead like
(.a = I32, .b = I32) ... and [] can be reserved for same element arrays
```

The council converged (3 of 4 reviewers independently, theory being the lone
dissent that the full swap is *also* fine) that the bracket-to-paren rename
is not worth doing: `[.a = I32, .b = I32]` is freshly-shipped, documented as
"the experimental row syntax," and already wired through the tree-sitter
grammar, both parsers, the formatter, and the LSP. Renaming it would be a
breaking migration (12+ example files under `examples/data/`, ~200+ files
touching products across both lowering routes) purely to make room for a
feature — arrays — that nothing currently demands and that doesn't need the
rename at all: `[T; N]` is unambiguous against existing product forms
(`[T, T2]`, `[.a = T, .b = T]`) purely by the presence of the `;`, so arrays
can be added without touching a single existing `[.` site.

This also directly enables the array head/tail destructuring idea from
IDEAS.md (`[.head = I32, ...tail = [I32; _]]`), which every reviewer flagged
as blocked on this type existing first — see "Explicitly out of scope" below.

## Current state

- Products/tuples already use `[…]`: `type Vec3 = [.x = Int, .y = Int, .z =
  Int]`, `type Pair = [Int, Int]`, indexable by name or position.
- No fixed-size or homogeneous array type exists. The closest existing
  concept is the "homogeneous runtime-index rule" for products (docs/
  language.md: "Runtime indexes retain the existing homogeneous runtime-index
  rule: every selectable slot must have a compatible value type") — arrays
  are a natural generalization of that rule to an arbitrary/inferred size,
  rather than an unrelated new concept.

## Proposed design

- New type-level form: `[T; N]` where `T` is a type and `N` is a constant
  (const-evaluable) length.
- Disambiguate from existing product forms at parse time using the `;`:
  a product never contains one, so `[T; N]` cannot collide with `[T, T2]` or
  `[.a = T, ...]`.
- Runtime representation: a labeled `DUP` over elements for duplication, and
  elementwise erasure — consistent with how products already erase/duplicate
  today (per theory review, no new IC interaction needed).

## Open questions

- **Value literal syntax is unresolved.** `[1, 2, 3]` already denotes a
  positional product literal today, so a plain enumerated array literal is
  ambiguous with a positional product without a type-directed context.
  Candidates to resolve during design:
  - Only allow array literals where a `[T; N]`-typed context is already
    known (annotation, parameter type, or return type) — consistent with how
    struct literals already rely on contextual typing.
  - A distinct repeat/fill literal for the common case, e.g. `[value; N]`
    for an N-length array of one repeated value, leaving fully-enumerated
    array literals to lean on context as above.
- Whether `N` may ever be a non-literal const expression, and how that
  interacts with `comptime`.

## Touches

Additive change, no migration of existing code:

- `tree-sitter-ix/grammar.js` + query files (new array-type rule, distinct
  from the existing product rules)
- hand-written parser (new type-level form)
- type-checker (`size_of`/`align_of`/`layout` builtins already exist for
  struct/union type-values and should extend naturally to arrays)
- IC/Core lowering for array duplication/erasure
- `docs/language.md` ("Types, Structs, Unions, And Facts") and
  `docs/coverage.md`
- LSP/formatter updates following the grammar change

No existing examples need to change.

## Explicitly out of scope (for this task)

- **Renaming existing products to parens.** Rejected by the council; keep
  `[.a = I32, .b = I32]` exactly as-is.
- **Head/tail array destructuring** (`[.head = I32, ...tail = [I32; _]]`
  from IDEAS.md). Blocked on this task shipping, and on a separate open
  design question the theory review raised: is a destructured `tail` an
  owned array (a move, splitting one owner into two disjoint ones) or a view
  aliasing the original's backing storage (which would require the source to
  be `#` frozen, or `tail` to be an explicit `&` borrow, to stay affine-safe)?
  Revisit once this array type exists and a concrete program needs it — do
  not design the destructuring pattern speculatively ahead of that.
- `[T; _]` (inferred/unknown length) is a different, dynamically-sized
  construct, not a fixed-size array, and is out of scope here.

## Council verdict summary

| Lens | Verdict | Note |
|---|---|---|
| Theory (IC/HVM4) | Adopt | Pure surface syntax; theory-neutral under affinity/dup-sup/authority either way |
| Consistency | Reject the swap; array need is real | Add `[T; N]` without renaming products; disambiguate via `;` |
| Cost | Defer full swap; adopt-later if scoped to arrays only | Renaming products has the highest migration surface reviewed; arrays alone are cheap and additive |
| Skeptic | Defer, blocked on unproven need | If arrays are ever needed, add `[T;N]` and keep products in `[]` — cut the rename |
