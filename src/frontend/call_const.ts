import { expect } from "../expect.ts";
import type { Env, FrontExpr, FrontType, ResolvedCallTarget } from "./ast.ts";
import { capture_const_ref } from "./capture.ts";
import { is_const_expr_known } from "./const_known.ts";
import { validate_const_expr } from "./constness.ts";
import { clone_env, lookup, push_binding } from "./env.ts";

export type CallConstHooks = {
  check_const_annotation: (
    annotation: string,
    expr: FrontExpr,
    env: Env,
  ) => void;
  eval_front_value: (expr: FrontExpr, env: Env) => FrontExpr;
  infer_expr: (expr: FrontExpr, env: Env) => FrontType;
  resolve_const_field_expr: (
    expr: Extract<FrontExpr, { tag: "field" }>,
    env: Env,
  ) => FrontExpr | undefined;
};

export function try_eval_all_const_call(
  expr: Extract<FrontExpr, { tag: "app" }>,
  env: Env,
  hooks: CallConstHooks,
): FrontExpr | undefined {
  if (!can_eval_const_call(expr, env, true, hooks)) {
    return undefined;
  }

  return eval_const_call(expr, env, true, hooks);
}

export function can_eval_const_call(
  expr: Extract<FrontExpr, { tag: "app" }>,
  env: Env,
  allow_unmarked_params: boolean,
  hooks: CallConstHooks,
): boolean {
  const target = resolve_const_call_target(expr.func, env, hooks);

  if (!target) {
    return false;
  }

  if (expr.args.length !== target.expr.params.length) {
    return false;
  }

  for (const param of target.expr.params) {
    if (param.is_linear) {
      return false;
    }

    if (!param.is_const && !allow_unmarked_params) {
      return false;
    }
  }

  for (const arg of expr.args) {
    if (!is_const_expr_known(arg, env, new Set())) {
      return false;
    }
  }

  return true;
}

export function eval_const_call(
  expr: Extract<FrontExpr, { tag: "app" }>,
  env: Env,
  allow_unmarked_params: boolean,
  hooks: CallConstHooks,
): FrontExpr | undefined {
  const target = resolve_const_call_target(expr.func, env, hooks);

  if (!target) {
    return undefined;
  }

  if (expr.args.length !== target.expr.params.length) {
    return undefined;
  }

  for (const param of target.expr.params) {
    if (!param.is_const && !allow_unmarked_params) {
      return undefined;
    }
  }

  const call_env = clone_env(target.env);

  for (let index = 0; index < target.expr.params.length; index += 1) {
    const param = target.expr.params[index];
    const arg = expr.args[index];
    expect(param, "Missing const call parameter " + index);
    expect(arg, "Missing const call argument " + index);
    validate_const_expr(
      arg,
      env,
      new Set(),
      "Const parameter " + param.name + " requires compile-time argument",
    );
    const value = capture_const_ref(arg, env);

    if (param.annotation) {
      hooks.check_const_annotation(param.annotation, value, env);
    }

    push_binding(call_env, {
      name: param.name,
      ic_name: param.name,
      type: hooks.infer_expr(value, env),
      is_const: true,
      is_linear: false,
      value,
      value_env: undefined,
    });
  }

  return hooks.eval_front_value(target.expr.body, call_env);
}

export function resolve_const_call_target(
  expr: FrontExpr,
  env: Env,
  hooks: CallConstHooks,
): ResolvedCallTarget | undefined {
  if (expr.tag === "captured") {
    return resolve_const_call_target(expr.expr, expr.env, hooks);
  }

  if (expr.tag === "lam") {
    return { expr, env };
  }

  if (expr.tag === "field") {
    const field = hooks.resolve_const_field_expr(expr, env);

    if (!field) {
      return undefined;
    }

    return resolve_const_call_target(field, env, hooks);
  }

  if (expr.tag === "app") {
    const value = try_eval_all_const_call(expr, env, hooks);

    if (!value) {
      return undefined;
    }

    return resolve_const_call_target(value, env, hooks);
  }

  if (expr.tag !== "var") {
    return undefined;
  }

  const binding = lookup(env, expr.name);

  if (!binding || !binding.is_const || !binding.value) {
    return undefined;
  }

  let value_env = env;

  if (binding.value_env) {
    value_env = binding.value_env;
  }

  return resolve_const_call_target(binding.value, value_env, hooks);
}
