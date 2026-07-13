# Guard clauses on `if let`

## Status

Proposed, ready for design review.

## Summary

Add an optional guard clause to `if let`, so a pattern match can be
conditioned on a boolean expression over its own bindings before the arm is
taken:

```txt
if let .some(value) = maybe if value > 0 {
  value
} else {
  0
}
```

If the pattern doesn't match, or the pattern matches but the guard is false,
control falls through to `else`/`else if` exactly as a non-matching pattern
does today.

## Motivation

IDEAS.md proposed a new top-level `match` construct:

```txt
match x
| ... if ... =>
```

The council's consensus (theory, consistency, cost, and skeptic reviewers all
converged independently) is that the only real gap in the current language is
the guard — `if let` / `else if let` chains already cover literal patterns,
union-case patterns with payload binding, and narrowing via `value is T`. A
parallel `match` keyword would duplicate that machinery for no new
expressiveness. Adding a guard to the existing form gets the one missing
capability without a second branching construct for readers to choose
between.

## Current state

- `if let PATTERN = target { ... } else { ... }` exists today, chainable via
  `else if` / `else if let` (docs/language.md, "Functions And Control Flow").
- No guard clause exists. A guard today has to be written as a nested `if`
  inside the arm, which loses the `else`-fallthrough-on-failure behavior a
  real guard gives you.
- There is no `match` keyword anywhere in the parser, tree-sitter grammar, or
  docs.

## Proposed design

- Extend the `if let` grammar with an optional `if <expr>` guard between the
  pattern binding and the block, both in statement and expression position.
- **Ownership rule (from the theory review):** the guard expression sees the
  pattern's bindings as borrows only, not as owned values. Ownership of the
  matched payload transfers to the arm body's bindings only once the guard
  evaluates true and the arm is committed. This is required so that a false
  guard can fall through to `else`/`else if` with the scrutinee still intact —
  the same discipline the existing failed-match fallthrough already relies
  on, just stated explicitly for guards.
- Reuse the existing pattern grammar (literal patterns, union-case patterns)
  unchanged — this is additive to `if let`, not a new pattern language.

## Open questions

- Exact token placement/spelling of the guard (`if let P = x if G { }` reads
  a little dense with two `if`s in a row) — worth a short bikeshed before
  implementation, but the semantics above should hold regardless of spelling.
- Whether guards should be allowed to call arbitrary functions or only
  pure/const expressions (affects whether a guard call can have effects that
  make "falling through" observable).

## Touches

Additive change, no migration of existing code:

- `tree-sitter-ix/grammar.js` + associated query files (new optional guard
  in the `if_let` rule)
- hand-written parser (`src/frontend`, wherever `if let` is parsed)
- pattern/guard lowering to IC (borrow semantics above)
- `docs/language.md` ("Functions And Control Flow" section)
- LSP/formatter should fall out of the grammar change with minor updates

No existing examples need to change; this is a strict syntax addition.

## Explicitly out of scope

- A standalone `match` keyword/expression — rejected by the council as
  duplicate machinery; revisit only if a concrete need for exhaustiveness
  checking emerges that `if let` chains genuinely can't express.

## Council verdict summary

| Lens | Verdict | Note |
|---|---|---|
| Theory (IC/HVM4) | Adopt-with-changes | Fine if guards borrow, not consume, the scrutinee |
| Consistency | Adopt-with-changes | Justify only on guards; reuse existing pattern grammar; watch `\|` overload if ever combined with sum syntax |
| Cost | Adopt-now | Net-new, additive, desugars onto existing `if let`/union-pattern machinery; lowest-risk proposal reviewed |
| Skeptic | Defer → narrowed to this | Two parallel branching constructs would be worse than one enhanced one; this scoped version addresses that objection |
