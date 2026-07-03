import type { StaticCtx } from "../../../local_collect.ts";
import type { CoreTypeCheckHooks } from "../../../type_check.ts";
import type { CoreBackendTypeCheckApi } from "./types.ts";

export function create_core_backend_type_check_hooks(
  api: CoreBackendTypeCheckApi,
): CoreTypeCheckHooks<StaticCtx> {
  return {
    core_expr_has_runtime_text_fact: api.core_expr_has_runtime_text_fact,
    core_expr_is_text: api.core_expr_is_text,
    core_runtime_text_concat_operands: api.core_runtime_text_concat_operands,
    dynamic_union_if: api.dynamic_union_if,
    expr_type: api.expr_type,
    runtime_aggregate_type_expr: api.runtime_aggregate_type_expr,
    runtime_union_type_expr: api.runtime_union_type_expr,
    same_runtime_aggregate_type_expr: api.same_runtime_aggregate_type_expr,
    static_struct_value: api.static_struct_value,
    static_text_value: api.static_text_value,
    static_type_level_value: api.static_type_level_value,
    static_type_name: api.static_type_name,
    static_type_value: api.static_type_value,
    static_union_case: api.static_union_case,
  };
}
