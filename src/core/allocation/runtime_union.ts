import type { CoreExpr } from "../ast.ts";
import { record_allocation } from "./record.ts";
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

export function record_runtime_union_allocations<ctx>(
  value: CoreExpr,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
  scan_expr: AllocationExprScanner<ctx>,
): void {
  if (value.tag === "if") {
    record_runtime_union_allocations(
      value.then_branch,
      scope,
      ctx,
      hooks,
      state,
      scan_expr,
    );
    record_runtime_union_allocations(
      value.else_branch,
      scope,
      ctx,
      hooks,
      state,
      scan_expr,
    );
    return;
  }

  record_allocation(value, "runtime_union", scope, state);

  if (value.tag !== "union_case") {
    return;
  }

  if (value.type_expr) {
    scan_expr(value.type_expr, scope, ctx, hooks, state);
  }

  if (value.value) {
    scan_expr(value.value, scope, ctx, hooks, state);
  }
}
