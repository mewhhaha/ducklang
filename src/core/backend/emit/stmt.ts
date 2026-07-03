import type { Wat } from "../../../wat.ts";
import type { CoreStmt } from "../../ast.ts";
import type { CoreEmitCtx } from "../../emit_ctx.ts";
import { emit_core_stmt } from "../../stmt_emit.ts";
import { create_core_backend_stmt_emit_hooks } from "./stmt/hooks.ts";
import type {
  CoreBackendStmtEmit,
  CoreBackendStmtEmitApi,
} from "./stmt/types.ts";

export type {
  CoreBackendStmtEmit,
  CoreBackendStmtEmitApi,
} from "./stmt/types.ts";

export function create_core_backend_stmt_emit(
  api: CoreBackendStmtEmitApi,
): CoreBackendStmtEmit {
  const core_stmt_emit_hooks = create_core_backend_stmt_emit_hooks(api);

  function emit_stmt(
    stmt: CoreStmt,
    ctx: CoreEmitCtx,
    is_final: boolean,
  ): Wat {
    return emit_core_stmt(stmt, ctx, is_final, core_stmt_emit_hooks);
  }

  return {
    emit_stmt,
  };
}
