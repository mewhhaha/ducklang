import type { Ic as IcNode } from "../ic.ts";
import type { ValType } from "../op.ts";
import type { Env, FrontExpr, ResolvedFrontExpr, TypeField } from "./ast.ts";
import type { FrontendStructAccess } from "./lower_struct_access_adapter.ts";
import {
  lower_struct_value as lower_struct_value_with_hooks,
  resolve_struct_value as resolve_struct_value_with_hooks,
  resolve_struct_value_type_fields
    as resolve_struct_value_type_fields_with_hooks,
  type StructValueHooks,
  type StructValueTarget,
} from "./struct_values.ts";
import {
  check_union_case_value as check_union_case_value_with_hooks,
  infer_untyped_union_case as infer_untyped_union_case_with_hooks,
  lower_union_case_value as lower_union_case_value_with_hooks,
  resolve_union_constructor_call as resolve_union_constructor_call_with_hooks,
  resolve_union_type_value as resolve_union_type_value_with_hooks,
  resolve_union_value as resolve_union_value_with_hooks,
  type UnionValueHooks,
  validate_union_payload_type as validate_union_payload_type_with_hooks,
} from "./union_values.ts";
import {
  infer_dynamic_if_let_cases as infer_dynamic_if_let_cases_with_hooks,
  infer_dynamic_union_if_cases as infer_dynamic_union_if_cases_with_hooks,
  infer_union_cases as infer_union_cases_with_hooks,
  type UnionInferHooks,
} from "./union_infer.ts";

export type FrontendValueGraphApi = {
  struct_access: FrontendStructAccess;
  struct_value_hooks: StructValueHooks;
  union_infer_hooks: UnionInferHooks;
  union_value_hooks: UnionValueHooks;
};

export type FrontendValueGraph = {
  check_union_case_value: (
    union_type: Extract<FrontExpr, { tag: "union_type" }>,
    value: Extract<FrontExpr, { tag: "union_case" }>,
    env: Env,
  ) => void;
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
  infer_dynamic_if_let_cases: (
    expr: FrontExpr,
    env: Env,
  ) => TypeField[] | undefined;
  infer_dynamic_union_if_cases: (
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ) => TypeField[] | undefined;
  infer_union_cases: (
    expr: FrontExpr,
    env: Env,
  ) => TypeField[] | undefined;
  infer_untyped_union_case: (
    expr: Extract<FrontExpr, { tag: "union_case" }>,
    env: Env,
  ) => TypeField | undefined;
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
  lower_struct_value: (
    expr: Extract<FrontExpr, { tag: "struct_value" }>,
    env: Env,
  ) => IcNode;
  lower_union_case_value: (
    expr: Extract<FrontExpr, { tag: "union_case" }>,
    env: Env,
  ) => IcNode;
  resolve_index_expr: (
    expr: Extract<FrontExpr, { tag: "index" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  resolve_struct_field_expr: (
    expr: Extract<FrontExpr, { tag: "field" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  resolve_struct_value: (
    expr: FrontExpr,
    env: Env,
  ) =>
    | { expr: Extract<FrontExpr, { tag: "struct_value" }>; env: Env }
    | undefined;
  resolve_struct_value_type_fields: (
    expr: Extract<FrontExpr, { tag: "struct_value" }>,
    env: Env,
  ) => TypeField[] | undefined;
  resolve_union_constructor_call: (
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ) =>
    | { expr: Extract<FrontExpr, { tag: "union_case" }>; env: Env }
    | undefined;
  resolve_union_type_value: (
    expr: FrontExpr,
    env: Env,
  ) => Extract<FrontExpr, { tag: "union_type" }> | undefined;
  resolve_union_value: (
    expr: FrontExpr,
    env: Env,
  ) =>
    | { expr: Extract<FrontExpr, { tag: "union_case" }>; env: Env }
    | undefined;
  validate_union_payload_type: (
    name: string,
    expected: string,
    value: FrontExpr,
    env: Env,
  ) => void;
};

export function create_frontend_value_graph(
  api: FrontendValueGraphApi,
): FrontendValueGraph {
  function lower_struct_value(
    expr: Extract<FrontExpr, { tag: "struct_value" }>,
    env: Env,
  ): IcNode {
    return lower_struct_value_with_hooks(expr, env, api.struct_value_hooks);
  }

  function lower_union_case_value(
    expr: Extract<FrontExpr, { tag: "union_case" }>,
    env: Env,
  ): IcNode {
    return lower_union_case_value_with_hooks(expr, env, api.union_value_hooks);
  }

  function resolve_struct_field_expr(
    expr: Extract<FrontExpr, { tag: "field" }>,
    env: Env,
  ): ResolvedFrontExpr | undefined {
    return api.struct_access.resolve_struct_field_expr(expr, env);
  }

  function resolve_index_expr(
    expr: Extract<FrontExpr, { tag: "index" }>,
    env: Env,
  ): ResolvedFrontExpr | undefined {
    return api.struct_access.resolve_index_expr(expr, env);
  }

  function declared_struct_field_type(
    object: FrontExpr,
    name: string,
    env: Env,
  ): string | undefined {
    return api.struct_access.declared_struct_field_type(object, name, env);
  }

  function declared_struct_index_type(
    object: FrontExpr,
    index: number,
    env: Env,
  ): string | undefined {
    return api.struct_access.declared_struct_index_type(object, index, env);
  }

  function indexed_result_type(target: StructValueTarget): ValType {
    return api.struct_access.indexed_result_type(target);
  }

  function indexed_values_are_text(target: StructValueTarget): boolean {
    return api.struct_access.indexed_values_are_text(target);
  }

  function lower_dynamic_index_access(
    object: FrontExpr,
    index: FrontExpr,
    env: Env,
  ): IcNode | undefined {
    return api.struct_access.lower_dynamic_index_access(object, index, env);
  }

  function lower_expr_as_declared_type(
    expr: FrontExpr,
    env: Env,
    type_name: string | undefined,
  ): IcNode {
    return api.struct_access.lower_expr_as_declared_type(
      expr,
      env,
      type_name,
    );
  }

  function resolve_struct_value(
    expr: FrontExpr,
    env: Env,
  ):
    | { expr: Extract<FrontExpr, { tag: "struct_value" }>; env: Env }
    | undefined {
    return resolve_struct_value_with_hooks(expr, env, api.struct_value_hooks);
  }

  function resolve_union_value(
    expr: FrontExpr,
    env: Env,
  ):
    | { expr: Extract<FrontExpr, { tag: "union_case" }>; env: Env }
    | undefined {
    return resolve_union_value_with_hooks(expr, env, api.union_value_hooks);
  }

  function infer_dynamic_if_let_cases(
    expr: FrontExpr,
    env: Env,
  ): TypeField[] | undefined {
    return infer_dynamic_if_let_cases_with_hooks(
      expr,
      env,
      api.union_infer_hooks,
    );
  }

  function infer_dynamic_union_if_cases(
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ): TypeField[] | undefined {
    return infer_dynamic_union_if_cases_with_hooks(
      expr,
      env,
      api.union_infer_hooks,
    );
  }

  function infer_union_cases(
    expr: FrontExpr,
    env: Env,
  ): TypeField[] | undefined {
    return infer_union_cases_with_hooks(expr, env, api.union_infer_hooks);
  }

  function infer_untyped_union_case(
    expr: Extract<FrontExpr, { tag: "union_case" }>,
    env: Env,
  ): TypeField | undefined {
    return infer_untyped_union_case_with_hooks(
      expr,
      env,
      api.union_value_hooks,
    );
  }

  function resolve_union_constructor_call(
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ):
    | { expr: Extract<FrontExpr, { tag: "union_case" }>; env: Env }
    | undefined {
    return resolve_union_constructor_call_with_hooks(
      expr,
      env,
      api.union_value_hooks,
    );
  }

  function resolve_union_type_value(
    expr: FrontExpr,
    env: Env,
  ): Extract<FrontExpr, { tag: "union_type" }> | undefined {
    return resolve_union_type_value_with_hooks(
      expr,
      env,
      api.union_value_hooks,
    );
  }

  function validate_union_payload_type(
    name: string,
    expected: string,
    value: FrontExpr,
    env: Env,
  ): void {
    validate_union_payload_type_with_hooks(
      name,
      expected,
      value,
      env,
      api.union_value_hooks,
    );
  }

  function check_union_case_value(
    union_type: Extract<FrontExpr, { tag: "union_type" }>,
    value: Extract<FrontExpr, { tag: "union_case" }>,
    env: Env,
  ): void {
    check_union_case_value_with_hooks(
      union_type,
      value,
      env,
      api.union_value_hooks,
    );
  }

  function resolve_struct_value_type_fields(
    expr: Extract<FrontExpr, { tag: "struct_value" }>,
    env: Env,
  ): TypeField[] | undefined {
    return resolve_struct_value_type_fields_with_hooks(
      expr,
      env,
      api.struct_value_hooks,
    );
  }

  return {
    check_union_case_value,
    declared_struct_field_type,
    declared_struct_index_type,
    indexed_result_type,
    indexed_values_are_text,
    infer_dynamic_if_let_cases,
    infer_dynamic_union_if_cases,
    infer_union_cases,
    infer_untyped_union_case,
    lower_dynamic_index_access,
    lower_expr_as_declared_type,
    lower_struct_value,
    lower_union_case_value,
    resolve_index_expr,
    resolve_struct_field_expr,
    resolve_struct_value,
    resolve_struct_value_type_fields,
    resolve_union_constructor_call,
    resolve_union_type_value,
    resolve_union_value,
    validate_union_payload_type,
  };
}
