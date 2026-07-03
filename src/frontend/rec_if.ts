import { expect } from "../expect.ts";
import { Ic, type Ic as IcNode } from "../ic.ts";
import type { Env, FrontExpr, TypeField } from "./ast.ts";
import { select_prim_for_branches } from "./numeric.ts";
import { infer_rec_expr } from "./rec_infer.ts";
import {
  lower_rec_runtime_struct_projection,
  lower_rec_runtime_struct_projection_from_value,
  type StaticRecStructHooks,
} from "./rec_struct.ts";
import { lower_rec_dynamic_union_if } from "./rec_union.ts";
import type { StaticRecHooks } from "./rec_hooks.ts";
import {
  common_front_type,
  front_type_name,
  val_type_from_type_name,
} from "./types.ts";

export type RecResultLowerer = (expr: FrontExpr, env: Env) => IcNode;

export function lower_rec_if(
  expr: Extract<FrontExpr, { tag: "if" }>,
  env: Env,
  hooks: StaticRecHooks,
  lower_result: RecResultLowerer,
): IcNode | undefined {
  check_rec_if_condition(expr.cond, env, hooks);
  const cond = Ic.reduce(lower_result(expr.cond, env));

  if (cond.tag === "num") {
    if (cond.type !== "i32") {
      throw new Error("If condition expects i32, got " + cond.type);
    }

    const value = cond.value;
    expect(typeof value === "number", "Expected i32 if condition");

    if (value !== 0) {
      return lower_result(expr.then_branch, env);
    }

    return lower_result(expr.else_branch, env);
  }

  const then_type = infer_rec_expr(expr.then_branch, env, hooks);
  const else_type = infer_rec_expr(expr.else_branch, env, hooks);
  const branch_type = common_front_type(then_type, else_type);

  if (!branch_type) {
    return undefined;
  }

  if (branch_type.tag === "text") {
    return {
      tag: "prim",
      prim: "i32.select",
      args: [
        lower_rec_branch_result(expr.then_branch, env, hooks, lower_result),
        lower_rec_branch_result(expr.else_branch, env, hooks, lower_result),
        cond,
      ],
    };
  }

  if (branch_type.tag === "struct" && branch_type.field_types) {
    return lower_rec_dynamic_struct_if(
      expr,
      branch_type.field_types,
      env,
      hooks,
      lower_result,
    );
  }

  if (branch_type.tag === "union_value") {
    const union_if = lower_rec_dynamic_union_if(
      expr,
      branch_type.cases,
      env,
      hooks,
      lower_result,
    );

    if (union_if) {
      return union_if;
    }
  }

  if (branch_type.tag !== "int") {
    return undefined;
  }

  let select_prim = select_prim_for_branches(
    expr.then_branch,
    expr.else_branch,
  );

  if (branch_type.type === "i64") {
    select_prim = "i64.select";
  }

  return {
    tag: "prim",
    prim: select_prim,
    args: [
      lower_rec_branch_result(expr.then_branch, env, hooks, lower_result),
      lower_rec_branch_result(expr.else_branch, env, hooks, lower_result),
      cond,
    ],
  };
}

export function create_rec_struct_hooks(
  hooks: StaticRecHooks,
): StaticRecStructHooks {
  return {
    fresh: hooks.fresh,
    infer_expr(expr: FrontExpr, env: Env) {
      return infer_rec_expr(expr, env, hooks);
    },
    resolve_static_i32_expr: hooks.resolve_static_i32_expr,
  };
}

function lower_rec_branch_result(
  expr: FrontExpr,
  env: Env,
  hooks: StaticRecHooks,
  lower_result: RecResultLowerer,
): IcNode {
  const resolved = resolve_rec_runtime_alias(expr, env, hooks, new Set());

  if (resolved) {
    return lower_result(resolved.expr, resolved.env);
  }

  return lower_result(expr, env);
}

function resolve_rec_runtime_alias(
  expr: FrontExpr,
  env: Env,
  hooks: StaticRecHooks,
  seen: Set<object>,
): { expr: FrontExpr; env: Env } | undefined {
  if (expr.tag === "captured") {
    return resolve_rec_runtime_alias(expr.expr, expr.env, hooks, seen);
  }

  if (expr.tag !== "var") {
    return undefined;
  }

  const binding = hooks.lookup(env, expr.name);

  if (!binding || !binding.value) {
    return undefined;
  }

  if (binding.value.tag === "lam" || binding.value.tag === "rec") {
    return undefined;
  }

  if (seen.has(binding)) {
    return undefined;
  }

  let value_env = env;

  if (binding.value_env) {
    value_env = binding.value_env;
  }

  seen.add(binding);
  const nested = resolve_rec_runtime_alias(
    binding.value,
    value_env,
    hooks,
    seen,
  );
  seen.delete(binding);

  if (nested) {
    return nested;
  }

  return { expr: binding.value, env: value_env };
}

function check_rec_if_condition(
  expr: FrontExpr,
  env: Env,
  hooks: StaticRecHooks,
): void {
  const type = hooks.infer_expr(expr, env);

  if (type.tag === "unknown") {
    return;
  }

  if (type.tag === "int" && type.type !== "i64") {
    return;
  }

  throw new Error("If condition expects i32, got " + front_type_name(type));
}

function lower_rec_dynamic_struct_if(
  expr: Extract<FrontExpr, { tag: "if" }>,
  fields: TypeField[],
  env: Env,
  hooks: StaticRecHooks,
  lower_result: RecResultLowerer,
): IcNode {
  const cond = lower_result(expr.cond, env);
  const field_values: IcNode[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    expect(field, "Missing dynamic struct field " + index);
    field_values.push(
      lower_rec_dynamic_struct_if_field(
        expr,
        index,
        fields,
        cond,
        env,
        hooks,
        lower_result,
      ),
    );
  }

  return lower_rec_struct_ic_fields(field_values, env, hooks);
}

function lower_rec_dynamic_struct_if_field(
  expr: Extract<FrontExpr, { tag: "if" }>,
  field_index: number,
  fields: TypeField[],
  cond: IcNode,
  env: Env,
  hooks: StaticRecHooks,
  lower_result: RecResultLowerer,
): IcNode {
  const field = fields[field_index];
  expect(field, "Missing dynamic struct field " + field_index);
  const select_prim = rec_struct_field_select_prim(field);

  if (select_prim) {
    return {
      tag: "prim",
      prim: select_prim,
      args: [
        lower_rec_dynamic_struct_if_branch_field(
          expr.then_branch,
          field_index,
          fields,
          env,
          hooks,
          lower_result,
        ),
        lower_rec_dynamic_struct_if_branch_field(
          expr.else_branch,
          field_index,
          fields,
          env,
          hooks,
          lower_result,
        ),
        cond,
      ],
    };
  }

  const field_type = hooks.resolve_annotation_type(field.type_name, env);

  if (field_type && field_type.tag === "struct" && field_type.field_types) {
    return lower_rec_dynamic_struct_if_values(
      lower_rec_dynamic_struct_if_branch_field(
        expr.then_branch,
        field_index,
        fields,
        env,
        hooks,
        lower_result,
      ),
      lower_rec_dynamic_struct_if_branch_field(
        expr.else_branch,
        field_index,
        fields,
        env,
        hooks,
        lower_result,
      ),
      field_type.field_types,
      cond,
      env,
      hooks,
    );
  }

  throw new Error(
    "Cannot lower dynamic struct if for non-scalar field: " + field.name,
  );
}

function lower_rec_dynamic_struct_if_values(
  then_value: IcNode,
  else_value: IcNode,
  fields: TypeField[],
  cond: IcNode,
  env: Env,
  hooks: StaticRecHooks,
): IcNode {
  const field_values: IcNode[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    expect(field, "Missing nested dynamic struct field " + index);
    field_values.push(
      lower_rec_dynamic_struct_if_value_field(
        then_value,
        else_value,
        index,
        fields,
        cond,
        env,
        hooks,
      ),
    );
  }

  return lower_rec_struct_ic_fields(field_values, env, hooks);
}

function lower_rec_dynamic_struct_if_value_field(
  then_value: IcNode,
  else_value: IcNode,
  field_index: number,
  fields: TypeField[],
  cond: IcNode,
  env: Env,
  hooks: StaticRecHooks,
): IcNode {
  const field = fields[field_index];
  expect(field, "Missing nested dynamic struct field " + field_index);
  const then_field = lower_rec_dynamic_struct_value_field(
    then_value,
    field_index,
    fields,
    env,
    hooks,
  );
  const else_field = lower_rec_dynamic_struct_value_field(
    else_value,
    field_index,
    fields,
    env,
    hooks,
  );
  const select_prim = rec_struct_field_select_prim(field);

  if (select_prim) {
    return {
      tag: "prim",
      prim: select_prim,
      args: [then_field, else_field, cond],
    };
  }

  const field_type = hooks.resolve_annotation_type(field.type_name, env);

  if (field_type && field_type.tag === "struct" && field_type.field_types) {
    return lower_rec_dynamic_struct_if_values(
      then_field,
      else_field,
      field_type.field_types,
      cond,
      env,
      hooks,
    );
  }

  throw new Error(
    "Cannot lower dynamic struct if for non-scalar field: " + field.name,
  );
}

function lower_rec_dynamic_struct_value_field(
  value: IcNode,
  field_index: number,
  fields: TypeField[],
  env: Env,
  hooks: StaticRecHooks,
): IcNode {
  return lower_rec_runtime_struct_projection_from_value(
    value,
    field_index,
    fields,
    env,
    create_rec_struct_hooks(hooks),
  );
}

function lower_rec_dynamic_struct_if_branch_field(
  branch: FrontExpr,
  field_index: number,
  fields: TypeField[],
  env: Env,
  hooks: StaticRecHooks,
  lower_result: RecResultLowerer,
): IcNode {
  const field = fields[field_index];
  expect(field, "Missing dynamic struct branch field " + field_index);
  const field_expr: FrontExpr = {
    tag: "field",
    object: branch,
    name: field.name,
  };
  const resolved = hooks.resolve_struct_field_expr(field_expr, env);

  if (resolved) {
    return lower_result(resolved.expr, resolved.env);
  }

  return lower_rec_runtime_struct_projection(
    branch,
    field_index,
    fields,
    env,
    create_rec_struct_hooks(hooks),
    lower_result,
  );
}

function lower_rec_struct_ic_fields(
  field_values: IcNode[],
  env: Env,
  hooks: StaticRecHooks,
): IcNode {
  const handler_name = hooks.fresh(env, "pick");
  let body: IcNode = { tag: "var", name: handler_name };

  for (const value of field_values) {
    body = {
      tag: "app",
      func: body,
      arg: value,
    };
  }

  return { tag: "lam", name: handler_name, body };
}

function rec_struct_field_select_prim(
  field: TypeField,
): "i32.select" | "i64.select" | undefined {
  if (field.type_name === "Text") {
    return "i32.select";
  }

  const value_type = val_type_from_type_name(field.type_name);

  if (value_type === "i64") {
    return "i64.select";
  }

  if (value_type === "i32") {
    return "i32.select";
  }

  return undefined;
}
