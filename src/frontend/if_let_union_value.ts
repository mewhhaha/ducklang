import { expect } from "../expect.ts";
import type { Ic as IcNode } from "../ic.ts";
import type { Env, FrontExpr, TypeField } from "./ast.ts";
import { clone_env, fresh } from "./env.ts";
import { lookup_type_field } from "./fields.ts";
import { lower_lambda_binding } from "./ic_share.ts";
import type { IfLetHooks } from "./if_let_types.ts";

export function lower_union_expr_with_cases(
  expr: FrontExpr,
  env: Env,
  cases: TypeField[],
  hooks: IfLetHooks,
): IcNode {
  const value = hooks.resolve_union_value(expr, env);

  if (value) {
    return lower_union_case_with_cases(value.expr, value.env, cases, hooks);
  }

  return hooks.lower_expr(expr, env);
}

export function apply_union_result_handlers(
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

function lower_union_case_with_cases(
  expr: Extract<FrontExpr, { tag: "union_case" }>,
  env: Env,
  cases: TypeField[],
  hooks: IfLetHooks,
): IcNode {
  const declared = lookup_type_field(cases, expr.name);

  if (!declared) {
    throw new Error("Missing union case: " + expr.name);
  }

  let payload: IcNode = { tag: "num", type: "i32", value: 0 };

  if (declared.type_name !== "Unit") {
    const value = expr.value;
    expect(value, "Missing union case payload: " + expr.name);
    payload = hooks.lower_expr(value, env);
  }

  const local = clone_env(env);
  const handler_names: string[] = [];

  for (const field of cases) {
    handler_names.push(fresh(local, "case_" + field.name));
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
    body = lower_lambda_binding(name, body);
  }

  return body;
}
