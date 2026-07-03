# Normalize Naming And Specification Text

## Goal

Turn the draft specification into consistent project documentation with semantic
casing.

## Source Sections

- Overview
- Core Design Statement
- Naming implied by examples across the full draft

## Work

- Add or update a language specification document for the draft.
- Normalize source identifiers to `snake_case` starting with a lowercase letter,
  including runtime names, const names, type-values, type constructors, type
  references, and protocol/fact-checker values.
- Keep only builtin type names such as `Text`, `Int`, `I64`, and `Unit` in their
  builtin spelling.
- Replace inconsistent non-`snake_case` user-defined identifiers in examples.

## Required Normalized Names

```txt
make_adder
read_number
invalid_digit
size_of
align_of
fields_of
cases_of
is_struct
is_union
align_to
tag_size
max_payload
max_align
tag_offset
payload_offset
```

For compile-time layout bindings, use the ordinary helper-const convention:

```txt
const user_layout = comptime layout(user_type)   // ordinary helper const value
```

## Acceptance Criteria

- The spec includes an explicit naming convention section.
- Examples use names like `make_adder`, `read_number`, `layout_of`, `fields_of`,
  `align_to`, `greet_user`, `user_type`, `option_type`, `result_type`,
  `functor`, `applicative`, and `monad`.
- Any intentional exception, such as builtin type names, is documented at the
  use site.

## Verification

- Search docs and examples for user-defined names that are not `snake_case`.
- Review remaining `PascalCase` identifiers and confirm they are builtin type
  names or TypeScript API names outside source snippets.

## Implementation Status

- Added `docs/language.md` as the normalized language specification surface.
- Runtime, const, type-value, type-constructor, and protocol/fact-checker
  examples in `tasks/` use `snake_case`.
- The frontend enforces lowercase-leading `snake_case` for runtime bindings,
  const bindings, expression-position source names, function parameters, const
  parameters, loop binders, linear-value references, fields, modules, imports,
  union cases, `if let` payload binders, and user-defined type references in
  annotations, field access, struct fields, union cases, and destructuring
  patterns.
- Frontend casing regressions now cover linear const bindings, const binding
  annotations, module closure parameters, recursive closure parameters, and
  expression-position `if let` payload binders.
- Compiler-internal source marker names use `snake_case`, including
  `object_type`, `layout_type`, and `field_offsets_type`.
- Project-owned runtime helpers, local variables, function names, and AST field
  names use `snake_case`; remaining PascalCase names are TypeScript type
  aliases, pseudo-trait companion values, builtin source type names, or platform
  APIs.
- Excluded language-family keywords such as `class`, `trait`, `macro`,
  `instance`, `extends`, `inherits`, and `where` are parser-reserved so they do
  not become ordinary source identifiers.
- Verified with a repository search for the draft camelCase helper names and
  with frontend casing tests. Remaining non-`snake_case` source snippets are
  deliberate negative parser tests or builtin type names such as `Int`, `I64`,
  `Text`, `Unit`, and `Type`.
