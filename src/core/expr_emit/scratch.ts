import { expect } from "../../expect.ts";
import type { ValType } from "../../op.ts";
import type { Wat } from "../../wat.ts";
import type { CoreExpr } from "../ast.ts";
import { core_scratch_return_rejection_detail } from "../cleanup.ts";
import {
  core_lifetime_rejection_message,
  core_scratch_return_lifetime_decision,
} from "../lifetime.ts";
import { core_expr_ownership, type CoreOwnershipHooks } from "../ownership.ts";
import {
  core_scratch_plan,
  emit_core_scratch_expr as emit_core_scratch_wat,
} from "../scratch.ts";
import { runtime_aggregate_type_expr } from "../runtime_aggregate.ts";
import {
  core_scratch_rejection_message,
  frozen_core_local,
} from "./lifetime.ts";
import type { CoreExprEmitCtx, CoreExprEmitHooks } from "./types.ts";

export function emit_core_scratch_block_expr<ctx extends CoreExprEmitCtx>(
  expr: Extract<CoreExpr, { tag: "scratch" }>,
  ctx: ctx,
  hooks: CoreExprEmitHooks<ctx>,
  emit_expr: (value: CoreExpr, value_ctx: ctx) => Wat,
): Wat {
  const result_type = hooks.expr_type(expr.body, ctx);
  const ownership_hooks = scratch_ownership_hooks(
    expr.body,
    result_type,
    hooks,
  );
  const ownership = core_expr_ownership(expr.body, ctx, ownership_hooks);
  const decision = core_scratch_return_lifetime_decision(ownership);
  const detail = core_scratch_return_rejection_detail(
    expr.body,
    ctx,
    ownership_hooks,
  );
  expect(
    decision.tag === "allowed",
    core_lifetime_rejection_message(
      core_scratch_rejection_message(
        "Cannot emit core scratch block",
        ownership,
        detail,
      ),
      decision,
    ),
  );
  const plan = core_scratch_plan(ctx);
  ctx.scratch_return_resets.push(plan.base);
  ctx.scratch_loop_resets.push(plan.base);
  const body = emit_expr(expr.body, ctx);
  const loop_reset = ctx.scratch_loop_resets.pop();
  const return_reset = ctx.scratch_return_resets.pop();
  expect(
    loop_reset === plan.base,
    "Core scratch loop cleanup stack mismatch",
  );
  expect(
    return_reset === plan.base,
    "Core scratch return cleanup stack mismatch",
  );
  return emit_core_scratch_wat(body, plan, result_type, ctx);
}

function scratch_ownership_hooks<ctx extends CoreExprEmitCtx>(
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
    static_core_call_requires_scope: hooks.static_core_call_requires_scope,
    static_core_call_target: hooks.static_core_call_target,
    static_core_call_value: hooks.static_core_call_value,
    static_union_case: hooks.static_union_case,
    static_text_value: hooks.static_text_value,
  };
}
