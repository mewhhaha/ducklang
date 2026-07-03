import type { Ic as IcNode } from "../ic.ts";
import type { ValType } from "../op.ts";
import type { Env, FrontExpr, ResolvedFrontExpr, TypeField } from "./ast.ts";
import type { FrontendValueGraph } from "./lower_value_graph.ts";
import type { StructValueTarget } from "./struct_values.ts";

export function create_frontend_value_facade(
  graph: () => FrontendValueGraph,
): FrontendValueGraph {
  function check_union_case_value(
    union_type: Extract<FrontExpr, { tag: "union_type" }>,
    value: Extract<FrontExpr, { tag: "union_case" }>,
    env: Env,
  ): void {
    graph().check_union_case_value(union_type, value, env);
  }

  function declared_struct_field_type(
    object: FrontExpr,
    name: string,
    env: Env,
  ): string | undefined {
    return graph().declared_struct_field_type(object, name, env);
  }

  function declared_struct_index_type(
    object: FrontExpr,
    index: number,
    env: Env,
  ): string | undefined {
    return graph().declared_struct_index_type(object, index, env);
  }

  function indexed_result_type(target: StructValueTarget): ValType {
    return graph().indexed_result_type(target);
  }

  function indexed_values_are_text(target: StructValueTarget): boolean {
    return graph().indexed_values_are_text(target);
  }

  function infer_dynamic_if_let_cases(
    expr: FrontExpr,
    env: Env,
  ): TypeField[] | undefined {
    return graph().infer_dynamic_if_let_cases(expr, env);
  }

  function infer_dynamic_union_if_cases(
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ): TypeField[] | undefined {
    return graph().infer_dynamic_union_if_cases(expr, env);
  }

  function infer_union_cases(
    expr: FrontExpr,
    env: Env,
  ): TypeField[] | undefined {
    return graph().infer_union_cases(expr, env);
  }

  function infer_untyped_union_case(
    expr: Extract<FrontExpr, { tag: "union_case" }>,
    env: Env,
  ): TypeField | undefined {
    return graph().infer_untyped_union_case(expr, env);
  }

  function lower_dynamic_index_access(
    object: FrontExpr,
    index: FrontExpr,
    env: Env,
  ): IcNode | undefined {
    return graph().lower_dynamic_index_access(object, index, env);
  }

  function lower_expr_as_declared_type(
    expr: FrontExpr,
    env: Env,
    type_name: string | undefined,
  ): IcNode {
    return graph().lower_expr_as_declared_type(expr, env, type_name);
  }

  function lower_struct_value(
    expr: Extract<FrontExpr, { tag: "struct_value" }>,
    env: Env,
  ): IcNode {
    return graph().lower_struct_value(expr, env);
  }

  function lower_union_case_value(
    expr: Extract<FrontExpr, { tag: "union_case" }>,
    env: Env,
  ): IcNode {
    return graph().lower_union_case_value(expr, env);
  }

  function resolve_index_expr(
    expr: Extract<FrontExpr, { tag: "index" }>,
    env: Env,
  ): ResolvedFrontExpr | undefined {
    return graph().resolve_index_expr(expr, env);
  }

  function resolve_struct_field_expr(
    expr: Extract<FrontExpr, { tag: "field" }>,
    env: Env,
  ): ResolvedFrontExpr | undefined {
    return graph().resolve_struct_field_expr(expr, env);
  }

  function resolve_struct_value(
    expr: FrontExpr,
    env: Env,
  ):
    | { expr: Extract<FrontExpr, { tag: "struct_value" }>; env: Env }
    | undefined {
    return graph().resolve_struct_value(expr, env);
  }

  function resolve_struct_value_type_fields(
    expr: Extract<FrontExpr, { tag: "struct_value" }>,
    env: Env,
  ): TypeField[] | undefined {
    return graph().resolve_struct_value_type_fields(expr, env);
  }

  function resolve_union_constructor_call(
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ):
    | { expr: Extract<FrontExpr, { tag: "union_case" }>; env: Env }
    | undefined {
    return graph().resolve_union_constructor_call(expr, env);
  }

  function resolve_union_type_value(
    expr: FrontExpr,
    env: Env,
  ): Extract<FrontExpr, { tag: "union_type" }> | undefined {
    return graph().resolve_union_type_value(expr, env);
  }

  function resolve_union_value(
    expr: FrontExpr,
    env: Env,
  ):
    | { expr: Extract<FrontExpr, { tag: "union_case" }>; env: Env }
    | undefined {
    return graph().resolve_union_value(expr, env);
  }

  function validate_union_payload_type(
    name: string,
    expected: string,
    value: FrontExpr,
    env: Env,
  ): void {
    graph().validate_union_payload_type(name, expected, value, env);
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
