import type { Wat } from "../../../wat.ts";
import type { CoreExpr } from "../../ast.ts";
import type { CoreEmitCtx } from "../../emit_ctx.ts";
import { emit_core_expr } from "../../expr_emit.ts";
import { create_core_backend_expr_emit_hooks } from "./expr/hooks.ts";
import type {
  CoreBackendExprEmit,
  CoreBackendExprEmitApi,
} from "./expr/types.ts";

export type {
  CoreBackendExprEmit,
  CoreBackendExprEmitApi,
} from "./expr/types.ts";

export function create_core_backend_expr_emit(
  api: CoreBackendExprEmitApi,
): CoreBackendExprEmit {
  const core_expr_emit_hooks = create_core_backend_expr_emit_hooks(api);

  function emit_expr(expr: CoreExpr, ctx: CoreEmitCtx): Wat {
    if (expr.tag === "if") {
      const fn_type = api.closure_fn_type(expr, ctx);

      if (fn_type) {
        return api.emit_core_closure_if_expr(
          expr,
          fn_type,
          ctx,
        );
      }
    }

    if (expr.tag === "if_let") {
      const fn_type = api.closure_fn_type(expr, ctx);

      if (fn_type) {
        return api.emit_core_closure_if_let_expr(
          expr,
          fn_type,
          ctx,
        );
      }
    }

    return emit_core_expr(expr, ctx, core_expr_emit_hooks);
  }

  return {
    emit_expr,
  };
}
