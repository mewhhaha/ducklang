import type { ValType } from "../../op.ts";
import type { Wat } from "../../wat.ts";
import type { CoreExpr, CoreStmt } from "../ast.ts";
import type { RuntimeAggregateField } from "../runtime_aggregate.ts";

export type CoreIndexAssignCtx = {
  locals: Map<string, ValType>;
  next_temp: number;
};

export type CoreIndexAssignHooks<
  ctx extends CoreIndexAssignCtx,
  emit_ctx extends ctx,
> = {
  core_expr_is_text: (expr: CoreExpr, ctx: ctx) => boolean;
  emit_expr: (expr: CoreExpr, ctx: emit_ctx) => Wat;
  expr_type: (expr: CoreExpr, ctx: ctx) => ValType;
  is_stable_static_expr: (expr: CoreExpr) => boolean;
  plan_static_value_expr: (
    expr: CoreExpr,
    ctx: ctx,
    emit_ctx: emit_ctx | undefined,
  ) => CoreIndexAssignValuePlan;
  runtime_union_type_expr: (
    expr: CoreExpr,
    ctx: ctx,
  ) => CoreExpr | undefined;
  runtime_aggregate_type_expr: (
    expr: CoreExpr,
    ctx: ctx,
  ) => CoreExpr | undefined;
  same_runtime_aggregate_type_expr: (
    left: CoreExpr | undefined,
    right: CoreExpr | undefined,
    ctx: ctx,
  ) => boolean;
  same_runtime_union_type_expr: (
    left: CoreExpr | undefined,
    right: CoreExpr | undefined,
    ctx: ctx,
  ) => boolean;
  static_text_value: (
    expr: CoreExpr,
    ctx: ctx,
  ) => CoreExpr | undefined;
};

export type StaticIndexAssignPlan = {
  value: Extract<CoreExpr, { tag: "struct_value" }>;
  setup: Wat;
};

export type RuntimeAggregateIndexAssignPlan = {
  fields: RuntimeAggregateField[];
  static_index: number | undefined;
  index_local: string | undefined;
  value_local: string | undefined;
  value_type: ValType;
};

export type CoreIndexAssignValuePlan = {
  value: CoreExpr;
  setup: Wat;
};

export type CoreIndexAssignStmt = Extract<CoreStmt, { tag: "index_assign" }>;
