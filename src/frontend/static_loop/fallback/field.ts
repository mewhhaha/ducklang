import type { Env, Field, FrontExpr, FrontType } from "../../ast.ts";
import { front_type_from_type_name } from "../../types.ts";
import type { StaticLoopHooks } from "../types.ts";
import type { DynamicLoopStructTarget } from "./types.ts";

export function dynamic_loop_control_struct_field_type(
  field: Field,
  target: DynamicLoopStructTarget,
  hooks: StaticLoopHooks,
): FrontType {
  const declared = dynamic_loop_control_struct_declared_field_type(
    field.name,
    target,
    hooks,
  );

  if (declared) {
    return declared;
  }

  return hooks.infer_expr(field.value, target.env);
}

function dynamic_loop_control_struct_declared_field_type(
  name: string,
  target: DynamicLoopStructTarget,
  hooks: StaticLoopHooks,
): FrontType | undefined {
  return dynamic_loop_control_struct_declared_field_type_expr(
    name,
    target.expr.type_expr,
    target.env,
    hooks,
  );
}

function dynamic_loop_control_struct_declared_field_type_expr(
  name: string,
  type_expr: FrontExpr,
  env: Env,
  hooks: StaticLoopHooks,
): FrontType | undefined {
  if (type_expr.tag === "captured") {
    return dynamic_loop_control_struct_declared_field_type_expr(
      name,
      type_expr.expr,
      type_expr.env,
      hooks,
    );
  }

  let fields: { name: string; type_name: string }[] | undefined;

  if (type_expr.tag === "struct_type") {
    fields = type_expr.fields;
  }

  if (type_expr.tag === "var") {
    const type = hooks.resolve_annotation_type(
      type_expr.name,
      env,
    );

    if (type && type.tag === "struct") {
      fields = type.field_types;
    }
  }

  if (!fields) {
    return undefined;
  }

  for (const field of fields) {
    if (field.name !== name) {
      continue;
    }

    const resolved = hooks.resolve_annotation_type(
      field.type_name,
      env,
    );

    if (resolved) {
      return resolved;
    }

    return front_type_from_type_name(field.type_name);
  }

  return undefined;
}
