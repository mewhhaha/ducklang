import { expect } from "../expect.ts";
import type { Ic as IcNode } from "../ic.ts";
import type { Prim, ValType } from "../op.ts";
import type { Env, FrontExpr, TypeField } from "./ast.ts";
import { indexed_result_type_from_fields } from "./runtime_struct.ts";
import type { StructValueTarget } from "./struct_values.ts";

export type DynamicIndexAccessHooks = {
  declared_struct_field_type: (
    expr: FrontExpr,
    field_name: string,
    env: Env,
  ) => string | undefined;
  indexed_result_type: (target: StructValueTarget) => ValType;
  lower_expr: (expr: FrontExpr, env: Env) => IcNode;
  lower_expr_as_declared_type: (
    expr: FrontExpr,
    env: Env,
    type_name: string | undefined,
  ) => IcNode;
  lower_runtime_struct_projection: (
    object: FrontExpr,
    field_index: number,
    fields: TypeField[],
    env: Env,
  ) => IcNode;
  resolve_runtime_struct_type: (
    expr: FrontExpr,
    env: Env,
  ) => { fields: TypeField[] } | undefined;
  resolve_struct_value: (
    expr: FrontExpr,
    env: Env,
  ) => StructValueTarget | undefined;
};

export function lower_dynamic_index_access(
  object: FrontExpr,
  index: FrontExpr,
  env: Env,
  hooks: DynamicIndexAccessHooks,
): IcNode | undefined {
  const target = hooks.resolve_struct_value(object, env);

  if (!target) {
    const runtime_target = hooks.resolve_runtime_struct_type(object, env);

    if (!runtime_target) {
      return undefined;
    }

    return lower_runtime_dynamic_index_access(
      object,
      index,
      runtime_target.fields,
      env,
      hooks,
    );
  }

  return lower_struct_dynamic_index_access(object, index, target, env, hooks);
}

function lower_runtime_dynamic_index_access(
  object: FrontExpr,
  index: FrontExpr,
  fields: TypeField[],
  env: Env,
  hooks: DynamicIndexAccessHooks,
): IcNode {
  const result_type = indexed_result_type_from_fields(fields);
  const prims = index_select_prims(result_type);
  let result: IcNode = { tag: "prim", prim: prims.trap, args: [] };

  for (
    let field_index = fields.length - 1;
    field_index >= 0;
    field_index -= 1
  ) {
    result = {
      tag: "prim",
      prim: prims.select,
      args: [
        hooks.lower_runtime_struct_projection(
          object,
          field_index,
          fields,
          env,
        ),
        result,
        {
          tag: "prim",
          prim: "i32.eq",
          args: [
            hooks.lower_expr(index, env),
            { tag: "num", type: "i32", value: field_index },
          ],
        },
      ],
    };
  }

  return result;
}

function lower_struct_dynamic_index_access(
  object: FrontExpr,
  index: FrontExpr,
  target: StructValueTarget,
  env: Env,
  hooks: DynamicIndexAccessHooks,
): IcNode {
  const result_type = hooks.indexed_result_type(target);
  const prims = index_select_prims(result_type);
  let result: IcNode = { tag: "prim", prim: prims.trap, args: [] };

  for (
    let field_index = target.expr.fields.length - 1;
    field_index >= 0;
    field_index -= 1
  ) {
    const field = target.expr.fields[field_index];
    expect(field, "Missing indexed field " + field_index.toString());
    const declared = hooks.declared_struct_field_type(
      object,
      field.name,
      env,
    );
    result = {
      tag: "prim",
      prim: prims.select,
      args: [
        hooks.lower_expr_as_declared_type(
          field.value,
          target.env,
          declared,
        ),
        result,
        {
          tag: "prim",
          prim: "i32.eq",
          args: [
            hooks.lower_expr(index, env),
            { tag: "num", type: "i32", value: field_index },
          ],
        },
      ],
    };
  }

  return result;
}

function index_select_prims(
  result_type: ValType,
): { trap: Prim; select: Prim } {
  if (result_type === "i64") {
    return { trap: "i64.trap", select: "i64.select" };
  }

  return { trap: "i32.trap", select: "i32.select" };
}
