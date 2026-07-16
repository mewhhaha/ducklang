import type { Env, FrontExpr, FrontType } from "../ast.ts";
import { infer_builtin_call_type } from "./prim.ts";
import type { InferExprFn, InferHooks } from "./types.ts";

export function infer_app_expr_type(
  expr: Extract<FrontExpr, { tag: "app" }>,
  env: Env,
  hooks: InferHooks,
  infer_expr: InferExprFn,
): FrontType {
  if (hooks.visible_text_value(expr, env, new Set())) {
    return { tag: "text" };
  }

  const union_value = hooks.resolve_union_constructor_call(expr, env);

  if (union_value && union_value.expr.type_expr) {
    const union_type = hooks.resolve_union_type_value(
      union_value.expr.type_expr,
      union_value.env,
    );

    if (union_type) {
      return { tag: "union_value", cases: union_type.cases };
    }
  }

  const union_call = hooks.infer_call_union_result_type(expr, env);

  if (union_call) {
    return union_call;
  }

  const rec_call = hooks.infer_static_rec_app_type(expr, env);

  if (rec_call) {
    return rec_call;
  }

  const specialized_call = hooks.infer_specialized_app_type(expr, env);

  if (specialized_call) {
    return specialized_call;
  }

  const builtin_call = infer_builtin_call_type(expr, env, hooks, infer_expr);

  if (builtin_call) {
    return builtin_call;
  }

  return { tag: "unknown" };
}
