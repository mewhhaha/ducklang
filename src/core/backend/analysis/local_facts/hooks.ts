import type { StaticCtx } from "../../../local_collect.ts";
import type { CoreLocalFactHooks } from "../../../local_facts.ts";
import type { CoreBackendLocalFactsApi } from "./types.ts";

export function create_core_backend_local_fact_hooks(
  api: CoreBackendLocalFactsApi,
): CoreLocalFactHooks<StaticCtx> {
  return {
    closure_fn_type: api.closure_fn_type,
    runtime_aggregate_type_expr: api.runtime_aggregate_type_expr,
    runtime_union_type_expr: api.runtime_union_type_expr,
    same_runtime_aggregate_type_expr: api.same_runtime_aggregate_type_expr,
    same_runtime_union_type_expr: api.same_runtime_union_type_expr,
    static_type_value: api.static_type_value,
  };
}
