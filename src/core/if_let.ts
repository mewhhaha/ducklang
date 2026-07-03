import { expect } from "../expect.ts";
import type { ValType } from "../op.ts";
import type { Wat } from "../wat.ts";
import type { CoreExpr, CoreStmt } from "./ast.ts";
import { indent_lines } from "./backend/util.ts";

export type DynamicUnionIf = {
  cond: CoreExpr;
  then_case: Extract<CoreExpr, { tag: "union_case" }>;
  else_case: Extract<CoreExpr, { tag: "union_case" }>;
};

export type CoreIfLetPayloadBinding<ctx> = {
  setup: Wat;
  ctx: ctx;
};

export type CoreIfLetHooks<ctx> = {
  bind_payload: (
    value_name: string | undefined,
    union_case: Extract<CoreExpr, { tag: "union_case" }>,
    ctx: ctx,
  ) => CoreIfLetPayloadBinding<ctx>;
  dynamic_union_if: (
    expr: CoreExpr,
    ctx: ctx,
  ) => DynamicUnionIf | undefined;
  emit_expr: (expr: CoreExpr, ctx: ctx) => Wat;
  emit_stmt: (stmt: CoreStmt, ctx: ctx, is_final: boolean) => Wat;
  expr_type: (expr: CoreExpr, ctx: ctx) => ValType;
  static_union_case: (
    expr: CoreExpr,
    ctx: ctx,
  ) => Extract<CoreExpr, { tag: "union_case" }> | undefined;
};

export function emit_core_if_let_stmt<ctx>(
  stmt: Extract<CoreStmt, { tag: "if_let_stmt" }>,
  ctx: ctx,
  hooks: CoreIfLetHooks<ctx>,
): Wat {
  const union_case = hooks.static_union_case(stmt.target, ctx);

  if (union_case) {
    if (union_case.name !== stmt.case_name) {
      return "";
    }

    const lines: string[] = [];

    const binding = hooks.bind_payload(stmt.value_name, union_case, ctx);
    lines.push(binding.setup);

    for (const item of stmt.body) {
      lines.push(hooks.emit_stmt(item, binding.ctx, false));
    }

    return lines.join("\n");
  }

  const dynamic_target = hooks.dynamic_union_if(stmt.target, ctx);

  if (!dynamic_target) {
    throw new Error("Cannot emit core if_let_stmt statement yet");
  }

  return emit_dynamic_if_let_stmt(stmt, dynamic_target, ctx, hooks);
}

export function emit_core_if_let_expr<ctx>(
  expr: Extract<CoreExpr, { tag: "if_let" }>,
  ctx: ctx,
  hooks: CoreIfLetHooks<ctx>,
): Wat {
  const union_case = hooks.static_union_case(expr.target, ctx);

  if (union_case) {
    if (union_case.name !== expr.case_name) {
      if (expr.implicit_else) {
        const result_type = hooks.expr_type(expr, ctx);
        return result_type + ".const 0";
      }

      return hooks.emit_expr(expr.else_branch, ctx);
    }

    const lines: string[] = [];

    const binding = hooks.bind_payload(expr.value_name, union_case, ctx);
    lines.push(binding.setup);

    lines.push(hooks.emit_expr(expr.then_branch, binding.ctx));
    return lines.join("\n");
  }

  const dynamic_target = hooks.dynamic_union_if(expr.target, ctx);

  if (!dynamic_target) {
    throw new Error("Cannot emit core if_let expression yet");
  }

  return emit_dynamic_if_let_expr(expr, dynamic_target, ctx, hooks);
}

function emit_dynamic_if_let_stmt<ctx>(
  stmt: Extract<CoreStmt, { tag: "if_let_stmt" }>,
  target: DynamicUnionIf,
  ctx: ctx,
  hooks: CoreIfLetHooks<ctx>,
): Wat {
  const cond_type = hooks.expr_type(target.cond, ctx);
  expect(cond_type === "i32", "Core dynamic if let condition must be i32");

  return [
    hooks.emit_expr(target.cond, ctx),
    "if",
    indent_lines(
      emit_dynamic_if_let_stmt_case(stmt, target.then_case, ctx, hooks),
      2,
    ),
    "else",
    indent_lines(
      emit_dynamic_if_let_stmt_case(stmt, target.else_case, ctx, hooks),
      2,
    ),
    "end",
  ].join("\n");
}

function emit_dynamic_if_let_stmt_case<ctx>(
  stmt: Extract<CoreStmt, { tag: "if_let_stmt" }>,
  union_case: Extract<CoreExpr, { tag: "union_case" }>,
  ctx: ctx,
  hooks: CoreIfLetHooks<ctx>,
): Wat {
  if (union_case.name !== stmt.case_name) {
    return "";
  }

  const lines: string[] = [];

  const binding = hooks.bind_payload(stmt.value_name, union_case, ctx);
  lines.push(binding.setup);

  for (const item of stmt.body) {
    lines.push(hooks.emit_stmt(item, binding.ctx, false));
  }

  return lines.join("\n");
}

function emit_dynamic_if_let_expr<ctx>(
  expr: Extract<CoreExpr, { tag: "if_let" }>,
  target: DynamicUnionIf,
  ctx: ctx,
  hooks: CoreIfLetHooks<ctx>,
): Wat {
  const result_type = hooks.expr_type(expr, ctx);

  return [
    hooks.emit_expr(target.cond, ctx),
    "if (result " + result_type + ")",
    indent_lines(
      emit_dynamic_if_let_expr_case(
        expr,
        target.then_case,
        result_type,
        ctx,
        hooks,
      ),
      2,
    ),
    "else",
    indent_lines(
      emit_dynamic_if_let_expr_case(
        expr,
        target.else_case,
        result_type,
        ctx,
        hooks,
      ),
      2,
    ),
    "end",
  ].join("\n");
}

function emit_dynamic_if_let_expr_case<ctx>(
  expr: Extract<CoreExpr, { tag: "if_let" }>,
  union_case: Extract<CoreExpr, { tag: "union_case" }>,
  result_type: ValType,
  ctx: ctx,
  hooks: CoreIfLetHooks<ctx>,
): Wat {
  if (union_case.name !== expr.case_name) {
    if (expr.implicit_else) {
      return result_type + ".const 0";
    }

    return hooks.emit_expr(expr.else_branch, ctx);
  }

  const lines: string[] = [];

  const binding = hooks.bind_payload(expr.value_name, union_case, ctx);
  lines.push(binding.setup);

  lines.push(hooks.emit_expr(expr.then_branch, binding.ctx));
  return lines.join("\n");
}
