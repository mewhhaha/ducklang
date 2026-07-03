import type { Ic as IcNode } from "../ic.ts";
import type { ValType } from "../op.ts";
import type {
  Binding,
  Env,
  Field,
  FrontExpr,
  FrontType,
  ResolvedFrontExpr,
} from "./ast.ts";
import {
  type AnnotationHooks,
  apply_annotation_context as apply_annotation_context_with_hooks,
  apply_runtime_binding_annotation
    as apply_runtime_binding_annotation_with_hooks,
  check_binding_annotation as check_binding_annotation_with_hooks,
  resolve_annotation_type as resolve_annotation_type_with_hooks,
  resolve_numeric_expr_type as resolve_numeric_expr_type_with_hooks,
} from "./annotations.ts";

export type FrontendAnnotationApi = {
  capture_const_ref: (expr: FrontExpr, env: Env) => FrontExpr;
  capture_expr: (expr: FrontExpr, env: Env) => FrontExpr;
  check_const_annotation: (
    annotation: string,
    value: FrontExpr,
    env: Env,
  ) => void;
  check_struct_fields: (
    type_value: Extract<FrontExpr, { tag: "struct_type" }>,
    fields: Field[],
    env: Env,
  ) => void;
  check_union_case_value: (
    type_value: Extract<FrontExpr, { tag: "union_type" }>,
    value: Extract<FrontExpr, { tag: "union_case" }>,
    env: Env,
  ) => void;
  infer_expr: (expr: FrontExpr, env: Env) => FrontType;
  lower_static_expr: (
    expr: FrontExpr,
    env: Env,
    seen: Set<Binding>,
  ) => IcNode | undefined;
  resolve_const_expr: (expr: FrontExpr, env: Env) => FrontExpr | undefined;
  resolve_deferred_frontend_value: (
    expr: FrontExpr,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  resolve_struct_value: (
    expr: FrontExpr,
    env: Env,
  ) =>
    | { expr: Extract<FrontExpr, { tag: "struct_value" }>; env: Env }
    | undefined;
  resolve_union_value: (
    expr: FrontExpr,
    env: Env,
  ) =>
    | { expr: Extract<FrontExpr, { tag: "union_case" }>; env: Env }
    | undefined;
  visible_text_value: (
    expr: FrontExpr,
    env: Env,
    seen: Set<string>,
  ) => FrontExpr | undefined;
};

export type FrontendAnnotation = {
  apply_annotation_context: (
    annotation: string,
    value: FrontExpr,
    env: Env,
  ) => FrontExpr;
  apply_runtime_binding_annotation: (
    annotation: string,
    value: FrontExpr,
    env: Env,
  ) => { value: FrontExpr; type: FrontType };
  check_binding_annotation: (
    annotation: string,
    value: FrontExpr,
    env: Env,
  ) => void;
  resolve_annotation_type: (
    annotation: string,
    env: Env,
  ) => FrontType | undefined;
  resolve_numeric_expr_type: (
    expr: FrontExpr,
    env: Env,
  ) => ValType | undefined;
};

export function create_frontend_annotation(
  api: FrontendAnnotationApi,
): FrontendAnnotation {
  const annotation_hooks = {
    capture_const_ref: api.capture_const_ref,
    capture_expr: api.capture_expr,
    check_const_annotation: api.check_const_annotation,
    check_struct_fields: api.check_struct_fields,
    check_union_case_value: api.check_union_case_value,
    infer_expr: api.infer_expr,
    lower_static_expr: api.lower_static_expr,
    resolve_const_expr: api.resolve_const_expr,
    resolve_deferred_frontend_value: api.resolve_deferred_frontend_value,
    resolve_struct_value: api.resolve_struct_value,
    resolve_union_value: api.resolve_union_value,
    visible_text_value: api.visible_text_value,
  } satisfies AnnotationHooks;

  function apply_annotation_context(
    annotation: string,
    value: FrontExpr,
    env: Env,
  ): FrontExpr {
    return apply_annotation_context_with_hooks(
      annotation,
      value,
      env,
      annotation_hooks,
    );
  }

  function apply_runtime_binding_annotation(
    annotation: string,
    value: FrontExpr,
    env: Env,
  ): { value: FrontExpr; type: FrontType } {
    return apply_runtime_binding_annotation_with_hooks(
      annotation,
      value,
      env,
      annotation_hooks,
    );
  }

  function check_binding_annotation(
    annotation: string,
    value: FrontExpr,
    env: Env,
  ): void {
    check_binding_annotation_with_hooks(
      annotation,
      value,
      env,
      annotation_hooks,
    );
  }

  function resolve_annotation_type(
    annotation: string,
    env: Env,
  ): FrontType | undefined {
    return resolve_annotation_type_with_hooks(
      annotation,
      env,
      annotation_hooks,
    );
  }

  function resolve_numeric_expr_type(
    expr: FrontExpr,
    env: Env,
  ): ValType | undefined {
    return resolve_numeric_expr_type_with_hooks(expr, env, annotation_hooks);
  }

  return {
    apply_annotation_context,
    apply_runtime_binding_annotation,
    check_binding_annotation,
    resolve_annotation_type,
    resolve_numeric_expr_type,
  };
}
