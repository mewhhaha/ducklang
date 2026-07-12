# Ix Language Server Tasks

Target: bring the `ix lsp` server from its v1 surface (parse diagnostics,
whole-document formatting, token-derived document symbols) to the feature set
expected from a modern language server such as rust-analyzer, adapted to Ix's
pipeline and semantics.

Baseline: `src/lsp/` as introduced with the `ix.ts` CLI — a dependency-free
stdio JSON-RPC server that reparses the full document on every change and
refuses to format buffers with parse errors.

## Design Rules

- All server work stays decoupled in `src/lsp/`; compiler internals are consumed
  through narrow, testable interfaces. The compiler must never import from
  `src/lsp/` or `src/fmt/`.
- Every feature must work on broken buffers. The editor's common state is
  mid-edit, so analyses degrade gracefully instead of disappearing.
- Ix's own semantics drive the value: const/comptime facts, effect rows, linear
  capabilities, and ownership classes are what hover, completion, hints, and
  semantic tokens should surface — not just generic name info.
- Deterministic outputs. Same buffer state, same replies; no wall-clock or
  randomness in results.

## Task Order

1. [Syntax foundation](01-syntax-foundation.md) — spans on the AST, lossless
   trivia, error-resilient parsing. Everything else depends on this.
2. [Document store and incremental sync](02-document-store-and-sync.md)
3. [Semantic diagnostics](03-semantic-diagnostics.md)
4. [Name resolution and symbol index](04-name-resolution-index.md)
5. [Navigation and rename](05-navigation-and-rename.md)
6. [Completion](06-completion.md)
7. [Hover and signature help](07-hover-and-signature-help.md)
8. [Semantic tokens](08-semantic-tokens.md)
9. [Inlay hints](09-inlay-hints.md)
10. [Code actions and assists](10-code-actions-and-assists.md)
11. [Comptime and pipeline powertools](11-comptime-powertools.md)
12. [Workspace, performance, and test harness](12-workspace-and-performance.md)

Tasks 4–10 depend on 1–3. Task 11 reuses the frontend evaluator directly and can
start after 2. Task 12 hardens everything and should trail the rest, but its
fixture harness is worth building as soon as task 3 lands.
