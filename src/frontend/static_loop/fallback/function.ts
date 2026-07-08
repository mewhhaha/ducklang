import type { Env, FrontExpr, FrontType, Param } from "../../ast.ts";
import { capture_expr } from "../../capture.ts";
import { lookup } from "../../env.ts";
import {
  function_if_param_types,
  resolve_direct_lambda,
} from "../../function_if.ts";
import { substitute_front_expr } from "../../substitute.ts";
import { type_name_from_front_type } from "../../types.ts";
import type { StaticLoopHooks } from "../types.ts";

export function dynamic_loop_control_function_type(
  value: FrontExpr,
  env: Env,
  hooks: StaticLoopHooks,
): Extract<FrontType, { tag: "fn" }> | undefined {
  const target = resolve_direct_lambda(value, env);

  if (target) {
    return { tag: "fn", params: target.expr.params };
  }

  const branch = dynamic_loop_control_function_if_value(value, env, hooks);

  if (!branch) {
    const if_let_branch = dynamic_loop_control_function_if_let_value(
      value,
      env,
      hooks,
    );

    if (!if_let_branch) {
      return undefined;
    }

    return { tag: "fn", params: if_let_branch.params };
  }

  return { tag: "fn", params: branch.params };
}

export function dynamic_loop_control_function_fallback(
  value: FrontExpr,
  env: Env,
  hooks: StaticLoopHooks,
): FrontExpr | undefined {
  const target = resolve_direct_lambda(value, env);

  if (target) {
    return capture_expr(target.expr, target.env);
  }

  const branch = dynamic_loop_control_function_if_value(value, env, hooks);

  if (branch) {
    return branch;
  }

  return dynamic_loop_control_function_if_let_value(value, env, hooks);
}

export function dynamic_loop_control_function_value(
  value: FrontExpr,
  env: Env,
  hooks: StaticLoopHooks,
): FrontExpr {
  const target = resolve_direct_lambda(value, env);

  if (target) {
    return capture_expr(target.expr, target.env);
  }

  const branch = dynamic_loop_control_function_if_value(value, env, hooks);

  if (branch) {
    return branch;
  }

  const if_let_branch = dynamic_loop_control_function_if_let_value(
    value,
    env,
    hooks,
  );

  if (if_let_branch) {
    return if_let_branch;
  }

  return value;
}

function dynamic_loop_control_function_if_value(
  value: FrontExpr,
  env: Env,
  hooks: StaticLoopHooks,
): Extract<FrontExpr, { tag: "lam" }> | undefined {
  if (value.tag !== "if") {
    return undefined;
  }

  const then_target = resolve_direct_lambda(value.then_branch, env);
  const else_target = resolve_direct_lambda(value.else_branch, env);

  if (!then_target || !else_target) {
    return undefined;
  }

  const param_types = function_if_param_types(
    then_target.expr.params,
    then_target.env,
    else_target.expr.params,
    else_target.env,
    hooks,
  );

  if (!param_types) {
    return undefined;
  }

  const params: Param[] = [];
  const then_replacements = new Map<string, FrontExpr>();
  const else_replacements = new Map<string, FrontExpr>();
  const param_names = new Set<string>();

  for (let index = 0; index < then_target.expr.params.length; index += 1) {
    const then_param = then_target.expr.params[index];
    const else_param = else_target.expr.params[index];
    const param_type = param_types[index];

    if (!then_param || !else_param || !param_type) {
      return undefined;
    }

    if (then_param.is_linear || else_param.is_linear) {
      return undefined;
    }

    const name = then_param.name;
    param_names.add(name);
    let annotation = then_param.annotation;

    if (!annotation) {
      annotation = else_param.annotation;
    }

    if (!annotation) {
      annotation = type_name_from_front_type(param_type);
    }

    params.push({
      ...then_param,
      name,
      annotation,
    });
    then_replacements.set(then_param.name, { tag: "var", name });
    else_replacements.set(else_param.name, { tag: "var", name });
  }

  const then_capture_replacements = dynamic_loop_control_capture_replacements(
    then_target.env,
    env,
    param_names,
  );
  const else_capture_replacements = dynamic_loop_control_capture_replacements(
    else_target.env,
    env,
    param_names,
  );

  if (!then_capture_replacements || !else_capture_replacements) {
    return undefined;
  }

  for (const [name, replacement] of then_capture_replacements) {
    then_replacements.set(name, replacement);
  }

  for (const [name, replacement] of else_capture_replacements) {
    else_replacements.set(name, replacement);
  }

  return {
    tag: "lam",
    params,
    body: {
      tag: "if",
      cond: value.cond,
      then_branch: substitute_front_expr(
        then_target.expr.body,
        then_replacements,
      ),
      else_branch: substitute_front_expr(
        else_target.expr.body,
        else_replacements,
      ),
    },
  };
}

function dynamic_loop_control_function_if_let_value(
  value: FrontExpr,
  env: Env,
  hooks: StaticLoopHooks,
): Extract<FrontExpr, { tag: "lam" }> | undefined {
  if (value.tag !== "if_let") {
    return undefined;
  }

  if (value.implicit_else) {
    return undefined;
  }

  const then_target = resolve_direct_lambda(value.then_branch, env);
  const else_target = resolve_direct_lambda(value.else_branch, env);

  if (!then_target || !else_target) {
    return undefined;
  }

  const param_types = function_if_param_types(
    then_target.expr.params,
    then_target.env,
    else_target.expr.params,
    else_target.env,
    hooks,
  );

  if (!param_types) {
    return undefined;
  }

  const selected = dynamic_loop_control_selected_function_parts(
    then_target.expr,
    then_target.env,
    else_target.expr,
    else_target.env,
    env,
    param_types,
    hooks,
    value.value_name,
  );

  if (!selected) {
    return undefined;
  }

  return {
    tag: "lam",
    params: selected.params,
    body: {
      tag: "if_let",
      case_name: value.case_name,
      value_name: value.value_name,
      target: value.target,
      then_branch: substitute_front_expr(
        then_target.expr.body,
        selected.then_replacements,
      ),
      else_branch: substitute_front_expr(
        else_target.expr.body,
        selected.else_replacements,
      ),
      implicit_else: value.implicit_else,
    },
  };
}

function dynamic_loop_control_selected_function_parts(
  then_expr: Extract<FrontExpr, { tag: "lam" }>,
  then_env: Env,
  else_expr: Extract<FrontExpr, { tag: "lam" }>,
  else_env: Env,
  base_env: Env,
  param_types: FrontType[],
  _hooks: StaticLoopHooks,
  protected_name: string | undefined,
):
  | {
    params: Param[];
    then_replacements: Map<string, FrontExpr>;
    else_replacements: Map<string, FrontExpr>;
  }
  | undefined {
  const params: Param[] = [];
  const then_replacements = new Map<string, FrontExpr>();
  const else_replacements = new Map<string, FrontExpr>();
  const protected_names = new Set<string>();

  if (protected_name) {
    protected_names.add(protected_name);
  }

  for (let index = 0; index < then_expr.params.length; index += 1) {
    const then_param = then_expr.params[index];
    const else_param = else_expr.params[index];
    const param_type = param_types[index];

    if (!then_param || !else_param || !param_type) {
      return undefined;
    }

    if (then_param.is_linear || else_param.is_linear) {
      return undefined;
    }

    const name = then_param.name;
    protected_names.add(name);
    let annotation = then_param.annotation;

    if (!annotation) {
      annotation = else_param.annotation;
    }

    if (!annotation) {
      annotation = type_name_from_front_type(param_type);
    }

    params.push({
      ...then_param,
      name,
      annotation,
    });
    then_replacements.set(then_param.name, { tag: "var", name });
    else_replacements.set(else_param.name, { tag: "var", name });
  }

  const then_capture_replacements = dynamic_loop_control_capture_replacements(
    then_env,
    base_env,
    protected_names,
  );
  const else_capture_replacements = dynamic_loop_control_capture_replacements(
    else_env,
    base_env,
    protected_names,
  );

  if (!then_capture_replacements || !else_capture_replacements) {
    return undefined;
  }

  for (const [name, replacement] of then_capture_replacements) {
    then_replacements.set(name, replacement);
  }

  for (const [name, replacement] of else_capture_replacements) {
    else_replacements.set(name, replacement);
  }

  return {
    params,
    then_replacements,
    else_replacements,
  };
}

function dynamic_loop_control_capture_replacements(
  source: Env,
  base: Env,
  protected_names: Set<string>,
): Map<string, FrontExpr> | undefined {
  const replacements = new Map<string, FrontExpr>();

  for (const scope of source.scopes) {
    for (const [name, binding] of scope) {
      if (protected_names.has(name)) {
        continue;
      }

      const base_binding = lookup(base, name);

      if (base_binding === binding) {
        continue;
      }

      if (binding.is_linear) {
        return undefined;
      }

      if (!binding.value) {
        return undefined;
      }

      let value_env = source;

      if (binding.value_env) {
        value_env = binding.value_env;
      }

      replacements.set(name, capture_expr(binding.value, value_env));
    }
  }

  return replacements;
}
