import { expect } from "../../expect.ts";
import type { Env, FrontExpr, FrontType, TypeField } from "../ast.ts";
import { lookup_type_field } from "../fields.ts";
import { front_type_for_type_name } from "./common.ts";
import type { InferHooks } from "./types.ts";

export function infer_runtime_struct_field_type(
  expr: Extract<FrontExpr, { tag: "field" }>,
  env: Env,
  hooks: InferHooks,
): FrontType | undefined {
  const runtime_target = hooks.resolve_runtime_struct_type(expr.object, env);

  if (!runtime_target) {
    return undefined;
  }

  const field = lookup_type_field(runtime_target.fields, expr.name);

  if (!field) {
    throw new Error("Missing struct field: " + expr.name);
  }

  return front_type_for_type_name(field.type_name, env, hooks);
}

export function runtime_struct_index_type(
  fields: TypeField[],
  index: number,
  env: Env,
  hooks: InferHooks,
): FrontType {
  if (index < 0 || index >= fields.length) {
    throw new Error("Index out of bounds: " + index.toString());
  }

  const field = fields[index];
  expect(field, "Missing indexed field " + index.toString());
  return front_type_for_type_name(field.type_name, env, hooks);
}
