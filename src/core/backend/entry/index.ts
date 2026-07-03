import type { ValType } from "../../../op.ts";
import type { Wat } from "../../../wat.ts";
import type { CoreExpr, CoreField, CoreStmt } from "../../ast.ts";
import type { CoreEmitCtx } from "../../emit_ctx.ts";
import {
  emit_core_runtime_aggregate_index_assign
    as emit_core_runtime_aggregate_index_assign_with_hooks,
  emit_core_static_index_assign as emit_core_static_index_assign_with_hooks,
  plan_core_runtime_aggregate_index_assign
    as plan_core_runtime_aggregate_index_assign_with_hooks,
  plan_core_static_index_assign as plan_core_static_index_assign_with_hooks,
  type RuntimeAggregateIndexAssignPlan,
  type StaticIndexAssignPlan,
} from "../../index_assign.ts";
import {
  emit_core_dynamic_index_expr as emit_core_dynamic_index_expr_with_hooks,
  static_collection_item_type as static_collection_item_type_with_hooks,
} from "../../index_expr.ts";
import type { CoreCtx, StaticCtx } from "../../local_collect.ts";
import { create_core_backend_index_hooks } from "./index/hooks.ts";
import type { CoreBackendIndex, CoreBackendIndexApi } from "./index/types.ts";

export type { CoreBackendIndex, CoreBackendIndexApi } from "./index/types.ts";

export function create_core_backend_index(
  api: CoreBackendIndexApi,
): CoreBackendIndex {
  const {
    collection_item_type_hooks,
    dynamic_index_hooks,
    index_assign_hooks,
  } = create_core_backend_index_hooks(api);

  function emit_dynamic_index_expr(
    fields: CoreField[],
    index: CoreExpr,
    ctx: CoreEmitCtx,
  ): Wat {
    return emit_core_dynamic_index_expr_with_hooks(
      fields,
      index,
      ctx,
      dynamic_index_hooks,
    );
  }

  function emit_static_index_assign(
    target: Extract<CoreExpr, { tag: "struct_value" }>,
    stmt: Extract<CoreStmt, { tag: "index_assign" }>,
    ctx: CoreEmitCtx,
  ): Wat {
    return emit_core_static_index_assign_with_hooks(
      target,
      stmt,
      ctx,
      index_assign_hooks,
    );
  }

  function emit_runtime_aggregate_index_assign(
    type_expr: CoreExpr,
    stmt: Extract<CoreStmt, { tag: "index_assign" }>,
    ctx: CoreEmitCtx,
  ): Wat {
    return emit_core_runtime_aggregate_index_assign_with_hooks(
      type_expr,
      stmt,
      ctx,
      index_assign_hooks,
    );
  }

  function plan_static_index_assign(
    target: Extract<CoreExpr, { tag: "struct_value" }>,
    index: CoreExpr,
    value: CoreExpr,
    ctx: CoreCtx,
    emit_ctx: CoreEmitCtx | undefined,
  ): StaticIndexAssignPlan {
    return plan_core_static_index_assign_with_hooks(
      target,
      index,
      value,
      ctx,
      emit_ctx,
      index_assign_hooks,
    );
  }

  function plan_runtime_aggregate_index_assign(
    type_expr: CoreExpr,
    stmt: Extract<CoreStmt, { tag: "index_assign" }>,
    ctx: CoreCtx,
  ): RuntimeAggregateIndexAssignPlan {
    return plan_core_runtime_aggregate_index_assign_with_hooks(
      type_expr,
      stmt,
      ctx,
      index_assign_hooks,
    );
  }

  function static_collection_item_type(
    fields: CoreField[],
    ctx: StaticCtx,
  ): ValType | undefined {
    return static_collection_item_type_with_hooks(
      fields,
      ctx,
      collection_item_type_hooks,
    );
  }

  return {
    emit_dynamic_index_expr,
    emit_runtime_aggregate_index_assign,
    emit_static_index_assign,
    plan_runtime_aggregate_index_assign,
    plan_static_index_assign,
    static_collection_item_type,
  };
}
