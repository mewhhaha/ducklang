import type { CoreExpr } from "../../../ast.ts";
import type { CoreEmitCtx } from "../../../emit_ctx.ts";
import type { TempCtx } from "../../../local_collect.ts";
import {
  plan_static_capture_expr as plan_static_capture_expr_with_hooks,
  plan_static_struct_value as plan_static_struct_value_with_hooks,
  plan_static_value_expr as plan_static_value_expr_with_hooks,
  type StaticValueHooks,
  type StaticValuePlan,
} from "../../../static_values.ts";
import type { CoreBackendStaticValue } from "./types.ts";

export type CoreBackendStaticValuePlan = Pick<
  CoreBackendStaticValue,
  | "plan_static_capture_expr"
  | "plan_static_struct_value"
  | "plan_static_value_expr"
>;

export function create_core_backend_static_value_plan(
  hooks: StaticValueHooks<TempCtx, CoreEmitCtx>,
): CoreBackendStaticValuePlan {
  function plan_static_value_expr(
    value: CoreExpr,
    ctx: TempCtx,
    emit_ctx: CoreEmitCtx | undefined,
  ): StaticValuePlan {
    return plan_static_value_expr_with_hooks(
      value,
      ctx,
      emit_ctx,
      hooks,
    );
  }

  function plan_static_struct_value(
    value: Extract<CoreExpr, { tag: "struct_value" }>,
    ctx: TempCtx,
    emit_ctx: CoreEmitCtx | undefined,
  ): StaticValuePlan {
    return plan_static_struct_value_with_hooks(
      value,
      ctx,
      emit_ctx,
      hooks,
    );
  }

  function plan_static_capture_expr(
    prefix: string,
    value: CoreExpr,
    ctx: TempCtx,
    emit_ctx: CoreEmitCtx | undefined,
  ): StaticValuePlan {
    return plan_static_capture_expr_with_hooks(
      prefix,
      value,
      ctx,
      emit_ctx,
      hooks,
    );
  }

  return {
    plan_static_capture_expr,
    plan_static_struct_value,
    plan_static_value_expr,
  };
}
