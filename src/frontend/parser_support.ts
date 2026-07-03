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

export function binary_precedence(op: string): number {
  if (op === "||") {
    return 1;
  }

  if (op === "&&") {
    return 2;
  }

  if (op === "*" || op === "/" || op === "%") {
    return 20;
  }

  if (op === "+" || op === "-") {
    return 10;
  }

  if (
    op === "==" || op === "!=" || op === "<" || op === ">" || op === "<=" ||
    op === ">="
  ) {
    return 5;
  }

  return -1;
}

export function can_start_struct_value(expr: FrontExpr): boolean {
  if (expr.tag === "var") {
    return expr.name.endsWith("_type");
  }

  if (expr.tag === "app") {
    return true;
  }

  if (expr.tag === "field") {
    return true;
  }

  return false;
}
