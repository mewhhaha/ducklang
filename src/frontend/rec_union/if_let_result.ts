import { expect } from "../../expect.ts";
import type { Ic as IcNode } from "../../ic.ts";
import type { Env, FrontExpr, TypeField } from "../ast.ts";
import type { StaticRecHooks } from "../rec_hooks.ts";
import {
  lookup_rec_type_field,
  rec_front_type_for_type_name,
} from "../rec_util.ts";
import {
  infer_rec_dynamic_union_if_cases,
  infer_rec_if_let_result_union_cases,
  type RecDynamicUnionIfTarget,
  resolve_rec_dynamic_union_if_target,
} from "../rec_union_infer.ts";
import {
  apply_rec_bound_union_result_app,
  apply_rec_union_result_handlers,
  lower_rec_lambda_binding,
  lower_rec_union_expr_with_cases,
  type RecResultLowerer,
} from "../rec_union_handlers.ts";

export function lower_rec_bound_if_let_union_result_app(
  value: FrontExpr,
  value_env: Env,
  args: FrontExpr[],
  arg_env: Env,
  hooks: StaticRecHooks,
  lower_result: RecResultLowerer,
): IcNode | undefined {
  if (value.tag !== "if_let") {
    return undefined;
  }

  const dynamic_target = resolve_rec_dynamic_union_if_target(
    value.target,
    value_env,
    hooks,
  );

  if (dynamic_target) {
    const target_cases = infer_rec_dynamic_union_if_cases(
      dynamic_target.expr,
      dynamic_target.env,
      hooks,
    );

    if (!target_cases) {
      return undefined;
    }

    const result_cases = infer_rec_if_let_result_union_cases(
      value,
      target_cases,
      value_env,
      hooks,
    );

    if (!result_cases) {
      return undefined;
    }

    if (args.length !== result_cases.length) {
      throw new Error(
        "Union result expected " + result_cases.length.toString() +
          " handlers, got " + args.length.toString(),
      );
    }

    const result = lower_rec_dynamic_union_if_let_union_value(
      value,
      dynamic_target,
      target_cases,
      result_cases,
      value_env,
      hooks,
      lower_result,
    );

    return apply_rec_bound_union_result_app(
      result,
      args,
      arg_env,
      lower_result,
    );
  }

  const target_type = hooks.infer_expr(value.target, value_env);

  if (target_type.tag !== "union_value") {
    return undefined;
  }

  const result_cases = infer_rec_if_let_result_union_cases(
    value,
    target_type.cases,
    value_env,
    hooks,
  );

  if (!result_cases) {
    return undefined;
  }

  if (args.length !== result_cases.length) {
    throw new Error(
      "Union result expected " + result_cases.length.toString() +
        " handlers, got " + args.length.toString(),
    );
  }

  const result = lower_rec_if_let_union_result_value(
    value,
    target_type.cases,
    result_cases,
    value_env,
    hooks,
    lower_result,
  );

  return apply_rec_bound_union_result_app(
    result,
    args,
    arg_env,
    lower_result,
  );
}

function lower_rec_if_let_union_result_value(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  target_cases: TypeField[],
  result_cases: TypeField[],
  env: Env,
  hooks: StaticRecHooks,
  lower_result: RecResultLowerer,
): IcNode {
  const local = hooks.clone_env(env);
  const handler_names: string[] = [];

  for (const field of result_cases) {
    handler_names.push(hooks.fresh(local, "case_" + field.name));
  }

  let body = lower_result(expr.target, env);

  for (const union_case of target_cases) {
    const handler = lower_rec_if_let_union_result_handler(
      expr,
      union_case,
      result_cases,
      handler_names,
      env,
      hooks,
      lower_result,
    );
    body = { tag: "app", func: body, arg: handler };
  }

  for (let index = handler_names.length - 1; index >= 0; index -= 1) {
    const name = handler_names[index];
    expect(name, "Missing union result handler " + index.toString());
    body = lower_rec_lambda_binding(name, body);
  }

  return body;
}

function lower_rec_if_let_union_result_handler(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  union_case: TypeField,
  result_cases: TypeField[],
  handler_names: string[],
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

    body = lower_rec_union_expr_with_cases(
      expr.then_branch,
      handler_env,
      result_cases,
      hooks,
      lower_result,
    );
  } else {
    body = lower_rec_union_expr_with_cases(
      expr.else_branch,
      handler_env,
      result_cases,
      hooks,
      lower_result,
    );
  }

  return lower_rec_lambda_binding(
    payload_name,
    apply_rec_union_result_handlers(body, handler_names),
  );
}

function lower_rec_dynamic_union_if_let_union_value(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  target: RecDynamicUnionIfTarget,
  target_cases: TypeField[],
  result_cases: TypeField[],
  env: Env,
  hooks: StaticRecHooks,
  lower_result: RecResultLowerer,
): IcNode {
  const then_target = hooks.resolve_union_value(
    target.expr.then_branch,
    target.env,
  );
  const else_target = hooks.resolve_union_value(
    target.expr.else_branch,
    target.env,
  );

  expect(then_target, "Missing then dynamic union target");
  expect(else_target, "Missing else dynamic union target");

  const local = hooks.clone_env(env);
  const handler_names: string[] = [];

  for (const field of result_cases) {
    handler_names.push(hooks.fresh(local, "case_" + field.name));
  }

  let body: IcNode = {
    tag: "prim",
    prim: "i32.select",
    args: [
      lower_rec_dynamic_union_if_let_union_branch(
        expr,
        then_target,
        target_cases,
        result_cases,
        handler_names,
        env,
        hooks,
        lower_result,
      ),
      lower_rec_dynamic_union_if_let_union_branch(
        expr,
        else_target,
        target_cases,
        result_cases,
        handler_names,
        env,
        hooks,
        lower_result,
      ),
      lower_result(target.expr.cond, target.env),
    ],
  };

  for (let index = handler_names.length - 1; index >= 0; index -= 1) {
    const name = handler_names[index];
    expect(name, "Missing union result handler " + index.toString());
    body = lower_rec_lambda_binding(name, body);
  }

  return body;
}

function lower_rec_dynamic_union_if_let_union_branch(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  target: { expr: Extract<FrontExpr, { tag: "union_case" }>; env: Env },
  target_cases: TypeField[],
  result_cases: TypeField[],
  handler_names: string[],
  env: Env,
  hooks: StaticRecHooks,
  lower_result: RecResultLowerer,
): IcNode {
  let result: IcNode;

  if (target.expr.name === expr.case_name) {
    result = lower_rec_matching_if_let_union_result(
      expr,
      target,
      target_cases,
      result_cases,
      env,
      hooks,
      lower_result,
    );
  } else {
    result = lower_rec_union_expr_with_cases(
      expr.else_branch,
      env,
      result_cases,
      hooks,
      lower_result,
    );
  }

  return apply_rec_union_result_handlers(result, handler_names);
}

function lower_rec_matching_if_let_union_result(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  target: { expr: Extract<FrontExpr, { tag: "union_case" }>; env: Env },
  target_cases: TypeField[],
  result_cases: TypeField[],
  env: Env,
  hooks: StaticRecHooks,
  lower_result: RecResultLowerer,
): IcNode {
  if (!expr.value_name) {
    return lower_rec_union_expr_with_cases(
      expr.then_branch,
      env,
      result_cases,
      hooks,
      lower_result,
    );
  }

  const matched = lookup_rec_type_field(target_cases, expr.case_name);

  if (!matched) {
    throw new Error("Missing union case: " + expr.case_name);
  }

  if (matched.type_name === "Unit") {
    throw new Error("Union case has no payload: " + expr.case_name);
  }

  const payload = target.expr.value;
  expect(payload, "Missing union payload: " + expr.case_name);
  const branch_env = hooks.clone_env(env);
  const ic_name = hooks.fresh(branch_env, expr.value_name);

  hooks.push_binding(branch_env, {
    name: expr.value_name,
    ic_name,
    type: rec_front_type_for_type_name(matched.type_name, env, hooks),
    is_const: false,
    is_linear: false,
    value: undefined,
    value_env: undefined,
  });

  return {
    tag: "app",
    func: lower_rec_lambda_binding(
      ic_name,
      lower_rec_union_expr_with_cases(
        expr.then_branch,
        branch_env,
        result_cases,
        hooks,
        lower_result,
      ),
    ),
    arg: lower_result(payload, target.env),
  };
}
