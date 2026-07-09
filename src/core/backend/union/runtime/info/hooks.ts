import type { CoreExpr } from "../../../../ast.ts";
import type { StaticCtx } from "../../../../local_collect.ts";
import {
  type RuntimeUnionHooks,
  same_runtime_union_type_expr,
} from "../../../../runtime_union.ts";
import type { CoreBackendUnionStatic } from "../../static.ts";
import type { CoreBackendUnionApi } from "../../types.ts";

export function create_core_backend_union_runtime_hooks(
  api: CoreBackendUnionApi,
  static_union: CoreBackendUnionStatic,
  runtime_union_type_expr: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => CoreExpr | undefined,
): RuntimeUnionHooks<StaticCtx> {
  return {
    check_closure_call_args: api.check_closure_call_args,
    closure_fn_type: api.closure_fn_type,
    core_expr_is_text: api.core_expr_is_text,
    dynamic_union_if: static_union.dynamic_union_if,
    expr_type: api.expr_type,
    runtime_aggregate_type_expr: api.runtime_aggregate_type_expr,
    runtime_union_type_expr,
    same_runtime_aggregate_type_expr: api.same_runtime_aggregate_type_expr,
    same_runtime_union_type_expr,
    static_collection_fields: api.static_collection_fields,
    static_struct_value: api.static_struct_value,
    static_union_case: static_union.static_union_case,
  };
}
