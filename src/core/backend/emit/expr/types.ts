import type { Prim as PrimNode, ValType } from "../../../../op.ts";
import type { Wat } from "../../../../wat.ts";
import type {
  CoreExpr,
  CoreField,
  CoreFnType,
  CoreStmt,
} from "../../../ast.ts";
import type { CoreEmitCtx } from "../../../emit_ctx.ts";
import type { DynamicUnionIf } from "../../../if_let.ts";
import type {
  RuntimeUnionMatchInfo,
  RuntimeUnionTarget,
} from "../../../runtime_union.ts";
import type { RuntimeTextEq } from "../../../text_facts.ts";

export type CoreBackendExprEmitApi = {
  bind_core_if_let_payload_fact: (
    value_name: string | undefined,
    union_case: Extract<CoreExpr, { tag: "union_case" }>,
    ctx: CoreEmitCtx,
  ) => void;
  bind_dynamic_if_let_payload: (
    case_name: string,
    value_name: string | undefined,
    target: DynamicUnionIf,
    ctx: CoreEmitCtx,
  ) => void;
  check_core_text_concat_operand_visibility: (
    expr: Extract<CoreExpr, { tag: "prim" }>,
    ctx: CoreEmitCtx,
  ) => void;
  check_closure_call_args: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    fn_type: CoreFnType,
    ctx: CoreEmitCtx,
  ) => void;
  closure_fn_type: (
    expr: CoreExpr,
    ctx: CoreEmitCtx,
  ) => CoreFnType | undefined;
  collect_stmt_locals: (stmt: CoreStmt, ctx: CoreEmitCtx) => void;
  core_expr_is_text: (expr: CoreExpr, ctx: CoreEmitCtx) => boolean;
  core_runtime_text_concat_operands: (
    expr: CoreExpr,
    ctx: CoreEmitCtx,
  ) => [CoreExpr, CoreExpr] | undefined;
  core_runtime_text_eq_operands: (
    expr: CoreExpr,
    ctx: CoreEmitCtx,
  ) => RuntimeTextEq | undefined;
  core_runtime_union_value: (
    expr: CoreExpr,
    ctx: CoreEmitCtx,
  ) => CoreExpr | undefined;
  dynamic_union_if: (
    expr: CoreExpr,
    ctx: CoreEmitCtx,
  ) => DynamicUnionIf | undefined;
  runtime_union_type_expr: (
    expr: CoreExpr,
    ctx: CoreEmitCtx,
  ) => CoreExpr | undefined;
  runtime_union_match_info: (
    case_name: string,
    target: RuntimeUnionTarget,
    ctx: CoreEmitCtx,
  ) => RuntimeUnionMatchInfo;
  runtime_union_target: (
    expr: CoreExpr,
    ctx: CoreEmitCtx,
  ) => RuntimeUnionTarget | undefined;
  runtime_aggregate_type_expr: (
    expr: CoreExpr,
    ctx: CoreEmitCtx,
  ) => CoreExpr | undefined;
  if_let_branch_ctx: (ctx: CoreEmitCtx) => CoreEmitCtx;
  same_runtime_aggregate_type_expr: (
    left: CoreExpr | undefined,
    right: CoreExpr | undefined,
    ctx: CoreEmitCtx,
  ) => boolean;
  same_runtime_union_type_expr: (
    left: CoreExpr,
    right: CoreExpr,
    ctx: CoreEmitCtx,
  ) => boolean;
  core_typed_prim: (
    expr: Extract<CoreExpr, { tag: "prim" }>,
    ctx: CoreEmitCtx,
  ) => PrimNode;
  emit_core_app: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_core_closure_if_expr: (
    expr: Extract<CoreExpr, { tag: "if" }>,
    fn_type: CoreFnType,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_core_closure_if_let_expr: (
    expr: Extract<CoreExpr, { tag: "if_let" }>,
    fn_type: CoreFnType,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_core_if_let_expr: (
    expr: Extract<CoreExpr, { tag: "if_let" }>,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_dynamic_index_expr: (
    fields: CoreField[],
    index: CoreExpr,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_runtime_closure: (
    expr: Extract<CoreExpr, { tag: "lam" }>,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_runtime_text_byte_index: (
    object: CoreExpr,
    index: CoreExpr,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_runtime_text_concat: (
    expr: Extract<CoreExpr, { tag: "prim" }>,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_runtime_text_eq: (
    expr: Extract<CoreExpr, { tag: "prim" }>,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_runtime_union_value: (expr: CoreExpr, ctx: CoreEmitCtx) => Wat;
  emit_stmt: (stmt: CoreStmt, ctx: CoreEmitCtx, is_final: boolean) => Wat;
  expr_type: (expr: CoreExpr, ctx: CoreEmitCtx) => ValType;
  static_collection_fields: (
    expr: CoreExpr,
    ctx: CoreEmitCtx,
  ) => CoreField[] | undefined;
  static_struct_value: (
    expr: CoreExpr,
    ctx: CoreEmitCtx,
  ) => Extract<CoreExpr, { tag: "struct_value" }> | undefined;
  static_runtime_union_match_branch_ctx: (
    value_name: string | undefined,
    info: RuntimeUnionMatchInfo,
    ctx: CoreEmitCtx,
  ) => CoreEmitCtx;
  static_union_case: (
    expr: CoreExpr,
    ctx: CoreEmitCtx,
  ) => Extract<CoreExpr, { tag: "union_case" }> | undefined;
  static_text_byte_index_expr: (
    expr: Extract<CoreExpr, { tag: "index" }>,
    ctx: CoreEmitCtx,
  ) => CoreExpr | undefined;
  static_text_value: (expr: CoreExpr, ctx: CoreEmitCtx) => CoreExpr | undefined;
};

export type CoreBackendExprEmit = {
  emit_expr: (expr: CoreExpr, ctx: CoreEmitCtx) => Wat;
};
