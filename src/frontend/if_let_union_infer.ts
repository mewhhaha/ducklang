import type { Env, FrontExpr, TypeField } from "./ast.ts";
import { clone_env, push_binding } from "./env.ts";
import { lookup_type_field, merge_type_fields } from "./fields.ts";
import { front_type_for_type_name } from "./if_let_common.ts";
import type { IfLetHooks } from "./if_let_types.ts";

export function infer_if_let_result_union_cases(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  cases: TypeField[],
  env: Env,
  hooks: IfLetHooks,
): TypeField[] | undefined {
  const then_env = clone_env(env);

  if (expr.value_name) {
    const matched = lookup_type_field(cases, expr.case_name);

    if (!matched) {
      throw new Error("Missing union case: " + expr.case_name);
    }

    if (matched.type_name === "Unit") {
      throw new Error("Union case has no payload: " + expr.case_name);
    }

    push_binding(then_env, {
      name: expr.value_name,
      ic_name: expr.value_name,
      type: front_type_for_type_name(matched.type_name, then_env, hooks),
      is_const: false,
      is_linear: false,
      value: undefined,
      value_env: undefined,
    });
  }

  const then_cases = hooks.infer_union_cases(expr.then_branch, then_env);
  const else_cases = hooks.infer_union_cases(expr.else_branch, env);

  if (!then_cases || !else_cases) {
    return undefined;
  }

  return merge_type_fields(then_cases, else_cases);
}
