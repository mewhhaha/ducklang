import type { CoreExpr, CoreField } from "../ast.ts";
import { core_expr_ownership } from "../ownership.ts";
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

type AllocationFieldsScanner<ctx> = (
  fields: CoreField[],
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
) => void;

export function scan_static_value_allocation_expr<ctx>(
  expr: CoreExpr,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
  record_runtime_union_owner: boolean,
  scan_expr: AllocationExprScanner<ctx>,
  scan_fields: AllocationFieldsScanner<ctx>,
): void {
  const struct_value = hooks.static_struct_value(expr, ctx);

  if (struct_value) {
    scan_fields(struct_value.fields, scope, ctx, hooks, state);
    return;
  }

  const union_value = hooks.runtime_union_value(expr, ctx);

  if (union_value) {
    if (record_runtime_union_owner) {
      record_static_runtime_union_owner_allocations(
        union_value,
        scope,
        ctx,
        hooks,
        state,
        scan_expr,
      );
      return;
    }

    scan_static_value_union_allocations(
      union_value,
      scope,
      ctx,
      hooks,
      state,
      scan_expr,
    );
  }
}

export function static_value_materializes_runtime_union_owner<ctx>(
  expr: CoreExpr,
  has_annotation: boolean,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
): boolean {
  const ownership = core_expr_ownership(expr, ctx, hooks);

  if (ownership.tag !== "unique_heap") {
    return false;
  }

  if (ownership.reason !== "runtime_union") {
    return false;
  }

  if (has_annotation) {
    return true;
  }

  if (expr.tag === "union_case") {
    if (expr.type_expr) {
      return true;
    }

    return false;
  }

  return true;
}

function record_static_runtime_union_owner_allocations<ctx>(
  value: CoreExpr,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
  scan_expr: AllocationExprScanner<ctx>,
): void {
  if (value.tag === "if") {
    record_static_runtime_union_owner_allocations(
      value.then_branch,
      scope,
      ctx,
      hooks,
      state,
      scan_expr,
    );
    record_static_runtime_union_owner_allocations(
      value.else_branch,
      scope,
      ctx,
      hooks,
      state,
      scan_expr,
    );
    return;
  }

  if (value.tag !== "union_case") {
    record_allocation(value, "runtime_union", scope, state);
    return;
  }

  if (value.type_expr) {
    scan_expr(value.type_expr, scope, ctx, hooks, state);
  }

  if (value.value) {
    scan_expr(value.value, scope, ctx, hooks, state);
  }

  record_allocation(value, "runtime_union", scope, state);
}

function scan_static_value_union_allocations<ctx>(
  expr: CoreExpr,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
  scan_expr: AllocationExprScanner<ctx>,
): void {
  if (expr.tag === "if") {
    scan_static_value_union_allocations(
      expr.then_branch,
      scope,
      ctx,
      hooks,
      state,
      scan_expr,
    );
    scan_static_value_union_allocations(
      expr.else_branch,
      scope,
      ctx,
      hooks,
      state,
      scan_expr,
    );
    return;
  }

  if (expr.tag !== "union_case") {
    return;
  }

  if (expr.value) {
    scan_expr(expr.value, scope, ctx, hooks, state);
  }
}
