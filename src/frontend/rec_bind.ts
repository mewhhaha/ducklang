import { expect } from "../expect.ts";
import type { Env, FrontExpr } from "./ast.ts";
import type { StaticRecHooks } from "./rec_hooks.ts";

export type StaticRecTarget = {
  expr: Extract<FrontExpr, { tag: "rec" }>;
  env: Env;
};

export function resolve_rec_target(
  expr: FrontExpr,
  env: Env,
  hooks: StaticRecHooks,
): StaticRecTarget | undefined {
  if (expr.tag === "rec") {
    return { expr, env };
  }

  if (expr.tag !== "var") {
    return undefined;
  }

  const binding = hooks.lookup(env, expr.name);

  if (!binding || !binding.value || binding.value.tag !== "rec") {
    return undefined;
  }

  let value_env = env;

  if (binding.value_env) {
    value_env = binding.value_env;
  }

  return { expr: binding.value, env: value_env };
}

export function bind_rec_args(
  rec: Extract<FrontExpr, { tag: "rec" }>,
  args: FrontExpr[],
  env: Env,
  hooks: StaticRecHooks,
): void {
  for (let index = 0; index < rec.params.length; index += 1) {
    const param = rec.params[index];
    const arg = args[index];
    expect(param, "Missing rec parameter " + index);
    expect(arg, "Missing rec argument " + index);

    if (param.is_const) {
      hooks.validate_const_expr(
        arg,
        env,
        new Set(),
        "Const parameter " + param.name + " requires compile-time argument",
      );
      const value = hooks.capture_const_ref(arg, env);

      if (param.annotation) {
        hooks.check_const_annotation(param.annotation, value, env);
      }

      hooks.push_binding(env, {
        name: param.name,
        ic_name: param.name,
        type: hooks.infer_expr(value, env),
        is_const: true,
        is_linear: false,
        value,
        value_env: undefined,
      });
      continue;
    }

    if (param.is_linear) {
      throw new Error("Cannot lower linear parameter to pure Ic frontend yet");
    }

    let value = arg;
    let value_type = hooks.infer_expr(value, env);

    if (param.annotation) {
      const annotated = hooks.apply_runtime_binding_annotation(
        param.annotation,
        value,
        env,
      );
      value = annotated.value;
      value_type = annotated.type;
    }

    hooks.push_binding(env, {
      name: param.name,
      ic_name: hooks.fresh(env, param.name),
      type: value_type,
      is_const: false,
      is_linear: param.is_linear,
      value,
      value_env: env,
    });
  }
}
