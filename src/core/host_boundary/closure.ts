import type { CoreExpr } from "../ast.ts";
import type { CoreHostImportCtx } from "../host_import.ts";
import type { StaticCoreCallCtx } from "../static_call.ts";
import { scan_host_boundary_with_shadowed_aliases } from "./alias.ts";
import type { CoreHostBoundaryHooks, CoreHostBoundaryState } from "./types.ts";

type HostBoundaryExprScanner<
  ctx extends CoreHostImportCtx & StaticCoreCallCtx,
> = (
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  state: CoreHostBoundaryState,
) => void;

export function scan_host_boundary_closure<
  ctx extends CoreHostImportCtx & StaticCoreCallCtx,
>(
  expr: Extract<CoreExpr, { tag: "lam" | "rec" }>,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  state: CoreHostBoundaryState,
  scan_expr: HostBoundaryExprScanner<ctx>,
): void {
  if (host_boundary_closure_has_const_params(expr)) {
    return;
  }

  const closure = hooks.closure_body_ctx(expr, ctx);

  if (closure.tag !== "scan") {
    return;
  }

  scan_host_boundary_with_shadowed_aliases(
    expr.params,
    state,
    () => scan_expr(expr.body, closure.ctx, hooks, state),
  );
}

function host_boundary_closure_has_const_params(
  expr: Extract<CoreExpr, { tag: "lam" | "rec" }>,
): boolean {
  for (const param of expr.params) {
    if (param.is_const) {
      return true;
    }
  }

  return false;
}
