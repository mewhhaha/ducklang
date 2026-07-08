import type { Env, Field, FrontExpr, FrontType } from "../../ast.ts";
import { capture_expr } from "../../capture.ts";
import { front_type_from_type_name } from "../../types.ts";
import type { DynamicLoopState } from "../dynamic_control.ts";
import type { StaticLoopHooks } from "../types.ts";
import { dynamic_loop_control_typed_value_env } from "./typed_env.ts";
import { dynamic_loop_control_type_fallback } from "./type_fallback.ts";

export function dynamic_loop_control_guarded_binding_value(
  name: string,
  type: FrontType,
  value: FrontExpr,
  env: Env,
  hooks: StaticLoopHooks,
  state: DynamicLoopState,
): FrontExpr | undefined {
  if (type.tag === "union_value") {
    const fallback = dynamic_loop_control_type_fallback(
      name,
      type,
      env,
      hooks,
    );

    if (!fallback) {
      return undefined;
    }

    const value_env = dynamic_loop_control_typed_value_env(value, type, env);

    if (!value_env) {
      return undefined;
    }

    return {
      tag: "if",
      cond: { tag: "var", name: state.step_name },
      then_branch: capture_expr(value, value_env),
      else_branch: fallback,
    };
  }

  if (type.tag === "struct" && type.field_types) {
    return dynamic_loop_control_guarded_struct_value(
      name,
      type,
      value,
      env,
      hooks,
      state,
    );
  }

  return undefined;
}

function dynamic_loop_control_guarded_struct_value(
  name: string,
  type: Extract<FrontType, { tag: "struct" }>,
  value: FrontExpr,
  env: Env,
  hooks: StaticLoopHooks,
  state: DynamicLoopState,
): Extract<FrontExpr, { tag: "struct_value" }> | undefined {
  if (!type.field_types) {
    return undefined;
  }

  const value_env = dynamic_loop_control_typed_value_env(value, type, env);

  if (!value_env) {
    return undefined;
  }

  const fields: Field[] = [];

  for (const field of type.field_types) {
    const field_value: FrontExpr = {
      tag: "field",
      object: value,
      name: field.name,
    };
    const guarded = dynamic_loop_control_guarded_type_name_value(
      name + "." + field.name,
      field.type_name,
      field_value,
      value_env,
      hooks,
      state,
    );

    if (!guarded) {
      return undefined;
    }

    fields.push({ name: field.name, value: guarded });
  }

  return {
    tag: "struct_value",
    type_expr: { tag: "struct_type", fields: type.field_types },
    fields,
  };
}

function dynamic_loop_control_guarded_type_name_value(
  name: string,
  type_name: string,
  value: FrontExpr,
  env: Env,
  hooks: StaticLoopHooks,
  state: DynamicLoopState,
): FrontExpr | undefined {
  const resolved = hooks.resolve_annotation_type(type_name, env);

  if (resolved) {
    return dynamic_loop_control_guarded_type_value(
      name,
      resolved,
      value,
      env,
      hooks,
      state,
    );
  }

  return dynamic_loop_control_guarded_type_value(
    name,
    front_type_from_type_name(type_name),
    value,
    env,
    hooks,
    state,
  );
}

function dynamic_loop_control_guarded_type_value(
  name: string,
  type: FrontType,
  value: FrontExpr,
  env: Env,
  hooks: StaticLoopHooks,
  state: DynamicLoopState,
): FrontExpr | undefined {
  if (type.tag === "struct") {
    return dynamic_loop_control_guarded_struct_value(
      name,
      type,
      value,
      env,
      hooks,
      state,
    );
  }

  const fallback = dynamic_loop_control_type_fallback(
    name,
    type,
    env,
    hooks,
  );

  if (!fallback) {
    return undefined;
  }

  return {
    tag: "if",
    cond: { tag: "var", name: state.step_name },
    then_branch: capture_expr(value, env),
    else_branch: fallback,
  };
}
