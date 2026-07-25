# TASKS

Planned work on Ducklang, and the coherence it is meant to produce.

Entries cite `file:line` so a claim can be checked rather than believed. Each is
marked **verified** (reproduced by running it) or **hypothesis** (read from the
code, not yet demonstrated). Do not promote a hypothesis without a repro.

## The principle everything is judged against

> The parts other languages wire into their compiler — arithmetic operators,
> type algebra, `derive`, effect handling — are ordinary Ducklang declarations
> here, and the compiler specializes them away before anything reaches the
> target.

Two consequences the current implementation does not fully honour:

1. **If a feature is a declaration, it must compose like one.** A `duck` or an
   `effect` that works in some syntactic positions and not others is not really
   an ordinary declaration; it is a builtin wearing a declaration's clothes.
2. **The prelude is the proof.** It is written in Duck and compiled by this
   compiler, so whatever the prelude cannot express cleanly is a hole in the
   language, not a library problem.

Most items below are one of those two failing.

## 1. Effects should work in every loop form

The pitch is effects and handlers. Today they work in some loops.

- [x] **Effects in collection loops.** `for item in collection { <effects> }`
      was rejected while `for index in 0..n` compiled. Fixed in `63be37c` by
      rewriting to the indexed range form; covered by
      `examples/handlers/05_effects_in_collection_loop.duck`. **verified**
- [x] **Effects in cursor loops (`List` and any `Iterator` duck).** Fixed in
      `58a81ae`; the hypothesis below was right but incomplete — it also
      required fixing `break` re-entering CPS loops. Covered by
      `examples/handlers/06_effects_in_cursor_loop.duck`. Original note: Fails
      with `Effect operation requires CPS elaboration`. Root cause:
      `statement_has_direct_duck_effects`
      (`src/frontend/handler_elaborate.ts:3677`) only recurses into `if_stmt`
      and `if_let_stmt` bodies. The union-cursor desugar
      (`src/frontend/duck_elaborate.ts`, `union_cursor_collection_loop`) emits
      its body as an `if_let` **expression** inside an `expr` statement, so the
      effect is invisible and the loop is misclassified as pure. Teach the scan
      to descend into `expr`-statement `block`/`if_let`/`if`/`match`, and into
      `for_*` and `loop` bodies. **hypothesis** — the misclassification is
      confirmed by reading; the fix is not yet demonstrated.
- [x] **`continue` in effectful loops.** Fixed in `9720e89`: the index increment
      sat after the body, so a `continue` tail-called with a stale index.
      Covered by `examples/handlers/07_effectful_loop_continue.duck`. Original
      note: rejected outright at `src/frontend/handler_elaborate.ts:1636`. Once
      cursor loops work this is the last hole in "effects work in every loop".
      **verified**
- [ ] **Effect inference cliff.** An effectful function without an explicit
      `<Effect>` row annotation silently falls into the pure rewrite and fails
      deep inside elaboration with a message that names neither the function nor
      the missing annotation. This cost real debugging time during the fix
      above. Either infer the row or fail at the definition with a message that
      says which annotation is missing. **verified**

**Coherence target:** effects compose with every loop and control form, or the
language says clearly and early where they do not.

## 2. `List a` should be as first-class as a bespoke union

A hand-rolled monomorphic cons list works everywhere. The prelude's `List a`
does not, which pushes every serious consumer back to hand-rolling. The codex
case study never writes `` `Nil () `` directly — it routes through
`comptime list Text` where the element type is pinned. That workaround is the
symptom.

**Correction (2026-07-25).** This section's diagnosis was largely wrong, and the
record is kept rather than rewritten so the mistake stays visible. A dedicated
investigation could not reproduce symptoms (a) or (b) at all — ten shapes
holding `List <union>` in a struct field compile and run — and **both**
suspected root causes below (the space heuristic, `lower_union_case`) turned out
to be dead ends. What was really broken were two Core lowering defects that are
not parametric-specific and reproduce with hand-rolled monomorphic unions; both
are fixed in `43b4572`. Symptoms (c) and (d) are resolved by that commit,
confirmed against real code: two codex fixtures that previously failed
union-case inference now compile past it. Treat (a) and (b) as unreproduced
until someone produces a failing program.

Four distinct failures, originally believed **verified** from the editor
migration:

- [ ] `List <union>` as a **struct field** fails backend lowering with "requires
      a named runtime type, found lam". The `lam` is the unapplied type
      constructor: a `type List value` declaration becomes a Core lambda
      (`src/backend/core_lowering.ts:349`), and `type_expression_name` (`:6343`)
      accepts only `var`, `type_name`, `app`, and `union_type`.
- [ ] **Alias and application do not unify.** Using `EditorCommands` where
      `List EditorCommand` is expected reports "nominal names differ", so the
      alias is not transparent to the unifier.
- [ ] **Bare `` `Nil () `` is ambiguous** once several `List` instantiations are
      in scope — resolution is a structural payload search, which cannot
      disambiguate `List Key` from `List EditorCommand`.
- [ ] **`rec` functions over `List T`** → `cannot infer function result`, even
      with an explicit `[…] -> …` annotation on the binding.

Two root causes worth fixing before the symptoms:

- [ ] **The space heuristic.** `src/frontend/type_set_elaborate.ts:4749`
      collapses a resolved union to its nominal name only when the name has no
      space. `"List Key"` has one, so parametric instantiations skip the
      collapse and ship an unnameable type expression to the backend. Register
      parametric instantiations as real nominal types instead of testing for a
      space. This is the change that retires the whole class.
- [ ] **`lower_union_case` prefers the wrong source of truth.**
      `src/backend/core_lowering.ts:5179` calls `type_expression_name` on
      `type_expr` first and only falls back to `expected` in the `else` branch —
      so it throws even when the declared field type was correct and available.
      Guard the call and fall back.

**Coherence target:** the prelude's collections are usable directly, so no
consumer has a reason to hand-roll a cons list.

## 3. One collection API in the prelude

There are three-to-four implementations of the same list operations, and the
canonical one is whichever a given file happened to import. All **verified** by
reading the modules.

- [ ] `src/frontend/prelude_list.duck` defines its whole API **twice** —
      standalone `list_*` consts (`:5-157`) and a `list` factory (`:159-308`)
      with byte-identical bodies.
- [ ] `src/frontend/prelude_functional.duck`'s `list` factory (`:316-716`) is a
      near-clone of that factory, extended with `filter`/`find`/`any`/`count`/
      `fold_i32`/`sort_by`. With ~110 importers it is the de facto canonical
      API.
- [ ] `src/frontend/prelude_collections.duck` is a third copy of
      `reverse`/`take`/`length`.
- [ ] `src/frontend/prelude_json_string.duck` is a byte-identical copy of part
      of `prelude_json_encode.duck`.
- [ ] **No canonical `fold`.** `list_fold_left` exists in `prelude_functional`
      with zero importers outside the prelude.
- [x] **`iterator_windows` is broken.** Fixed in `09da064` by calling the
      `@slice` intrinsic; the literal tuple form regresses `for` over the
      iterator. Original note: `src/frontend/prelude_iterators.duck:353` calls
      the tuple-lambda `slice` with comma arguments, so any module that uses it
      fails `DUCK2307`. It is hidden only because unused const-module members
      are pruned.
- [ ] **`prelude_iterators` now has no consumers** — the editor was the only one
      and no longer imports it.

Decide one home, make the others re-export, and delete the copies. Pick
`prelude_functional`'s API on usage grounds, or move it to `prelude_list` on
naming grounds — but pick.

**Coherence target:** one obvious way to fold a list, and the prelude does not
contradict itself.

## 4. Tests that actually run

- [ ] **482 of 506 codex fixtures execute in nothing.** Each ends in
      `return { .score = score }` and nothing reads it. `deno test` discovers
      only `*.test.ts`; there is no `.duck` runner, and `examples/manifest.ts`
      has zero codex entries. All 80 `app_server_*` fixtures — the largest
      subsystem — are among them. **verified**
- [x] **The CI matrix was wrong in both directions.** Fixed in `c58ea7e`: three
      of five entries (chip8, grep, tar) named directories not tracked in the
      repo, so those jobs failed on every PR, while editor was covered by
      nothing. Codex remains excluded until its suite is green. Original note:
      (`.github/workflows/pr.yaml:77-87` lists chip8, grep, raytracer, tar,
      wav). The editor work in `ca194ae` was verified locally and by nothing
      else. **verified**
- [ ] **`for` over `List` is documented but untested.** `docs/language.md:2098`
      describes it; no `.duck` file in the repo exercises it. **verified**

**Coherence target:** a green CI run means the case studies still work.

## 5. Structure

- [x] **The backend lived in `experiments/`.** Moved to `src/backend/`, and
      `experiments/` is gone entirely: the only other thing in it was a baba
      compatibility probe whose own README recorded that the real grammar had
      already moved to `tree-sitter-duck/grammar.baba`. The sibling import
      `../../../gpufuck/functional.ts` is unchanged — `src/backend/` sits at the
      same depth `experiments/gpufuck/` did.
- [ ] **`src/backend/compiler.test.ts` is excluded from the test run.** Moving
      the backend under `src/` would have wired its 140-test suite into CI,
      which is red: roughly 120 failures, most of them WebGPU device exhaustion
      (each test wants its own device, and a local `ollama` holding 12.5 GB of
      16 GB is enough to starve them) plus real pre-existing lowering bugs such
      as `cannot infer function parameter left in (left, right)` for `append`,
      which reproduces identically at `f0ff59b`. The suite ran in no CI job
      before the move, so `--ignore` preserves that rather than turning CI red.
      `deno task compiler:test` still runs it deliberately. Fix the suite, then
      drop the ignore.

- [ ] **The cross-repo import has no pin.** `../../../gpufuck/functional.ts` is
      a relative path into a sibling checkout; a removed export breaks Duck on
      the next compile with no version range to protect it. gpufuck's own
      `ARCHITECTURE.md` §7 documents this as the fragile seam. At minimum, a
      smoke test that fails loudly when the boundary drifts.

## 6. TypeScript side

- [ ] **`Validation` conversion is 1 of 32.** `src/frontend/checked.ts` exists
      and one checker uses it; 31 functions still take a mutable
      `SourceDiagnostic[]` across 104 `push` sites. Convert bottom-up with the
      `diagnostics.push(...diagnostics_of(check))` bridge so every increment
      stays green.
- [x] **`Format`'s `Source` instance is registered but never dispatched.**
      Removed in `42882b7`. Original note: `src/frontend/source.ts:121`
      registers it; all nine formatting call sites use the plain
      `format_source`. Either give it a polymorphic call site or drop the
      registration.

## Language proposals

These are suggestions, not decisions. Each is argued from the principle above.

### Derived members on `duck` declarations

A `duck` currently declares members and nothing else (`docs/language.md:2108`).
Every implementer must supply every member, even when one is always mechanically
derivable from another.

The TypeScript side already hit this and fixed it: `Callable.arity` is always
`type(x).args.length`, so it moved onto the typeclass as a derived method and
instances now supply only `type` (`68f4065`). Duck cannot express that, so its
own ducks push the same duplication onto every implementer.

```duck
duck Callable Self {
  type Item
  .signature = Self -> Signature
  .arity = (value: Self) => signature(value).args.length   // derived default
}
```

This is squarely the language's thesis: the ability to give a trait member a
default body is exactly "a compiler feature as an ordinary declaration".

### Expected-type-directed constructor resolution

`` `Nil () `` is currently resolved by searching registered unions for a
matching payload shape. That is unambiguous only while one union has that shape,
which is why several `List` instantiations break it.

Push the expected type inward instead — the annotation, field type, or parameter
type at the use site is already known. This subsumes the ambiguity failure in §2
and is the standard fix.

### An `Iterator` story with one shape

There are three overlapping mechanisms: the `Iterator`/`Iterable`/`IntoIterator`
ducks, the `iterator_*` combinators in `prelude_iterators`, and the list
factories. `for` prefers `Iterator` over `IntoIterator`, so `extend List` in
`prelude_iterators` is dead, and the combinator module has no consumers at all.

Collapse to: `for` and every combinator work over anything implementing
`Iterator`; combinators live next to it; `Iterable` stays only as the indexed
fast path.

### Better failure when an effect row is missing

Related to §1 but worth stating as a design rule: a missing effect annotation
should fail at the definition naming the function and the row, not deep in CPS
elaboration with a message about internal machinery. Effects are a headline
feature; their worst error message should not be the least informative one.

## Sequencing

1. §1 cursor loops, then `continue` — finishes "effects work in every loop", and
   is the smallest complete story.
2. §2 root causes (space heuristic, then `lower_union_case`) — the four symptoms
   should be re-tested after each, since they may collapse together.
3. §4 CI wiring — cheap, and everything after it is safer.
4. §3 prelude consolidation — needs §2 done, or the consolidated API inherits
   the same parametric problems.
5. §5 and §6 — independent, do when convenient.

§2 before §3 matters: consolidating the collection API on top of a `List a` that
cannot sit in a struct field would bake the workarounds in.

## Not doing

- **Rewriting the compiler in functional style throughout.** Tried and reverted.
  The `undefined` returns are a deliberate error-poisoning discipline —
  `numeric_type` returns `undefined` for an ill-typed subexpression and every
  consumer guards on it, which is what keeps one root cause reported once. The
  test `semantic validation keeps nested width errors structured and singular`
  pins it. `Validation` accumulates _independent_ failures; it is not a
  replacement for that mechanism, and `Maybe` would be a rename with allocation.
  Accumulation and suppression are orthogonal — keep both.
