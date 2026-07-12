import type { CoreExpr } from "../ast.ts";
import { record_core_expr_provenance } from "../subject_provenance.ts";
import type { RuntimeUnionCtx, RuntimeUnionHooks } from "./types.ts";

export function core_runtime_union_value<ctx extends RuntimeUnionCtx>(
  value: CoreExpr,
  ctx: ctx,
  hooks: RuntimeUnionHooks<ctx>,
): CoreExpr | undefined {
  const union_case = hooks.static_union_case(value, ctx);

  if (union_case) {
    return union_case;
  }

  const union_if = hooks.dynamic_union_if(value, ctx);

  if (union_if) {
    return record_core_expr_provenance({
      tag: "if",
      cond: union_if.cond,
      then_branch: union_if.then_case,
      else_branch: union_if.else_case,
    }, value);
  }

  return undefined;
}
