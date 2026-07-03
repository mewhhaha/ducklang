import type { Env, FrontExpr, ResolvedCallTarget } from "./ast.ts";
import { resolve_const_call_target } from "./call_const.ts";
import {
  type CallTargetHooks,
  resolve_call_target as resolve_call_target_with_hooks,
  resolve_call_target_with_env as resolve_call_target_with_env_with_hooks,
  resolve_dynamic_function_if_target
    as resolve_dynamic_function_if_target_with_hooks,
} from "./call_target.ts";
import type { CallSpecializeHooks } from "./call_specialize_types.ts";

export type DynamicFunctionIfTarget = {
  expr: Extract<FrontExpr, { tag: "if" }>;
  env: Env;
};

export function resolve_call_target(
  expr: FrontExpr,
  env: Env,
  hooks: CallSpecializeHooks,
): Extract<FrontExpr, { tag: "lam" }> | undefined {
  return resolve_call_target_with_hooks(expr, env, call_target_hooks(hooks));
}

export function resolve_call_target_with_env(
  expr: FrontExpr,
  env: Env,
  hooks: CallSpecializeHooks,
): ResolvedCallTarget | undefined {
  return resolve_call_target_with_env_with_hooks(
    expr,
    env,
    call_target_hooks(hooks),
  );
}

export function resolve_dynamic_function_if_target(
  expr: FrontExpr,
  env: Env,
  hooks: CallSpecializeHooks,
): DynamicFunctionIfTarget | undefined {
  return resolve_dynamic_function_if_target_with_hooks(
    expr,
    env,
    call_target_hooks(hooks),
  );
}

function call_target_hooks(hooks: CallSpecializeHooks): CallTargetHooks {
  return {
    resolve_const_call_target: (expr, env) =>
      resolve_const_call_target(expr, env, hooks),
    resolve_static_if_branch: hooks.resolve_static_if_branch,
  };
}
