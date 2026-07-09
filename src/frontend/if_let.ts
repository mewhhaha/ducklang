import type { Ic as IcNode } from "../ic.ts";
import type { Env, FrontExpr } from "./ast.ts";
import { clone_env, fresh, push_binding } from "./env.ts";
import { lookup_type_field } from "./fields.ts";
import {
  front_type_for_type_name,
  lower_if_let_else_branch,
} from "./if_let_common.ts";
import { lower_dynamic_if_let } from "./if_let_dynamic.ts";
import type { IfLetHooks } from "./if_let_types.ts";
import { lower_lambda_binding } from "./ic_share.ts";

export {
  type DynamicUnionIfTarget,
  resolve_dynamic_union_if_target,
} from "./if_let_target.ts";
export type { IfLetHooks } from "./if_let_types.ts";

export function lower_if_let(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  env: Env,
  hooks: IfLetHooks,
): IcNode {
  const target = hooks.resolve_union_value(expr.target, env);

  if (!target) {
    return lower_dynamic_if_let(expr, env, hooks);
  }

  if (target.expr.name !== expr.case_name) {
    const target_type = hooks.infer_expr(expr.target, env);

    if (target_type.tag === "union_value") {
      const matched = lookup_type_field(target_type.cases, expr.case_name);

      if (matched) {
        return lower_if_let_else_branch(expr, target_type.cases, env, hooks);
      }
    }

    return hooks.lower_expr(expr.else_branch, env);
  }

  if (!expr.value_name) {
    return hooks.lower_expr(expr.then_branch, env);
  }

  const value = target.expr.value;

  if (!value) {
    throw new Error("Union case has no payload: " + expr.case_name);
  }

  const branch_env = clone_env(env);
  const ic_name = fresh(branch_env, expr.value_name);
  const target_type = hooks.infer_expr(expr.target, env);
  let value_type = hooks.infer_expr(value, target.env);

  if (target_type.tag === "union_value") {
    const matched = lookup_type_field(target_type.cases, expr.case_name);

    if (matched && matched.type_name !== "Unit") {
      value_type = front_type_for_type_name(
        matched.type_name,
        branch_env,
        hooks,
      );
    }
  }

  push_binding(branch_env, {
    name: expr.value_name,
    ic_name,
    type: value_type,
    is_const: false,
    is_linear: false,
    value: undefined,
    value_env: undefined,
  });

  return {
    tag: "app",
    func: lower_lambda_binding(
      ic_name,
      hooks.lower_expr(expr.then_branch, branch_env),
    ),
    arg: hooks.lower_expr(value, target.env),
  };
}
