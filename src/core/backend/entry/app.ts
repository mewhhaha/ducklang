import type { ValType } from "../../../op.ts";
import type { Wat } from "../../../wat.ts";
import type { CoreExpr } from "../../ast.ts";
import {
  type CoreAppEmitHooks,
  emit_core_app as emit_core_app_with_hooks,
} from "../../app_emit.ts";
import {
  app_type as app_type_with_hooks,
  type CoreAppTypeHooks,
} from "../../app_type.ts";
import type { CoreEmitCtx } from "../../emit_ctx.ts";
import type { StaticCtx } from "../../local_collect.ts";
import type { CoreBackendApp, CoreBackendAppApi } from "./app/types.ts";

export type { CoreBackendApp, CoreBackendAppApi } from "./app/types.ts";

export function create_core_backend_app(
  api: CoreBackendAppApi,
): CoreBackendApp {
  const app_type_hooks = {
    check_closure_call_args: api.check_closure_call_args,
    closure_fn_type: api.closure_fn_type,
    core_expr_is_text: api.core_expr_is_text,
    expr_type: api.expr_type,
    rec_call_type: api.rec_call_type,
    scoped_static_core_call_type: api.scoped_static_core_call_type,
    static_collection_fields: api.static_collection_fields,
    static_core_call_requires_scope: api.static_core_call_requires_scope,
    static_core_call_target: api.static_core_call_target,
    static_core_call_value: api.static_core_call_value,
    static_core_rec_target: api.static_core_rec_target,
    static_text_length_expr: api.static_text_length_expr,
    static_text_value: api.static_text_value,
    text_byte_index_expr: api.text_byte_index_expr,
  } satisfies CoreAppTypeHooks<StaticCtx>;

  const app_emit_hooks = {
    app_type,
    closure_fn_type: api.closure_fn_type,
    core_expr_is_text: api.core_expr_is_text,
    emit_core_rec_call: api.emit_core_rec_call,
    emit_dynamic_closure_call: api.emit_dynamic_closure_call,
    emit_dynamic_index_expr: api.emit_dynamic_index_expr,
    emit_expr: api.emit_expr,
    emit_runtime_bytes_generate: api.emit_runtime_bytes_generate,
    emit_runtime_buffer_builtin: api.emit_runtime_buffer_builtin,
    emit_runtime_text_byte_index: api.emit_runtime_text_byte_index,
    emit_runtime_text_append: api.emit_runtime_text_append,
    emit_runtime_text_len: api.emit_runtime_text_len,
    emit_runtime_text_slice: api.emit_runtime_text_slice,
    emit_scoped_static_core_call: api.emit_scoped_static_core_call,
    expr_type: api.expr_type,
    static_collection_fields: api.static_collection_fields,
    static_core_call_requires_scope: api.static_core_call_requires_scope,
    static_core_call_target: api.static_core_call_target,
    static_core_call_value: api.static_core_call_value,
    static_core_rec_target: api.static_core_rec_target,
    static_text_length_expr: api.static_text_length_expr,
    static_text_value: api.static_text_value,
    text_byte_index_expr: api.text_byte_index_expr,
  } satisfies CoreAppEmitHooks<CoreEmitCtx>;

  function app_type(
    expr: Extract<CoreExpr, { tag: "app" }>,
    ctx: StaticCtx,
  ): ValType {
    return app_type_with_hooks(expr, ctx, app_type_hooks);
  }

  function emit_core_app(
    expr: Extract<CoreExpr, { tag: "app" }>,
    ctx: CoreEmitCtx,
  ): Wat {
    return emit_core_app_with_hooks(expr, ctx, app_emit_hooks);
  }

  return {
    app_type,
    emit_core_app,
  };
}
