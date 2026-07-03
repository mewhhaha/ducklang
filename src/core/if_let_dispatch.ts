import type { Wat } from "../wat.ts";
import type { CoreExpr, CoreStmt } from "./ast.ts";
import type { CoreIfLetHooks, DynamicUnionIf } from "./if_let.ts";
import type { RuntimeUnionIfLetCtx } from "./runtime_union_emit.ts";
import type { RuntimeUnionTarget } from "./runtime_union.ts";

export type CoreIfLetDispatchHooks<
  ctx extends RuntimeUnionIfLetCtx,
> = {
  dynamic_union_if: (
    expr: CoreExpr,
    ctx: ctx,
  ) => DynamicUnionIf | undefined;
  emit_core_if_let_expr: (
    expr: Extract<CoreExpr, { tag: "if_let" }>,
    ctx: ctx,
    hooks: CoreIfLetHooks<ctx>,
  ) => Wat;
  emit_core_if_let_stmt: (
    stmt: Extract<CoreStmt, { tag: "if_let_stmt" }>,
    ctx: ctx,
    hooks: CoreIfLetHooks<ctx>,
  ) => Wat;
  emit_runtime_union_if_let_expr: (
    expr: Extract<CoreExpr, { tag: "if_let" }>,
    target: RuntimeUnionTarget,
    ctx: ctx,
  ) => Wat;
  emit_runtime_union_if_let_stmt: (
    stmt: Extract<CoreStmt, { tag: "if_let_stmt" }>,
    target: RuntimeUnionTarget,
    ctx: ctx,
  ) => Wat;
  runtime_union_target: (
    expr: CoreExpr,
    ctx: ctx,
  ) => RuntimeUnionTarget | undefined;
  static_union_case: (
    expr: CoreExpr,
    ctx: ctx,
  ) => Extract<CoreExpr, { tag: "union_case" }> | undefined;
};

export function emit_core_if_let_stmt_dispatch<
  ctx extends RuntimeUnionIfLetCtx,
>(
  stmt: Extract<CoreStmt, { tag: "if_let_stmt" }>,
  ctx: ctx,
  core_hooks: CoreIfLetHooks<ctx>,
  hooks: CoreIfLetDispatchHooks<ctx>,
): Wat {
  const union_case = hooks.static_union_case(stmt.target, ctx);

  if (union_case) {
    return hooks.emit_core_if_let_stmt(stmt, ctx, core_hooks);
  }

  const dynamic_target = hooks.dynamic_union_if(stmt.target, ctx);

  if (dynamic_target) {
    return hooks.emit_core_if_let_stmt(stmt, ctx, core_hooks);
  }

  const runtime_target = hooks.runtime_union_target(stmt.target, ctx);

  if (!runtime_target) {
    return hooks.emit_core_if_let_stmt(stmt, ctx, core_hooks);
  }

  return hooks.emit_runtime_union_if_let_stmt(
    stmt,
    runtime_target,
    ctx,
  );
}

export function emit_core_if_let_expr_dispatch<
  ctx extends RuntimeUnionIfLetCtx,
>(
  expr: Extract<CoreExpr, { tag: "if_let" }>,
  ctx: ctx,
  core_hooks: CoreIfLetHooks<ctx>,
  hooks: CoreIfLetDispatchHooks<ctx>,
): Wat {
  const union_case = hooks.static_union_case(expr.target, ctx);

  if (union_case) {
    return hooks.emit_core_if_let_expr(expr, ctx, core_hooks);
  }

  const dynamic_target = hooks.dynamic_union_if(expr.target, ctx);

  if (dynamic_target) {
    return hooks.emit_core_if_let_expr(expr, ctx, core_hooks);
  }

  const runtime_target = hooks.runtime_union_target(expr.target, ctx);

  if (!runtime_target) {
    return hooks.emit_core_if_let_expr(expr, ctx, core_hooks);
  }

  return hooks.emit_runtime_union_if_let_expr(
    expr,
    runtime_target,
    ctx,
  );
}
