import type { ValType } from "../../../op.ts";
import type { Wat } from "../../../wat.ts";
import type { CoreExpr } from "../../ast.ts";
import type { CoreEmitCtx } from "../../emit_ctx.ts";
import type { CoreCtx, StaticCtx } from "../../local_collect.ts";
import {
  type CoreRecEmitHooks,
  emit_core_rec_call as emit_core_rec_call_with_hooks,
} from "../../rec_emit.ts";
import {
  bind_rec_initial_params as bind_rec_initial_params_with_hooks,
  check_rec_tail_call_args as check_rec_tail_call_args_with_hooks,
  type CoreRecTypeHooks,
  is_core_rec_tail_call,
  rec_call_type as rec_call_type_with_hooks,
} from "../../rec_type.ts";
import type { CoreBackendRec, CoreBackendRecApi } from "./rec/types.ts";

export type { CoreBackendRec, CoreBackendRecApi };

export function create_core_backend_rec(
  api: CoreBackendRecApi,
): CoreBackendRec {
  const rec_type_hooks = {
    apply_core_parameter_annotation: api.apply_core_parameter_annotation,
    collect_stmt_locals: api.collect_stmt_locals,
    create_rec_body_block_ctx: api.create_rec_body_block_ctx,
    create_rec_call_ctx: api.create_rec_call_ctx,
    expr_type: api.expr_type,
  } satisfies CoreRecTypeHooks<StaticCtx, CoreCtx>;

  const rec_emit_hooks = {
    apply_core_parameter_annotation: api.apply_core_parameter_annotation,
    check_rec_tail_call_args,
    create_rec_body_ctx: api.create_rec_body_ctx,
    emit_expr: api.emit_expr,
    emit_stmt: api.emit_stmt,
    is_core_rec_tail_call,
    rec_call_type,
  } satisfies CoreRecEmitHooks<CoreEmitCtx>;

  function rec_call_type(
    expr: Extract<CoreExpr, { tag: "app" }>,
    target: Extract<CoreExpr, { tag: "rec" }>,
    ctx: StaticCtx,
  ): ValType {
    return rec_call_type_with_hooks(expr, target, ctx, rec_type_hooks);
  }

  function bind_rec_initial_params(
    expr: Extract<CoreExpr, { tag: "app" }>,
    target: Extract<CoreExpr, { tag: "rec" }>,
    ctx: StaticCtx,
  ): void {
    bind_rec_initial_params_with_hooks(expr, target, ctx, rec_type_hooks);
  }

  function check_rec_tail_call_args(
    expr: Extract<CoreExpr, { tag: "app" }>,
    target: Extract<CoreExpr, { tag: "rec" }>,
    ctx: StaticCtx,
  ): void {
    check_rec_tail_call_args_with_hooks(expr, target, ctx, rec_type_hooks);
  }

  function emit_core_rec_call(
    expr: Extract<CoreExpr, { tag: "app" }>,
    target: Extract<CoreExpr, { tag: "rec" }>,
    ctx: CoreEmitCtx,
  ): Wat {
    return emit_core_rec_call_with_hooks(expr, target, ctx, rec_emit_hooks);
  }

  return {
    bind_rec_initial_params,
    check_rec_tail_call_args,
    emit_core_rec_call,
    is_core_rec_tail_call,
    rec_call_type,
  };
}
