import type { FrontExpr } from "../ast.ts";

export function expr_root_is_named(
  expr: FrontExpr,
  names: Set<string>,
): boolean {
  if (expr.tag === "captured") {
    return expr_root_is_named(expr.expr, names);
  }

  if (expr.tag === "var") {
    return names.has(expr.name);
  }

  if (expr.tag === "field") {
    return expr_root_is_named(expr.object, names);
  }

  if (expr.tag === "index") {
    return expr_root_is_named(expr.object, names);
  }

  return false;
}
