import { drop_scope_owners } from "./emit.ts";
import { mark_final_expr_escape } from "./ownership.ts";
import { empty_exit_owners, next_closure_scope } from "./state.ts";
import type {
  CoreDropExitOwners,
  CoreDropHooks,
  CoreDropOwner,
  CoreDropState,
  CoreExpr,
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

type CoreDropExprChildrenScanner<ctx> = (
  expr: CoreExpr,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
) => boolean;

export function scan_drop_closure_body<ctx>(
  expr: Extract<CoreExpr, { tag: "lam" | "rec" }>,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  scan_drop_stmts: CoreDropStmtsScanner<ctx>,
  scan_drop_expr_children: CoreDropExprChildrenScanner<ctx>,
): boolean {
  for (const param of expr.params) {
    if (param.is_const) {
      return true;
    }
  }

  let body_ctx = ctx;

  if (hooks.closure_body_ctx) {
    const scoped_ctx = hooks.closure_body_ctx(expr, ctx);

    if (!scoped_ctx) {
      return true;
    }

    body_ctx = scoped_ctx;
  }

  const scope = next_closure_scope(state);
  const owners = new Map<string, CoreDropOwner>();
  const previous_final_escape = state.final_escape;
  state.final_escape = "named_only";

  try {
    return scan_drop_closure_body_expr(
      expr.body,
      scope,
      owners,
      body_ctx,
      hooks,
      state,
      scan_drop_stmts,
      scan_drop_expr_children,
    );
  } finally {
    state.final_escape = previous_final_escape;
  }
}

function scan_drop_closure_body_expr<ctx>(
  expr: CoreExpr,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  scan_drop_stmts: CoreDropStmtsScanner<ctx>,
  scan_drop_expr_children: CoreDropExprChildrenScanner<ctx>,
): boolean {
  if (expr.tag === "block") {
    return scan_drop_stmts(
      expr.statements,
      scope,
      owners,
      empty_exit_owners(),
      ctx,
      hooks,
      state,
    );
  }

  const continues = scan_drop_expr_children(
    expr,
    scope,
    owners,
    empty_exit_owners(),
    ctx,
    hooks,
    state,
  );

  if (!continues) {
    return false;
  }

  mark_final_expr_escape(expr, owners, ctx, hooks, state);
  drop_scope_owners(scope, owners, state);
  return true;
}
