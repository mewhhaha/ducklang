import type { Core as CoreNode, CoreExpr, CoreStmt } from "../../ast.ts";
import {
  collect_core_ctx as collect_core_ctx_with_hooks,
  collect_expr_locals as collect_expr_locals_with_hooks,
  collect_stmt_locals as collect_stmt_locals_with_hooks,
  type CoreCtx,
} from "../../local_collect.ts";
import { create_core_backend_local_collect_hooks } from "./local_collect/hooks.ts";
import type {
  CoreBackendLocalCollect,
  CoreBackendLocalCollectApi,
} from "./local_collect/types.ts";

export function create_core_backend_local_collect(
  api: CoreBackendLocalCollectApi,
): CoreBackendLocalCollect {
  const core_local_collect_hooks = create_core_backend_local_collect_hooks(api);

  function collect_core_ctx(core: CoreNode): CoreCtx {
    return collect_core_ctx_with_hooks(core, core_local_collect_hooks);
  }

  function collect_stmt_locals(stmt: CoreStmt, ctx: CoreCtx): void {
    collect_stmt_locals_with_hooks(stmt, ctx, core_local_collect_hooks);
  }

  function collect_expr_locals(expr: CoreExpr, ctx: CoreCtx): void {
    collect_expr_locals_with_hooks(expr, ctx, core_local_collect_hooks);
  }

  return {
    collect_core_ctx,
    collect_expr_locals,
    collect_stmt_locals,
  };
}
