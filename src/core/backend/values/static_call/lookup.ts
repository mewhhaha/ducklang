import type { CoreExpr } from "../../../ast.ts";
import type { CoreCtx, StaticCtx, TempCtx } from "../../../local_collect.ts";
import {
  static_core_call_requires_scope
    as static_core_call_requires_scope_without_hooks,
  static_core_call_target as static_core_call_target_with_hooks,
  static_core_call_value as static_core_call_value_with_hooks,
  static_core_rec_target as static_core_rec_target_without_hooks,
  type StaticCoreCallHooks,
} from "../../../static_call.ts";
import type { CoreEmitCtx } from "../../../emit_ctx.ts";
import type { CoreBackendStaticCall } from "./types.ts";

export type CoreBackendStaticCallLookup = Pick<
  CoreBackendStaticCall,
  | "static_core_call_requires_scope"
  | "static_core_call_target"
  | "static_core_call_value"
  | "static_core_rec_target"
>;

export function create_core_backend_static_call_lookup(
  hooks: StaticCoreCallHooks<StaticCtx, TempCtx, CoreCtx, CoreEmitCtx>,
): CoreBackendStaticCallLookup {
  function static_core_call_value(
    expr: CoreExpr,
    ctx: StaticCtx,
  ): CoreExpr | undefined {
    return static_core_call_value_with_hooks(
      expr,
      ctx,
      hooks,
    );
  }

  function static_core_call_target(
    expr: CoreExpr,
    ctx: StaticCtx,
  ): Extract<CoreExpr, { tag: "lam" }> | undefined {
    return static_core_call_target_with_hooks(
      expr,
      ctx,
      hooks,
    );
  }

  return {
    static_core_call_requires_scope:
      static_core_call_requires_scope_without_hooks,
    static_core_call_target,
    static_core_call_value,
    static_core_rec_target: static_core_rec_target_without_hooks,
  };
}
