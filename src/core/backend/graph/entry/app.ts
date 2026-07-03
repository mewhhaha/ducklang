import type { CoreExpr, CoreField, CoreFnType } from "../../../ast.ts";
import type { CoreEmitCtx as EmitCtx } from "../../../emit_ctx.ts";
import type { StaticCtx } from "../../../local_collect.ts";
import { create_core_backend_app } from "../../entry/app.ts";
import type { CoreBackendApp } from "../../entry/app.ts";
import type { CoreBackendIndex } from "../../entry/index.ts";
import type { CoreBackendGraphDeps } from "../../graph_deps.ts";

export function create_core_backend_graph_app(
  deps: CoreBackendGraphDeps,
  index: CoreBackendIndex,
): CoreBackendApp {
  return create_core_backend_app({
    check_closure_call_args: deps.closure().check_closure_call_args,
    closure_fn_type: deps.closure().closure_fn_type,
    core_expr_is_text: (expr, ctx) => deps.text().core_expr_is_text(expr, ctx),
    emit_core_rec_call: (
      expr: Extract<CoreExpr, { tag: "app" }>,
      target: Extract<CoreExpr, { tag: "rec" }>,
      ctx: EmitCtx,
    ) => deps.rec().emit_core_rec_call(expr, target, ctx),
    emit_dynamic_closure_call: (
      expr: Extract<CoreExpr, { tag: "app" }>,
      fn_type: CoreFnType,
      ctx: EmitCtx,
    ) => deps.closure().emit_dynamic_closure_call(expr, fn_type, ctx),
    emit_dynamic_index_expr: (
      fields: CoreField[],
      index_expr: CoreExpr,
      ctx: EmitCtx,
    ) => index.emit_dynamic_index_expr(fields, index_expr, ctx),
    emit_expr: (expr, ctx) => deps.expr_emit().emit_expr(expr, ctx),
    emit_runtime_text_byte_index: (
      collection: CoreExpr,
      index_expr: CoreExpr,
      ctx: EmitCtx,
    ) =>
      deps.text().emit_runtime_text_byte_index(
        collection,
        index_expr,
        ctx,
      ),
    emit_runtime_text_append: (left, right, ctx) =>
      deps.text().emit_runtime_text_append(left, right, ctx),
    emit_runtime_text_len: (collection, ctx) =>
      deps.text().emit_runtime_text_len(collection, ctx),
    emit_runtime_text_slice: (
      text: CoreExpr,
      start: CoreExpr,
      end: CoreExpr,
      ctx: EmitCtx,
    ) => deps.text().emit_runtime_text_slice(text, start, end, ctx),
    emit_scoped_static_core_call:
      deps.static_call().emit_scoped_static_core_call,
    expr_type: (expr, ctx) => deps.expr_type().expr_type(expr, ctx),
    rec_call_type: deps.rec().rec_call_type,
    scoped_static_core_call_type:
      deps.static_call().scoped_static_core_call_type,
    static_collection_fields: deps.struct().static_collection_fields,
    static_core_call_requires_scope:
      deps.static_call().static_core_call_requires_scope,
    static_core_call_target: deps.static_call().static_core_call_target,
    static_core_call_value: deps.static_call().static_core_call_value,
    static_core_rec_target: deps.static_call().static_core_rec_target,
    static_text_length_expr: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.text().static_text_length_expr(expr, ctx),
    static_text_value: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.text().static_text_value(expr, ctx),
    text_byte_index_expr: (text: CoreExpr, index_expr: CoreExpr) =>
      deps.text().text_byte_index_expr(text, index_expr),
  });
}
