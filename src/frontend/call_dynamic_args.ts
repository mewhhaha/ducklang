import { expect } from "../expect.ts";
import type { Env, FrontExpr, ResolvedCallTarget } from "./ast.ts";
import {
  resolve_call_target_with_env,
  resolve_dynamic_function_if_target,
} from "./call_resolve.ts";
import type { CallSpecializeHooks } from "./call_specialize_types.ts";

export function check_dynamic_function_if_args(
  expr: Extract<FrontExpr, { tag: "app" }>,
  env: Env,
  hooks: CallSpecializeHooks,
): void {
  const dynamic_target = resolve_dynamic_function_if_target(
    expr.func,
    env,
    hooks,
  );

  if (!dynamic_target) {
    return;
  }

  const then_target = resolve_call_target_with_env(
    dynamic_target.expr.then_branch,
    dynamic_target.env,
    hooks,
  );
  const else_target = resolve_call_target_with_env(
    dynamic_target.expr.else_branch,
    dynamic_target.env,
    hooks,
  );

  if (!then_target || !else_target) {
    return;
  }

  check_call_target_arg_annotations(then_target, expr.args, env, hooks);
  check_call_target_arg_annotations(else_target, expr.args, env, hooks);
}

function check_call_target_arg_annotations(
  target: ResolvedCallTarget,
  args: FrontExpr[],
  env: Env,
  hooks: CallSpecializeHooks,
): void {
  for (let index = 0; index < target.expr.params.length; index += 1) {
    const param = target.expr.params[index];
    const arg = args[index];
    expect(param, "Missing annotated call parameter " + index);

    if (!arg) {
      return;
    }

    if (!param.annotation) {
      continue;
    }

    const arg_type = hooks.infer_expr(arg, env);

    if (arg_type.tag === "unknown") {
      continue;
    }

    hooks.check_binding_annotation(param.annotation, arg, env);
  }
}
