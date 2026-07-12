# Code Actions And Assists

## Goal

Quick fixes bound to diagnostics plus standalone refactoring assists, applied
through workspace edits — rust-analyzer's assist system scaled to Ix's current
diagnostic surface.

## Work

- Infrastructure: `textDocument/codeAction` with diagnostics context, lazy edit
  computation via `codeAction/resolve`, and kinds (`quickfix`,
  `refactor.rewrite`, `refactor.extract`, `source.fixAll`).
- Diagnostic-bound quick fixes, starting from the failure-example corpus:
  - unused linear value → insert explicit consume or remove the binding
  - reused linear value → suggest `dup` where the checker allows sharing
  - missing struct field in construction → insert field with typed hole
  - invalid union payload / missing case in `if let` chain → add branch
  - mixed i32/i64 operands → insert widening annotation on the binding
  - frozen/scratch mutation → rewrite to rebuild-and-shadow form
- Assists independent of diagnostics:
  - extract expression into `let` binding (with fresh-name hygiene)
  - inline a `let` binding with single use
  - convert `let` to `const` when `is_const_expr_known` accepts the value
  - wrap selection in `comptime` when it validates as const
  - annotate binding with its inferred type fact
  - reorder/complete a handler literal against its effect declaration
- Every produced edit must reparse and re-resolve cleanly; assists that cannot
  guarantee this must not be offered.

## Acceptance Criteria

- Each failure example in scope offers at least one quick fix whose applied edit
  eliminates the diagnostic without introducing new ones.
- Assist availability is position-accurate (no actions offered on constructs
  they cannot handle).

## Verification

- Before/after fixture pairs per action; applying the action must produce the
  exact after-file, and the after-file must pass analysis.

## Implementation Status

Implemented.

- Added ranged `textDocument/codeAction` enumeration and lazy
  `codeAction/resolve`, including stale-version and workspace-route validation.
- Quick fixes cover pure unused linear bindings, repeated scalar linear use,
  mixed integer widths, missing struct fields, invalid union payloads, frozen
  mutation rebuilds, and escaping scratch results. General `dup` remains
  intentionally unavailable because the current linear checker rejects its
  ordinary-value elaboration; scalar reuse instead removes the linear binder
  without changing the computed expression.
- Refactors cover exact-selection extraction, single-use inline, inferred type
  annotations, `let` to `const`, `comptime` wrapping, explicit missing `if let`
  cases, and handler reordering/completion.
- Every resolved edit is reparsed and analyzed through the same URI, import
  resolver, and manifest route as the open document. Exact before/after and
  post-edit-clean fixtures cover every action family.
