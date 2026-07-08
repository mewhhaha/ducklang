import {
  scan_drop_assign_stmt,
  scan_drop_bind_stmt,
  scan_drop_index_assign_stmt,
} from "./binding_stmt.ts";
import {
  scan_drop_if_else_stmt,
  scan_drop_if_let_stmt,
  scan_drop_if_stmt,
} from "./conditional_stmt.ts";
import { drop_exit_owners, drop_scope_owners } from "./emit.ts";
import { scan_drop_expr_children_impl } from "./expr_children.ts";
import {
  scan_drop_expr,
  scan_drop_result_expr as scan_drop_result_expr_impl,
} from "./expr_result.ts";
import {
  scan_drop_collection_loop_stmt,
  scan_drop_range_loop_stmt,
} from "./loop_stmt.ts";
import {
  drop_unknown_host_boundary_probe_error,
  mark_final_expr_escape,
} from "./ownership.ts";
import { returned_owner_name } from "./state.ts";
import type {
  CoreDropExitOwners,
  CoreDropExprResult,
  CoreDropHooks,
  CoreDropOwner,
  CoreDropState,
  CoreExpr,
  CoreStmt,
} from "./types.ts";

export function scan_drop_stmts<ctx>(
  statements: CoreStmt[],
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  drop_fallthrough_owners = true,
): boolean {
  const previous_functions = state.functions;
  state.functions = new Map(previous_functions);

  try {
    for (let index = 0; index < statements.length; index += 1) {
      const stmt = statements[index];

      if (index + 1 >= statements.length) {
        return scan_final_drop_stmt(
          stmt,
          scope,
          owners,
          exit_owners,
          ctx,
          hooks,
          state,
          drop_fallthrough_owners,
        );
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

      if (!continues) {
        return false;
      }

      try {
        drop_scope_owners(owners, exit_owners, scope, state);
      } catch (error) {
        if (!drop_unknown_host_boundary_probe_error(error)) {
          throw error;
        }
      }
    }
  } finally {
    state.functions = previous_functions;
  }

  return true;
}

function scan_drop_stmt<ctx>(
  stmt: CoreStmt,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
): boolean {
  switch (stmt.tag) {
    case "bind":
      scan_drop_bind_stmt(stmt, scope, owners, exit_owners, ctx, hooks, state);
      return true;

    case "assign":
      scan_drop_assign_stmt(stmt, scope, owners, exit_owners, ctx, hooks, state);
      return true;

    case "index_assign":
      scan_drop_index_assign_stmt(
        stmt,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
      );
      return true;

    case "range_loop":
      scan_drop_range_loop_stmt(stmt, scope, owners, exit_owners, ctx, hooks, state);
      return true;

    case "collection_loop":
      scan_drop_collection_loop_stmt(
        stmt,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
      );
      return true;

    case "if_stmt":
      scan_drop_if_stmt(stmt, scope, owners, exit_owners, ctx, hooks, state);
      return true;

    case "if_else_stmt":
      scan_drop_if_else_stmt(stmt, scope, owners, exit_owners, ctx, hooks, state);
      return true;

    case "if_let_stmt":
      scan_drop_if_let_stmt(stmt, scope, owners, exit_owners, ctx, hooks, state);
      return true;

    case "type_check":
      scan_drop_expr(stmt.target, scope, owners, exit_owners, ctx, hooks, state);
      return true;

    case "break":
      drop_exit_owners(owners, exit_owners, "break", state);
      return false;

    case "continue":
      drop_exit_owners(owners, exit_owners, "continue", state);
      return false;

    case "return": {
      const result = scan_drop_result_expr_impl(
        stmt.value,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
      );
      drop_exit_owners(result.owners, exit_owners, returned_owner_name, state);
      return false;
    }

    case "expr":
      scan_drop_expr(stmt.expr, scope, owners, exit_owners, ctx, hooks, state);
      return true;

    case "unsupported":
      return true;
  }
}

function scan_final_drop_stmt<ctx>(
  stmt: CoreStmt | undefined,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  drop_fallthrough_owners: boolean,
): boolean {
  if (!stmt) {
    if (drop_fallthrough_owners) {
      drop_scope_owners(owners, exit_owners, scope, state);
    }

    return true;
  }

  if (stmt.tag === "expr") {
    const result = scan_drop_result_expr(
      stmt.expr,
      scope,
      owners,
      exit_owners,
      ctx,
      hooks,
      state,
    );

    if (drop_fallthrough_owners) {
      drop_scope_owners(result.owners, exit_owners, scope, state);
    }

    return true;
  }

  return scan_drop_stmt(stmt, scope, owners, exit_owners, ctx, hooks, state);
}

export function scan_drop_result_expr<ctx>(
  expr: CoreExpr,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
): CoreDropExprResult {
  const result = scan_drop_result_expr_impl(
    expr,
    scope,
    owners,
    exit_owners,
    ctx,
    hooks,
    state,
  );

  if (result.owner) {
    mark_final_expr_escape(result.owner, state);
  }

  return result;
}

export function scan_drop_expr_children<ctx>(
  expr: CoreExpr,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
): boolean {
  return scan_drop_expr_children_impl(
    expr,
    scope,
    owners,
    exit_owners,
    ctx,
    hooks,
    state,
  );
}
