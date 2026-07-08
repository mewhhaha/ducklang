import type { FrontExpr, Source as SourceNode, Stmt } from "./ast.ts";
import { format_expr_with_stmt } from "./format/expr.ts";
import { format_stmt_with_expr } from "./format/stmt.ts";

export function format_source(source: SourceNode): string {
  return source.statements.map(format_stmt).join("\n");
}

function format_stmt(stmt: Stmt): string {
  return format_stmt_with_expr(stmt, format_expr);
}

export function format_expr(expr: FrontExpr): string {
  return format_expr_with_stmt(expr, format_stmt);
}
