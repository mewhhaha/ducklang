import { expect } from "../../expect.ts";
import type { CoreExpr } from "../ast.ts";

export function static_block_result(expr: CoreExpr): CoreExpr | undefined {
  if (expr.tag !== "block") {
    return undefined;
  }

  if (expr.statements.length !== 1) {
    return undefined;
  }

  const stmt = expr.statements[0];
  expect(stmt, "Missing static block statement");

  if (stmt.tag === "expr") {
    return stmt.expr;
  }

  if (stmt.tag === "return") {
    return stmt.value;
  }

  return undefined;
}
