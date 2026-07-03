import type { CoreExpr } from "../../../ast.ts";
import type { CoreEmitCtx } from "../../../emit_ctx.ts";
import type { CoreCtx, StaticCtx, TempCtx } from "../../../local_collect.ts";
import type { StaticCoreCallHooks } from "../../../static_call.ts";
import type { CoreBackendStaticCallApi } from "./types.ts";

export function create_core_backend_static_call_hooks(
  api: CoreBackendStaticCallApi,
): StaticCoreCallHooks<StaticCtx, TempCtx, CoreCtx, CoreEmitCtx> {
  return {
    apply_core_parameter_annotation: api.apply_core_parameter_annotation,
    bind_core_struct_type: api.bind_core_struct_type,
    bind_core_union_type: api.bind_core_union_type,
    closure_fn_type: api.closure_fn_type,
    collect_expr_locals: api.collect_expr_locals,
    core_lam_capture_info: api.core_lam_capture_info,
    create_scoped_static_core_call_ctx: api.create_scoped_static_core_call_ctx,
    emit_expr: api.emit_expr,
    expr_type: api.expr_type,
    is_static_value_expr: api.is_static_value_expr,
    plan_static_value_expr: api.plan_static_value_expr,
    static_struct_binding: api.static_struct_binding,
    static_struct_value: (
      expr: CoreExpr,
      ctx: StaticCtx,
    ) => api.static_struct_value(expr, ctx),
  };
}
