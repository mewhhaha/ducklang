import type { Ic as IcNode } from "../ic.ts";
import type {
  Binding,
  Env,
  Field,
  FrontExpr,
  FrontType,
  ResolvedFrontExpr,
} from "./ast.ts";

export type AnnotationHooks = {
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
