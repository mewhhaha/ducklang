import { emit_drop } from "./emit.ts";
import { child_exit_owners, clone_drop_owners } from "./state.ts";
import type {
  CoreDropBranchResult,
  CoreDropExitOwners,
  CoreDropHooks,
  CoreDropOwner,
  CoreDropState,
  CoreStmt,
} from "./types.ts";

export type CoreDropStmtsScanner<ctx> = (
  statements: CoreStmt[],
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  drop_fallthrough_owners?: boolean,
) => boolean;

export function merge_if_stmt_branch_owners(
  owners: Map<string, CoreDropOwner>,
  branch: CoreDropBranchResult,
): void {
  if (!branch.continues) {
    return;
  }

  for (const name of Array.from(owners.keys())) {
    const existing = owners.get(name);
    const owner = branch.owners.get(name);

    if (owner) {
      const merged: CoreDropOwner = {
        name: owner.name,
        ownership: owner.ownership,
        pointer: owner.pointer,
      };
      if (existing && existing.subject === owner.subject) {
        merged.subject = owner.subject;
      }
      owners.set(name, merged);
    }
  }
}

export function merge_if_else_branch_owners(
  owners: Map<string, CoreDropOwner>,
  branches: CoreDropBranchResult[],
): void {
  for (const name of Array.from(owners.keys())) {
    const continuing: CoreDropOwner[] = [];

    for (const branch of branches) {
      if (!branch.continues) {
        continue;
      }

      const owner = branch.owners.get(name);
      if (owner) {
        continuing.push(owner);
      }
    }

    const merged = continuing[continuing.length - 1];
    if (merged) {
      const value: CoreDropOwner = {
        name: merged.name,
        ownership: merged.ownership,
        pointer: merged.pointer,
      };
      for (const owner of continuing) {
        if (owner.pointer === "temporary") {
          value.pointer = "temporary";
        }
      }
      let common_subject = continuing[0]?.subject;
      for (const owner of continuing) {
        if (owner.subject !== common_subject) {
          common_subject = undefined;
        }
      }
      if (common_subject) {
        value.subject = common_subject;
      }
      owners.set(name, value);
    } else {
      owners.delete(name);
    }
  }
}

export function drop_branch_local_owners(
  scope: string,
  branch_owners: Map<string, CoreDropOwner>,
  parent_owners: Map<string, CoreDropOwner>,
  state: CoreDropState,
): void {
  for (const [name, owner] of Array.from(branch_owners.entries())) {
    if (parent_owners.has(name)) {
      continue;
    }

    emit_drop("scope_exit", scope, owner.name, owner, state);
    branch_owners.delete(name);
  }
}

export function scan_drop_branch_stmts<ctx>(
  statements: CoreStmt[],
  scope: string,
  parent_owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  scan_drop_stmts: CoreDropStmtsScanner<ctx>,
): CoreDropBranchResult {
  const branch_owners = clone_drop_owners(parent_owners);
  const continues = scan_drop_stmts(
    statements,
    scope,
    branch_owners,
    child_exit_owners(parent_owners, exit_owners),
    ctx,
    hooks,
    state,
    false,
  );

  if (continues) {
    drop_branch_local_owners(scope, branch_owners, parent_owners, state);
  }

  return {
    continues,
    owners: branch_owners,
  };
}
