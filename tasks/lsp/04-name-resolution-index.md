# Name Resolution And Symbol Index

## Goal

Build the definition/reference index that navigation, rename, completion, hover,
and semantic tokens all consume. Ix's binding rules make this more interesting
than lexical scoping: shadowing is the mutation model, const bindings snapshot
their environment at definition time, and linear values have consume points.

## Work

- Produce a per-document binding graph from the spanned AST: every name
  occurrence classified as definition, reference, shadowing redefinition (`=`
  and `:=`), consume of a linear value, or field/case member access.
- Respect binding-time semantics: a reference inside a const closure binds to
  the const environment captured at definition, so later shadowing of the same
  name is a _different_ entity in the index. Model each shadowing generation as
  its own symbol entity.
- Index declarations: `type`, `effect`, `declare`, module params, effect
  operations, struct fields, and union cases as member symbols nested under
  their owner.
- Resolve member access (`user.name`, `Result.ok`, `Io.read`) against visible
  struct/union/effect declarations where the target's type fact is statically
  known.
- Keep the index incremental per document version; rebuild only the edited
  document, not the workspace (cross-file resolution arrives in task 12).

## Acceptance Criteria

- For every example, each name occurrence resolves to exactly one entity or is
  explicitly classified unresolved (builtin, dynamic member, or unknown).
- Shadowing fixtures: `x = x + 1` links the right-hand `x` to the previous
  generation and the left-hand `x` to a new one; const-capture fixtures bind to
  the snapshot generation.
- Index rebuild after a one-line edit touches only that document.

## Verification

- Fixture files with caret markers (`^def`, `^ref`) asserting resolution
  targets, in the task 12 harness format.
- Property test: every definition's references list round-trips through the
  reverse lookup.

## Implementation Status

Implemented.

The tolerant parser records exact source sites for definitions, references,
annotations, members, and recovered syntax. `build_binding_index` creates
versioned entities, lexical scopes, shadow generations, forward occurrences,
reverse reference lists, owner-member maps, and best-effort type/nominal facts.
It preserves RHS-before-shadow and recursive-self semantics, models const
captures through generation identity, distinguishes linear consumes, keeps
generic parameters declaration-local, and explicitly classifies unresolved
builtins, dynamic members, unknown names, and recovery-poisoned sites.

`visible_at` selects the generation active in the innermost source scope, while
member lookup keeps fields, cases, and effect operations nested under their
owners. The LSP document adapter caches one index per document version, so an
edit rebuilds only that document.

Verification covers repeated exact name spellings, parser rewrites and recovery,
shadow and const binding order, recursive and linear uses, nominal members and
cases, declaration-local generics, lexical visibility before and after shadows,
owner-member isolation, deterministic rebuilding, per-document cache
invalidation, and definition/reference reverse-lookup round trips.
