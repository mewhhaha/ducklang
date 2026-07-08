import type { Ic as IcNode } from "../ic.ts";
import type { Env, FrontExpr, FrontType } from "./ast.ts";
import { lookup } from "./env.ts";
import { unwrap_ownership_wrapper_expr } from "./ownership.ts";
import {
  simple_alias_block_value,
  single_expr_block_result,
} from "./typed_block.ts";
import {
  lower_if_as_front_type,
  lower_if_let_as_front_type,
} from "./typed_if.ts";
import type { FrontTypedLowerHooks } from "./typed_hooks.ts";

export type { FrontTypedLowerHooks, TypedFrontExpr } from "./typed_hooks.ts";

export function lower_expr_as_front_type(
  expr: FrontExpr,
  type: FrontType,
  env: Env,
  hooks: FrontTypedLowerHooks,
): IcNode {
  if (expr.tag === "captured") {
    return lower_expr_as_front_type(expr.expr, type, expr.env, hooks);
  }

  const unwrapped = unwrap_ownership_wrapper_expr(expr);

  if (unwrapped !== expr) {
    return lower_expr_as_front_type(unwrapped, type, env, hooks);
  }

  if (expr.tag === "block") {
    const alias = simple_alias_block_value(expr, type, env, hooks);

    if (alias) {
      return lower_expr_as_front_type(alias, type, env, hooks);
    }

    const result = single_expr_block_result(expr);

    if (result) {
      return lower_expr_as_front_type(result, type, env, hooks);
    }
  }

  if (expr.tag === "var") {
    const binding = lookup(env, expr.name);

    if (binding && binding.is_deferred && binding.value) {
      let value_env = env;

      if (binding.value_env) {
        value_env = binding.value_env;
      }

      return lower_expr_as_front_type(binding.value, type, value_env, hooks);
    }
  }

  if (expr.tag === "app" && hooks.lower_app_as_front_type) {
    const app = hooks.lower_app_as_front_type(expr, type, env);

    if (app) {
      return app;
    }
  }

  if (expr.tag === "if_let") {
    return lower_if_let_as_front_type(
      expr,
      type,
      env,
      hooks,
      lower_expr_as_front_type,
    );
  }

  if (expr.tag !== "if") {
    return hooks.lower_expr(expr, env);
  }

  return lower_if_as_front_type(
    expr,
    type,
    env,
    hooks,
    lower_expr_as_front_type,
  );
}
