import type { CoreExpr } from "../../../ast.ts";
import type { TempCtx } from "../../../local_collect.ts";
import {
  runtime_aggregate_type_expr,
  same_runtime_aggregate_type_expr,
} from "../../../runtime_aggregate.ts";
import { same_runtime_union_type_expr } from "../../../runtime_union.ts";
import type { CoreBackendIndex } from "../../entry/index.ts";
import { create_core_backend_index } from "../../entry/index.ts";
import type { CoreBackendGraphDeps } from "../../graph_deps.ts";

export function create_core_backend_graph_index(
  deps: CoreBackendGraphDeps,
): CoreBackendIndex {
  return create_core_backend_index({
    core_expr_is_text: (expr, ctx) => deps.text().core_expr_is_text(expr, ctx),
    emit_expr: (expr, ctx) => deps.expr_emit().emit_expr(expr, ctx),
    expr_type: (expr, ctx) => deps.expr_type().expr_type(expr, ctx),
    plan_static_value_expr: (value, ctx, emit_ctx) =>
      deps.static_value().plan_static_value_expr(value, ctx, emit_ctx),
    runtime_aggregate_type_expr: (expr, ctx) =>
      runtime_aggregate_type_expr(expr, ctx, {
        check_closure_call_args: deps.closure().check_closure_call_args,
        closure_fn_type: deps.closure().closure_fn_type,
      }),
    runtime_union_type_expr: (expr, ctx) =>
      deps.union().runtime_union_type_expr(expr, ctx),
    same_runtime_aggregate_type_expr,
    same_runtime_union_type_expr,
    static_text_value: (expr: CoreExpr, ctx: TempCtx) =>
      deps.text().static_text_value(expr, ctx),
  });
}
