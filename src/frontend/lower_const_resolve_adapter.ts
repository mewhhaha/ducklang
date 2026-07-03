import type { Binding, Env, FrontExpr, ResolvedFrontExpr } from "./ast.ts";
import {
  type ConstBuiltinHooks,
  eval_const_builtin as eval_const_builtin_with_hooks,
} from "./const_builtin.ts";
import {
  type ConstResolveHooks,
  lookup_const_field as lookup_const_field_with_hooks,
  resolve_const_expr as resolve_const_expr_with_hooks,
  resolve_const_expr_with_env as resolve_const_expr_with_env_with_hooks,
  resolve_const_field_expr as resolve_const_field_expr_with_hooks,
} from "./const_resolve.ts";

export type FrontendConstResolveApi = {
  capture_expr: (expr: FrontExpr, env: Env) => FrontExpr;
  eval_simple_front_block: (
    expr: Extract<FrontExpr, { tag: "block" }>,
    env: Env,
  ) => FrontExpr | undefined;
  lookup: (env: Env, name: string) => Binding | undefined;
  resolve_extended_type_value: (expr: FrontExpr, env: Env) => FrontExpr;
  resolve_index_expr: (
    expr: Extract<FrontExpr, { tag: "index" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  resolve_static_i32_expr: (
    expr: FrontExpr,
    env: Env,
  ) => number | undefined;
  resolve_struct_value: (
    expr: FrontExpr,
    env: Env,
  ) =>
    | { expr: Extract<FrontExpr, { tag: "struct_value" }>; env: Env }
    | undefined;
  try_eval_all_const_call: (
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ) => FrontExpr | undefined;
};

export type FrontendConstResolve = {
  eval_const_builtin: (
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ) => FrontExpr | undefined;
  lookup_const_field: (
    value: FrontExpr,
    name: string,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  resolve_const_expr: (
    expr: FrontExpr,
    env: Env,
  ) => FrontExpr | undefined;
  resolve_const_expr_with_env: (
    expr: FrontExpr,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  resolve_const_field_expr: (
    expr: Extract<FrontExpr, { tag: "field" }>,
    env: Env,
  ) => FrontExpr | undefined;
};

export function create_frontend_const_resolve(
  api: FrontendConstResolveApi,
): FrontendConstResolve {
  const const_builtin_hooks = {
    capture_expr: api.capture_expr,
    lookup: api.lookup,
    lookup_const_field,
    resolve_const_expr,
    resolve_const_expr_with_env,
    resolve_extended_type_value: api.resolve_extended_type_value,
    resolve_index_expr: api.resolve_index_expr,
    resolve_struct_value: api.resolve_struct_value,
  } satisfies ConstBuiltinHooks;

  const const_resolve_hooks = {
    eval_const_builtin,
    eval_simple_front_block: api.eval_simple_front_block,
    resolve_index_expr: api.resolve_index_expr,
    resolve_static_i32_expr: api.resolve_static_i32_expr,
    try_eval_all_const_call: api.try_eval_all_const_call,
  } satisfies ConstResolveHooks;

  function eval_const_builtin(
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ): FrontExpr | undefined {
    return eval_const_builtin_with_hooks(expr, env, const_builtin_hooks);
  }

  function resolve_const_field_expr(
    expr: Extract<FrontExpr, { tag: "field" }>,
    env: Env,
  ): FrontExpr | undefined {
    return resolve_const_field_expr_with_hooks(
      expr,
      env,
      const_resolve_hooks,
    );
  }

  function resolve_const_expr(
    expr: FrontExpr,
    env: Env,
  ): FrontExpr | undefined {
    return resolve_const_expr_with_hooks(expr, env, const_resolve_hooks);
  }

  function resolve_const_expr_with_env(
    expr: FrontExpr,
    env: Env,
  ): ResolvedFrontExpr | undefined {
    return resolve_const_expr_with_env_with_hooks(
      expr,
      env,
      const_resolve_hooks,
    );
  }

  function lookup_const_field(
    value: FrontExpr,
    name: string,
    env: Env,
  ): ResolvedFrontExpr | undefined {
    return lookup_const_field_with_hooks(
      value,
      name,
      env,
      const_resolve_hooks,
    );
  }

  return {
    eval_const_builtin,
    lookup_const_field,
    resolve_const_expr,
    resolve_const_expr_with_env,
    resolve_const_field_expr,
  };
}
