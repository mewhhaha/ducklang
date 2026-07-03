import type { CoreExpr } from "../../../ast.ts";
import type { StaticCtx } from "../../../local_collect.ts";
import {
  runtime_aggregate_type_expr,
  same_runtime_aggregate_type_expr,
} from "../../../runtime_aggregate.ts";
import {
  static_type_level_value,
  static_type_name,
  static_type_value,
} from "../../../type_static.ts";
import type { CoreBackendExprType } from "../../analysis/expr_type.ts";
import type { CoreBackendTypeCheck } from "../../analysis/type_check.ts";
import { create_core_backend_type_check } from "../../analysis/type_check.ts";
import type { CoreBackendGraphDeps } from "../../graph_deps.ts";

export function create_core_backend_graph_type_check(
  deps: CoreBackendGraphDeps,
  expr_type: CoreBackendExprType,
): CoreBackendTypeCheck {
  return create_core_backend_type_check({
    core_expr_has_runtime_text_fact: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.text().core_expr_has_runtime_text_fact(expr, ctx),
    core_expr_is_text: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.text().core_expr_is_text(expr, ctx),
    core_runtime_text_concat_operands: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.text().core_runtime_text_concat_operands(expr, ctx),
    dynamic_union_if: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.union().dynamic_union_if(expr, ctx),
    expr_type: expr_type.expr_type,
    runtime_aggregate_type_expr: (expr: CoreExpr, ctx: StaticCtx) =>
      runtime_aggregate_type_expr(expr, ctx, {
        check_closure_call_args: (
          app_expr,
          fn_type,
          app_ctx,
        ) => deps.closure().check_closure_call_args(app_expr, fn_type, app_ctx),
        closure_fn_type: (value, value_ctx) =>
          deps.closure().closure_fn_type(value, value_ctx),
      }),
    runtime_union_type_expr: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.union().runtime_union_type_expr(expr, ctx),
    same_runtime_aggregate_type_expr,
    static_struct_value: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.struct().static_struct_value(expr, ctx),
    static_text_value: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.text().static_text_value(expr, ctx),
    static_type_level_value,
    static_type_name,
    static_type_value,
    static_union_case: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.union().static_union_case(expr, ctx),
  });
}
