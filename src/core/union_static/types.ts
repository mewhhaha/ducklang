import type { ValType } from "../../op.ts";
import type { CoreExpr, CoreFnType, CoreStmt } from "../ast.ts";

export type CoreUnionCtx = {
  locals: Map<string, ValType>;
  statics: Map<string, CoreExpr>;
  fn_types: Map<string, CoreFnType>;
  text_locals: Set<string>;
  struct_locals: Map<string, CoreExpr>;
  union_locals: Map<string, CoreExpr>;
};

export type CoreUnionHooks<ctx extends CoreUnionCtx> = {
  block_ctx?: (ctx: ctx) => ctx;
  check_core_value_type_name: (
    label: string,
    expected_name: string,
    value: CoreExpr,
    ctx: ctx,
  ) => void;
  collect_stmt_locals?: (stmt: CoreStmt, ctx: ctx) => void;
  expr_type: (expr: CoreExpr, ctx: ctx) => ValType;
  core_expr_is_text: (expr: CoreExpr, ctx: ctx) => boolean;
  scoped_static_core_call_value: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    target: Extract<CoreExpr, { tag: "lam" }>,
    ctx: ctx,
  ) => { value: CoreExpr; ctx: ctx };
  static_core_call_requires_scope: (
    target: Extract<CoreExpr, { tag: "lam" }>,
  ) => boolean;
  static_core_call_value: (expr: CoreExpr, ctx: ctx) => CoreExpr | undefined;
  static_core_call_target: (
    expr: CoreExpr,
    ctx: ctx,
  ) => Extract<CoreExpr, { tag: "lam" }> | undefined;
  static_struct_value: (
    expr: CoreExpr,
    ctx: ctx,
  ) => Extract<CoreExpr, { tag: "struct_value" }> | undefined;
  static_type_value: (expr: CoreExpr, ctx: ctx) => CoreExpr | undefined;
};
