import type { CoreExpr } from "../ast.ts";
import type { CoreUnionCtx, CoreUnionHooks } from "./types.ts";

export function scoped_union_static_call_value<ctx extends CoreUnionCtx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreUnionHooks<ctx>,
): { value: CoreExpr; ctx: ctx } | undefined {
  if (expr.tag !== "app") {
    return undefined;
  }

  const target = hooks.static_core_call_target(expr.func, ctx);

  if (!target) {
    return undefined;
  }

  if (!hooks.static_core_call_requires_scope(target)) {
    return undefined;
  }

  return hooks.scoped_static_core_call_value(expr, target, ctx);
}
