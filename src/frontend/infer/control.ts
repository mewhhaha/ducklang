import type { Env, FrontExpr, FrontType } from "../ast.ts";
import { clone_env, push_binding } from "../env.ts";
import { lookup_type_field } from "../fields.ts";
import { common_if_type, front_type_for_type_name } from "./common.ts";
import type { InferExprFn, InferHooks } from "./types.ts";

export function infer_if_expr_type(
  expr: Extract<FrontExpr, { tag: "if" }>,
  env: Env,
  hooks: InferHooks,
  infer_expr: InferExprFn,
): FrontType {
  const then_type = infer_expr(expr.then_branch, env, hooks);
  const else_type = infer_expr(expr.else_branch, env, hooks);
  const result_type = common_if_type(
    expr.implicit_else,
    then_type,
    else_type,
  );

  if (result_type) {
    if (result_type.tag === "union") {
      const union_cases = hooks.infer_dynamic_union_if_cases(expr, env);

      if (union_cases) {
        return { tag: "union_value", cases: union_cases };
      }
    }

    return result_type;
  }

  const union_cases = hooks.infer_dynamic_union_if_cases(expr, env);

  if (union_cases) {
    return { tag: "union_value", cases: union_cases };
  }

  return { tag: "unknown" };
}

export function infer_if_let_expr_type(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  env: Env,
  hooks: InferHooks,
  infer_expr: InferExprFn,
): FrontType {
  const target_type = infer_expr(expr.target, env, hooks);
  const then_env = infer_if_let_then_env(expr, target_type, env, hooks);
  const then_type = infer_expr(expr.then_branch, then_env, hooks);
  const else_type = infer_expr(expr.else_branch, env, hooks);
  const result_type = common_if_type(
    expr.implicit_else,
    then_type,
    else_type,
  );

  if (result_type) {
    return result_type;
  }

  const union_cases = hooks.infer_union_cases(expr, env);

  if (union_cases) {
    return { tag: "union_value", cases: union_cases };
  }

  return { tag: "unknown" };
}

function infer_if_let_then_env(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  target_type: FrontType,
  env: Env,
  hooks: InferHooks,
): Env {
  if (target_type.tag !== "union_value") {
    return env;
  }

  if (!expr.value_name) {
    return env;
  }

  const matched = lookup_type_field(target_type.cases, expr.case_name);

  if (!matched) {
    return env;
  }

  if (matched.type_name === "Unit") {
    return env;
  }

  const branch_env = clone_env(env);
  push_binding(branch_env, {
    name: expr.value_name,
    ic_name: expr.value_name,
    type: front_type_for_type_name(matched.type_name, branch_env, hooks),
    is_const: false,
    is_linear: false,
    value: undefined,
    value_env: undefined,
  });
  return branch_env;
}
