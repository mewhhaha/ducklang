# MVP Grammar And Scope Control

## Goal

Define the first implementable grammar and keep MVP scope explicit.

## Source Sections

- Minimal Grammar Sketch
- MVP Feature Set
- Core Design Statement

## MVP Includes

```txt
let
const
comptime
shadowing with = and :=
closures
return
if
if let
rec
for
break
continue
linear parameters with !
borrow views
freeze values
scratchpads with value results
struct
union
type-values
const parameters
with extensions
fact checkers
modules as functions
compile-time layout helpers
monomorphization
Wasm codegen
```

## MVP Excludes

```txt
global IO
global typeclass instance search
runtime structural dispatch
implicit effects
inheritance
classes
traits
macros as a separate system
dependent runtime-sized types
general first-class linear closure capture
baseline GC fallback for uncertain lifetimes
first-class source-level region objects beyond scratchpads
attached scratch regions that survive scratch reset
implicit promotion or managed storage for unsafe scratch returns
```

## Work

- Turn the grammar sketch into parser tasks or grammar rules.
- Keep unsupported features explicitly rejected with diagnostics.
- Add fixtures for each included and excluded feature.
- Track which grammar productions are intentionally incomplete.

## Acceptance Criteria

- Every MVP include has at least one parser fixture.
- Every MVP exclude has a rejection test or documented unsupported diagnostic.
- The grammar distinguishes expressions, statements, patterns, type annotations,
  `with`, `comptime`, and loop forms.
- Unsupported features do not parse silently as unrelated constructs.

## Verification

- Run parser tests over the MVP include/exclude fixture set.
- Review diagnostics for excluded features.

## Implementation Status

- The parser has fixtures for every implemented MVP include: bindings, `const`,
  `comptime`, shadowing, closures, returns, `if`, `if let`, `rec`, `for`,
  `break`, `continue`, linear parameters and pure linear `let`/`const` bindings,
  ownership forms `borrow expr`, `freeze expr`, and `scratch { ... }`, structs,
  unions, type-values, const parameters, runtime parameter annotations,
  user-defined source-name and type-reference casing across binders, field
  access, union cases, and patterns, `with`, fact checkers, modules, layout
  helpers, specialization, no-else scalar control-flow expressions, explicit
  integer literal suffixes, text length/index/get operations, text collection
  loops, and the scalar Wasm path. The `Mod` layer also covers Wasm function
  imports and single-memory data segments, and source text literals lower to
  length-prefixed UTF-8 data pointers below the source grammar.
- Ownership forms `borrow expr`, `freeze expr`, and `scratch { ... }` are
  parser-visible baseline forms. Their full no-GC semantics are owned by Task
  12: lexical borrow/view checking, explicit frozen-shareable values, scratchpad
  reset insertion, static escape analysis, and deterministic rejection rather
  than GC fallback in the baseline backend.
- `scratch { ... }` is the MVP region-like grammar surface. General named arenas
  or first-class region objects remain outside the MVP and should only be added
  after the scratch lifetime/drop model is stable.
- A scratch scope may have a value result, but the MVP does not expose a live
  attached region after reset. Results that could reference scratch storage must
  be frozen, promoted, proven scratch-free, or rejected by Task 12 analysis.
- Parser token navigation is isolated in `src/frontend/parser_cursor.ts`,
  parameter and annotation parsing is isolated in
  `src/frontend/parser_params.ts`, aggregate field/type-pattern parsing is
  isolated in `src/frontend/parser_aggregate.ts`, expression/postfix/block
  parsing is isolated in `src/frontend/parser_expr.ts`, and parser support rules
  for reserved keywords, builtin type-reference names, module-function
  normalization, operator precedence, and struct-value starts are isolated in
  `src/frontend/parser_support.ts`.
- Unsupported or not-yet-lowered grammar paths are rejected with explicit
  diagnostics rather than silently parsed as unrelated constructs.
- Excluded language-family keywords such as `class`, `trait`, `macro`,
  `instance`, `extends`, `inherits`, and `where` are parser-reserved and have
  fixtures proving they format as unsupported nodes and fail before Ic lowering.
- Current reserved diagnostics include general dynamic loop codegen, runtime
  union payload storage/matching outside the implemented scalar, `Text`, `Unit`,
  union-pointer, and aggregate-pointer struct payload cases, unknown dynamic
  `if let` outside typed/direct union-if or inlineable closure-call union-result
  shapes, unknown runtime collection codegen, captured runtime aggregate and
  non-Text memory-backed index assignment, general first-class linear closure
  captures, runtime text/string operations outside the supported visible
  literal/concat/data-pointer cases and runtime `Text` length, byte-load, `get`,
  byte assignment, collection-loop, and Core runtime concat subset, unknown
  effectful method-style capability calls, frontend aggregate memory/codegen
  values, and general memory-backed index update codegen.
- Excluded language families such as global IO, runtime instance search,
  inheritance/classes, traits, `where` clauses, and separate macro syntax remain
  outside the supported parser surface.
