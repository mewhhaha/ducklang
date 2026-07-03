import type { CoreExpr, CoreFnType } from "../../../ast.ts";
import type { StaticCtx } from "../../../local_collect.ts";

export type CoreBackendLocalFactsApi = {
  closure_fn_type: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => CoreFnType | undefined;
  runtime_union_type_expr: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => CoreExpr | undefined;
  runtime_aggregate_type_expr: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => CoreExpr | undefined;
  same_runtime_aggregate_type_expr: (
    left: CoreExpr,
    right: CoreExpr,
    ctx: StaticCtx,
  ) => boolean;
  same_runtime_union_type_expr: (
    left: CoreExpr,
    right: CoreExpr,
    ctx: StaticCtx,
  ) => boolean;
  static_type_value: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => CoreExpr | undefined;
};

export type CoreBackendLocalFacts = {
  bind_core_assignment_union_type: (
    name: string,
    value: CoreExpr,
    mode: "same" | "change",
    ctx: StaticCtx,
  ) => void;
  bind_core_fn_type: (
    name: string,
    value: CoreExpr,
    ctx: StaticCtx,
  ) => void;
  bind_core_struct_type: (
    name: string,
    value: CoreExpr,
    annotation: string | undefined,
    ctx: StaticCtx,
  ) => void;
  bind_core_union_type: (
    name: string,
    value: CoreExpr,
    annotation: string | undefined,
    ctx: StaticCtx,
  ) => void;
  clear_core_local_facts: (name: string, ctx: StaticCtx) => void;
  clear_optional_core_union_local: (
    name: string | undefined,
    ctx: StaticCtx,
  ) => void;
  core_annotation_union_type_expr: (
    annotation: string | undefined,
    ctx: StaticCtx,
  ) => CoreExpr | undefined;
  bind_core_assignment_struct_type: (
    name: string,
    value: CoreExpr,
    mode: "same" | "change",
    ctx: StaticCtx,
  ) => void;
  core_annotation_struct_type_expr: (
    annotation: string | undefined,
    ctx: StaticCtx,
  ) => CoreExpr | undefined;
};
