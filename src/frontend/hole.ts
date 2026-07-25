import type { FrontExpr } from "./ast.ts";

/**
 * Reserved name a parsed argument hole carries until the enclosing application
 * lifts it into a lambda. It cannot collide with a source name because `@`
 * only ever begins an intrinsic.
 */
export const hole_name = "@hole";

/**
 * Lambdas synthesised from an argument hole.
 *
 * Parsing is bottom-up, so an inner call lifts its own hole before the
 * enclosing application sees it. Without this, `f [g [_], _]` would quietly
 * bind each hole to its nearest call — the innermost-binding rule that makes
 * the same syntax hard to predict elsewhere. Recording which lambdas came from
 * holes lets the enclosing application reject that shape instead.
 */
const hole_lambdas = new WeakSet<object>();

export function mark_hole_lambda(expr: FrontExpr): FrontExpr {
  hole_lambdas.add(expr);
  return expr;
}

/** Whether this expression is, or contains, a lambda lifted from a hole. */
export function contains_hole_lambda(expr: FrontExpr): boolean {
  if (hole_lambdas.has(expr)) {
    return true;
  }

  if (expr.tag === "product") {
    return expr.entries.some((entry) => contains_hole_lambda(entry.value));
  }

  if (expr.tag === "app") {
    if (expr.arg !== undefined && contains_hole_lambda(expr.arg)) {
      return true;
    }

    return contains_hole_lambda(expr.func);
  }

  return false;
}

/** Whether an unlifted hole survives anywhere in this expression. */
export function contains_hole(expr: FrontExpr): boolean {
  if (expr.tag === "var") {
    return expr.name === hole_name;
  }

  if (expr.tag === "product") {
    return expr.entries.some((entry) => contains_hole(entry.value));
  }

  if (expr.tag === "app") {
    if (expr.arg !== undefined && contains_hole(expr.arg)) {
      return true;
    }

    return contains_hole(expr.func);
  }

  return false;
}
