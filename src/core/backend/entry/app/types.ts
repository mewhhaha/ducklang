import type { ValType } from "../../../../op.ts";
import type { Wat } from "../../../../wat.ts";
import type { CoreExpr, CoreField, CoreFnType } from "../../../ast.ts";
import type { CoreEmitCtx } from "../../../emit_ctx.ts";
import type { StaticCtx } from "../../../local_collect.ts";

export type CoreBackendAppApi = {
  check_closure_call_args: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    fn_type: CoreFnType,
    ctx: StaticCtx,
  ) => void;
  closure_fn_type: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => CoreFnType | undefined;
  core_expr_is_text: (expr: CoreExpr, ctx: StaticCtx) => boolean;
  emit_core_rec_call: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    target: Extract<CoreExpr, { tag: "rec" }>,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_dynamic_closure_call: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    fn_type: CoreFnType,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_dynamic_index_expr: (
    fields: CoreField[],
    index: CoreExpr,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_expr: (expr: CoreExpr, ctx: CoreEmitCtx) => Wat;
  emit_runtime_text_byte_index: (
    collection: CoreExpr,
    index: CoreExpr,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_runtime_text_append: (
    left: CoreExpr,
    right: CoreExpr,
    subject: CoreExpr,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_runtime_text_len: (collection: CoreExpr, ctx: CoreEmitCtx) => Wat;
  emit_runtime_text_slice: (
    subject: CoreExpr,
    text: CoreExpr,
    start: CoreExpr,
    end: CoreExpr,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_scoped_static_core_call: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    target: Extract<CoreExpr, { tag: "lam" }>,
    ctx: CoreEmitCtx,
  ) => Wat;
  expr_type: (expr: CoreExpr, ctx: StaticCtx) => ValType;
  rec_call_type: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    target: Extract<CoreExpr, { tag: "rec" }>,
    ctx: StaticCtx,
  ) => ValType;
  scoped_static_core_call_type: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    target: Extract<CoreExpr, { tag: "lam" }>,
    ctx: StaticCtx,
  ) => ValType;
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
  static_core_rec_target: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => Extract<CoreExpr, { tag: "rec" }> | undefined;
  static_text_length_expr: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => CoreExpr | undefined;
  static_text_value: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => CoreExpr | undefined;
  text_byte_index_expr: (text: CoreExpr, index: CoreExpr) => CoreExpr;
};

export type CoreBackendApp = {
  app_type: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    ctx: StaticCtx,
  ) => ValType;
  emit_core_app: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    ctx: CoreEmitCtx,
  ) => Wat;
};
