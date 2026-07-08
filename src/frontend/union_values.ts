import { expect } from "../expect.ts";
import type { Ic as IcNode } from "../ic.ts";
import type { Env, FrontExpr } from "./ast.ts";
import { clone_env, fresh } from "./env.ts";
import { lookup_type_field } from "./fields.ts";
import { lower_lambda_binding } from "./ic_share.ts";
import { infer_untyped_union_case } from "./union_payload.ts";
import { resolve_union_type_value } from "./union_resolve.ts";

export {
  check_union_case_value,
  infer_untyped_union_case,
  validate_union_payload_type,
} from "./union_payload.ts";
export {
  resolve_union_constructor_call,
  resolve_union_type_value,
  resolve_union_value,
} from "./union_resolve.ts";
export type { UnionValueHooks, UnionValueTarget } from "./union_value_types.ts";
import type { UnionValueHooks } from "./union_value_types.ts";

export function lower_union_case_value(
  expr: Extract<FrontExpr, { tag: "union_case" }>,
  env: Env,
  hooks: UnionValueHooks,
): IcNode {
  let type_expr = expr.type_expr;

  if (!type_expr) {
    const field = infer_untyped_union_case(expr, env, hooks);

    type_expr = { tag: "union_type", cases: [field] };
  }

  const union_type = resolve_union_type_value(type_expr, env, hooks);
  expect(union_type, "Missing union type for case: " + expr.name);
  const declared = lookup_type_field(union_type.cases, expr.name);

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

  for (const field of union_type.cases) {
    handler_names.push(fresh(local, "case_" + field.name));
  }

  let selected_index = -1;

  for (let index = 0; index < union_type.cases.length; index += 1) {
    const field = union_type.cases[index];
    expect(field, "Missing union case field " + index);

    if (field.name === expr.name) {
      selected_index = index;
    }
  }

  if (selected_index < 0) {
    throw new Error("Missing union case: " + expr.name);
  }

  const selected_handler = handler_names[selected_index];
  expect(selected_handler, "Missing selected union handler");
  let body: IcNode = {
    tag: "app",
    func: { tag: "var", name: selected_handler },
    arg: payload,
  };

  for (let index = handler_names.length - 1; index >= 0; index -= 1) {
    const name = handler_names[index];
    expect(name, "Missing union handler " + index);
    body = lower_lambda_binding(name, body);
  }

  return body;
}
