import type { Prim as PrimNode, ValType } from "../../op.ts";
import type { CoreExpr, CoreField, CoreFnType, CoreStmt } from "../ast.ts";
import type { DynamicUnionIf } from "../if_let.ts";
import type {
  RuntimeUnionMatchInfo,
  RuntimeUnionTarget,
} from "../runtime_union.ts";
import type { RuntimeTextEq } from "../text_facts.ts";

export type CoreExprTypeCtx = {
  locals: Map<string, ValType>;
  statics: Map<string, CoreExpr>;
  fn_types: Map<string, CoreFnType>;
  text_locals: Set<string>;
  struct_locals: Map<string, CoreExpr>;
  union_locals: Map<string, CoreExpr>;
  frozen_locals?: Set<string>;
};

export type CoreExprTypeBlockCtx = CoreExprTypeCtx & {
  next_loop: number;
  next_temp: number;
};

export type CoreExprTypeHooks<
  ctx extends CoreExprTypeCtx,
  block_ctx extends ctx & CoreExprTypeBlockCtx,
> = {
  app_type: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    ctx: ctx,
  ) => ValType;
  bind_core_if_let_payload_fact: (
    value_name: string | undefined,
    union_case: Extract<CoreExpr, { tag: "union_case" }>,
    ctx: ctx,
  ) => void;
  bind_dynamic_if_let_payload: (
    case_name: string,
    value_name: string | undefined,
    target: DynamicUnionIf,
    ctx: ctx,
  ) => void;
  check_core_text_concat_operand_visibility: (
    expr: Extract<CoreExpr, { tag: "prim" }>,
    ctx: ctx,
  ) => void;
  check_closure_call_args: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    fn_type: CoreFnType,
    ctx: ctx,
  ) => void;
  clear_optional_core_union_local: (
    value_name: string | undefined,
    ctx: ctx,
  ) => void;
  closure_fn_type: (expr: CoreExpr, ctx: ctx) => CoreFnType | undefined;
  collect_stmt_locals: (stmt: CoreStmt, ctx: block_ctx) => void;
  core_expr_is_text: (expr: CoreExpr, ctx: ctx) => boolean;
  core_runtime_text_concat_operands: (
    expr: CoreExpr,
    ctx: ctx,
  ) => [CoreExpr, CoreExpr] | undefined;
  core_runtime_text_eq_operands: (
    expr: CoreExpr,
    ctx: ctx,
  ) => RuntimeTextEq | undefined;
  core_runtime_union_value: (
    expr: CoreExpr,
    ctx: ctx,
  ) => CoreExpr | undefined;
  core_typed_prim: (
    expr: Extract<CoreExpr, { tag: "prim" }>,
    ctx: ctx,
  ) => PrimNode;
  create_block_ctx: (ctx: ctx) => block_ctx;
  dynamic_union_if: (
    expr: CoreExpr,
    ctx: ctx,
  ) => DynamicUnionIf | undefined;
  runtime_union_match_info: (
    case_name: string,
    target: RuntimeUnionTarget,
    ctx: ctx,
  ) => RuntimeUnionMatchInfo;
  runtime_union_target: (
    expr: CoreExpr,
    ctx: ctx,
  ) => RuntimeUnionTarget | undefined;
  runtime_union_value_type: (value: CoreExpr, ctx: ctx) => ValType;
  static_collection_fields: (
    expr: CoreExpr,
    ctx: ctx,
  ) => CoreField[] | undefined;
  static_runtime_union_match_branch_ctx: (
    value_name: string | undefined,
    info: RuntimeUnionMatchInfo,
    ctx: ctx,
  ) => ctx;
  static_text_byte_index_expr: (
    expr: Extract<CoreExpr, { tag: "index" }>,
    ctx: ctx,
  ) => CoreExpr | undefined;
  static_text_value: (expr: CoreExpr, ctx: ctx) => CoreExpr | undefined;
  static_struct_value: (
    expr: CoreExpr,
    ctx: ctx,
  ) => Extract<CoreExpr, { tag: "struct_value" }> | undefined;
  static_type_value: (
    expr: CoreExpr,
    ctx: ctx,
  ) => CoreExpr | undefined;
  static_union_case: (
    expr: CoreExpr,
    ctx: ctx,
  ) => Extract<CoreExpr, { tag: "union_case" }> | undefined;
};

export type CoreInferExprType<
  ctx extends CoreExprTypeCtx,
  block_ctx extends ctx & CoreExprTypeBlockCtx,
> = (
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreExprTypeHooks<ctx, block_ctx>,
) => ValType;
