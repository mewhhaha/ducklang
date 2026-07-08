import { expect } from "../../../expect.ts";
import type { CoreExpr, CoreStmt } from "../../ast.ts";
import type { CoreCtx } from "../../local_collect.ts";

export function drop_analysis_stmt_contains_freeze_consumption(
  stmt: CoreStmt,
): boolean {
  switch (stmt.tag) {
    case "bind":
    case "assign":
      return is_drop_analysis_freeze_consumption(stmt.value);

    case "expr":
      return is_drop_analysis_freeze_consumption(stmt.expr);

    case "return":
      return is_drop_analysis_freeze_consumption(stmt.value);

    case "if_stmt":
      for (const body_stmt of stmt.body) {
        if (drop_analysis_stmt_contains_freeze_consumption(body_stmt)) {
          return true;
        }
      }
      return false;

    case "if_else_stmt":
      for (const body_stmt of stmt.then_body) {
        if (drop_analysis_stmt_contains_freeze_consumption(body_stmt)) {
          return true;
        }
      }

      for (const body_stmt of stmt.else_body) {
        if (drop_analysis_stmt_contains_freeze_consumption(body_stmt)) {
          return true;
        }
      }

      return false;

    case "if_let_stmt":
      for (const body_stmt of stmt.body) {
        if (drop_analysis_stmt_contains_freeze_consumption(body_stmt)) {
          return true;
        }
      }
      return false;

    case "range_loop":
      for (const body_stmt of stmt.body) {
        if (drop_analysis_stmt_contains_freeze_consumption(body_stmt)) {
          return true;
        }
      }
      return false;

    case "collection_loop":
      for (const body_stmt of stmt.body) {
        if (drop_analysis_stmt_contains_freeze_consumption(body_stmt)) {
          return true;
        }
      }
      return false;

    case "index_assign":
      return is_drop_analysis_freeze_consumption(stmt.index) ||
        is_drop_analysis_freeze_consumption(stmt.value);

    case "type_check":
      return is_drop_analysis_freeze_consumption(stmt.target);

    case "break":
    case "continue":
    case "unsupported":
      return false;
  }
}

export function is_drop_analysis_freeze_consumption(expr: CoreExpr): boolean {
  if (expr.tag === "freeze") {
    return true;
  }

  if (expr.tag === "block") {
    const final_stmt = expr.statements[expr.statements.length - 1];
    expect(final_stmt, "Core drop-analysis block has no result statement");

    if (final_stmt.tag === "expr") {
      return is_drop_analysis_freeze_consumption(final_stmt.expr);
    }

    if (final_stmt.tag === "return") {
      return is_drop_analysis_freeze_consumption(final_stmt.value);
    }

    return false;
  }

  if (expr.tag === "if") {
    return is_drop_analysis_freeze_consumption(expr.then_branch) &&
      is_drop_analysis_freeze_consumption(expr.else_branch);
  }

  if (expr.tag === "if_let") {
    return is_drop_analysis_freeze_consumption(expr.then_branch) &&
      is_drop_analysis_freeze_consumption(expr.else_branch);
  }

  return false;
}

export function clear_drop_analysis_local_facts(
  name: string,
  ctx: CoreCtx,
): void {
  ctx.fn_types.delete(name);
  ctx.text_locals.delete(name);
  ctx.struct_locals.delete(name);
  ctx.union_locals.delete(name);
  if (ctx.frozen_locals) {
    ctx.frozen_locals.delete(name);
  }
}
