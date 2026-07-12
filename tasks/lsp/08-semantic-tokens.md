# Semantic Tokens

## Goal

Compiler-fact-driven highlighting layered over tree-sitter: distinguish what
static analysis knows that a grammar cannot — const vs runtime bindings, linear
values, effect operations, type-values, comptime-only regions.

## Work

- Implement `textDocument/semanticTokens/full` and `/range`; add `/delta` once
  full-document tokens are stable.
- Token classification from the task 4 index and constness facts:
  - const bindings and const parameters (`readonly` modifier on `variable`)
  - linear values and their consume points (`variable` + custom modifier)
  - type-values and type constructors (`type`, `typeParameter`)
  - effects and effect operations (`interface`, `method`)
  - union cases and struct fields (`enumMember`, `property`)
  - comptime expressions and fact-checker calls (custom `comptime` modifier)
  - shadowing assignments (`modification` modifier)
- Declare the legend in the initialize response; keep custom modifiers few and
  documented so Helix themes can target them.
- Tokens must degrade under parse errors: emit for the recovered regions.

## Acceptance Criteria

- In a fixture mixing const and runtime bindings of the same name across
  shadowing generations, each occurrence carries the correct modifier set.
- Token output is stable across two identical requests and updates minimally
  (delta) after a one-line edit.

## Verification

- Golden token dumps (line, char, length, type, modifiers) per fixture.
- Helix smoke: a theme override maps the custom modifiers and renders distinctly
  (manual checklist documented in the task).

## Implementation Status

Implemented.

The server advertises a compact semantic-token legend and implements full,
range, and delta requests. Index entities classify variables, functions, types,
type parameters, effects, operations, union cases, and struct fields. Standard
`declaration`, `readonly`, and `modification` modifiers distinguish definitions,
const generations/parameters, and shadowing assignments. Two custom modifiers
are exposed:

- `linear` — linear definitions, references, and consume points;
- `comptime` — names inside explicit comptime regions and resolved const-call
  sites.

Tokens come from recovered index occurrences, so valid regions remain
highlighted around parse errors. Results are cached by document version, receive
deterministic content-based result IDs, and delta responses use the minimal
common-prefix/common-suffix replacement. Golden dumps cover const to runtime
shadowing, type/member/effect/linear classification, comptime calls, range
recovery, identical-request stability, and one-line delta updates.

### Helix smoke checklist

- Run `just install`, open a mixed fixture, and confirm semantic highlighting
  appears without disabling Tree-sitter highlighting.
- Temporarily map `variable.linear` and `variable.comptime` (or the equivalent
  modifier scopes exposed by the active Helix version) to visibly distinct
  colors in the current theme.
- Confirm a `const` name remains readonly across references, a later ordinary
  shadow loses readonly and gains modification at its definition, `!token` uses
  receive the linear color, and a const call inside `comptime` receives the
  comptime color.
- Edit one line and confirm unaffected lines do not visibly repaint; request a
  full refresh once to confirm the delta and full render are identical.
