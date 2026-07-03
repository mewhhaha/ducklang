import type { ValType } from "../../../../op.ts";
import type { Wat } from "../../../../wat.ts";
import type { CoreExpr, CoreParam, CoreStmt } from "../../../ast.ts";
import type { CoreEmitCtx } from "../../../emit_ctx.ts";
import type { CoreCtx, StaticCtx } from "../../../local_collect.ts";

export type CoreBackendRecApi = {
  apply_core_parameter_annotation: (
    param: CoreParam,
    arg: CoreExpr,
    ctx: StaticCtx,
  ) => CoreExpr;
  collect_stmt_locals: (stmt: CoreStmt, ctx: CoreCtx) => void;
  create_rec_body_block_ctx: (ctx: StaticCtx) => CoreCtx;
  create_rec_body_ctx: (ctx: CoreEmitCtx) => CoreEmitCtx;
  create_rec_call_ctx: (ctx: StaticCtx) => StaticCtx;
  emit_expr: (expr: CoreExpr, ctx: CoreEmitCtx) => Wat;
  emit_stmt: (stmt: CoreStmt, ctx: CoreEmitCtx, is_final: boolean) => Wat;
  expr_type: (expr: CoreExpr, ctx: StaticCtx) => ValType;
};

export type CoreBackendRec = {
  bind_rec_initial_params: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    target: Extract<CoreExpr, { tag: "rec" }>,
    ctx: StaticCtx,
  ) => void;
  check_rec_tail_call_args: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    target: Extract<CoreExpr, { tag: "rec" }>,
    ctx: StaticCtx,
  ) => void;
  emit_core_rec_call: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    target: Extract<CoreExpr, { tag: "rec" }>,
    ctx: CoreEmitCtx,
  ) => Wat;
  is_core_rec_tail_call: (
    expr: CoreExpr,
  ) => expr is Extract<CoreExpr, { tag: "app" }>;
  rec_call_type: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    target: Extract<CoreExpr, { tag: "rec" }>,
    ctx: StaticCtx,
  ) => ValType;
};
