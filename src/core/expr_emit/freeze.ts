import { expect } from "../../expect.ts";
import type { ValType } from "../../op.ts";
import type { Wat } from "../../wat.ts";
import type { CoreExpr } from "../ast.ts";
import {
  core_expr_ownership,
  core_non_scalar_ownership_message,
  type CoreOwnershipHooks,
} from "../ownership.ts";
import {
  emit_runtime_aggregate_freeze_copy,
  runtime_aggregate_type_expr,
} from "../runtime_aggregate.ts";
import { emit_runtime_union_freeze_copy } from "../runtime_union_emit.ts";
import {
  core_freeze_lifetime_decision,
  core_lifetime_rejection_message,
} from "../lifetime.ts";
import {
  emit_core_freeze_can_copy_runtime_aggregate,
  emit_core_freeze_can_copy_runtime_union,
  emit_core_freeze_can_materialize_runtime_aggregate,
  emit_core_freeze_can_materialize_runtime_union,
  emit_core_freeze_persistent_value,
  emit_core_freeze_text_value,
  emit_runtime_aggregate_nested_union_freeze_copy,
  frozen_core_local,
} from "./lifetime.ts";
import type { CoreExprEmitCtx, CoreExprEmitHooks } from "./types.ts";

export function emit_core_freeze_expr<ctx extends CoreExprEmitCtx>(
  expr: Extract<CoreExpr, { tag: "freeze" }>,
  ctx: ctx,
  hooks: CoreExprEmitHooks<ctx>,
  emit_expr: (value: CoreExpr, value_ctx: ctx) => Wat,
): Wat {
  const result_type = hooks.expr_type(expr.value, ctx);
  const ownership = core_expr_ownership(
    expr.value,
    ctx,
    freeze_ownership_hooks(expr.value, result_type, hooks),
  );
  const decision = core_freeze_lifetime_decision(ownership);
  expect(
    decision.tag === "allowed",
    core_lifetime_rejection_message(
      core_non_scalar_ownership_message(
        "Cannot emit core freeze value",
        ownership,
      ),
      decision,
    ),
  );

  if (ownership.tag === "unique_heap" && ownership.reason === "text") {
    return emit_core_freeze_text_value(expr.value, ctx, emit_expr);
  }

  if (
    ownership.tag === "unique_heap" &&
    ownership.reason === "runtime_aggregate" &&
    emit_core_freeze_can_materialize_runtime_aggregate(
      expr.value,
      ctx,
      hooks,
    )
  ) {
    return emit_core_freeze_persistent_value(expr.value, ctx, emit_expr);
  }

  if (
    ownership.tag === "unique_heap" &&
    ownership.reason === "runtime_aggregate" &&
    emit_core_freeze_can_copy_runtime_aggregate(expr.value, ctx, hooks)
  ) {
    const type_expr = hooks.runtime_aggregate_type_expr(expr.value, ctx);
    expect(type_expr, "Missing runtime aggregate freeze-copy type");
    return emit_runtime_aggregate_freeze_copy(expr.value, type_expr, ctx, {
      core_expr_is_text: hooks.core_expr_is_text,
      emit_expr,
      expr_type: hooks.expr_type,
      runtime_aggregate_type_expr: hooks.runtime_aggregate_type_expr,
      runtime_union_type_expr: hooks.runtime_union_type_expr,
      same_runtime_aggregate_type_expr: hooks.same_runtime_aggregate_type_expr,
      same_runtime_union_type_expr: hooks.same_runtime_union_type_expr,
      emit_runtime_union_freeze_copy:
        emit_runtime_aggregate_nested_union_freeze_copy,
      static_struct_value: hooks.static_struct_value,
    });
  }

  if (
    ownership.tag === "unique_heap" &&
    ownership.reason === "runtime_union" &&
    emit_core_freeze_can_materialize_runtime_union(expr.value, ctx, hooks)
  ) {
    return emit_core_freeze_persistent_value(expr.value, ctx, emit_expr);
  }

  if (
    ownership.tag === "unique_heap" &&
    ownership.reason === "runtime_union" &&
    emit_core_freeze_can_copy_runtime_union(expr.value, ctx, hooks)
  ) {
    const type_expr = hooks.runtime_union_type_expr(expr.value, ctx);
    expect(type_expr, "Missing runtime union freeze-copy type");
    return emit_runtime_union_freeze_copy(expr.value, type_expr, ctx, {
      core_expr_is_text: hooks.core_expr_is_text,
      emit_expr,
      expr_type: hooks.expr_type,
      runtime_aggregate_type_expr: hooks.runtime_aggregate_type_expr,
      runtime_union_type_expr: hooks.runtime_union_type_expr,
      same_runtime_aggregate_type_expr: hooks.same_runtime_aggregate_type_expr,
      same_runtime_union_type_expr: hooks.same_runtime_union_type_expr,
      static_struct_value: hooks.static_struct_value,
    });
  }

  return emit_expr(expr.value, ctx);
}

function freeze_ownership_hooks<ctx extends CoreExprEmitCtx>(
  target: CoreExpr,
  result_type: ValType,
  hooks: CoreExprEmitHooks<ctx>,
): CoreOwnershipHooks<ctx> {
  return {
    closure_fn_type: hooks.closure_fn_type,
    core_expr_is_text: hooks.core_expr_is_text,
    bind_core_if_let_payload_fact: hooks.bind_core_if_let_payload_fact,
    bind_dynamic_if_let_payload: hooks.bind_dynamic_if_let_payload,
    block_ctx: hooks.if_let_branch_ctx,
    collect_stmt_locals: hooks.collect_stmt_locals,
    dynamic_union_if: hooks.dynamic_union_if,
    expr_type: (value, value_ctx) => {
      if (value === target) {
        return result_type;
      }

      return hooks.expr_type(value, value_ctx);
    },
    frozen_local: frozen_core_local,
    if_let_branch_ctx: hooks.if_let_branch_ctx,
    runtime_union_match_info: hooks.runtime_union_match_info,
    runtime_union_target: hooks.runtime_union_target,
    runtime_union_value: hooks.runtime_union_value,
    runtime_aggregate_type_expr: (value, value_ctx) =>
      runtime_aggregate_type_expr(value, value_ctx, {
        check_closure_call_args: hooks.check_closure_call_args,
        closure_fn_type: hooks.closure_fn_type,
      }),
    static_runtime_union_match_branch_ctx:
      hooks.static_runtime_union_match_branch_ctx,
    static_struct_value: hooks.static_struct_value,
    static_union_case: hooks.static_union_case,
    static_text_value: hooks.static_text_value,
  };
}
