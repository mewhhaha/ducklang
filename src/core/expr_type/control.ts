import type { CoreExpr } from "../ast.ts";
import { core_stmts_definitely_exit_sequence } from "../borrow/control.ts";

export function core_expr_definitely_exits(expr: CoreExpr): boolean {
  if (expr.tag === "block") {
    return core_stmts_definitely_exit_sequence(expr.statements);
  }

  if (expr.tag === "if") {
    return core_expr_definitely_exits(expr.then_branch) &&
      core_expr_definitely_exits(expr.else_branch);
  }

  if (expr.tag === "if_let") {
    if (expr.implicit_else) {
      return false;
    }

    return core_expr_definitely_exits(expr.then_branch) &&
      core_expr_definitely_exits(expr.else_branch);
  }

  return false;
}
