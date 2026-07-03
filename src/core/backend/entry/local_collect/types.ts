import type { ValType } from "../../../../op.ts";
import type { Core as CoreNode, CoreExpr, CoreStmt } from "../../../ast.ts";
import type { CoreBackendLocalFacts } from "../../analysis/local_facts.ts";
import type { CoreBackendTypeCheck } from "../../analysis/type_check.ts";
import type { CoreBackendClosure } from "../../closure/types.ts";
import type { CoreBackendControlFlow } from "../../control_flow/types.ts";
import type { CoreBackendRec } from "../../runtime/rec/types.ts";
import type { CoreBackendText } from "../../text/types.ts";
import type { CoreBackendUnion } from "../../union/types.ts";
import type { CoreBackendStaticCall } from "../../values/static_call/types.ts";
import type { CoreBackendStaticValue } from "../../values/static_value/types.ts";
import type { CoreBackendStruct } from "../../values/struct/types.ts";
import type { CoreCtx, StaticCtx } from "../../../local_collect.ts";
import type { CoreBackendIndex } from "../index.ts";

type LocalCollectClosure = Pick<
  CoreBackendClosure,
  | "check_closure_call_args"
  | "closure_fn_type"
  | "closure_fn_type_with_expected"
  | "plan_core_lam_capture"
>;

type LocalCollectControlFlow = Pick<
  CoreBackendControlFlow,
  | "bind_core_if_let_payload_fact"
  | "merge_if_else_static_assignments"
>;

type LocalCollectIndex = Pick<
  CoreBackendIndex,
  | "plan_runtime_aggregate_index_assign"
  | "plan_static_index_assign"
  | "static_collection_item_type"
>;

type LocalCollectLocalFacts = Pick<
  CoreBackendLocalFacts,
  | "bind_core_assignment_struct_type"
  | "bind_core_assignment_union_type"
  | "bind_core_fn_type"
  | "bind_core_struct_type"
  | "bind_core_union_type"
  | "clear_core_local_facts"
  | "clear_optional_core_union_local"
>;

type LocalCollectRec = Pick<
  CoreBackendRec,
  | "bind_rec_initial_params"
  | "check_rec_tail_call_args"
  | "is_core_rec_tail_call"
>;

type LocalCollectStaticCall = Pick<
  CoreBackendStaticCall,
  | "collect_scoped_static_core_call_locals"
  | "static_core_call_target"
  | "static_core_call_value"
>;

type LocalCollectStaticValue = Pick<
  CoreBackendStaticValue,
  | "is_static_value_expr"
  | "plan_static_capture_expr"
  | "plan_static_value_expr"
>;

type LocalCollectStruct = Pick<
  CoreBackendStruct,
  | "static_collection_fields"
  | "static_struct_binding"
  | "static_struct_value"
>;

type LocalCollectText = Pick<
  CoreBackendText,
  | "core_expr_has_runtime_text_fact"
  | "core_expr_is_text"
  | "core_runtime_text_concat_operands"
  | "core_runtime_text_eq_operands"
  | "static_text_value"
>;

type LocalCollectTypeCheck = Pick<
  CoreBackendTypeCheck,
  | "check_core_type_pattern"
  | "core_binding_value"
  | "core_type_const_value"
>;

type LocalCollectUnion = Pick<
  CoreBackendUnion,
  | "bind_dynamic_if_let_payload"
  | "collect_runtime_union_value_locals"
  | "dynamic_union_if"
  | "runtime_union_target"
  | "static_union_case"
>;

export type CoreBackendLocalCollectApi = {
  closure: LocalCollectClosure;
  control_flow: LocalCollectControlFlow;
  index: LocalCollectIndex;
  local_facts: LocalCollectLocalFacts;
  rec: LocalCollectRec;
  static_call: LocalCollectStaticCall;
  static_value: LocalCollectStaticValue;
  struct: LocalCollectStruct;
  text: LocalCollectText;
  type_check: LocalCollectTypeCheck;
  union: LocalCollectUnion;
  expr_type: (expr: CoreExpr, ctx: StaticCtx) => ValType;
};

export type CoreBackendLocalCollect = {
  collect_core_ctx: (core: CoreNode) => CoreCtx;
  collect_stmt_locals: (stmt: CoreStmt, ctx: CoreCtx) => void;
  collect_expr_locals: (expr: CoreExpr, ctx: CoreCtx) => void;
};
