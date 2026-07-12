import type { CoreExpr, CoreStmt } from "../ast.ts";
import { static_core_call_binding_target } from "../static_call.ts";
import type { CoreAllocationHooks } from "./types.ts";

export function allocation_stmt_value_is_static_call_target<ctx>(
  stmt: Extract<CoreStmt, { tag: "bind" | "assign" }>,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
): boolean {
  if (
    static_core_call_binding_target(
      stmt.name,
      stmt.value,
      ctx,
      hooks,
    )
  ) {
    return true;
  }

  if (
    stmt.value.tag !== "lam" ||
    !hooks.block_ctx ||
    !hooks.collect_stmt_locals
  ) {
    return false;
  }

  const binding_ctx = hooks.block_ctx(ctx);
  try {
    hooks.collect_stmt_locals(stmt, binding_ctx);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Unbound core local: ")
    ) {
      return false;
    }
    throw error;
  }
  return static_core_call_binding_target(
    stmt.name,
    stmt.value,
    binding_ctx,
    hooks,
  );
}

export function scoped_static_allocation_call_value<ctx>(
  expr: Extract<CoreExpr, { tag: "app" }>,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
): { value: CoreExpr; ctx: ctx } | undefined {
  if (
    !hooks.static_core_call_target ||
    !hooks.scoped_static_core_call_value ||
    !hooks.static_core_call_requires_scope
  ) {
    return undefined;
  }

  const target = hooks.static_core_call_target(expr.func, ctx);

  if (!target) {
    return undefined;
  }

  if (!hooks.static_core_call_requires_scope(target)) {
    return undefined;
  }

  return hooks.scoped_static_core_call_value(expr, target, ctx);
}
