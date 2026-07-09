import type { CoreExpr } from "../../../ast.ts";
import type { CoreEmitCtx } from "../../../emit_ctx.ts";
import type { CoreExprEmitHooks } from "../../../expr_emit.ts";
import type { CoreBackendExprEmitApi } from "./types.ts";

export function create_core_backend_expr_emit_hooks(
  api: CoreBackendExprEmitApi,
): CoreExprEmitHooks<CoreEmitCtx> {
  return {
    bind_core_if_let_payload_fact: api.bind_core_if_let_payload_fact,
    bind_dynamic_if_let_payload: api.bind_dynamic_if_let_payload,
    check_core_text_concat_operand_visibility:
      api.check_core_text_concat_operand_visibility,
    check_closure_call_args: api.check_closure_call_args,
    closure_fn_type: api.closure_fn_type,
    collect_stmt_locals: api.collect_stmt_locals,
    core_expr_is_text: api.core_expr_is_text,
    core_typed_prim: api.core_typed_prim,
    dynamic_union_if: api.dynamic_union_if,
    emit_core_app: api.emit_core_app,
    emit_core_if_let_expr: api.emit_core_if_let_expr,
    emit_dynamic_index_expr: api.emit_dynamic_index_expr,
    emit_runtime_closure: api.emit_runtime_closure,
    emit_runtime_text_byte_index: api.emit_runtime_text_byte_index,
    emit_runtime_text_concat: api.emit_runtime_text_concat,
    emit_runtime_text_eq: api.emit_runtime_text_eq,
    emit_runtime_union_value: api.emit_runtime_union_value,
    emit_stmt: api.emit_stmt,
    expr_type: api.expr_type,
    is_runtime_text_concat: (
      expr: Extract<CoreExpr, { tag: "prim" }>,
      ctx: CoreEmitCtx,
    ) => api.core_runtime_text_concat_operands(expr, ctx) !== undefined,
    runtime_text_eq_operands: api.core_runtime_text_eq_operands,
    runtime_aggregate_type_expr: api.runtime_aggregate_type_expr,
    runtime_union_match_info: api.runtime_union_match_info,
    runtime_union_target: api.runtime_union_target,
    runtime_union_value: api.core_runtime_union_value,
    runtime_union_type_expr: api.runtime_union_type_expr,
    if_let_branch_ctx: api.if_let_branch_ctx,
    same_runtime_aggregate_type_expr: api.same_runtime_aggregate_type_expr,
    same_runtime_union_type_expr: api.same_runtime_union_type_expr,
    static_collection_fields: api.static_collection_fields,
    static_core_call_requires_scope: api.static_core_call_requires_scope,
    static_core_call_target: api.static_core_call_target,
    static_core_call_value: api.static_core_call_value,
    static_runtime_union_match_branch_ctx:
      api.static_runtime_union_match_branch_ctx,
    static_struct_value: api.static_struct_value,
    static_union_case: api.static_union_case,
    static_text_byte_index_expr: api.static_text_byte_index_expr,
    static_text_value: api.static_text_value,
  };
}
