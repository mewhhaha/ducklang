import type { Prim as PrimNode, ValType } from "../../../../op.ts";
import type {
  CoreExpr,
  CoreField,
  CoreFnType,
  CoreStmt,
} from "../../../ast.ts";
import type { DynamicUnionIf } from "../../../if_let.ts";
import type { CoreCtx, StaticCtx } from "../../../local_collect.ts";
import type {
  RuntimeUnionMatchInfo,
  RuntimeUnionTarget,
} from "../../../runtime_union.ts";
import type { RuntimeTextEq } from "../../../text_facts.ts";

export type CoreBackendExprTypeApi = {
  app_type: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    ctx: StaticCtx,
  ) => ValType;
  bind_core_if_let_payload_fact: (
    value_name: string | undefined,
    union_case: Extract<CoreExpr, { tag: "union_case" }>,
    ctx: StaticCtx,
  ) => void;
  bind_dynamic_if_let_payload: (
    case_name: string,
    value_name: string | undefined,
    target: DynamicUnionIf,
    ctx: StaticCtx,
  ) => void;
  check_core_text_concat_operand_visibility: (
    expr: Extract<CoreExpr, { tag: "prim" }>,
    ctx: StaticCtx,
  ) => void;
  check_closure_call_args: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    fn_type: CoreFnType,
    ctx: StaticCtx,
  ) => void;
  clear_optional_core_union_local: (
    value_name: string | undefined,
    ctx: StaticCtx,
  ) => void;
  closure_fn_type: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => CoreFnType | undefined;
  collect_stmt_locals: (stmt: CoreStmt, ctx: CoreCtx) => void;
  core_expr_is_text: (expr: CoreExpr, ctx: StaticCtx) => boolean;
  core_runtime_text_concat_operands: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => [CoreExpr, CoreExpr] | undefined;
  core_runtime_text_eq_operands: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => RuntimeTextEq | undefined;
  core_runtime_union_value: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => CoreExpr | undefined;
  dynamic_union_if: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => DynamicUnionIf | undefined;
  runtime_union_match_info: (
    case_name: string,
    target: RuntimeUnionTarget,
    ctx: StaticCtx,
  ) => RuntimeUnionMatchInfo;
  runtime_union_target: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => RuntimeUnionTarget | undefined;
  runtime_union_value_type: (value: CoreExpr, ctx: StaticCtx) => ValType;
  static_collection_fields: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => CoreField[] | undefined;
  static_core_call_requires_scope: (
    target: Extract<CoreExpr, { tag: "lam" }>,
  ) => boolean;
  static_core_call_target: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => Extract<CoreExpr, { tag: "lam" }> | undefined;
  static_core_call_value: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => CoreExpr | undefined;
  static_runtime_union_match_branch_ctx: (
    value_name: string | undefined,
    info: RuntimeUnionMatchInfo,
    ctx: StaticCtx,
  ) => StaticCtx;
  static_struct_value: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => Extract<CoreExpr, { tag: "struct_value" }> | undefined;
  static_text_byte_index_expr: (
    expr: Extract<CoreExpr, { tag: "index" }>,
    ctx: StaticCtx,
  ) => CoreExpr | undefined;
  static_text_value: (expr: CoreExpr, ctx: StaticCtx) => CoreExpr | undefined;
  static_type_value: (expr: CoreExpr, ctx: StaticCtx) => CoreExpr | undefined;
  static_union_case: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => Extract<CoreExpr, { tag: "union_case" }> | undefined;
};

export type CoreBackendExprType = {
  core_typed_prim: (
    expr: Extract<CoreExpr, { tag: "prim" }>,
    ctx: StaticCtx,
  ) => PrimNode;
  expr_type: (expr: CoreExpr, ctx: StaticCtx) => ValType;
  stmt_result_type: (stmt: CoreStmt, ctx: StaticCtx) => ValType;
};
