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
  return expression_tree_contains(expr, (value) => hole_lambdas.has(value));
}

/** Whether an unlifted hole survives anywhere in this expression. */
export function contains_hole(expr: FrontExpr): boolean {
  return expression_tree_contains(expr, (value) => {
    const candidate = value as { tag?: string; name?: string };
    return candidate.tag === "var" && candidate.name === hole_name;
  });
}

function expression_tree_contains(
  expr: FrontExpr,
  matches: (value: object) => boolean,
): boolean {
  const pending: object[] = [expr];
  const visited = new WeakSet<object>();

  while (pending.length > 0) {
    const value = pending.pop();
    if (value === undefined || visited.has(value)) continue;
    visited.add(value);
    if (matches(value)) return true;

    for (const child of Object.values(value)) {
      if (child === null || typeof child !== "object") continue;
      if (Array.isArray(child)) {
        for (const entry of child) {
          if (entry !== null && typeof entry === "object") {
            pending.push(entry);
          }
        }
        continue;
      }
      pending.push(child);
    }
  }

  return false;
}
