import { expect } from "../../../expect.ts";
import type { CoreExpr, CoreStmt } from "../../ast.ts";
import type { CoreCtx } from "../../local_collect.ts";
import { static_core_call_branch_value } from "../../static_call.ts";
import { static_type_level_value } from "../../type_static.ts";
import { create_child_core_ctx } from "./context.ts";
import type { CoreBackendGraph } from "./types.ts";

export type DropAnalysisStmtCollector = (
  stmt: CoreStmt,
  ctx: CoreCtx,
) => void;

export function drop_analysis_static_expr_value(
  backend: CoreBackendGraph,
  expr: CoreExpr,
  ctx: CoreCtx,
  collect_stmt_locals: DropAnalysisStmtCollector,
): CoreExpr | undefined {
  const type_value = drop_analysis_static_type_level_value(expr, ctx);

  if (type_value) {
    return type_value;
  }

  const text_value = backend.text.static_text_value(expr, ctx);

  if (text_value) {
    return text_value;
  }

  if (expr.tag === "freeze") {
    const struct_value = backend.struct.static_struct_value(
      expr.value,
      ctx,
    );

    if (struct_value) {
      return backend.static_value.plan_static_value_expr(
        {
          tag: "freeze",
          value: struct_value,
        },
        ctx,
        undefined,
      ).value;
    }
  }

  if (expr.tag === "var") {
    return ctx.statics.get(expr.name);
  }

  if (expr.tag === "lam" || expr.tag === "rec") {
    return expr;
  }

  if (expr.tag === "struct_update") {
    const updated = backend.struct.static_struct_update_value(expr, ctx);

    if (updated) {
      return updated;
    }
  }

  if (
    expr.tag === "struct_value" ||
    expr.tag === "union_case" ||
    expr.tag === "with"
  ) {
    return expr;
  }

  if (expr.tag === "if") {
    const branch_function = static_core_call_branch_value(expr, ctx, {
      static_core_call_target: backend.static_call.static_core_call_target,
    });

    if (branch_function) {
      return branch_function;
    }

    const then_value = drop_analysis_static_expr_value(
      backend,
      expr.then_branch,
      ctx,
      collect_stmt_locals,
    );
    const else_value = drop_analysis_static_expr_value(
      backend,
      expr.else_branch,
      ctx,
      collect_stmt_locals,
    );

    if (
      then_value && else_value &&
      drop_analysis_static_ownerless_value(then_value) &&
      drop_analysis_static_ownerless_value(else_value)
    ) {
      return expr;
    }
  }

  if (expr.tag !== "block") {
    return undefined;
  }

  const block_ctx = create_child_core_ctx(ctx);

  for (let index = 0; index < expr.statements.length; index += 1) {
    const stmt = expr.statements[index];
    expect(stmt, "Missing core drop-analysis block statement " + index);
    const is_final = index + 1 >= expr.statements.length;

    if (!is_final) {
      collect_stmt_locals(stmt, block_ctx);
      continue;
    }

    if (stmt.tag === "expr") {
      return drop_analysis_static_expr_value(
        backend,
        stmt.expr,
        block_ctx,
        collect_stmt_locals,
      );
    }

    if (stmt.tag === "return") {
      return drop_analysis_static_expr_value(
        backend,
        stmt.value,
        block_ctx,
        collect_stmt_locals,
      );
    }

    collect_stmt_locals(stmt, block_ctx);
  }

  return undefined;
}

export function drop_analysis_runtime_binding_static_expr_value(
  backend: CoreBackendGraph,
  expr: CoreExpr,
  ctx: CoreCtx,
  collect_stmt_locals: DropAnalysisStmtCollector,
): CoreExpr | undefined {
  const value = drop_analysis_static_expr_value(
    backend,
    expr,
    ctx,
    collect_stmt_locals,
  );

  if (!value) {
    return undefined;
  }

  if (value.tag === "with") {
    return undefined;
  }

  return value;
}

function drop_analysis_static_type_level_value(
  expr: CoreExpr,
  ctx: CoreCtx,
): CoreExpr | undefined {
  try {
    return static_type_level_value(expr, ctx);
  } catch (error) {
    if (drop_analysis_ordinary_static_call_probe_error(error)) {
      return undefined;
    }

    throw error;
  }
}

function drop_analysis_ordinary_static_call_probe_error(
  error: unknown,
): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.message.startsWith("Core type constructor expects ")) {
    return true;
  }

  if (error.message.startsWith("Core type constructor argument ")) {
    if (error.message.endsWith(" must resolve to a type name")) {
      return true;
    }
  }

  return false;
}

function drop_analysis_static_ownerless_value(expr: CoreExpr): boolean {
  if (expr.tag === "type_name") {
    return true;
  }

  if (expr.tag === "struct_type") {
    return true;
  }

  if (expr.tag === "union_type") {
    return true;
  }

  if (expr.tag === "text") {
    return true;
  }

  if (expr.tag === "struct_value") {
    return true;
  }

  if (expr.tag === "struct_update") {
    return true;
  }

  if (expr.tag === "union_case") {
    return true;
  }

  if (expr.tag === "with") {
    return true;
  }

  if (expr.tag === "if") {
    return true;
  }

  return false;
}
