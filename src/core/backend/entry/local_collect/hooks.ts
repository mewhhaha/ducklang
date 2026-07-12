import { same_core_fn_type } from "../../../closure_type.ts";
import type { CoreLocalCollectHooks } from "../../../local_collect.ts";
import type { CoreBackendLocalCollectApi } from "./types.ts";

export function create_core_backend_local_collect_hooks(
  api: CoreBackendLocalCollectApi,
): CoreLocalCollectHooks {
  return {
    bind_core_assignment_struct_type:
      api.local_facts.bind_core_assignment_struct_type,
    bind_core_assignment_union_type:
      api.local_facts.bind_core_assignment_union_type,
    bind_core_fn_type: api.local_facts.bind_core_fn_type,
    bind_core_if_let_payload_fact:
      api.control_flow.bind_core_if_let_payload_fact,
    bind_core_struct_type: api.local_facts.bind_core_struct_type,
    bind_core_union_type: api.local_facts.bind_core_union_type,
    bind_dynamic_if_let_payload: api.union.bind_dynamic_if_let_payload,
    bind_rec_initial_params: api.rec.bind_rec_initial_params,
    check_closure_call_args: api.closure.check_closure_call_args,
    check_core_type_pattern: api.type_check.check_core_type_pattern,
    check_rec_tail_call_args: api.rec.check_rec_tail_call_args,
    clear_core_local_facts: api.local_facts.clear_core_local_facts,
    clear_optional_core_union_local:
      api.local_facts.clear_optional_core_union_local,
    closure_fn_type: api.closure.closure_fn_type,
    closure_fn_type_with_expected: api.closure.closure_fn_type_with_expected,
    collect_runtime_union_value_locals:
      api.union.collect_runtime_union_value_locals,
    collect_scoped_static_core_call_locals:
      api.static_call.collect_scoped_static_core_call_locals,
    core_assignment_value: api.type_check.core_assignment_value,
    core_binding_value: api.type_check.core_binding_value,
    core_expr_has_runtime_text_fact: api.text.core_expr_has_runtime_text_fact,
    core_expr_is_text: api.text.core_expr_is_text,
    core_runtime_text_concat_operands:
      api.text.core_runtime_text_concat_operands,
    core_runtime_text_eq_operands: api.text.core_runtime_text_eq_operands,
    core_type_const_value: api.type_check.core_type_const_value,
    dynamic_union_if: api.union.dynamic_union_if,
    expr_type: api.expr_type,
    is_core_rec_tail_call: api.rec.is_core_rec_tail_call,
    is_static_value_expr: api.static_value.is_static_value_expr,
    merge_if_else_static_assignments:
      api.control_flow.merge_if_else_static_assignments,
    plan_core_lam_capture: api.closure.plan_core_lam_capture,
    plan_core_runtime_aggregate_index_assign:
      api.index.plan_runtime_aggregate_index_assign,
    plan_core_static_index_assign: api.index.plan_static_index_assign,
    plan_static_capture_expr: api.static_value.plan_static_capture_expr,
    plan_static_value_expr: api.static_value.plan_static_value_expr,
    runtime_union_target: api.union.runtime_union_target,
    same_core_fn_type,
    static_collection_fields: api.struct.static_collection_fields,
    static_collection_item_type: api.index.static_collection_item_type,
    static_core_call_target: api.static_call.static_core_call_target,
    static_core_call_value: api.static_call.static_core_call_value,
    static_struct_binding: api.struct.static_struct_binding,
    static_struct_value: api.struct.static_struct_value,
    static_text_value: api.text.static_text_value,
    static_union_case: api.union.static_union_case,
  };
}
