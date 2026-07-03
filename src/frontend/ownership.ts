import type { Env, FrontExpr } from "./ast.ts";

export type FrontOwnershipTextHooks = {
  visible_text_value: (
    expr: FrontExpr,
    env: Env,
    seen: Set<string>,
  ) => FrontExpr | undefined;
};

export function front_expr_is_static_shareable_text(
  expr: FrontExpr,
  env: Env,
  hooks: FrontOwnershipTextHooks,
): boolean {
  return hooks.visible_text_value(expr, env, new Set()) !== undefined;
}

export function unwrap_ownership_wrapper_expr(expr: FrontExpr): FrontExpr {
  let current = expr;

  while (
    current.tag === "borrow" || current.tag === "freeze" ||
    current.tag === "scratch"
  ) {
    if (current.tag === "scratch") {
      current = current.body;
    } else {
      current = current.value;
    }
  }

  return current;
}
