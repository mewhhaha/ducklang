import type { Env, FrontExpr, FrontType } from "../../ast.ts";
import { capture_expr } from "../../capture.ts";
import {
  type CallTargetHooks,
  resolve_dynamic_function_if_target,
} from "../../call_target.ts";
import { clone_env, push_binding } from "../../env.ts";
import { resolve_direct_lambda } from "../../function_if.ts";
import { substitute_front_expr } from "../../substitute.ts";
import { common_front_type, front_type_from_type_name } from "../../types.ts";
import type { StaticLoopHooks } from "../types.ts";

export function dynamic_loop_control_app_result_type(
  value: FrontExpr,
  env: Env,
  hooks: StaticLoopHooks,
): FrontType | undefined {
  const lambda_type = dynamic_loop_control_lambda_app_result_type(
    value,
    env,
    hooks,
  );

  if (lambda_type) {
    return lambda_type;
  }

  const inlined = dynamic_loop_control_inline_app_expr(value, env, hooks);

  if (!inlined) {
    return undefined;
  }

  const type = hooks.infer_expr(inlined.expr, inlined.env);

  if (type.tag === "unknown") {
    return undefined;
  }

  return type;
}

export function dynamic_loop_control_inline_app_expr(
  value: FrontExpr,
  env: Env,
  hooks: StaticLoopHooks,
): { expr: FrontExpr; env: Env } | undefined {
  if (value.tag !== "app") {
    return undefined;
  }

  const target = resolve_direct_lambda(value.func, env);

  if (target) {
    return dynamic_loop_control_inline_lambda_app(
      target.expr,
      target.env,
      value.args,
      env,
    );
  }

  const dynamic_target = resolve_dynamic_function_if_target(
    value.func,
    env,
    dynamic_loop_control_call_target_hooks(hooks),
  );

  if (!dynamic_target) {
    return undefined;
  }

  const then_target = resolve_direct_lambda(
    dynamic_target.expr.then_branch,
    dynamic_target.env,
  );
  const else_target = resolve_direct_lambda(
    dynamic_target.expr.else_branch,
    dynamic_target.env,
  );

  if (!then_target || !else_target) {
    return undefined;
  }

  const then_body = dynamic_loop_control_inline_lambda_app(
    then_target.expr,
    then_target.env,
    value.args,
    env,
  );
  const else_body = dynamic_loop_control_inline_lambda_app(
    else_target.expr,
    else_target.env,
    value.args,
    env,
  );

  if (!then_body || !else_body) {
    return undefined;
  }

  return {
    expr: {
      tag: "if",
      cond: capture_expr(dynamic_target.expr.cond, dynamic_target.env),
      then_branch: capture_expr(then_body.expr, then_body.env),
      else_branch: capture_expr(else_body.expr, else_body.env),
    },
    env,
  };
}

function dynamic_loop_control_lambda_app_result_type(
  value: FrontExpr,
  env: Env,
  hooks: StaticLoopHooks,
): FrontType | undefined {
  if (value.tag !== "app") {
    return undefined;
  }

  const target = resolve_direct_lambda(value.func, env);

  if (target) {
    return dynamic_loop_control_single_lambda_app_result_type(
      target.expr,
      target.env,
      value.args,
      env,
      hooks,
    );
  }

  const dynamic_target = resolve_dynamic_function_if_target(
    value.func,
    env,
    dynamic_loop_control_call_target_hooks(hooks),
  );

  if (!dynamic_target) {
    return undefined;
  }

  const then_target = resolve_direct_lambda(
    dynamic_target.expr.then_branch,
    dynamic_target.env,
  );
  const else_target = resolve_direct_lambda(
    dynamic_target.expr.else_branch,
    dynamic_target.env,
  );

  if (!then_target || !else_target) {
    return undefined;
  }

  const then_type = dynamic_loop_control_single_lambda_app_result_type(
    then_target.expr,
    then_target.env,
    value.args,
    env,
    hooks,
  );
  const else_type = dynamic_loop_control_single_lambda_app_result_type(
    else_target.expr,
    else_target.env,
    value.args,
    env,
    hooks,
  );

  if (!then_type || !else_type) {
    return undefined;
  }

  return common_front_type(then_type, else_type);
}

function dynamic_loop_control_single_lambda_app_result_type(
  lambda: Extract<FrontExpr, { tag: "lam" }>,
  lambda_env: Env,
  args: FrontExpr[],
  arg_env: Env,
  hooks: StaticLoopHooks,
): FrontType | undefined {
  if (args.length !== lambda.params.length) {
    return undefined;
  }

  const call_env = clone_env(lambda_env);

  for (let index = 0; index < lambda.params.length; index += 1) {
    const param = lambda.params[index];
    const arg = args[index];

    if (!param || !arg) {
      return undefined;
    }

    if (param.is_const || param.is_linear) {
      return undefined;
    }

    const param_type = dynamic_loop_control_param_type(
      param.annotation,
      arg,
      arg_env,
      hooks,
    );

    push_binding(call_env, {
      name: param.name,
      ic_name: param.name,
      type: param_type,
      is_const: false,
      is_linear: false,
      value: capture_expr(arg, arg_env),
      value_env: call_env,
    });
  }

  const result_type = hooks.infer_expr(lambda.body, call_env);

  if (result_type.tag === "unknown") {
    return undefined;
  }

  return result_type;
}

function dynamic_loop_control_param_type(
  annotation: string | undefined,
  arg: FrontExpr,
  env: Env,
  hooks: StaticLoopHooks,
): FrontType {
  if (annotation) {
    const resolved = hooks.resolve_annotation_type(annotation, env);

    if (resolved) {
      return resolved;
    }

    const builtin = front_type_from_type_name(annotation);

    if (builtin.tag !== "unknown") {
      return builtin;
    }
  }

  return hooks.infer_expr(arg, env);
}

function dynamic_loop_control_inline_lambda_app(
  lambda: Extract<FrontExpr, { tag: "lam" }>,
  lambda_env: Env,
  args: FrontExpr[],
  arg_env: Env,
): { expr: FrontExpr; env: Env } | undefined {
  if (args.length !== lambda.params.length) {
    return undefined;
  }

  const replacements = new Map<string, FrontExpr>();

  for (let index = 0; index < lambda.params.length; index += 1) {
    const param = lambda.params[index];
    const arg = args[index];

    if (!param || !arg) {
      return undefined;
    }

    if (param.is_const || param.is_linear) {
      return undefined;
    }

    replacements.set(param.name, capture_expr(arg, arg_env));
  }

  return {
    expr: substitute_front_expr(lambda.body, replacements),
    env: lambda_env,
  };
}

function dynamic_loop_control_call_target_hooks(
  hooks: StaticLoopHooks,
): CallTargetHooks {
  return {
    resolve_const_call_target: () => undefined,
    resolve_static_if_branch: (expr, env) => {
      const cond = hooks.resolve_static_i32_expr(expr.cond, env);

      if (cond === undefined) {
        return undefined;
      }

      if (cond !== 0) {
        return expr.then_branch;
      }

      return expr.else_branch;
    },
  };
}
