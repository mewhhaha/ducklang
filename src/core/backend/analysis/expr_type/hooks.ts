import type { CoreExpr } from "../../../ast.ts";
import {
  type CoreCtx,
  create_core_block_ctx,
  type StaticCtx,
} from "../../../local_collect.ts";
import type { CoreExprTypeHooks } from "../../../expr_type.ts";
import type { CoreBackendExprTypeApi } from "./types.ts";

export function create_core_backend_expr_type_hooks(
  api: CoreBackendExprTypeApi,
  core_typed_prim: (
    expr: Extract<CoreExpr, { tag: "prim" }>,
    ctx: StaticCtx,
  ) => ReturnType<CoreExprTypeHooks<StaticCtx, CoreCtx>["core_typed_prim"]>,
): CoreExprTypeHooks<StaticCtx, CoreCtx> {
  return {
    app_type: api.app_type,
    bind_core_if_let_payload_fact: api.bind_core_if_let_payload_fact,
    bind_dynamic_if_let_payload: api.bind_dynamic_if_let_payload,
    check_core_text_concat_operand_visibility:
      api.check_core_text_concat_operand_visibility,
    check_closure_call_args: api.check_closure_call_args,
    clear_optional_core_union_local: api.clear_optional_core_union_local,
    closure_fn_type: api.closure_fn_type,
    collect_stmt_locals: api.collect_stmt_locals,
    core_expr_is_text: api.core_expr_is_text,
    core_runtime_text_concat_operands: api.core_runtime_text_concat_operands,
    core_runtime_text_eq_operands: api.core_runtime_text_eq_operands,
    core_runtime_union_value: api.core_runtime_union_value,
    core_typed_prim,
    create_block_ctx: create_core_block_ctx,
    dynamic_union_if: api.dynamic_union_if,
    runtime_union_match_info: api.runtime_union_match_info,
    runtime_union_target: api.runtime_union_target,
    runtime_union_value_type: api.runtime_union_value_type,
    static_collection_fields: api.static_collection_fields,
    static_runtime_union_match_branch_ctx:
      api.static_runtime_union_match_branch_ctx,
    static_struct_value: api.static_struct_value,
    static_text_byte_index_expr: api.static_text_byte_index_expr,
    static_text_value: api.static_text_value,
    static_type_value: api.static_type_value,
    static_union_case: api.static_union_case,
  };
}
