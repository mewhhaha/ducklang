import { emit_drop } from "./emit.ts";
import type { CoreDropResultExprScanner } from "./expr_result.ts";
import { simple_expr_result_owner } from "./ownership.ts";
import {
  child_exit_owners,
  clone_drop_owners,
  next_block_scope,
} from "./state.ts";
import type {
  CoreDropExitOwners,
  CoreDropExprResult,
  CoreDropHooks,
  CoreDropOwner,
  CoreDropState,
  CoreExpr,
  CoreStmt,
} from "./types.ts";

export type CoreDropStmtScanner<ctx> = (
  stmt: CoreStmt,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
) => boolean;

export function scan_drop_block_expr<ctx>(
  expr: Extract<CoreExpr, { tag: "block" }>,
  _scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  scan_drop_stmt: CoreDropStmtScanner<ctx>,
  scan_drop_result_expr: CoreDropResultExprScanner<ctx>,
): boolean {
  const block_scope = next_block_scope(state);
  const parent_names = new Set(owners.keys());
  const block_owners = clone_drop_owners(owners);
  const block_ctx = hooks.block_ctx(ctx);
  const statements = expr.statements;
  let result: CoreDropExprResult | undefined;

  for (let index = 0; index < statements.length; index += 1) {
    const stmt = statements[index];

    if (!stmt) {
      throw new Error("Missing core drop block statement " + index.toString());
    }

    const is_final = index + 1 >= statements.length;

    if (!is_final) {
      const continues = scan_drop_stmt(
        stmt,
        block_scope,
        block_owners,
        child_exit_owners(block_owners, exit_owners),
        block_ctx,
        hooks,
        state,
      );

      if (!continues) {
        return false;
      }

      hooks.collect_stmt_locals(stmt, block_ctx);
      continue;
    }

    const final = scan_drop_block_final_stmt(
      stmt,
      block_scope,
      block_owners,
      child_exit_owners(block_owners, exit_owners),
      block_ctx,
      hooks,
      state,
      scan_drop_stmt,
      scan_drop_result_expr,
    );

    if (!final.continues) {
      return false;
    }

    result = final.result;
  }

  drop_block_local_owners(block_scope, block_owners, parent_names, state);
  merge_block_parent_owners(
    owners,
    block_owners,
    parent_names,
    simple_expr_result_owner(result),
  );

  if (result) {
    state.expr_results.set(expr, result);
  } else {
    state.expr_results.set(expr, { tag: "none" });
  }

  return true;
}

function scan_drop_block_final_stmt<ctx>(
  stmt: CoreStmt,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  scan_drop_stmt: CoreDropStmtScanner<ctx>,
  scan_drop_result_expr: CoreDropResultExprScanner<ctx>,
): {
  continues: boolean;
  result: CoreDropExprResult | undefined;
} {
  if (stmt.tag === "expr") {
    return scan_drop_result_expr(
      stmt.expr,
      scope,
      owners,
      exit_owners,
      ctx,
      hooks,
      state,
    );
  }

  if (stmt.tag === "return") {
    const continues = scan_drop_stmt(
      stmt,
      scope,
      owners,
      exit_owners,
      ctx,
      hooks,
      state,
    );
    return {
      continues,
      result: undefined,
    };
  }

  const continues = scan_drop_stmt(
    stmt,
    scope,
    owners,
    exit_owners,
    ctx,
    hooks,
    state,
  );
  return {
    continues,
    result: undefined,
  };
}

function drop_block_local_owners(
  scope: string,
  block_owners: Map<string, CoreDropOwner>,
  parent_names: Set<string>,
  state: CoreDropState,
): void {
  for (const [name, owner] of Array.from(block_owners.entries())) {
    if (parent_names.has(name)) {
      continue;
    }

    emit_drop("scope_exit", scope, owner.name, owner, state);
    block_owners.delete(name);
  }
}

function merge_block_parent_owners(
  owners: Map<string, CoreDropOwner>,
  block_owners: Map<string, CoreDropOwner>,
  parent_names: Set<string>,
  result_owner: CoreDropOwner | undefined,
): void {
  for (const name of parent_names) {
    if (result_owner && result_owner.name === name) {
      continue;
    }

    const owner = block_owners.get(name);

    if (owner) {
      owners.set(name, owner);
    } else {
      owners.delete(name);
    }
  }
}
