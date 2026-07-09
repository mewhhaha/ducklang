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
        hooks.collect_stmt_locals(stmt, ctx);
      } catch (error) {
        if (!drop_unknown_host_boundary_probe_error(error)) {
          throw error;
        }
      }
    }

    if (drop_fallthrough_owners) {
      drop_scope_owners(scope, owners, state);
    }

    return true;
  } finally {
    state.functions = previous_functions;
  }
}

function scan_final_drop_stmt<ctx>(
  stmt: CoreStmt,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  drop_fallthrough_owners: boolean,
): boolean {
  if (stmt.tag === "expr") {
    const continues = scan_drop_expr_children(
      stmt.expr,
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

    mark_final_expr_escape(stmt.expr, owners, ctx, hooks, state);
    if (drop_fallthrough_owners) {
      drop_scope_owners(scope, owners, state);
    }

    return true;
  }

  if (stmt.tag === "return") {
    const continues = scan_drop_expr_children(
      stmt.value,
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

    mark_final_expr_escape(stmt.value, owners, ctx, hooks, state);
    drop_exit_owners(
      "return_exit",
      scope,
      owners,
      exit_owners.return_owners,
      returned_owner_name(stmt.value),
      state,
    );
    return false;
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

  if (continues) {
    if (drop_fallthrough_owners) {
      drop_scope_owners(scope, owners, state);
    }
  }

  return continues;
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
    case "bind": {
      return scan_drop_bind_stmt(
        stmt,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
        scan_drop_expr_children,
      );
    }

    case "assign": {
      return scan_drop_assign_stmt(
        stmt,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
        scan_drop_expr_children,
      );
    }

    case "index_assign": {
      return scan_drop_index_assign_stmt(
        stmt,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
        scan_drop_expr_children,
      );
    }

    case "range_loop": {
      return scan_drop_range_loop_stmt(
        stmt,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
        scan_drop_expr_children,
        scan_drop_stmts,
      );
    }

    case "collection_loop": {
      return scan_drop_collection_loop_stmt(
        stmt,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
        scan_drop_expr_children,
        scan_drop_discarded_expr,
        scan_drop_stmts,
      );
    }

    case "if_stmt": {
      return scan_drop_if_stmt(
        stmt,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
        scan_drop_expr_children,
        scan_drop_stmts,
      );
    }

    case "if_else_stmt": {
      return scan_drop_if_else_stmt(
        stmt,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
        scan_drop_expr_children,
        scan_drop_stmts,
      );
    }

    case "if_let_stmt": {
      return scan_drop_if_let_stmt(
        stmt,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
        scan_drop_expr_children,
        scan_drop_stmts,
      );
    }

    case "type_check": {
      const continues = scan_drop_expr_children(
        stmt.target,
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

      return true;
    }

    case "return": {
      const continues = scan_drop_expr_children(
        stmt.value,
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

      mark_final_expr_escape(stmt.value, owners, ctx, hooks, state);
      drop_exit_owners(
        "return_exit",
        scope,
        owners,
        exit_owners.return_owners,
        returned_owner_name(stmt.value),
        state,
      );
      return false;
    }

    case "expr":
      return scan_drop_expr(
        stmt.expr,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
        scan_drop_expr_children,
      );

    case "break":
      drop_exit_owners(
        "break_exit",
        scope,
        owners,
        exit_owners.break_owners,
        undefined,
        state,
      );
      return false;

    case "continue":
      drop_exit_owners(
        "continue_exit",
        scope,
        owners,
        exit_owners.continue_owners,
        undefined,
        state,
      );
      return false;

    case "unsupported":
      return true;
  }
}

function scan_drop_discarded_expr<ctx>(
  expr: CoreExpr,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
): boolean {
  return scan_drop_expr(
    expr,
    scope,
    owners,
    exit_owners,
    ctx,
    hooks,
    state,
    scan_drop_expr_children,
  );
}

function scan_drop_expr_children<ctx>(
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
    scan_drop_stmt,
    scan_drop_stmts,
    scan_drop_result_expr,
  );
}

function scan_drop_result_expr<ctx>(
  expr: CoreExpr,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
): {
  continues: boolean;
  result: CoreDropExprResult | undefined;
} {
  return scan_drop_result_expr_impl(
    expr,
    scope,
    owners,
    exit_owners,
    ctx,
    hooks,
    state,
    scan_drop_expr_children,
  );
}
