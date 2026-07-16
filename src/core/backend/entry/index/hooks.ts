import type { CoreIndexAssignHooks } from "../../../index_assign.ts";
import type {
  CoreCollectionItemTypeHooks,
  CoreDynamicIndexHooks,
} from "../../../index_expr.ts";
import type { CoreEmitCtx } from "../../../emit_ctx.ts";
import type { StaticCtx, TempCtx } from "../../../local_collect.ts";
import { is_stable_static_expr } from "../../../static_stability.ts";
import type { CoreBackendIndexApi } from "./types.ts";

export type CoreBackendIndexHooks = {
  index_assign_hooks: CoreIndexAssignHooks<TempCtx, CoreEmitCtx>;
  collection_item_type_hooks: CoreCollectionItemTypeHooks<StaticCtx>;
  dynamic_index_hooks: CoreDynamicIndexHooks<CoreEmitCtx>;
};

export function create_core_backend_index_hooks(
  api: CoreBackendIndexApi,
): CoreBackendIndexHooks {
  const index_assign_hooks = {
    core_expr_is_text: api.core_expr_is_text,
    emit_expr: api.emit_expr,
    expr_type: api.expr_type,
    is_stable_static_expr,
    plan_static_capture_expr: api.plan_static_capture_expr,
    plan_static_value_expr: api.plan_static_value_expr,
    runtime_aggregate_type_expr: api.runtime_aggregate_type_expr,
    runtime_union_type_expr: api.runtime_union_type_expr,
    same_runtime_aggregate_type_expr: api.same_runtime_aggregate_type_expr,
    same_runtime_union_type_expr: api.same_runtime_union_type_expr,
    static_text_value: api.static_text_value,
  } satisfies CoreIndexAssignHooks<TempCtx, CoreEmitCtx>;

  const collection_item_type_hooks = {
    expr_type: api.expr_type,
  } satisfies CoreCollectionItemTypeHooks<StaticCtx>;

  const dynamic_index_hooks = {
    emit_expr: api.emit_expr,
    expr_type: api.expr_type,
  } satisfies CoreDynamicIndexHooks<CoreEmitCtx>;

  return {
    collection_item_type_hooks,
    dynamic_index_hooks,
    index_assign_hooks,
  };
}
