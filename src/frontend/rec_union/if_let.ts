import type { Ic as IcNode } from "../../ic.ts";
import type { Env, FrontExpr, TypeField } from "../ast.ts";
import type { StaticRecHooks } from "../rec_hooks.ts";
import {
  lookup_rec_type_field,
  rec_front_type_for_type_name,
} from "../rec_util.ts";
import {
  lower_rec_lambda_binding,
  type RecResultLowerer,
} from "../rec_union_handlers.ts";

export function lower_rec_if_let(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  env: Env,
  hooks: StaticRecHooks,
  lower_result: RecResultLowerer,
): IcNode | undefined {
  const target = hooks.resolve_union_value(expr.target, env);

  if (target) {
    if (target.expr.name !== expr.case_name) {
      return lower_result(expr.else_branch, env);
    }

    if (!expr.value_name) {
      return lower_result(expr.then_branch, env);
    }

    const value = target.expr.value;

    if (!value) {
      throw new Error("Union case has no payload: " + expr.case_name);
    }

    const branch_env = hooks.clone_env(env);
    hooks.push_binding(branch_env, {
      name: expr.value_name,
      ic_name: hooks.fresh(branch_env, expr.value_name),
      type: hooks.infer_expr(value, target.env),
      is_const: false,
      is_linear: false,
      value,
      value_env: target.env,
    });

    return lower_result(expr.then_branch, branch_env);
  }

  const target_type = hooks.infer_expr(expr.target, env);

  if (target_type.tag !== "union_value") {
    return undefined;
  }

  const matched = lookup_rec_type_field(target_type.cases, expr.case_name);

  if (!matched) {
    throw new Error("Missing union case: " + expr.case_name);
  }

  const then_env = hooks.clone_env(env);

  if (expr.value_name) {
    if (matched.type_name === "Unit") {
      throw new Error("Union case has no payload: " + expr.case_name);
    }

    hooks.push_binding(then_env, {
      name: expr.value_name,
      ic_name: hooks.fresh(then_env, expr.value_name),
      type: rec_front_type_for_type_name(matched.type_name, env, hooks),
      is_const: false,
      is_linear: false,
      value: undefined,
      value_env: undefined,
    });
  }

  const then_type = hooks.infer_expr(expr.then_branch, then_env);
  const else_type = hooks.infer_expr(expr.else_branch, env);

  if (!hooks.same_type(then_type, else_type)) {
    throw new Error("If let branches must have the same type");
  }

  let result = lower_result(expr.target, env);

  for (const union_case of target_type.cases) {
    const handler = lower_rec_if_let_handler(
      expr,
      union_case,
      env,
      hooks,
      lower_result,
    );
    result = { tag: "app", func: result, arg: handler };
  }

  return result;
}

function lower_rec_if_let_handler(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  union_case: TypeField,
  env: Env,
  hooks: StaticRecHooks,
  lower_result: RecResultLowerer,
): IcNode {
  const handler_env = hooks.clone_env(env);
  const payload_name = hooks.fresh(handler_env, "payload_" + union_case.name);
  let body: IcNode;

  if (union_case.name === expr.case_name) {
    if (expr.value_name && union_case.type_name === "Unit") {
      throw new Error("Union case has no payload: " + expr.case_name);
    }

    if (expr.value_name) {
      hooks.push_binding(handler_env, {
        name: expr.value_name,
        ic_name: payload_name,
        type: rec_front_type_for_type_name(
          union_case.type_name,
          env,
          hooks,
        ),
        is_const: false,
        is_linear: false,
        value: undefined,
        value_env: undefined,
      });
    }

    body = lower_result(expr.then_branch, handler_env);
  } else {
    body = lower_result(expr.else_branch, handler_env);
  }

  return lower_rec_lambda_binding(payload_name, body);
}
