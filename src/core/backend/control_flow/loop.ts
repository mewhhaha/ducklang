import type { Wat } from "../../../wat.ts";
import type { CoreStmt } from "../../ast.ts";
import type {
  CoreBackendControlFlow,
  CoreBackendControlFlowApi,
} from "./types.ts";
import {
  type CoreCollectionLoopHooks,
  emit_core_collection_loop,
} from "../../collection_loop.ts";
import type { CoreEmitCtx } from "../../emit_ctx.ts";
import {
  type CoreRangeLoopHooks,
  emit_core_range_loop,
} from "../../range_loop.ts";

export type CoreBackendControlFlowLoop = Pick<
  CoreBackendControlFlow,
  "emit_collection_loop" | "emit_range_loop"
>;

export function create_core_backend_control_flow_loop(
  api: CoreBackendControlFlowApi,
): CoreBackendControlFlowLoop {
  const collection_loop_hooks = {
    core_expr_is_text: api.core_expr_is_text,
    emit_expr: api.emit_expr,
    emit_stmt: api.emit_stmt,
    static_collection_fields: api.static_collection_fields,
    static_text_value: api.static_text_value,
  } satisfies CoreCollectionLoopHooks<CoreEmitCtx>;

  const range_loop_hooks = {
    emit_expr: api.emit_expr,
    emit_stmt: api.emit_stmt,
  } satisfies CoreRangeLoopHooks<CoreEmitCtx>;

  function emit_collection_loop(
    stmt: Extract<CoreStmt, { tag: "collection_loop" }>,
    ctx: CoreEmitCtx,
  ): Wat {
    return emit_core_collection_loop(stmt, ctx, collection_loop_hooks);
  }

  function emit_range_loop(
    stmt: Extract<CoreStmt, { tag: "range_loop" }>,
    ctx: CoreEmitCtx,
  ): Wat {
    return emit_core_range_loop(stmt, ctx, range_loop_hooks);
  }

  return {
    emit_collection_loop,
    emit_range_loop,
  };
}
