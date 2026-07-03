import type { CoreExpr, CoreParam } from "../../../ast.ts";
import type { CoreEmitCtx as EmitCtx } from "../../../emit_ctx.ts";
import {
  create_core_block_ctx,
  type StaticCtx,
  type TempCtx,
} from "../../../local_collect.ts";
import type { CoreBackendGraphDeps } from "../../graph_deps.ts";
import { create_core_backend_static_call } from "../../values/static_call.ts";
import type { CoreBackendStaticCall } from "../../values/static_call/types.ts";
import type { CoreBackendStruct } from "../../values/struct/types.ts";

export function create_core_backend_values_static_call(
  deps: CoreBackendGraphDeps,
  get_struct: () => CoreBackendStruct,
): CoreBackendStaticCall {
  return create_core_backend_static_call({
    apply_core_parameter_annotation: (
      param: CoreParam,
      arg: CoreExpr,
      ctx: StaticCtx,
    ) => deps.type_check().apply_core_parameter_annotation(param, arg, ctx),
    bind_core_struct_type: deps.local_facts().bind_core_struct_type,
    bind_core_union_type: deps.local_facts().bind_core_union_type,
    closure_fn_type: (expr, ctx) => deps.closure().closure_fn_type(expr, ctx),
    collect_expr_locals: (expr: CoreExpr, ctx) =>
      deps.local_collect().collect_expr_locals(expr, ctx),
    core_lam_capture_info: (
      expr: Extract<CoreExpr, { tag: "lam" }>,
      ctx: TempCtx,
    ) => deps.closure().core_lam_capture_info(expr, ctx),
    create_scoped_static_core_call_ctx: create_core_block_ctx,
    emit_expr: (expr: CoreExpr, ctx: EmitCtx) =>
      deps.expr_emit().emit_expr(expr, ctx),
    expr_type: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.expr_type().expr_type(expr, ctx),
    is_static_value_expr: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.static_value().is_static_value_expr(expr, ctx),
    plan_static_value_expr: (
      value: CoreExpr,
      ctx: TempCtx,
      emit_ctx: EmitCtx | undefined,
    ) => deps.static_value().plan_static_value_expr(value, ctx, emit_ctx),
    static_struct_binding: (name: string, ctx: TempCtx) =>
      get_struct().static_struct_binding(name, ctx),
    static_struct_value: (expr: CoreExpr, ctx: StaticCtx) =>
      get_struct().static_struct_value(expr, ctx),
  });
}
