import type {
  CoreExpr,
  CoreField,
  CoreFnType,
  CoreStmt,
} from "../../../ast.ts";
import {
  type CoreEmitCtx as EmitCtx,
  create_core_branch_emit_ctx,
} from "../../../emit_ctx.ts";
import type { CoreBackendExprEmit } from "../../emit/expr.ts";
import { create_core_backend_expr_emit } from "../../emit/expr.ts";
import type { CoreBackendGraphDeps } from "../../graph_deps.ts";
import {
  type RuntimeUnionMatchInfo,
  same_runtime_union_type_expr,
} from "../../../runtime_union.ts";
import { bind_runtime_union_match_payload_fact } from "../../../runtime_union_match.ts";
import {
  runtime_aggregate_type_expr,
  same_runtime_aggregate_type_expr,
} from "../../../runtime_aggregate.ts";

export function create_core_backend_graph_expr_emit(
  deps: CoreBackendGraphDeps,
): CoreBackendExprEmit {
  return create_core_backend_expr_emit({
    bind_core_if_let_payload_fact: (
      value_name,
      union_case,
      ctx,
    ) =>
      deps.control_flow().bind_core_if_let_payload_fact(
        value_name,
        union_case,
        ctx,
      ),
    bind_dynamic_if_let_payload: (
      case_name,
      value_name,
      target,
      ctx,
    ) =>
      deps.union().bind_dynamic_if_let_payload(
        case_name,
        value_name,
        target,
        ctx,
      ),
    check_core_text_concat_operand_visibility: (
      expr: Extract<CoreExpr, { tag: "prim" }>,
      ctx: EmitCtx,
    ) => deps.text().check_core_text_concat_operand_visibility(expr, ctx),
    check_closure_call_args: (
      expr: Extract<CoreExpr, { tag: "app" }>,
      fn_type: CoreFnType,
      ctx: EmitCtx,
    ) => deps.closure().check_closure_call_args(expr, fn_type, ctx),
    closure_fn_type: (expr: CoreExpr, ctx: EmitCtx) =>
      deps.closure().closure_fn_type(expr, ctx),
    collect_stmt_locals: (stmt: CoreStmt, ctx: EmitCtx) =>
      deps.local_collect().collect_stmt_locals(stmt, ctx),
    core_expr_is_text: (expr: CoreExpr, ctx: EmitCtx) =>
      deps.text().core_expr_is_text(expr, ctx),
    core_runtime_text_concat_operands: (expr: CoreExpr, ctx: EmitCtx) =>
      deps.text().core_runtime_text_concat_operands(expr, ctx),
    core_runtime_text_eq_operands: (expr: CoreExpr, ctx: EmitCtx) =>
      deps.text().core_runtime_text_eq_operands(expr, ctx),
    core_runtime_union_value: (expr: CoreExpr, ctx: EmitCtx) =>
      deps.union().core_runtime_union_value(expr, ctx),
    dynamic_union_if: (expr: CoreExpr, ctx: EmitCtx) =>
      deps.union().dynamic_union_if(expr, ctx),
    runtime_aggregate_type_expr: (expr: CoreExpr, ctx: EmitCtx) =>
      runtime_aggregate_type_expr(expr, ctx, {
        check_closure_call_args: deps.closure().check_closure_call_args,
        closure_fn_type: deps.closure().closure_fn_type,
      }),
    runtime_union_type_expr: (expr: CoreExpr, ctx: EmitCtx) =>
      deps.union().runtime_union_type_expr(expr, ctx),
    runtime_union_match_info: (case_name, target, ctx) =>
      deps.union().runtime_union_match_info(case_name, target, ctx),
    runtime_union_target: (expr: CoreExpr, ctx: EmitCtx) =>
      deps.union().runtime_union_target(expr, ctx),
    if_let_branch_ctx: create_core_branch_emit_ctx,
    same_runtime_aggregate_type_expr,
    same_runtime_union_type_expr,
    core_typed_prim: deps.expr_type().core_typed_prim,
    emit_core_app: (expr: Extract<CoreExpr, { tag: "app" }>, ctx: EmitCtx) =>
      deps.app().emit_core_app(expr, ctx),
    emit_core_closure_if_expr: (
      expr: Extract<CoreExpr, { tag: "if" }>,
      fn_type: CoreFnType,
      ctx: EmitCtx,
    ) => deps.closure().emit_core_closure_if_expr(expr, fn_type, ctx),
    emit_core_closure_if_let_expr: (
      expr: Extract<CoreExpr, { tag: "if_let" }>,
      fn_type: CoreFnType,
      ctx: EmitCtx,
    ) => deps.closure().emit_core_closure_if_let_expr(expr, fn_type, ctx),
    emit_core_if_let_expr: (
      expr: Extract<CoreExpr, { tag: "if_let" }>,
      ctx: EmitCtx,
    ) => deps.control_flow().emit_if_let_expr(expr, ctx),
    emit_dynamic_index_expr: (
      fields: CoreField[],
      index: CoreExpr,
      ctx: EmitCtx,
    ) => deps.index().emit_dynamic_index_expr(fields, index, ctx),
    emit_runtime_closure: (
      expr: Extract<CoreExpr, { tag: "lam" }>,
      ctx: EmitCtx,
    ) => deps.closure().emit_runtime_closure(expr, ctx),
    emit_runtime_text_byte_index: (
      object: CoreExpr,
      index: CoreExpr,
      ctx: EmitCtx,
    ) => deps.text().emit_runtime_text_byte_index(object, index, ctx),
    emit_runtime_text_concat: (
      expr: Extract<CoreExpr, { tag: "prim" }>,
      ctx: EmitCtx,
    ) => deps.text().emit_runtime_text_concat(expr, ctx),
    emit_runtime_text_eq: (
      expr: Extract<CoreExpr, { tag: "prim" }>,
      ctx: EmitCtx,
    ) => deps.text().emit_runtime_text_eq(expr, ctx),
    emit_runtime_union_value: (expr: CoreExpr, ctx: EmitCtx) =>
      deps.union().emit_runtime_union_value(expr, ctx),
    emit_stmt: (stmt: CoreStmt, ctx: EmitCtx, is_final: boolean) =>
      deps.stmt_emit().emit_stmt(stmt, ctx, is_final),
    expr_type: deps.expr_type().expr_type,
    static_collection_fields: (expr: CoreExpr, ctx: EmitCtx) =>
      deps.struct().static_collection_fields(expr, ctx),
    static_struct_value: (expr: CoreExpr, ctx: EmitCtx) =>
      deps.struct().static_struct_value(expr, ctx),
    static_runtime_union_match_branch_ctx:
      create_emit_runtime_union_match_branch_ctx,
    static_union_case: (expr: CoreExpr, ctx: EmitCtx) =>
      deps.union().static_union_case(expr, ctx),
    static_text_byte_index_expr: (
      expr: Extract<CoreExpr, { tag: "index" }>,
      ctx: EmitCtx,
    ) => deps.text().static_text_byte_index_expr(expr, ctx),
    static_text_value: (expr: CoreExpr, ctx: EmitCtx) =>
      deps.text().static_text_value(expr, ctx),
  });
}

function create_emit_runtime_union_match_branch_ctx(
  value_name: string | undefined,
  info: RuntimeUnionMatchInfo,
  ctx: EmitCtx,
): EmitCtx {
  const branch_ctx = create_core_branch_emit_ctx(ctx);
  bind_runtime_union_match_payload_fact(value_name, info, branch_ctx);
  return branch_ctx;
}
