import type { FrontExpr, Stmt } from "./ast.ts";

export function expression_does_not_fall_through(expr: FrontExpr): boolean {
  if (expr.tag === "block") {
    return statements_do_not_fall_through(expr.statements);
  }

  if (expr.tag === "if") {
    return expression_does_not_fall_through(expr.then_branch) &&
      expression_does_not_fall_through(expr.else_branch);
  }

  if (expr.tag === "if_let") {
    return expression_does_not_fall_through(expr.then_branch) &&
      expression_does_not_fall_through(expr.else_branch);
  }

  if (expr.tag === "match") {
    return expr.arms.length > 0 && expr.arms.every((arm) => {
      return expression_does_not_fall_through(arm.body);
    });
  }

  return expr.tag === "app" && expr.func.tag === "var" &&
    expr.func.name === "@panic";
}

function statements_do_not_fall_through(statements: Stmt[]): boolean {
  for (const statement of statements) {
    if (statement_does_not_fall_through(statement)) {
      return true;
    }
  }

  return false;
}

function statement_does_not_fall_through(statement: Stmt): boolean {
  if (
    statement.tag === "return" || statement.tag === "break" ||
    statement.tag === "continue"
  ) {
    return true;
  }

  if (statement.tag === "expr") {
    return expression_does_not_fall_through(statement.expr);
  }

  return false;
}
