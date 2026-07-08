import {
  type CoreDropExprChildrenScanner,
  type CoreDropResultExprScanner,
  merge_expr_branches,
} from "./expr_result.ts";
import {
  child_exit_owners,
  clone_drop_owners,
  next_block_scope,
} from "./state.ts";
import type {
  CoreDropExitOwners,
  CoreDropExprBranchResult,
  CoreDropHooks,
  CoreDropOwner,
  CoreDropState,
  CoreExpr,
} from "./types.ts";

export function scan_drop_if_expr<ctx>(
  expr: Extract<CoreExpr, { tag: "if" }>,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  scan_drop_expr_children: CoreDropExprChildrenScanner<ctx>,
  scan_drop_result_expr: CoreDropResultExprScanner<ctx>,
): boolean {
  const cond_continues = scan_drop_expr_children(
    expr.cond,
    scope,
    owners,
    exit_owners,
    ctx,
    hooks,
    state,
  );
  if (!cond_continues) {
    return false;
  }

  const then_branch = scan_drop_expr_branch_result(
    expr.then_branch,
    next_block_scope(state),
    owners,
    exit_owners,
    ctx,
    hooks,
    state,
    scan_drop_result_expr,
  );
  const else_branch = scan_drop_expr_branch_result(
    expr.else_branch,
    next_block_scope(state),
    owners,
    exit_owners,
    ctx,
    hooks,
    state,
    scan_drop_result_expr,
  );

  return merge_expr_branches(
    expr,
    owners,
    [then_branch, else_branch],
    state,
  );
}

export function scan_drop_if_let_expr<ctx>(
  expr: Extract<CoreExpr, { tag: "if_let" }>,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  scan_drop_expr_children: CoreDropExprChildrenScanner<ctx>,
  scan_drop_result_expr: CoreDropResultExprScanner<ctx>,
): boolean {
  const target_continues = scan_drop_expr_children(
    expr.target,
    scope,
    owners,
    exit_owners,
    ctx,
    hooks,
    state,
  );
  if (!target_continues) {
    return false;
  }

  const branch_ctx = drop_if_let_branch_ctx(
    expr.case_name,
    expr.value_name,
    expr.target,
    ctx,
    hooks,
  );
  let branches: CoreDropExprBranchResult[];

  if (branch_ctx.tag === "skip") {
    branches = [
      scan_drop_expr_branch_result(
        expr.else_branch,
        next_block_scope(state),
        owners,
        exit_owners,
        ctx,
        hooks,
        state,
        scan_drop_result_expr,
      ),
    ];
  } else {
    const then_branch = scan_drop_expr_branch_result(
      expr.then_branch,
      next_block_scope(state),
      owners,
      exit_owners,
      branch_ctx.ctx,
      hooks,
      state,
      scan_drop_result_expr,
    );
    const else_branch = scan_drop_expr_branch_result(
      expr.else_branch,
      next_block_scope(state),
      owners,
      exit_owners,
      ctx,
      hooks,
      state,
      scan_drop_result_expr,
    );
    branches = [then_branch, else_branch];
  }

  return merge_expr_branches(
    expr,
    owners,
    branches,
    state,
  );
}

export function drop_if_let_branch_ctx<ctx>(
  case_name: string,
  value_name: string | undefined,
  target: CoreExpr,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
): { tag: "scan"; ctx: ctx } | { tag: "skip" } {
  if (!hooks.if_let_branch_ctx) {
    return { tag: "scan", ctx };
  }

  const branch_ctx = hooks.if_let_branch_ctx(
    case_name,
    value_name,
    target,
    ctx,
  );

  if (branch_ctx.tag === "skip") {
    return branch_ctx;
  }

  if (branch_ctx.tag === "scan") {
    return branch_ctx;
  }

  return { tag: "scan", ctx };
}

function scan_drop_expr_branch_result<ctx>(
  expr: CoreExpr,
  scope: string,
  parent_owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  scan_drop_result_expr: CoreDropResultExprScanner<ctx>,
): CoreDropExprBranchResult {
  const owners = clone_drop_owners(parent_owners);
  const result = scan_drop_result_expr(
    expr,
    scope,
    owners,
    child_exit_owners(parent_owners, exit_owners),
    ctx,
    hooks,
    state,
  );

  return {
    scope,
    continues: result.continues,
    owners,
    result: result.result,
  };
}
