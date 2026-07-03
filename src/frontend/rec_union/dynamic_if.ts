import { expect } from "../../expect.ts";
import type { Ic as IcNode } from "../../ic.ts";
import type { Env, FrontExpr, TypeField } from "../ast.ts";
import type { StaticRecHooks } from "../rec_hooks.ts";
import {
  lower_rec_dynamic_union_if_branch,
  lower_rec_lambda_binding,
  type RecResultLowerer,
} from "../rec_union_handlers.ts";

export function lower_rec_dynamic_union_if(
  expr: Extract<FrontExpr, { tag: "if" }>,
  cases: TypeField[],
  env: Env,
  hooks: StaticRecHooks,
  lower_result: RecResultLowerer,
): IcNode | undefined {
  const then_branch = hooks.resolve_union_value(expr.then_branch, env);
  const else_branch = hooks.resolve_union_value(expr.else_branch, env);

  if (!then_branch || !else_branch) {
    return undefined;
  }

  const local = hooks.clone_env(env);
  const handler_names: string[] = [];

  for (const field of cases) {
    handler_names.push(hooks.fresh(local, "case_" + field.name));
  }

  let body: IcNode = {
    tag: "prim",
    prim: "i32.select",
    args: [
      lower_rec_dynamic_union_if_branch(
        then_branch,
        cases,
        handler_names,
        lower_result,
      ),
      lower_rec_dynamic_union_if_branch(
        else_branch,
        cases,
        handler_names,
        lower_result,
      ),
      lower_result(expr.cond, env),
    ],
  };

  for (let index = handler_names.length - 1; index >= 0; index -= 1) {
    const name = handler_names[index];
    expect(name, "Missing union handler " + index);
    body = lower_rec_lambda_binding(name, body);
  }

  return body;
}
