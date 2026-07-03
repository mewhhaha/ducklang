import { expect } from "../expect.ts";
import type { Env, FrontExpr, FrontType } from "./ast.ts";
import { resolve_deferred_frontend_value } from "./call_deferred.ts";
import { resolve_call_target_with_env } from "./call_resolve.ts";
import type { CallSpecializeHooks } from "./call_specialize_types.ts";
import { clone_env, push_binding } from "./env.ts";

export function infer_call_union_result_type(
  expr: Extract<FrontExpr, { tag: "app" }>,
  env: Env,
  hooks: CallSpecializeHooks,
): FrontType | undefined {
  const target = resolve_call_target_with_env(expr.func, env, hooks);

  if (!target) {
    return undefined;
  }

  if (expr.args.length !== target.expr.params.length) {
    return undefined;
  }

  const call_env = clone_env(target.env);

  for (let index = 0; index < target.expr.params.length; index += 1) {
    const param = target.expr.params[index];
    const arg = expr.args[index];
    expect(param, "Missing union result parameter " + index);
    expect(arg, "Missing union result argument " + index);

    if (param.is_const || param.is_linear) {
      return undefined;
    }

    let type = hooks.infer_expr(arg, env);

    if (param.annotation) {
      const annotation_type = hooks.resolve_annotation_type(
        param.annotation,
        env,
      );

      if (annotation_type) {
        type = annotation_type;
      }
    }

    const deferred = resolve_deferred_frontend_value(arg, env, hooks);
    let value: FrontExpr | undefined;
    let value_env: Env | undefined;

    if (deferred) {
      value = deferred.expr;
      value_env = deferred.env;
    }

    push_binding(call_env, {
      name: param.name,
      ic_name: param.name,
      type,
      is_const: false,
      is_linear: false,
      value,
      value_env,
    });
  }

  const cases = hooks.infer_union_cases(target.expr.body, call_env);

  if (!cases) {
    return undefined;
  }

  return { tag: "union_value", cases };
}
