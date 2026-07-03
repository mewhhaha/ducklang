import { expect } from "../expect.ts";
import type { CoreExpr, CoreStmt } from "./ast.ts";
import type { CoreCtx, CoreLocalCollectHooks } from "./local_collect/types.ts";

export type CoreRecLocalCollectApi = {
  collect_expr_locals: (
    expr: CoreExpr,
    ctx: CoreCtx,
    hooks: CoreLocalCollectHooks,
  ) => void;
  collect_stmt_locals: (
    stmt: CoreStmt,
    ctx: CoreCtx,
    hooks: CoreLocalCollectHooks,
  ) => void;
};

export function collect_core_rec_call_locals(
  expr: Extract<CoreExpr, { tag: "app" }>,
  target: Extract<CoreExpr, { tag: "rec" }>,
  ctx: CoreCtx,
  hooks: CoreLocalCollectHooks,
  api: CoreRecLocalCollectApi,
): void {
  ctx.next_loop += 1;
  hooks.bind_rec_initial_params(expr, target, ctx);
  collect_rec_body_expr_locals(target.body, target, ctx, hooks, api);
}

function collect_rec_body_expr_locals(
  expr: CoreExpr,
  target: Extract<CoreExpr, { tag: "rec" }>,
  ctx: CoreCtx,
  hooks: CoreLocalCollectHooks,
  api: CoreRecLocalCollectApi,
): void {
  if (hooks.is_core_rec_tail_call(expr)) {
    hooks.check_rec_tail_call_args(expr, target, ctx);

    for (const arg of expr.args) {
      api.collect_expr_locals(arg, ctx, hooks);
    }

    return;
  }

  if (expr.tag === "if") {
    api.collect_expr_locals(expr.cond, ctx, hooks);
    collect_rec_body_expr_locals(expr.then_branch, target, ctx, hooks, api);
    collect_rec_body_expr_locals(expr.else_branch, target, ctx, hooks, api);
    return;
  }

  if (expr.tag === "block") {
    collect_rec_body_block_locals(expr.statements, target, ctx, hooks, api);
    return;
  }

  api.collect_expr_locals(expr, ctx, hooks);
}

function collect_rec_body_block_locals(
  statements: CoreStmt[],
  target: Extract<CoreExpr, { tag: "rec" }>,
  ctx: CoreCtx,
  hooks: CoreLocalCollectHooks,
  api: CoreRecLocalCollectApi,
): void {
  for (let index = 0; index < statements.length; index += 1) {
    const stmt = statements[index];
    expect(stmt, "Missing core rec body statement " + index.toString());
    const is_final = index + 1 >= statements.length;

    if (stmt.tag === "expr" && is_final) {
      collect_rec_body_expr_locals(stmt.expr, target, ctx, hooks, api);
      continue;
    }

    if (stmt.tag === "return") {
      collect_rec_body_expr_locals(stmt.value, target, ctx, hooks, api);
      return;
    }

    api.collect_stmt_locals(stmt, ctx, hooks);
  }
}
