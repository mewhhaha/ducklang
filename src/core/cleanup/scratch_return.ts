import type { CoreExpr } from "../ast.ts";
import {
  core_expr_ownership,
  core_ownership_result_text,
  type CoreOwnership,
  type CoreOwnershipHooks,
} from "../ownership.ts";
import { runtime_aggregate_freeze_copy_supported } from "../runtime_aggregate.ts";
import { runtime_union_freeze_copy_supported } from "../runtime_union_emit.ts";
import { is_scratch_free_static_value_expr } from "../static_values.ts";
import type { TypeStaticCtx } from "../type_static.ts";
import { static_block_result } from "../type_static.ts";

export function core_scratch_return_ownership<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): CoreOwnership {
  let scratch_ctx = ctx;
  if (hooks.scratch_return_ctx) {
    scratch_ctx = hooks.scratch_return_ctx(ctx);
  }
  return core_scratch_return_ownership_in_ctx(expr, scratch_ctx, hooks);
}

function core_scratch_return_ownership_in_ctx<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): CoreOwnership {
  const block_value = static_block_result(expr);

  if (block_value) {
    return core_scratch_return_ownership_in_ctx(block_value, ctx, hooks);
  }

  const block_result = scratch_block_result_with_ctx(expr, ctx, hooks);

  if (block_result) {
    return core_scratch_return_ownership_in_ctx(
      block_result.expr,
      block_result.ctx,
      hooks,
    );
  }

  if (expr.tag === "freeze") {
    const source = core_expr_ownership(expr.value, ctx, hooks);

    if (source.tag === "unique_heap") {
      if (source.reason === "text") {
        return { tag: "frozen_shareable", reason: "freeze" };
      }

      if (source.reason === "closure") {
        return { tag: "frozen_shareable", reason: "freeze" };
      }

      if (
        source.reason === "runtime_aggregate" &&
        (
          scratch_freeze_can_emit_runtime_aggregate(expr.value, ctx, hooks) ||
          scratch_freeze_can_copy_runtime_aggregate(expr.value, ctx, hooks)
        )
      ) {
        return { tag: "frozen_shareable", reason: "freeze" };
      }

      if (
        source.reason === "runtime_union" &&
        (
          scratch_freeze_can_emit_runtime_union(expr.value, ctx, hooks) ||
          scratch_freeze_can_copy_runtime_union(expr.value, ctx, hooks)
        )
      ) {
        return { tag: "frozen_shareable", reason: "freeze" };
      }

      if (
        source.reason === "runtime_aggregate" ||
        source.reason === "runtime_union"
      ) {
        return { tag: "scratch_backed", source };
      }
    }

    if (
      source.tag !== "scalar_local" &&
      source.tag !== "frozen_shareable" &&
      !scratch_return_static_aggregate_is_free(expr.value, ctx, hooks) &&
      !scratch_return_static_union_is_free(expr.value, ctx, hooks)
    ) {
      return { tag: "scratch_backed", source };
    }
  }

  if (scratch_return_static_aggregate_is_free(expr, ctx, hooks)) {
    return { tag: "frozen_shareable", reason: "runtime_aggregate" };
  }

  if (scratch_return_static_union_is_free(expr, ctx, hooks)) {
    return { tag: "frozen_shareable", reason: "runtime_union" };
  }

  return core_expr_ownership(expr, ctx, hooks);
}

function scratch_freeze_can_emit_runtime_aggregate<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): boolean {
  return expr.tag === "struct_value" && !!hooks.static_struct_value(expr, ctx);
}

function scratch_freeze_can_copy_runtime_aggregate<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): boolean {
  if (!hooks.runtime_aggregate_type_expr) {
    return false;
  }

  const type_expr = hooks.runtime_aggregate_type_expr(expr, ctx);

  if (!type_expr) {
    return false;
  }

  return runtime_aggregate_freeze_copy_supported(
    type_expr,
    ctx as ctx & TypeStaticCtx,
    {
      runtime_union_freeze_copy_supported,
    },
  );
}

function scratch_freeze_can_emit_runtime_union<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): boolean {
  const value = hooks.runtime_union_value(expr, ctx);

  if (!value) {
    return false;
  }

  return expr.tag !== "var" && value.tag === "union_case";
}

function scratch_freeze_can_copy_runtime_union<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): boolean {
  const type_expr = scratch_runtime_union_type_expr(expr, ctx, hooks);

  if (!type_expr) {
    return false;
  }

  return runtime_union_freeze_copy_supported(
    type_expr,
    ctx as ctx & TypeStaticCtx,
  );
}

function scratch_runtime_union_type_expr<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): CoreExpr | undefined {
  const value = hooks.runtime_union_value(expr, ctx);

  if (value) {
    if (value.tag === "union_case") {
      return value.type_expr;
    }

    if (value.tag === "if") {
      return scratch_runtime_union_type_expr(value.then_branch, ctx, hooks);
    }
  }

  if (hooks.runtime_union_target) {
    const target = hooks.runtime_union_target(expr, ctx);

    if (target) {
      return target.type_expr;
    }
  }

  return undefined;
}

function scratch_block_result_with_ctx<ctx>(
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
      throw new Error("Missing scratch block statement");
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

function scratch_return_static_aggregate_is_free<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): boolean {
  const struct_value = hooks.static_struct_value(expr, ctx);
  return !!struct_value &&
    scratch_return_static_value_is_free(expr, ctx, hooks);
}

export function core_scratch_return_rejection_detail<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): string | undefined {
  let scratch_ctx = ctx;
  if (hooks.scratch_return_ctx) {
    scratch_ctx = hooks.scratch_return_ctx(ctx);
  }
  return core_scratch_return_rejection_detail_in_ctx(expr, scratch_ctx, hooks);
}

function core_scratch_return_rejection_detail_in_ctx<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): string | undefined {
  const block_value = static_block_result(expr);

  if (block_value) {
    return core_scratch_return_rejection_detail_in_ctx(
      block_value,
      ctx,
      hooks,
    );
  }

  const block_result = scratch_block_result_with_ctx(expr, ctx, hooks);

  if (block_result) {
    return core_scratch_return_rejection_detail_in_ctx(
      block_result.expr,
      block_result.ctx,
      hooks,
    );
  }

  if (scratch_return_static_value_is_free(expr, ctx, hooks)) {
    return undefined;
  }

  const aggregate_detail = scratch_return_static_aggregate_rejection_detail(
    expr,
    ctx,
    hooks,
  );

  if (aggregate_detail) {
    return aggregate_detail;
  }

  const union_detail = scratch_return_static_union_rejection_detail(
    expr,
    ctx,
    hooks,
  );

  if (union_detail) {
    return union_detail;
  }

  return undefined;
}

function scratch_return_static_aggregate_rejection_detail<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): string | undefined {
  const struct_value = hooks.static_struct_value(expr, ctx);

  if (!struct_value) {
    return undefined;
  }

  for (const field of struct_value.fields) {
    const detail = scratch_return_static_field_rejection_detail(
      field.value,
      ctx,
      hooks,
    );

    if (detail) {
      return "field " + field.name + " " + detail;
    }
  }

  return undefined;
}

function scratch_return_static_value_is_free<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): boolean {
  return is_scratch_free_static_value_expr(expr, ctx, {
    block_ctx: hooks.block_ctx,
    closure_fn_type: hooks.closure_fn_type,
    collect_stmt_locals: hooks.collect_stmt_locals,
    core_expr_is_text: hooks.core_expr_is_text,
    dynamic_union_if: (value, value_ctx) => {
      if (!hooks.dynamic_union_if) {
        return undefined;
      }

      return hooks.dynamic_union_if(value, value_ctx);
    },
    expr_type: hooks.expr_type,
    frozen_local: hooks.frozen_local,
    runtime_aggregate_type_expr: (value, value_ctx) => {
      if (!hooks.runtime_aggregate_type_expr) {
        return undefined;
      }

      return hooks.runtime_aggregate_type_expr(value, value_ctx);
    },
    runtime_union_type_expr: (value, value_ctx) =>
      scratch_runtime_union_type_expr(value, value_ctx, hooks),
    static_capture_value: hooks.static_capture_value,
    static_core_call_value: (value, value_ctx) => {
      if (!hooks.static_core_call_value) {
        return undefined;
      }

      return hooks.static_core_call_value(value, value_ctx);
    },
    static_struct_value: hooks.static_struct_value,
    static_text_value: hooks.static_text_value,
    static_union_case: (value, value_ctx) => {
      if (!hooks.static_union_case) {
        return undefined;
      }

      return hooks.static_union_case(value, value_ctx);
    },
  });
}

function scratch_return_static_field_rejection_detail<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): string | undefined {
  const aggregate_detail = scratch_return_static_aggregate_rejection_detail(
    expr,
    ctx,
    hooks,
  );

  if (aggregate_detail) {
    return aggregate_detail;
  }

  const union_detail = scratch_return_static_union_rejection_detail(
    expr,
    ctx,
    hooks,
  );

  if (union_detail) {
    return union_detail;
  }

  if (hooks.static_text_value(expr, ctx)) {
    return undefined;
  }

  const ownership = core_expr_ownership(expr, ctx, hooks);

  if (
    ownership.tag === "scalar_local" ||
    ownership.tag === "frozen_shareable"
  ) {
    return undefined;
  }

  return "may reference " + core_ownership_result_text(ownership);
}

function scratch_return_static_union_is_free<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): boolean {
  const value = hooks.runtime_union_value(expr, ctx);

  if (!value) {
    return false;
  }

  return scratch_return_static_value_is_free(value, ctx, hooks);
}

function scratch_return_static_union_rejection_detail<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): string | undefined {
  const value = hooks.runtime_union_value(expr, ctx);

  if (!value) {
    return undefined;
  }

  return scratch_return_static_union_value_rejection_detail(value, ctx, hooks);
}

function scratch_return_static_union_value_rejection_detail<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): string | undefined {
  if (expr.tag === "union_case") {
    if (!expr.value) {
      return undefined;
    }

    const detail = scratch_return_static_field_rejection_detail(
      expr.value,
      ctx,
      hooks,
    );

    if (detail) {
      return "payload ." + expr.name + " " + detail;
    }

    return undefined;
  }

  if (expr.tag === "if") {
    const cond_detail = scratch_return_static_field_rejection_detail(
      expr.cond,
      ctx,
      hooks,
    );

    if (cond_detail) {
      return "condition " + cond_detail;
    }

    const then_detail = scratch_return_static_union_value_rejection_detail(
      expr.then_branch,
      ctx,
      hooks,
    );

    if (then_detail) {
      return "then " + then_detail;
    }

    const else_detail = scratch_return_static_union_value_rejection_detail(
      expr.else_branch,
      ctx,
      hooks,
    );

    if (else_detail) {
      return "else " + else_detail;
    }
  }

  return undefined;
}
