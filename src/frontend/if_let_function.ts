import { expect } from "../expect.ts";
import type { Ic as IcNode } from "../ic.ts";
import type { Env, FrontExpr } from "./ast.ts";
import { capture_expr } from "./capture.ts";
import { clone_env } from "./env.ts";
import {
  bind_function_if_params,
  function_if_param_types,
  resolve_direct_lambda,
} from "./function_if.ts";
import { lower_lambda_binding } from "./ic_share.ts";
import type { IfLetHooks } from "./if_let_types.ts";

export function lower_dynamic_union_if_let_function(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  target: { expr: Extract<FrontExpr, { tag: "if" }>; env: Env },
  env: Env,
  hooks: IfLetHooks,
): IcNode | undefined {
  const then_lam = resolve_direct_lambda(expr.then_branch, env);
  const else_lam = resolve_direct_lambda(expr.else_branch, env);

  if (!then_lam || !else_lam) {
    return undefined;
  }

  const param_types = function_if_param_types(
    then_lam.expr.params,
    then_lam.env,
    else_lam.expr.params,
    else_lam.env,
    hooks,
  );

  if (!param_types) {
    return undefined;
  }

  const then_env = clone_env(then_lam.env);
  const else_env = clone_env(else_lam.env);
  const names = bind_function_if_params(
    then_lam.expr.params,
    then_env,
    else_lam.expr.params,
    else_env,
    param_types,
  );

  if (!names) {
    return undefined;
  }

  let body = hooks.lower_expr(
    {
      tag: "if_let",
      case_name: expr.case_name,
      value_name: expr.value_name,
      target: capture_expr(target.expr, target.env),
      then_branch: then_lam.expr.body,
      else_branch: capture_expr(else_lam.expr.body, else_env),
      implicit_else: expr.implicit_else,
    },
    then_env,
  );

  for (let index = names.length - 1; index >= 0; index -= 1) {
    const name = names[index];
    expect(name, "Missing if-let function parameter " + index.toString());
    body = lower_lambda_binding(name, body);
  }

  return body;
}
