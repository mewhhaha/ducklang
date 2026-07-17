import type { FrontExpr } from "./ast.ts";
import { is_builtin_type_name } from "./types.ts";

export function unsupported_reserved_feature(
  name: string,
): string | undefined {
  if (name === "class") {
    return "classes";
  }

  if (name === "trait") {
    return "traits";
  }

  if (name === "macro") {
    return "macros";
  }

  if (name === "instance") {
    return "runtime instance search";
  }

  if (name === "extends" || name === "inherits") {
    return "inheritance";
  }

  if (name === "where") {
    return "where clauses";
  }

  return undefined;
}

export function is_builtin_type_reference_name(name: string): boolean {
  if (is_builtin_type_name(name)) {
    return true;
  }

  return name === "Type";
}

export function module_value(expr: FrontExpr): FrontExpr {
  if (expr.tag !== "lam") {
    return expr;
  }

  return {
    tag: "lam",
    params: expr.params.map((param) => ({ ...param, is_const: true })),
    body: expr.body,
  };
}
