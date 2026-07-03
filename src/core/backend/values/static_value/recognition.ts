import type { CoreExpr } from "../../../ast.ts";
import type { StaticCtx } from "../../../local_collect.ts";
import {
  is_static_value_expr as is_static_value_expr_with_hooks,
  type StaticValueRecognitionHooks,
} from "../../../static_values.ts";
import type { CoreBackendStaticValue } from "./types.ts";

export type CoreBackendStaticValueRecognition = Pick<
  CoreBackendStaticValue,
  "is_static_value_expr"
>;

export function create_core_backend_static_value_recognition(
  hooks: StaticValueRecognitionHooks<StaticCtx>,
): CoreBackendStaticValueRecognition {
  function is_static_value_expr(
    expr: CoreExpr,
    ctx: StaticCtx,
  ): boolean {
    return is_static_value_expr_with_hooks(
      expr,
      ctx,
      hooks,
    );
  }

  return {
    is_static_value_expr,
  };
}
