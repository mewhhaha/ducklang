import type { Ic as IcNode } from "../ic.ts";
import type { Binding, Env, FrontExpr, ResolvedFrontExpr } from "./ast.ts";
import {
  eval_i32_expr as eval_i32_expr_with_hooks,
  lower_static_expr as lower_static_expr_with_hooks,
  resolve_static_i32_expr as resolve_static_i32_expr_with_hooks,
  type StaticExprHooks,
} from "./static_expr.ts";

export type FrontendStaticExprApi = {
  lookup: (env: Env, name: string) => Binding | undefined;
  lower_expr: (expr: FrontExpr, env: Env) => IcNode;
  resolve_index_expr: (
    expr: Extract<FrontExpr, { tag: "index" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  resolve_struct_field_expr: (
    expr: Extract<FrontExpr, { tag: "field" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
};

export type FrontendStaticExpr = {
  eval_i32_expr: (expr: FrontExpr, env: Env, label: string) => number;
  lower_static_expr: (
    expr: FrontExpr,
    env: Env,
    seen: Set<Binding>,
  ) => IcNode | undefined;
  resolve_static_i32_expr: (
    expr: FrontExpr,
    env: Env,
  ) => number | undefined;
};

export function create_frontend_static_expr(
  api: FrontendStaticExprApi,
): FrontendStaticExpr {
  const static_expr_hooks = {
    lookup: api.lookup,
    lower_expr: api.lower_expr,
    resolve_index_expr: api.resolve_index_expr,
    resolve_struct_field_expr: api.resolve_struct_field_expr,
  } satisfies StaticExprHooks;

  function eval_i32_expr(
    expr: FrontExpr,
    env: Env,
    label: string,
  ): number {
    return eval_i32_expr_with_hooks(expr, env, label, static_expr_hooks);
  }

  function lower_static_expr(
    expr: FrontExpr,
    env: Env,
    seen: Set<Binding>,
  ): IcNode | undefined {
    return lower_static_expr_with_hooks(expr, env, seen, static_expr_hooks);
  }

  function resolve_static_i32_expr(
    expr: FrontExpr,
    env: Env,
  ): number | undefined {
    return resolve_static_i32_expr_with_hooks(expr, env, static_expr_hooks);
  }

  return {
    eval_i32_expr,
    lower_static_expr,
    resolve_static_i32_expr,
  };
}
