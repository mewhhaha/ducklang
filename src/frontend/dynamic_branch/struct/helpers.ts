import { expect } from "../../../expect.ts";
import type { Env, Field, FrontExpr, TypeField } from "../../ast.ts";
import { capture_expr } from "../../capture.ts";
import { front_type_from_type_name } from "../../types.ts";
import type { DynamicBranchHooks } from "../types.ts";

export function if_let_field_expr(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  then_field: Field,
  else_field: Field,
  else_env: Env,
): FrontExpr {
  return {
    tag: "if_let",
    case_name: expr.case_name,
    value_name: expr.value_name,
    target: expr.target,
    then_branch: then_field.value,
    else_branch: capture_expr(else_field.value, else_env),
  };
}

export function dynamic_struct_type_for_type_name(
  type_name: string,
  env: Env,
  hooks: DynamicBranchHooks,
): TypeField[] | undefined {
  const type = hooks.resolve_annotation_type(type_name, env);

  if (type && type.tag === "struct" && type.field_types) {
    return type.field_types;
  }

  return undefined;
}

export function dynamic_front_type_for_type_name(
  type_name: string,
  env: Env,
  hooks: DynamicBranchHooks,
) {
  const type = hooks.resolve_annotation_type(type_name, env);

  if (type) {
    return type;
  }

  return front_type_from_type_name(type_name);
}

export function same_type_fields(
  left: Extract<FrontExpr, { tag: "struct_type" }>,
  right: Extract<FrontExpr, { tag: "struct_type" }>,
): boolean {
  if (left.fields.length !== right.fields.length) {
    return false;
  }

  for (let index = 0; index < left.fields.length; index += 1) {
    const left_field = left.fields[index];
    const right_field = right.fields[index];
    expect(left_field, "Missing left type field " + index.toString());
    expect(right_field, "Missing right type field " + index.toString());

    if (left_field.name !== right_field.name) {
      return false;
    }

    if (left_field.type_name !== right_field.type_name) {
      return false;
    }
  }

  return true;
}
