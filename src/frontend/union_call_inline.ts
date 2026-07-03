import type { Env, FrontExpr, ResolvedFrontExpr } from "./ast.ts";

export type UnionCallInlineHooks = {
  inline_deferred_const_call: (
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  inline_runtime_call_expr: (
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  inline_specialized_call_expr: (
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
};

export function inline_union_result_call(
  expr: Extract<FrontExpr, { tag: "app" }>,
  env: Env,
  hooks: UnionCallInlineHooks,
): ResolvedFrontExpr | undefined {
  const deferred = hooks.inline_deferred_const_call(expr, env);

  if (deferred) {
    return deferred;
  }

  const specialized = hooks.inline_specialized_call_expr(expr, env);

  if (specialized) {
    return specialized;
  }

  return hooks.inline_runtime_call_expr(expr, env);
}
