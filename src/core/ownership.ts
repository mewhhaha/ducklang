import { expect } from "../expect.ts";
import type { CoreExpr } from "./ast.ts";
import type { RuntimeUnionTarget } from "./runtime_union.ts";
import { static_block_result } from "./type_static.ts";
import { core_runtime_slice_fact } from "./runtime_slice.ts";
import {
  core_expr_result_is_freeze,
  core_if_branch_ownership,
  core_if_branches_are_freeze_results,
  core_if_let_branch_ownership,
} from "./ownership/branch.ts";
import type { CoreOwnership, CoreOwnershipHooks } from "./ownership/types.ts";
export {
  core_non_scalar_ownership_message,
  core_ownership_result_text,
} from "./ownership/text.ts";
export type {
  CoreOwnership,
  CoreOwnershipHooks,
  CoreOwnershipPointerReason,
} from "./ownership/types.ts";

export function core_expr_ownership<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): CoreOwnership {
  if (core_runtime_slice_fact(expr)) {
    return { tag: "unique_heap", reason: "runtime_aggregate" };
  }

  const block_value = static_block_result(expr);

  if (block_value) {
    return core_expr_ownership(block_value, ctx, hooks);
  }

  const block_result = core_block_result_with_ctx(expr, ctx, hooks);

  if (block_result) {
    return core_expr_ownership(block_result.expr, block_result.ctx, hooks);
  }

  if (expr.tag === "borrow") {
    const source = core_expr_ownership(expr.value, ctx, hooks);

    if (
      source.tag === "scalar_local" ||
      source.tag === "frozen_shareable"
    ) {
      return source;
    }

    return { tag: "borrow_view", source };
  }

  if (expr.tag === "freeze") {
    const source = core_expr_ownership(expr.value, ctx, hooks);

    if (source.tag === "scalar_local") {
      return source;
    }

    return { tag: "frozen_shareable", reason: "freeze" };
  }

  if (expr.tag === "scratch") {
    const source = core_expr_ownership(expr.body, ctx, hooks);

    if (
      source.tag === "scalar_local" ||
      source.tag === "frozen_shareable"
    ) {
      return source;
    }

    return { tag: "scratch_backed", source };
  }

  if (expr.tag === "app") {
    if (
      expr.func.tag === "var" &&
      hooks.static_core_call_requires_scope &&
      hooks.static_core_call_value
    ) {
      const target = direct_static_value(expr.func.name, ctx);

      if (
        target && target.tag === "lam" &&
        !hooks.static_core_call_requires_scope(target) &&
        core_expr_result_is_freeze(target.body)
      ) {
        const value = hooks.static_core_call_value(expr, ctx);
        expect(value, "Missing static freeze call value");
        return core_expr_ownership(value, ctx, hooks);
      }
    }

    const scoped = scoped_static_ownership_call_value(expr, ctx, hooks);

    if (scoped) {
      return core_expr_ownership(scoped.value, scoped.ctx, hooks);
    }
  }

  if (
    expr.tag === "if" &&
    !expr.implicit_else &&
    (
      hooks.core_expr_is_text(expr, ctx) ||
      core_if_branches_are_freeze_results(expr)
    )
  ) {
    const merged = core_if_branch_ownership(
      expr,
      ctx,
      hooks,
      core_expr_ownership,
    );

    if (merged) {
      return merged;
    }
  }

  if (
    expr.tag === "if_let" &&
    !expr.implicit_else &&
    hooks.core_expr_is_text(expr, ctx)
  ) {
    const merged = core_if_let_branch_ownership(
      expr,
      ctx,
      hooks,
      core_expr_ownership,
    );

    if (merged) {
      return merged;
    }
  }

  if (hooks.static_struct_value(expr, ctx)) {
    return { tag: "unique_heap", reason: "runtime_aggregate" };
  }

  if (hooks.host_import_result_ownership) {
    const host_import_result = hooks.host_import_result_ownership(expr, ctx);

    if (host_import_result) {
      return host_import_result;
    }
  }

  if (expr.tag === "var" && hooks.frozen_local) {
    if (hooks.frozen_local(expr.name, ctx)) {
      return { tag: "frozen_shareable", reason: "freeze" };
    }
  }

  if (hooks.runtime_aggregate_type_expr) {
    const aggregate_type = hooks.runtime_aggregate_type_expr(expr, ctx);

    if (aggregate_type) {
      if (expr.tag === "field") {
        return {
          tag: "borrow_view",
          source: { tag: "unique_heap", reason: "runtime_aggregate" },
        };
      }

      return { tag: "unique_heap", reason: "runtime_aggregate" };
    }
  }

  if (hooks.closure_fn_type(expr, ctx)) {
    return { tag: "unique_heap", reason: "closure" };
  }

  if (hooks.core_expr_is_text(expr, ctx)) {
    if (hooks.static_text_value(expr, ctx)) {
      return { tag: "frozen_shareable", reason: "text" };
    }

    return { tag: "unique_heap", reason: "text" };
  }

  const union_target = try_runtime_union_target(expr, ctx, hooks);

  if (union_target) {
    const collection = indexed_collection_source(expr);

    if (collection) {
      const source = core_expr_ownership(collection, ctx, hooks);

      if (
        source.tag === "scalar_local" ||
        source.tag === "frozen_shareable"
      ) {
        return source;
      }

      return { tag: "borrow_view", source };
    }

    return { tag: "unique_heap", reason: "runtime_union" };
  }

  if (hooks.runtime_union_value(expr, ctx)) {
    return { tag: "unique_heap", reason: "runtime_union" };
  }

  const type = hooks.expr_type(expr, ctx);

  return { tag: "scalar_local", type };
}

function direct_static_value<ctx>(
  name: string,
  ctx: ctx,
): CoreExpr | undefined {
  if (typeof ctx !== "object" || ctx === null || !("statics" in ctx)) {
    return undefined;
  }

  const statics = ctx.statics;

  if (!(statics instanceof Map)) {
    return undefined;
  }

  const value = statics.get(name);

  if (typeof value !== "object" || value === null || !("tag" in value)) {
    return undefined;
  }

  return value as CoreExpr;
}

function indexed_collection_source(expr: CoreExpr): CoreExpr | undefined {
  if (expr.tag === "index") {
    return expr.object;
  }

  if (
    expr.tag === "app" &&
    expr.func.tag === "var" &&
    expr.func.name === "get"
  ) {
    return expr.args[0];
  }

  return undefined;
}

function scoped_static_ownership_call_value<ctx>(
  expr: Extract<CoreExpr, { tag: "app" }>,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
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

function try_runtime_union_target<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): RuntimeUnionTarget | undefined {
  if (!hooks.runtime_union_target) {
    return undefined;
  }

  try {
    return hooks.runtime_union_target(expr, ctx);
  } catch {
    return undefined;
  }
}

function core_block_result_with_ctx<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): { expr: CoreExpr; ctx: ctx } | undefined {
  if (expr.tag !== "block") {
    return undefined;
  }

  if (!hooks.block_ctx || !hooks.collect_stmt_locals) {
    return undefined;
  }

  const block_ctx = hooks.block_ctx(ctx);

  for (let index = 0; index < expr.statements.length; index += 1) {
    const stmt = expr.statements[index];

    if (!stmt) {
      throw new Error("Missing ownership block statement");
    }

    const is_final = index + 1 >= expr.statements.length;

    if (!is_final) {
      hooks.collect_stmt_locals(stmt, block_ctx);
      continue;
    }

    if (stmt.tag === "expr") {
      return { expr: stmt.expr, ctx: block_ctx };
    }

    if (stmt.tag === "return") {
      return { expr: stmt.value, ctx: block_ctx };
    }

    hooks.collect_stmt_locals(stmt, block_ctx);
  }

  return undefined;
}
