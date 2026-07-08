import type { ValType } from "../../op.ts";
import type { Wat } from "../../wat.ts";
import type { CoreExpr } from "../ast.ts";
import {
  core_non_scalar_ownership_message,
  core_ownership_result_text,
  type CoreOwnership,
} from "../ownership.ts";
import { emit_runtime_text_freeze_copy } from "../runtime_text.ts";
import {
  emit_runtime_aggregate_freeze_copy,
  runtime_aggregate_freeze_copy_supported,
} from "../runtime_aggregate.ts";
import {
  emit_runtime_union_freeze_copy,
  runtime_union_freeze_copy_supported,
} from "../runtime_union_emit.ts";
import type { TypeStaticCtx } from "../type_static.ts";
import type { CoreExprEmitCtx, CoreExprEmitHooks } from "./types.ts";

export function core_scratch_rejection_message(
  prefix: string,
  ownership: CoreOwnership,
  detail: string | undefined,
): string {
  if (detail) {
    return prefix + " with unsafe scratch return " + detail + " and " +
      "non-scalar " + core_ownership_result_text(ownership) + " result yet";
  }

  return core_non_scalar_ownership_message(prefix, ownership);
}

export function frozen_core_local<ctx extends { frozen_locals?: Set<string> }>(
  name: string,
  ctx: ctx,
): boolean {
  if (!ctx.frozen_locals) {
    return false;
  }

  return ctx.frozen_locals.has(name);
}

export function emit_core_freeze_text_value<ctx extends CoreExprEmitCtx>(
  value: CoreExpr,
  ctx: ctx,
  emit_expr: (expr: CoreExpr, ctx: ctx) => Wat,
): Wat {
  if (ctx.scratch_return_resets.length > 0) {
    return emit_runtime_text_freeze_copy(value, ctx, {
      emit_expr,
    });
  }

  return emit_expr(value, ctx);
}

export function emit_core_freeze_can_materialize_runtime_aggregate<
  ctx extends CoreExprEmitCtx,
>(
  value: CoreExpr,
  ctx: ctx,
  hooks: Pick<CoreExprEmitHooks<ctx>, "static_struct_value">,
): boolean {
  if (hooks.static_struct_value(value, ctx)) {
    return value.tag === "struct_value";
  }

  return false;
}

export function emit_core_freeze_can_copy_runtime_aggregate<
  ctx extends CoreExprEmitCtx,
>(
  value: CoreExpr,
  ctx: ctx,
  hooks: Pick<
    CoreExprEmitHooks<ctx>,
    "runtime_aggregate_type_expr" | "static_struct_value"
  >,
): boolean {
  if (ctx.scratch_return_resets.length === 0) {
    return false;
  }

  if (emit_core_freeze_can_materialize_runtime_aggregate(value, ctx, hooks)) {
    return false;
  }

  const type_expr = hooks.runtime_aggregate_type_expr(value, ctx);

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

export function emit_runtime_aggregate_nested_union_freeze_copy<
  ctx extends CoreExprEmitCtx & TypeStaticCtx,
>(
  source: CoreExpr,
  type_expr: CoreExpr,
  ctx: ctx,
  hooks: {
    core_expr_is_text: (expr: CoreExpr, ctx: ctx) => boolean;
    emit_expr: (expr: CoreExpr, ctx: ctx) => Wat;
    expr_type: (expr: CoreExpr, ctx: ctx) => ValType;
    runtime_aggregate_type_expr: (
      expr: CoreExpr,
      ctx: ctx,
    ) => CoreExpr | undefined;
    runtime_union_type_expr: (
      expr: CoreExpr,
      ctx: ctx,
    ) => CoreExpr | undefined;
    same_runtime_aggregate_type_expr: (
      left: CoreExpr | undefined,
      right: CoreExpr | undefined,
      ctx: ctx,
    ) => boolean;
    same_runtime_union_type_expr: (
      left: CoreExpr,
      right: CoreExpr,
      ctx: ctx,
    ) => boolean;
    static_struct_value: (
      expr: CoreExpr,
      ctx: ctx,
    ) => Extract<CoreExpr, { tag: "struct_value" }> | undefined;
  },
): Wat {
  return emit_runtime_union_freeze_copy(source, type_expr, ctx, {
    core_expr_is_text: hooks.core_expr_is_text,
    emit_expr: hooks.emit_expr,
    expr_type: hooks.expr_type,
    runtime_aggregate_type_expr: hooks.runtime_aggregate_type_expr,
    runtime_union_type_expr: hooks.runtime_union_type_expr,
    same_runtime_aggregate_type_expr: hooks.same_runtime_aggregate_type_expr,
    same_runtime_union_type_expr: hooks.same_runtime_union_type_expr,
    static_struct_value: hooks.static_struct_value,
  });
}

export function emit_core_freeze_can_materialize_runtime_union<
  ctx extends CoreExprEmitCtx,
>(
  value: CoreExpr,
  ctx: ctx,
  hooks: Pick<CoreExprEmitHooks<ctx>, "runtime_union_value">,
): boolean {
  const union_value = hooks.runtime_union_value(value, ctx);

  if (!union_value) {
    return false;
  }

  return value.tag !== "var" && union_value.tag === "union_case";
}

export function emit_core_freeze_can_copy_runtime_union<
  ctx extends CoreExprEmitCtx,
>(
  value: CoreExpr,
  ctx: ctx,
  hooks: Pick<
    CoreExprEmitHooks<ctx>,
    "runtime_union_type_expr" | "runtime_union_value"
  >,
): boolean {
  if (ctx.scratch_return_resets.length === 0) {
    return false;
  }

  if (emit_core_freeze_can_materialize_runtime_union(value, ctx, hooks)) {
    return false;
  }

  const type_expr = hooks.runtime_union_type_expr(value, ctx);

  if (!type_expr) {
    return false;
  }

  return runtime_union_freeze_copy_supported(
    type_expr,
    ctx as ctx & TypeStaticCtx,
  );
}

export function emit_core_freeze_persistent_value<
  ctx extends CoreExprEmitCtx,
>(
  value: CoreExpr,
  ctx: ctx,
  emit_expr: (expr: CoreExpr, ctx: ctx) => Wat,
): Wat {
  if (ctx.scratch_return_resets.length === 0) {
    return emit_expr(value, ctx);
  }

  const scratch_return_resets = ctx.scratch_return_resets;
  ctx.scratch_return_resets = [];

  try {
    return emit_expr(value, ctx);
  } finally {
    ctx.scratch_return_resets = scratch_return_resets;
  }
}
