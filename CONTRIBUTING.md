# Contributing

Ducklang keeps compiler stages explicit and each change reviewable as one idea.
Read `AGENTS.md` before changing code; it is the repository's detailed style,
testing, and architecture policy.

## Prerequisites

- Deno 2.9.2
- Tree-sitter CLI 0.26.3
- WABT with `wat2wasm` on `PATH`
- `just`

No repository dependency install is required. The Deno lockfile pins the single
JSR dependency.

## Before a change

Read the implementation you will edit and a neighboring module that performs a
similar operation. Confirm the established naming, error handling, dependency
direction, and existing test coverage before writing code.

Keep backend routes accurate:

```txt
Source -> IC -> Expr -> Mod -> WAT -> Wasm
Source -> structured Core -> Mod -> WAT -> Wasm
```

Shared frontend stages must not import Core or WAT emitters. Core dependencies
flow `model -> analysis -> plan -> emit -> backend`, and source syntax enters
Core through `core/from_source/` adapters.

## Verification

Run the focused test beside the changed implementation, then run the complete
gate:

```sh
just check
```

That command checks formatting, lint, all-file types, dependency boundaries,
generated Tree-sitter files and queries, source/example tests, every case study,
and compiler/LSP performance budgets.

When changing the grammar, regenerate its checked-in artifacts with the pinned
Tree-sitter CLI and include `grammar.json`, `node-types.json`, and `parser.c` in
the same change. When changing diagnostics or the product barrel, update the
registry/API tests and `docs/typescript-api-migration.md`.

Report exactly which checks passed and anything that could not be verified.
