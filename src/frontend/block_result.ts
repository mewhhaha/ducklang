import type { FrontExpr, Stmt } from "./ast.ts";

export function stmt_result_expr(stmt: Stmt): FrontExpr | undefined {
  if (stmt.tag === "expr") {
    return stmt.expr;
  }

  if (stmt.tag === "return") {
    return stmt.value;
  }

  return undefined;
}
