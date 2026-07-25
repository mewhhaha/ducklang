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

- [~] **Unreproduced.** `List <union>` as a **struct field** was reported to
  fail backend lowering with "requires a named runtime type, found lam". The
  `lam` is the unapplied type constructor: a `type List value` declaration
  becomes a Core lambda (`src/backend/core_lowering.ts:349`), and
  `type_expression_name` (`:6343`) accepts only `var`, `type_name`, `app`, and
  `union_type`.
- [~] **Unreproduced.** Alias and application reported not to unify. Using
  `EditorCommands` where `List EditorCommand` is expected reports "nominal names
  differ", so the alias is not transparent to the unifier.
- [x] **Fixed in `43b4572`.** Bare `` `Nil () `` was ambiguous once several
      `List` instantiations are in scope — resolution is a structural payload
      search, which cannot disambiguate `List Key` from `List EditorCommand`.
- [x] **Fixed in `43b4572`.** `rec` functions over `List T` →
      `cannot infer function result`, even with an explicit `[…] -> …`
      annotation on the binding.

Two root causes worth fixing before the symptoms:

- [~] **Dead end.** The space heuristic.
  `src/frontend/type_set_elaborate.ts:4749` collapses a resolved union to its
  nominal name only when the name has no space. `"List Key"` has one, so
  parametric instantiations skip the collapse and ship an unnameable type
  expression to the backend. Register parametric instantiations as real nominal
  types instead of testing for a space. This is the change that retires the
  whole class.
- [~] **Dead end.** `lower_union_case` prefers the wrong source of truth.
  `src/backend/core_lowering.ts:5179` calls `type_expression_name` on
  `type_expr` first and only falls back to `expected` in the `else` branch — so
  it throws even when the declared field type was correct and available. Guard
  the call and fall back.

**Coherence target:** the prelude's collections are usable directly, so no
consumer has a reason to hand-roll a cons list.

## 3. One collection API in the prelude

**Rewritten (2026-07-25) — the original premise was wrong.** This section
claimed three-to-four careless copies of the same list operations. Working
through every item found the opposite: the prelude has _variants tuned to
different constraints_, and only one was genuine duplication. The real defect is
that nothing records which variant to reach for, so it reads as sloppiness.

What each module is actually for:

| module                | constraint it serves                                     |
| --------------------- | -------------------------------------------------------- |
| `prelude_list`        | depends only on `duck:prelude/types`; naive constructors |
| `prelude_collections` | **zero** imports; `List` used ambiently                  |
| `prelude_functional`  | pins nominal types with `@construct`; the robust one     |
| `prelude_json_string` | escapes a string without pulling in Json types           |

- [x] **`prelude_list` defined its API twice.** Genuine, and the only genuine
      one. Fixed in `67e5254`: the `list` factory now delegates to the
      standalone `list_*` consts. 150 lines removed, both surfaces kept.
- [x] ~~`prelude_functional`'s `list` factory is a near-clone.~~ **Do not
      merge.** It uses `@construct(node_type, [value, values])` and a `cons`
      helper to pin the nominal type explicitly, where `prelude_list` writes a
      bare literal and `` `Cons ``. That is precisely the workaround for §2's
      ambiguity symptom, and it is why the codex study routes through
      `comptime list Text` instead of writing constructors by hand. Delegating
      would reintroduce the ambiguity across 138 importers.
- [x] ~~`prelude_json_string` is a byte-identical copy.~~ **Do not merge.** The
      bodies match; the dependency footprints do not. `prelude_json_encode`
      imports `duck:prelude/json/values` and aliases `JsonArray`/`JsonObject`.
      Merging failed `agent_tool_control.test.ts` with
      `F2101 unknown type
      "Json"`, confirmed by A/B.
- [x] ~~No canonical `fold`.~~ **There is one:** `list_fold_left`, generic over
      `forall value state`, exported from `prelude_functional`. It cannot be a
      member of the `list` factory because the factory is parameterized on
      `value_type` alone and a fold needs a second type parameter — which is why
      `fold_i32` exists alongside it. Attempting to add `.fold` fails to parse.
      The gap is discoverability, not absence.
- [x] ~~`prelude_iterators` has no consumers.~~ It has one again:
      `examples/loops/14_iterator_windows.duck`, added with the fix in
      `09da064`.
- [x] **`iterator_windows` is broken.** Fixed in `09da064` by calling the
      `@slice` intrinsic; the literal tuple form regresses `for` over the
      iterator.
- [ ] **`prelude_collections` overlaps `prelude_list`** on
      `reverse`/`take`/`length`. Unlike the others this may be mergeable, but it
      is the only module in the prelude with **zero** imports, so delegating to
      `prelude_list` would add a dependency where none exists. Establish first
      whether any consumer depends on that, the way `prelude_json_string`'s
      consumers depend on not seeing Json types.
- [ ] **Document the variants.** The table above belongs in the prelude itself,
      next to the modules. Four separate attempts today assumed duplication and
      three were wrong; the next reader will assume the same.

**Coherence target:** one obvious way to fold a list, and where several
implementations exist, a recorded reason for each.

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
- [x] **`for` over `List` is documented but untested.** Now exercised by
      `examples/handlers/06_effects_in_cursor_loop.duck`, which iterates a
      `List I32` and runs in CI. Original note: `docs/language.md:2098`
      describes it; no `.duck` file in the repo exercises it. **verified**

**Coherence target:** a green CI run means the case studies still work.

## 4b. The three bugs keeping codex out of CI

`case-studies/codex` fails 8 of 27 tests at `ad87e2f`, which is why `c58ea7e`
left it out of the CI matrix. Three distinct classes, all **verified**.

- [ ] **`Compile-time shape cannot be emitted as a Core result`**
      (`src/core/from_source/expr.ts:418`, from
      `src/core/from_source/stmt.ts:303`). Fails `exec.test.ts` (2) and
      `hook.test.ts`. Diagnosed to a language-level tension, not yet fixed.

      `hook_adapter_fixture.duck` reported five diagnostics before lowering.
      Four were a real prelude bug — `generate_bytes` called pack-style in
      `prelude_json` — fixed in `69d3452`. That did **not** change the codex
      tally: the same eight tests fail before and after.

      The fifth is the cause: `DUCK2101 Const parameter transform requires
      compile-time argument: session_id`. `pipe` is declared in
      `prelude_functional.duck:280` as `(value, const transform) => transform
      value` and bound to `|>` at `:7`, so the right-hand side of every pipe
      must be a compile-time value. `hook_input.duck:41` writes
      `|> json_string_field("session_id", session_id)`, where `session_id` is
      destructured from a runtime tuple — so the stage captures a runtime value
      and the const check rejects it.

      The `const` is load-bearing: removing it trades the one `DUCK2101` for
      three `DUCK2310` unification failures, because the specialization it
      enables is what makes the pipeline typecheck — and that specialization is
      the point, since it resolves the pipeline instead of building an
      intermediate closure per stage.

      **Correction.** The commit message for `7c2772a` called this `DUCK2101`
      the cause of the `Compile-time shape` failure. That is not established. A
      probe reproducing the same diagnostic — a pipe whose stage closes over a
      runtime binding — **compiles and runs correctly**, returning the expected
      value with the diagnostic present. So `DUCK2101` does not by itself block
      lowering, and the cause of the codex failure is still unknown.

      What is established: the lambda-stage form works.
      `value |> (v => f [v, runtime_value])` runs correctly and specializes;
      the parentheses are required because the lambda binds looser than `|>`.
      `scope_const_expr_known` (`type_set_elaborate.ts:5806`) already accepts a
      `lam` argument, so this form is intended. The spurious part is that the
      check still walks into the lambda body and rejects free *runtime*
      bindings referenced there — `add`, then `runtime_value` — even though
      only the stage's shape needs to be compile-time for specialization.
      Narrowing that check is the actual fix, and it is in
      `type_set_elaborate.ts:5341`, not `call_args.ts:210`.

      Separately, the compiler lowers source that has diagnostics and fails
      with an internal error instead of surfacing them. Worth fixing on its own
      — it is what made this take four hours to locate.

- [ ] **`Host callable cannot expose borrowed or frozen values`**
      (`src/abi.ts:481`, via `src/backend/core_lowering.ts:130`). Fails
      `request_permissions.test.ts` and `update_plan_stage_composition.test.ts`.
      Not investigated.
- [ ] **`F2102` type mismatch during gpufuck compilation**
      (`src/backend/compiler.ts:799`). Fails `agent_job_report.test.ts` and
      `view_image.test.ts` with
      `expected duck::JsonArray, received
      duck::JsonObject`, and
      `code_mode_execute.test.ts` with
      `expected
      ($FunctionalText, duck::JsonObject), received $FunctionalText`.
      Not investigated.

**Coherence target:** codex joins the CI matrix, which is the only way the
largest case study stops silently rotting.

## 4c. The tree-sitter grammar lags the language

The grammar is what editor tooling uses, so anything it cannot parse loses
highlighting and LSP structure even though the compiler accepts it. It had
drifted from `src/frontend/tokenize.ts`.

- [x] **Numeric literals.** The `number` token matched only `123`, `123i32` and
      `1f32`, while the tokenizer also lexes hexadecimal, a fractional part and
      an exponent. `0x80`, `0x46464952` and `0.5f32` all failed. Widened in
      `b1ba9f3`.
- [x] **Single-argument trailing comma.** `positional_product` required two or
      more expressions, so `f(\n  1,\n)` — which the formatter itself emits when
      wrapping — matched no rule. Fixed in `b1ba9f3`.
- [ ] **`turn_profile.duck` still fails — root cause found.** The grammar lets a
      call apply across a newline; the real parser does not.

      `application_expression` (`grammar.baba:587`) has two alternatives. The
      first requires `_application_space`, a contextual token matching only
      space and tab, so it cannot span lines. The second —
      `function argument:(parenthesized_or_product)`, which exists for `f(x)` —
      carries **no whitespace constraint at all**, and the skip rule
      `/[ \t\r\n]+/` then permits a newline between them. So `}` followed by
      `[...]` on the next line parses as an application.

      The language does not allow this. Parsing `let x = f\n(1);` reports
      ``Expected `;` after binding``, while `f(1)` on one line is clean. The
      grammar is wrong; the source is fine.

      The fix is adjacency, and the mechanism already exists: `_index_open` is
      declared `token.immediate` in `baba.json` so `obj[i]` requires no gap.
      The second application alternative wants the same. Note the first
      alternative already covers the spaced forms — `add [1, 2]` and `f (x)` —
      because `named_product` is a `_primary_expression`, so tightening the
      second should not lose them. Verify that before changing it.

      **This is why no syntax redesign is needed.** Mandatory semicolons or an
      ML-style `let ... in` would both paper over a grammar bug, at the cost of
      touching all 1060 Duck files.

Case-study parse failures went from 10 of 907 to 1. Examples (130) and the
prelude (23) were already clean and stay clean.

**Coherence target:** anything the compiler accepts, the editor grammar parses.

## 4d. Required `return` and mandatory semicolons

Decided direction: every block ends with an explicit `return <expr>;`, every
statement is terminated, and the concise lambda form `() => value` stays
implicit. That gives the grammar a real terminator and removes the trailing-
expression special case, so statement position and argument position stop
overlapping.

**Blocker found before migrating: `return` already means two different things
depending on position.** Both measured through `DuckCompiler`:

| context               | meaning                     | evidence                                                                            |
| --------------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| block used as a value | the block's value           | `let x = if n > 0 { return 99; } else { return 0; }; x + 1` returns **100**, not 99 |
| `let … else { … }`    | exit the enclosing function | `let \`Some v = m else { return 7; }; v + 1` returns **7**                          |

Making `return` required for every block therefore needs a spec decision first,
because the same keyword would carry both readings on every block in the
language:

- [ ] **Decide the semantics.** Either keep one keyword and define its meaning
      by position — value in a value block, divergence in a diverging block —
      and write that down; or split it, keeping `return` for function exit and
      giving value blocks a different word. The second is clearer but touches
      the `let … else` sites too.
- [ ] **Then migrate.** 1060 files, 77,090 lines. 3,421 assignments need
      terminators and every block's trailing expression needs wrapping. The
      `duck fmt` CLI cannot perform this: `src/fmt/format.ts` reflows tokens and
      has no notion of statement kinds, so it needs statement-boundary awareness
      first, or the migration needs a one-off codemod built on the frontend AST.
- [ ] **Then simplify the grammar**, which is the payoff — a real terminator
      should retire the ambiguity in `application_expression` and possibly
      shrink the 178-line contextual scanner.

Note this is a larger fix than the bug that prompted it. The parse failure in
section 4c has a one-token fix. This is worth doing for its own sake, not as a
workaround.

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

- [x] **The cross-repo import has no pin.** Fixed. The three scattered
      `../../../gpufuck/functional.ts` specifiers became one `"gpufuck"`
      import-map entry, and that entry now points at
      `jsr:@mewhhaha/gpufuck@^0.4.0` rather than the sibling checkout. 0.4.0
      carries the renamed API this repo expects, so a version range finally
      applies and a removed export shows up as a resolution failure instead of
      breaking the next compile silently. The `jsr:@mewhhaha/*` entry in
      `minimumDependencyAge` lets same-day releases resolve. This also removes
      the constraint that a checkout must sit beside `gpufuck/`, which broke
      every worktree used for A/B testing today.

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

### Holes for partial application — landed

`f [v, _]` becomes `x => f [v, x]`, so a pipeline stage stays the compile-time
shape `|>` needs while still closing over runtime data:

```duck
1 |> add [offset, _] |> add [30, _]
```

Landed in `b65fd8f`. Holes bind left to right within one argument list; a hole
inside a nested call is rejected, which needed a record of which lambdas were
lifted from holes, because bottom-up parsing lifts an inner call's hole first.

Two things the implementation had to get right, both found by building it:

- **The surface form must survive.** Desugaring in the parser meant
  `format_source` rewrote `add [1, _]` as `__hole_0 => add [1, __hole_0]`,
  leaking a generated name. The lambda now records its lifted parameter names
  and the formatter puts the holes back, so parse/format round trips. That also
  avoided a new `FrontExpr` variant, which would have touched every exhaustive
  switch over expression tags.
- **`_` is ambiguous with type syntax.** Adding it to `_primary_expression`
  needed conflict declarations against `positional_type_product` and
  `array_type`, since `[_, _]` could be either under LR parsing.

Covered by `src/frontend/hole.test.ts` and
`examples/compile_time/24_argument_holes.duck`.

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
