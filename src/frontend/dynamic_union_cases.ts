import type { Env, FrontExpr, TypeField } from "./ast.ts";
import { merge_type_fields } from "./fields.ts";

export type DynamicUnionCaseHooks = {
  infer_union_cases: (
    expr: FrontExpr,
    env: Env,
  ) => TypeField[] | undefined;
};

export function infer_dynamic_union_if_cases(
  expr: Extract<FrontExpr, { tag: "if" }>,
  env: Env,
  hooks: DynamicUnionCaseHooks,
): TypeField[] | undefined {
  const then_cases = hooks.infer_union_cases(expr.then_branch, env);
  const else_cases = hooks.infer_union_cases(expr.else_branch, env);

  if (!then_cases || !else_cases) {
    return undefined;
  }

  return merge_type_fields(then_cases, else_cases);
}
