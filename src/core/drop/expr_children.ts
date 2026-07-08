import { type CoreDropStmtScanner, scan_drop_block_expr } from "./block.ts";
import { scan_drop_closure_body } from "./closure_body.ts";
import {
  scan_drop_if_expr,
  scan_drop_if_let_expr,
} from "./conditional_expr.ts";
import type { CoreDropResultExprScanner } from "./expr_result.ts";
import {
  consume_host_transfer_args,
  consume_runtime_union_payload_owner,
} from "./ownership.ts";
import { consume_static_host_transfer_call } from "./static_transfer.ts";
import type {
  CoreDropExitOwners,
  CoreDropHooks,
  CoreDropOwner,
  CoreDropState,
  CoreExpr,
  CoreField,
  CoreStmt,
} from "./types.ts";

type CoreDropStmtsScanner<ctx> = (
  statements: CoreStmt[],
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  drop_fallthrough_owners?: boolean,
) => boolean;

export function scan_drop_expr_children_impl<ctx>(
  expr: CoreExpr,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  scan_drop_stmt: CoreDropStmtScanner<ctx>,
  scan_drop_stmts: CoreDropStmtsScanner<ctx>,
  scan_drop_result_expr: CoreDropResultExprScanner<ctx>,
): boolean {
  const scan_children = (
    child: CoreExpr,
    child_scope: string,
    child_owners: Map<string, CoreDropOwner>,
    child_exit_owners: CoreDropExitOwners,
    child_ctx: ctx,
    child_hooks: CoreDropHooks<ctx>,
    child_state: CoreDropState,
  ): boolean => {
    return scan_drop_expr_children_impl(
      child,
      child_scope,
      child_owners,
      child_exit_owners,
      child_ctx,
      child_hooks,
      child_state,
      scan_drop_stmt,
      scan_drop_stmts,
      scan_drop_result_expr,
    );
  };

  switch (expr.tag) {
    case "num":
    case "text":
    case "type_name":
    case "var":
    case "linear":
    case "struct_type":
    case "union_type":
    case "unsupported":
      return true;

    case "lam":
    case "rec":
      return scan_drop_closure_body(
        expr,
        ctx,
        hooks,
        state,
        scan_drop_stmts,
        scan_children,
      );

    case "prim":
      for (const arg of expr.args) {
        const continues = scan_children(
          arg,
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
      }
      return true;

    case "app":
      {
        const continues = scan_children(
          expr.func,
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
      }
      for (const arg of expr.args) {
        const continues = scan_children(
          arg,
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
      }
      consume_host_transfer_args(expr, scope, owners, ctx, hooks, state);
      consume_static_host_transfer_call(
        expr,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
      );
      consume_runtime_union_payload_owner(expr, owners, ctx, hooks, state);
      return true;

    case "block": {
      return scan_drop_block_expr(
        expr,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
        scan_drop_stmt,
        scan_drop_result_expr,
      );
    }

    case "comptime":
      return scan_children(
        expr.expr,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
      );

    case "borrow":
    case "freeze":
      return scan_children(
        expr.value,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
      );

    case "scratch":
      return scan_children(
        expr.body,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
      );

    case "with":
      if (
        !scan_children(
          expr.base,
          scope,
          owners,
          exit_owners,
          ctx,
          hooks,
          state,
        )
      ) {
        return false;
      }
      return scan_drop_fields(
        expr.fields,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
        scan_children,
      );

    case "struct_value":
      if (
        !scan_children(
          expr.type_expr,
          scope,
          owners,
          exit_owners,
          ctx,
          hooks,
          state,
        )
      ) {
        return false;
      }
      return scan_drop_fields(
        expr.fields,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
        scan_children,
      );

    case "struct_update":
      if (
        !scan_children(
          expr.base,
          scope,
          owners,
          exit_owners,
          ctx,
          hooks,
          state,
        )
      ) {
        return false;
      }
      return scan_drop_fields(
        expr.fields,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
        scan_children,
      );

    case "if": {
      return scan_drop_if_expr(
        expr,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
        scan_children,
        scan_drop_result_expr,
      );
    }

    case "if_let": {
      return scan_drop_if_let_expr(
        expr,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
        scan_children,
        scan_drop_result_expr,
      );
    }

    case "field":
      return scan_children(
        expr.object,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
      );

    case "index":
      if (
        !scan_children(
          expr.object,
          scope,
          owners,
          exit_owners,
          ctx,
          hooks,
          state,
        )
      ) {
        return false;
      }
      return scan_children(
        expr.index,
        scope,
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
      );

    case "union_case":
      if (expr.value) {
        const continues = scan_children(
          expr.value,
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
      }

      if (expr.type_expr) {
        const continues = scan_children(
          expr.type_expr,
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
      }

      consume_runtime_union_payload_owner(expr, owners, ctx, hooks, state);
      return true;
  }
}

function scan_drop_fields<ctx>(
  fields: CoreField[],
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  scan_children: (
    child: CoreExpr,
    child_scope: string,
    child_owners: Map<string, CoreDropOwner>,
    child_exit_owners: CoreDropExitOwners,
    child_ctx: ctx,
    child_hooks: CoreDropHooks<ctx>,
    child_state: CoreDropState,
  ) => boolean,
): boolean {
  for (const field of fields) {
    const continues = scan_children(
      field.value,
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
  }

  return true;
}
