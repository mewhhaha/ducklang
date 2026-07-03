import type { ValType } from "../../op.ts";
import type { CoreExpr, CoreFnType } from "../ast.ts";
import type { DynamicUnionIf } from "../if_let.ts";
import { static_block_result } from "../type_static.ts";

export type ScratchFreeStaticValueHooks<ctx> = {
  closure_fn_type: (expr: CoreExpr, ctx: ctx) => CoreFnType | undefined;
  core_expr_is_text: (expr: CoreExpr, ctx: ctx) => boolean;
  dynamic_union_if: (
    expr: CoreExpr,
    ctx: ctx,
  ) => DynamicUnionIf | undefined;
  expr_type: (expr: CoreExpr, ctx: ctx) => ValType;
  runtime_aggregate_type_expr: (
    expr: CoreExpr,
    ctx: ctx,
  ) => CoreExpr | undefined;
  runtime_union_type_expr: (
    expr: CoreExpr,
    ctx: ctx,
  ) => CoreExpr | undefined;
  static_core_call_value: (
    expr: CoreExpr,
    ctx: ctx,
  ) => CoreExpr | undefined;
  static_struct_value: (
    expr: CoreExpr,
    ctx: ctx,
  ) => Extract<CoreExpr, { tag: "struct_value" }> | undefined;
  static_text_value: (expr: CoreExpr, ctx: ctx) => CoreExpr | undefined;
  static_union_case: (
    expr: CoreExpr,
    ctx: ctx,
  ) => Extract<CoreExpr, { tag: "union_case" }> | undefined;
};

export function is_scratch_free_static_value_expr<ctx>(
  value: CoreExpr,
  ctx: ctx,
  hooks: ScratchFreeStaticValueHooks<ctx>,
): boolean {
  const inlined = hooks.static_core_call_value(value, ctx);

  if (inlined) {
    return is_scratch_free_static_value_expr(inlined, ctx, hooks);
  }

  if (hooks.static_text_value(value, ctx)) {
    return true;
  }

  const union_case = hooks.static_union_case(value, ctx);

  if (union_case) {
    if (!union_case.value) {
      return true;
    }

    return is_scratch_free_static_value_expr(union_case.value, ctx, hooks);
  }

  if (value.tag === "if") {
    const union_if = hooks.dynamic_union_if(value, ctx);

    if (union_if) {
      return is_scratch_free_static_value_expr(
        union_if.cond,
        ctx,
        hooks,
      ) &&
        is_scratch_free_static_value_expr(union_if.then_case, ctx, hooks) &&
        is_scratch_free_static_value_expr(union_if.else_case, ctx, hooks);
    }
  }

  const struct_value = hooks.static_struct_value(value, ctx);

  if (struct_value) {
    for (const field of struct_value.fields) {
      if (!is_scratch_free_static_value_expr(field.value, ctx, hooks)) {
        return false;
      }
    }

    return true;
  }

  const block_value = static_block_result(value);

  if (block_value) {
    return is_scratch_free_static_value_expr(block_value, ctx, hooks);
  }

  switch (value.tag) {
    case "num":
    case "text":
      return true;

    case "var":
    case "app":
    case "prim":
    case "if":
    case "field":
    case "index":
      return is_scratch_free_scalar_expr(value, ctx, hooks);

    case "borrow":
      return is_scratch_free_static_value_expr(value.value, ctx, hooks);

    case "freeze":
      return is_scratch_free_static_value_expr(value.value, ctx, hooks);

    case "scratch":
      return is_scratch_free_static_value_expr(value.body, ctx, hooks);

    case "linear":
    case "lam":
    case "rec":
    case "block":
    case "comptime":
    case "with":
    case "type_name":
    case "struct_type":
    case "struct_value":
    case "struct_update":
    case "union_type":
    case "if_let":
    case "union_case":
    case "unsupported":
      return false;
  }
}

function is_scratch_free_scalar_expr<ctx>(
  value: CoreExpr,
  ctx: ctx,
  hooks: ScratchFreeStaticValueHooks<ctx>,
): boolean {
  if (hooks.core_expr_is_text(value, ctx)) {
    return false;
  }

  if (hooks.closure_fn_type(value, ctx)) {
    return false;
  }

  if (hooks.runtime_aggregate_type_expr(value, ctx)) {
    return false;
  }

  if (hooks.runtime_union_type_expr(value, ctx)) {
    return false;
  }

  hooks.expr_type(value, ctx);
  return true;
}
