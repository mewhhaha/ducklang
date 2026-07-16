import type { ValType } from "../../../../op.ts";
import type { Wat } from "../../../../wat.ts";
import type { CoreExpr, CoreField, CoreStmt } from "../../../ast.ts";
import type { CoreEmitCtx } from "../../../emit_ctx.ts";
import type {
  RuntimeAggregateIndexAssignPlan,
  StaticIndexAssignPlan,
} from "../../../index_assign.ts";
import type { CoreCtx, StaticCtx, TempCtx } from "../../../local_collect.ts";
import type { StaticValuePlan } from "../../../static_values.ts";

export type CoreBackendIndexApi = {
  core_expr_is_text: (expr: CoreExpr, ctx: StaticCtx) => boolean;
  emit_expr: (expr: CoreExpr, ctx: CoreEmitCtx) => Wat;
  expr_type: (expr: CoreExpr, ctx: StaticCtx) => ValType;
  plan_static_capture_expr: (
    prefix: string,
    expr: CoreExpr,
    ctx: TempCtx,
    emit_ctx: CoreEmitCtx | undefined,
  ) => StaticValuePlan;
  plan_static_value_expr: (
    expr: CoreExpr,
    ctx: TempCtx,
    emit_ctx: CoreEmitCtx | undefined,
  ) => StaticValuePlan;
  runtime_union_type_expr: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => CoreExpr | undefined;
  runtime_aggregate_type_expr: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => CoreExpr | undefined;
  same_runtime_aggregate_type_expr: (
    left: CoreExpr | undefined,
    right: CoreExpr | undefined,
    ctx: StaticCtx,
  ) => boolean;
  same_runtime_union_type_expr: (
    left: CoreExpr | undefined,
    right: CoreExpr | undefined,
    ctx: StaticCtx,
  ) => boolean;
  static_text_value: (expr: CoreExpr, ctx: TempCtx) => CoreExpr | undefined;
};

export type CoreBackendIndex = {
  emit_dynamic_index_expr: (
    fields: CoreField[],
    index: CoreExpr,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_static_index_assign: (
    target: Extract<CoreExpr, { tag: "struct_value" }>,
    stmt: Extract<CoreStmt, { tag: "index_assign" }>,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_runtime_aggregate_index_assign: (
    type_expr: CoreExpr,
    stmt: Extract<CoreStmt, { tag: "index_assign" }>,
    ctx: CoreEmitCtx,
  ) => Wat;
  plan_static_index_assign: (
    target: Extract<CoreExpr, { tag: "struct_value" }>,
    index: CoreExpr,
    value: CoreExpr,
    ctx: CoreCtx,
    emit_ctx: CoreEmitCtx | undefined,
  ) => StaticIndexAssignPlan;
  plan_runtime_aggregate_index_assign: (
    type_expr: CoreExpr,
    stmt: Extract<CoreStmt, { tag: "index_assign" }>,
    ctx: CoreCtx,
  ) => RuntimeAggregateIndexAssignPlan;
  static_collection_item_type: (
    fields: CoreField[],
    ctx: StaticCtx,
  ) => ValType | undefined;
};
