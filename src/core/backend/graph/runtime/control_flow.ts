import type { CoreExpr, CoreStmt } from "../../../ast.ts";
import { create_core_backend_control_flow } from "../../control_flow.ts";
import type { CoreBackendClosure } from "../../closure/types.ts";
import type { CoreBackendControlFlow } from "../../control_flow/types.ts";
import type { CoreBackendGraphDeps } from "../../graph_deps.ts";
import type { CoreBackendUnion } from "../../union/types.ts";
import { create_core_branch_emit_ctx } from "../../../emit_ctx.ts";
import type { StaticCtx } from "../../../local_collect.ts";
import { runtime_aggregate_type_expr } from "../../../runtime_aggregate.ts";

export function create_core_backend_runtime_control_flow(
  deps: CoreBackendGraphDeps,
  union: CoreBackendUnion,
  closure: CoreBackendClosure,
): CoreBackendControlFlow {
  return create_core_backend_control_flow({
    branch_payload_ctx: create_core_branch_emit_ctx,
    clear_core_local_facts: deps.local_facts().clear_core_local_facts,
    core_expr_is_text: (expr, ctx) => deps.text().core_expr_is_text(expr, ctx),
    dynamic_union_if: (expr: CoreExpr, ctx: StaticCtx) =>
      union.dynamic_union_if(expr, ctx),
    emit_expr: (expr, ctx) => deps.expr_emit().emit_expr(expr, ctx),
    emit_runtime_union_if_let_expr: (
      expr: Extract<CoreExpr, { tag: "if_let" }>,
      target,
      ctx,
    ) => union.emit_runtime_union_if_let_expr(expr, target, ctx),
    emit_runtime_union_if_let_stmt: (
      stmt: Extract<CoreStmt, { tag: "if_let_stmt" }>,
      target,
      ctx,
    ) => union.emit_runtime_union_if_let_stmt(stmt, target, ctx),
    emit_stmt: (stmt, ctx, is_final) =>
      deps.stmt_emit().emit_stmt(stmt, ctx, is_final),
    expr_type: (expr, ctx) => deps.expr_type().expr_type(expr, ctx),
    plan_static_capture_expr: (prefix, value, ctx, emit_ctx) =>
      deps.static_value().plan_static_capture_expr(
        prefix,
        value,
        ctx,
        emit_ctx,
      ),
    plan_static_struct_value: (value, ctx, emit_ctx) =>
      deps.static_value().plan_static_struct_value(value, ctx, emit_ctx),
    runtime_union_target: (expr: CoreExpr, ctx: StaticCtx) =>
      union.runtime_union_target(expr, ctx),
    runtime_aggregate_type_expr: (expr: CoreExpr, ctx: StaticCtx) =>
      runtime_aggregate_type_expr(expr, ctx, {
        check_closure_call_args: closure.check_closure_call_args,
        closure_fn_type: closure.closure_fn_type,
      }),
    runtime_union_type_expr: (expr: CoreExpr, ctx: StaticCtx) =>
      union.runtime_union_type_expr(expr, ctx),
    static_collection_fields: (expr, ctx) =>
      deps.struct().static_collection_fields(expr, ctx),
    static_struct_value: (expr, ctx) =>
      deps.struct().static_struct_value(expr, ctx),
    static_text_value: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.text().static_text_value(expr, ctx),
    static_union_case: (expr: CoreExpr, ctx: StaticCtx) =>
      union.static_union_case(expr, ctx),
  });
}
