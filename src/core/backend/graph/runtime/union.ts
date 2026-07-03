import type { CoreExpr } from "../../../ast.ts";
import type { CoreBackendClosure } from "../../closure/types.ts";
import type { CoreBackendGraphDeps } from "../../graph_deps.ts";
import { create_core_backend_union } from "../../union.ts";
import type { CoreBackendUnion } from "../../union/types.ts";
import {
  create_core_runtime_union_match_branch_ctx,
} from "../../../emit_ctx.ts";
import type { StaticCtx } from "../../../local_collect.ts";
import {
  runtime_aggregate_type_expr,
  same_runtime_aggregate_type_expr,
} from "../../../runtime_aggregate.ts";
import { static_type_value } from "../../../type_static.ts";

export function create_core_backend_runtime_union(
  deps: CoreBackendGraphDeps,
  closure: CoreBackendClosure,
): CoreBackendUnion {
  return create_core_backend_union({
    check_closure_call_args: closure.check_closure_call_args,
    check_core_value_type_name: (
      label: string,
      expected_type_name: string,
      value: CoreExpr,
      ctx: StaticCtx,
    ) =>
      deps.type_check().check_core_value_type_name(
        label,
        expected_type_name,
        value,
        ctx,
      ),
    closure_fn_type: closure.closure_fn_type,
    collect_expr_locals: (expr, ctx) =>
      deps.local_collect().collect_expr_locals(expr, ctx),
    core_expr_is_text: (expr, ctx) => deps.text().core_expr_is_text(expr, ctx),
    emit_expr: (expr, ctx) => deps.expr_emit().emit_expr(expr, ctx),
    emit_stmt: (stmt, ctx, is_final) =>
      deps.stmt_emit().emit_stmt(stmt, ctx, is_final),
    expr_type: (expr, ctx) => deps.expr_type().expr_type(expr, ctx),
    match_branch_ctx: create_core_runtime_union_match_branch_ctx,
    runtime_aggregate_type_expr: (expr: CoreExpr, ctx: StaticCtx) =>
      runtime_aggregate_type_expr(expr, ctx, {
        check_closure_call_args: closure.check_closure_call_args,
        closure_fn_type: closure.closure_fn_type,
      }),
    same_runtime_aggregate_type_expr,
    static_core_call_value: (expr, ctx) =>
      deps.static_call().static_core_call_value(expr, ctx),
    static_struct_value: (expr, ctx) =>
      deps.struct().static_struct_value(expr, ctx),
    static_type_value,
  });
}
