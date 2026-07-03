import { expect } from "../expect.ts";
import type { Ic as IcNode } from "../ic.ts";
import type { Env, FrontExpr, TypeField } from "./ast.ts";
import type { StaticRecHooks } from "./rec_hooks.ts";
import { lookup_rec_type_field } from "./rec_util.ts";

export type RecResultLowerer = (expr: FrontExpr, env: Env) => IcNode;

export function apply_rec_bound_union_result_app(
  result: IcNode,
  args: FrontExpr[],
  arg_env: Env,
  lower_result: RecResultLowerer,
): IcNode {
  let applied = result;

  for (const arg of args) {
    applied = {
      tag: "app",
      func: applied,
      arg: lower_result(arg, arg_env),
    };
  }

  return applied;
}

export function lower_rec_union_expr_with_cases(
  expr: FrontExpr,
  env: Env,
  cases: TypeField[],
  hooks: StaticRecHooks,
  lower_result: RecResultLowerer,
): IcNode {
  const value = hooks.resolve_union_value(expr, env);

  if (value) {
    return lower_rec_union_case_with_cases(
      value.expr,
      value.env,
      cases,
      hooks,
      lower_result,
    );
  }

  return lower_result(expr, env);
}

export function lower_rec_union_case_with_cases(
  expr: Extract<FrontExpr, { tag: "union_case" }>,
  env: Env,
  cases: TypeField[],
  hooks: StaticRecHooks,
  lower_result: RecResultLowerer,
): IcNode {
  const declared = lookup_rec_type_field(cases, expr.name);

  if (!declared) {
    throw new Error("Missing union case: " + expr.name);
  }

  let payload: IcNode = { tag: "num", type: "i32", value: 0 };

  if (declared.type_name !== "Unit") {
    const value = expr.value;
    expect(value, "Missing union case payload: " + expr.name);
    payload = lower_result(value, env);
  }

  const local = hooks.clone_env(env);
  const handler_names: string[] = [];

  for (const field of cases) {
    handler_names.push(hooks.fresh(local, "case_" + field.name));
  }

  let selected_index = -1;

  for (let index = 0; index < cases.length; index += 1) {
    const field = cases[index];
    expect(field, "Missing union result case " + index.toString());

    if (field.name === expr.name) {
      selected_index = index;
    }
  }

  if (selected_index < 0) {
    throw new Error("Missing union case: " + expr.name);
  }

  const selected_handler = handler_names[selected_index];
  expect(selected_handler, "Missing selected union result handler");
  let body: IcNode = {
    tag: "app",
    func: { tag: "var", name: selected_handler },
    arg: payload,
  };

  for (let index = handler_names.length - 1; index >= 0; index -= 1) {
    const name = handler_names[index];
    expect(name, "Missing union result handler " + index.toString());
    body = lower_rec_lambda_binding(name, body);
  }

  return body;
}

export function apply_rec_union_result_handlers(
  value: IcNode,
  handler_names: string[],
): IcNode {
  let result = value;

  for (const name of handler_names) {
    result = {
      tag: "app",
      func: result,
      arg: { tag: "var", name },
    };
  }

  return result;
}

export function lower_rec_dynamic_union_if_branch(
  branch: { expr: Extract<FrontExpr, { tag: "union_case" }>; env: Env },
  cases: TypeField[],
  handler_names: string[],
  lower_result: RecResultLowerer,
): IcNode {
  let selected_index = -1;

  for (let index = 0; index < cases.length; index += 1) {
    const field = cases[index];
    expect(field, "Missing union case field " + index);

    if (field.name === branch.expr.name) {
      selected_index = index;
    }
  }

  if (selected_index < 0) {
    throw new Error("Missing union case: " + branch.expr.name);
  }

  const handler_name = handler_names[selected_index];
  expect(handler_name, "Missing selected union handler");
  const declared = cases[selected_index];
  expect(declared, "Missing selected union case");
  let payload: IcNode = { tag: "num", type: "i32", value: 0 };

  if (declared.type_name !== "Unit") {
    const value = branch.expr.value;
    expect(value, "Missing union payload: " + branch.expr.name);
    payload = lower_result(value, branch.env);
  }

  return {
    tag: "app",
    func: { tag: "var", name: handler_name },
    arg: payload,
  };
}

export function lower_rec_lambda_binding(name: string, body: IcNode): IcNode {
  return { tag: "lam", name, body };
}
