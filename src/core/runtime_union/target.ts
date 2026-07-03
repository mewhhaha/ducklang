import { expect } from "../../expect.ts";
import type { CoreExpr } from "../ast.ts";
import { static_type_value } from "../type_static.ts";
import { runtime_union_type_expr } from "./type_expr.ts";
import type {
  RuntimeUnionCtx,
  RuntimeUnionHooks,
  RuntimeUnionTarget,
} from "./types.ts";
import { core_runtime_union_value } from "./value.ts";

export function runtime_union_target<ctx extends RuntimeUnionCtx>(
  value: CoreExpr,
  ctx: ctx,
  hooks: RuntimeUnionHooks<ctx>,
): RuntimeUnionTarget | undefined {
  const direct_value = core_runtime_union_value(value, ctx, hooks);

  if (direct_value) {
    return undefined;
  }

  const type_expr = runtime_union_type_expr(value, ctx, hooks);

  if (!type_expr) {
    return undefined;
  }

  const type_value = static_type_value(type_expr, ctx);
  expect(
    type_value && type_value.tag === "union_type",
    "Core runtime union pointer requires a union type",
  );

  return {
    target: value,
    type_expr,
    type_value,
  };
}
