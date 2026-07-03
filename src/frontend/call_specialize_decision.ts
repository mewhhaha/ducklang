import { expect } from "../expect.ts";
import type { Env, FrontExpr } from "./ast.ts";
import { has_const_param, has_runtime_annotation_param } from "./call_args.ts";
import {
  resolve_deferred_frontend_value,
  resolve_deferred_text_value,
} from "./call_deferred.ts";
import type { CallSpecializeHooks } from "./call_specialize_types.ts";
import {
  has_visible_value_param,
  param_can_defer_visible_text,
} from "./visible_params.ts";

export function requires_specialized_call(
  expr: Extract<FrontExpr, { tag: "lam" }>,
  env: Env,
  hooks: CallSpecializeHooks,
): boolean {
  return has_const_param(expr) ||
    has_runtime_annotation_param(expr, env, hooks) ||
    has_visible_value_param(expr);
}

export function should_specialize_app(
  target: Extract<FrontExpr, { tag: "lam" }>,
  args: FrontExpr[],
  env: Env,
  hooks: CallSpecializeHooks,
): boolean {
  const params = target.params;

  if (params.length === 0 && args.length === 0) {
    return true;
  }

  for (const param of params) {
    if (param.is_const) {
      return true;
    }

    if (param.annotation) {
      return true;
    }
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const param = params[index];
    expect(arg, "Missing specialization argument " + index.toString());

    if (resolve_deferred_frontend_value(arg, env, hooks)) {
      return true;
    }

    if (param && param_can_defer_visible_text(target, param)) {
      if (resolve_deferred_text_value(arg, env, hooks)) {
        return true;
      }
    }

    const arg_type = hooks.infer_expr(arg, env);

    if (arg_type.tag === "text") {
      return true;
    }

    if (arg_type.tag === "struct") {
      return true;
    }

    if (arg_type.tag === "union_value") {
      return true;
    }
  }

  return false;
}
