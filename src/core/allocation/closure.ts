import type { CoreExpr } from "../ast.ts";
import type {
  CoreAllocationHooks,
  CoreAllocationScope,
  CoreAllocationState,
} from "./types.ts";

type AllocationExprScanner<ctx> = (
  expr: CoreExpr,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
) => void;

export function scan_closure_body_allocations<ctx>(
  expr: Extract<CoreExpr, { tag: "lam" | "rec" }>,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
  scan_expr: AllocationExprScanner<ctx>,
): void {
  if (!hooks.closure_body_ctx) {
    return;
  }

  const body_ctx = hooks.closure_body_ctx(expr, ctx);

  if (!body_ctx) {
    return;
  }

  const closure_scope = "closure#" + state.next_closure.toString();
  state.next_closure += 1;
  scan_expr(
    expr.body,
    { name: closure_scope, scratch: scope.scratch },
    body_ctx,
    hooks,
    state,
  );
}
