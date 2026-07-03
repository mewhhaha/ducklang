import type { CoreExpr, CoreParam } from "../../../ast.ts";
import type { CoreBackendGraphDeps } from "../../graph_deps.ts";
import type { CoreBackendRec } from "../../runtime/rec/types.ts";
import { create_core_backend_rec } from "../../runtime/rec.ts";
import { create_core_rec_body_emit_ctx } from "../../../emit_ctx.ts";
import {
  create_core_block_ctx,
  create_rec_call_ctx,
  type StaticCtx,
} from "../../../local_collect.ts";

export function create_core_backend_runtime_rec(
  deps: CoreBackendGraphDeps,
): CoreBackendRec {
  return create_core_backend_rec({
    apply_core_parameter_annotation: (
      param: CoreParam,
      arg: CoreExpr,
      ctx: StaticCtx,
    ) => deps.type_check().apply_core_parameter_annotation(param, arg, ctx),
    collect_stmt_locals: (stmt, ctx) =>
      deps.local_collect().collect_stmt_locals(stmt, ctx),
    create_rec_body_block_ctx: create_core_block_ctx,
    create_rec_call_ctx,
    create_rec_body_ctx: create_core_rec_body_emit_ctx,
    emit_expr: (expr, ctx) => deps.expr_emit().emit_expr(expr, ctx),
    emit_stmt: (stmt, ctx, is_final) =>
      deps.stmt_emit().emit_stmt(stmt, ctx, is_final),
    expr_type: (expr, ctx) => deps.expr_type().expr_type(expr, ctx),
  });
}
