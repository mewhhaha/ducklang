import type { Ic as IcNode } from "../ic.ts";
import type { ValType } from "../op.ts";
import type {
  Binding,
  Env,
  FrontExpr,
  FrontType,
  ResolvedFrontExpr,
  TypeField,
} from "./ast.ts";
import {
  type DynamicIndexAccessHooks,
  lower_dynamic_index_access as lower_dynamic_index_access_with_hooks,
} from "./index_access.ts";
import {
  declared_struct_field_type as declared_struct_field_type_with_hooks,
  declared_struct_index_type as declared_struct_index_type_with_hooks,
  indexed_result_type as indexed_result_type_with_hooks,
  indexed_values_are_text as indexed_values_are_text_with_hooks,
  lower_expr_as_declared_type as lower_expr_as_declared_type_with_hooks,
  resolve_index_expr as resolve_index_expr_with_hooks,
  resolve_struct_field_expr as resolve_struct_field_expr_with_hooks,
  type StaticAggregateResolveHooks,
  type StructAccessHooks,
} from "./struct_access.ts";
import type { StructValueTarget } from "./struct_values.ts";

export type FrontendStructAccessApi = {
  eval_i32_expr: (expr: FrontExpr, env: Env, label: string) => number;
  infer_expr: (expr: FrontExpr, env: Env) => FrontType;
  lower_expr: (expr: FrontExpr, env: Env) => IcNode;
  lower_runtime_struct_projection: (
    object: FrontExpr,
    field_index: number,
    fields: TypeField[],
    env: Env,
  ) => IcNode;
  lower_static_expr: (
    expr: FrontExpr,
    env: Env,
    in_progress: Set<Binding>,
  ) => IcNode | undefined;
  resolve_runtime_struct_type: (
    expr: FrontExpr,
    env: Env,
  ) => { fields: TypeField[] } | undefined;
  resolve_struct_value: (
    expr: FrontExpr,
    env: Env,
  ) => StructValueTarget | undefined;
  resolve_struct_value_type_fields: (
    expr: Extract<FrontExpr, { tag: "struct_value" }>,
    env: Env,
  ) => TypeField[] | undefined;
};

export type FrontendStructAccess = {
  declared_struct_field_type: (
    object: FrontExpr,
    name: string,
    env: Env,
  ) => string | undefined;
  declared_struct_index_type: (
    object: FrontExpr,
    index: number,
    env: Env,
  ) => string | undefined;
  indexed_result_type: (target: StructValueTarget) => ValType;
  indexed_values_are_text: (target: StructValueTarget) => boolean;
  lower_dynamic_index_access: (
    object: FrontExpr,
    index: FrontExpr,
    env: Env,
  ) => IcNode | undefined;
  lower_expr_as_declared_type: (
    expr: FrontExpr,
    env: Env,
    type_name: string | undefined,
  ) => IcNode;
  resolve_index_expr: (
    expr: Extract<FrontExpr, { tag: "index" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  resolve_struct_field_expr: (
    expr: Extract<FrontExpr, { tag: "field" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
};

export function create_frontend_struct_access(
  api: FrontendStructAccessApi,
): FrontendStructAccess {
  const static_aggregate_resolve_hooks = {
    eval_i32_expr: api.eval_i32_expr,
    resolve_struct_value: api.resolve_struct_value,
  } satisfies StaticAggregateResolveHooks;

  const struct_access_hooks = {
    infer_expr: api.infer_expr,
    lower_expr: api.lower_expr,
    lower_static_expr: api.lower_static_expr,
    resolve_struct_value: api.resolve_struct_value,
    resolve_struct_value_type_fields: api.resolve_struct_value_type_fields,
  } satisfies StructAccessHooks;

  const dynamic_index_access_hooks = {
    declared_struct_field_type,
    indexed_result_type,
    lower_expr: api.lower_expr,
    lower_expr_as_declared_type,
    lower_runtime_struct_projection: api.lower_runtime_struct_projection,
    resolve_runtime_struct_type: api.resolve_runtime_struct_type,
    resolve_struct_value: api.resolve_struct_value,
  } satisfies DynamicIndexAccessHooks;

  function resolve_struct_field_expr(
    expr: Extract<FrontExpr, { tag: "field" }>,
    env: Env,
  ): ResolvedFrontExpr | undefined {
    return resolve_struct_field_expr_with_hooks(
      expr,
      env,
      static_aggregate_resolve_hooks,
    );
  }

  function resolve_index_expr(
    expr: Extract<FrontExpr, { tag: "index" }>,
    env: Env,
  ): ResolvedFrontExpr | undefined {
    return resolve_index_expr_with_hooks(
      expr,
      env,
      static_aggregate_resolve_hooks,
    );
  }

  function declared_struct_field_type(
    object: FrontExpr,
    name: string,
    env: Env,
  ): string | undefined {
    return declared_struct_field_type_with_hooks(
      object,
      name,
      env,
      struct_access_hooks,
    );
  }

  function declared_struct_index_type(
    object: FrontExpr,
    index: number,
    env: Env,
  ): string | undefined {
    return declared_struct_index_type_with_hooks(
      object,
      index,
      env,
      struct_access_hooks,
    );
  }

  function indexed_result_type(target: StructValueTarget): ValType {
    return indexed_result_type_with_hooks(target, struct_access_hooks);
  }

  function indexed_values_are_text(target: StructValueTarget): boolean {
    return indexed_values_are_text_with_hooks(target, struct_access_hooks);
  }

  function lower_expr_as_declared_type(
    expr: FrontExpr,
    env: Env,
    type_name: string | undefined,
  ): IcNode {
    return lower_expr_as_declared_type_with_hooks(
      expr,
      env,
      type_name,
      struct_access_hooks,
    );
  }

  function lower_dynamic_index_access(
    object: FrontExpr,
    index: FrontExpr,
    env: Env,
  ): IcNode | undefined {
    return lower_dynamic_index_access_with_hooks(
      object,
      index,
      env,
      dynamic_index_access_hooks,
    );
  }

  return {
    declared_struct_field_type,
    declared_struct_index_type,
    indexed_result_type,
    indexed_values_are_text,
    lower_dynamic_index_access,
    lower_expr_as_declared_type,
    resolve_index_expr,
    resolve_struct_field_expr,
  };
}
