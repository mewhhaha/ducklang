import type { Env, FrontExpr, Stmt } from "../ast.ts";
import { capture_deferred_expr, capture_expr } from "../capture.ts";
import { validate_const_expr } from "../constness.ts";
import { call_message } from "../fields.ts";
import type { FrontEvalHooks } from "./types.ts";

export type FrontValueEvalApi = {
  eval_front_block: (
    stmts: Stmt[],
    env: Env,
    hooks: FrontEvalHooks,
  ) => FrontExpr;
  eval_front_value: (
    expr: FrontExpr,
    env: Env,
    hooks: FrontEvalHooks,
  ) => FrontExpr;
};

export function eval_front_value_impl(
  expr: FrontExpr,
  env: Env,
  hooks: FrontEvalHooks,
  api: FrontValueEvalApi,
): FrontExpr {
  if (expr.tag === "block") {
    return api.eval_front_block(expr.statements, env, hooks);
  }

  if (expr.tag === "comptime") {
    validate_const_expr(
      expr.expr,
      env,
      new Set(),
      "comptime expression requires compile-time values",
    );
    return api.eval_front_value(expr.expr, env, hooks);
  }

  if (expr.tag === "app") {
    if (expr.func.tag === "var" && expr.func.name === "fail") {
      throw new Error("fail: " + call_message(expr.args));
    }

    const union_value = hooks.resolve_union_constructor_call(expr, env);

    if (union_value) {
      return union_value.expr;
    }

    const value = hooks.eval_const_call(expr, env, true);

    if (value) {
      return value;
    }

    const deferred = hooks.inline_deferred_const_call(expr, env);

    if (deferred) {
      return capture_expr(deferred.expr, deferred.env);
    }
  }

  if (expr.tag === "prim") {
    const text_value = hooks.visible_text_value(expr, env, new Set());

    if (text_value) {
      return api.eval_front_value(text_value, env, hooks);
    }
  }

  if (expr.tag === "field") {
    const const_field = hooks.resolve_const_field_expr(expr, env);

    if (const_field) {
      return api.eval_front_value(const_field, env, hooks);
    }

    const struct_field = hooks.resolve_struct_field_expr(expr, env);

    if (struct_field) {
      return api.eval_front_value(struct_field.expr, struct_field.env, hooks);
    }

    throw new Error("Missing const field: " + expr.name);
  }

  if (expr.tag === "index") {
    const item = hooks.resolve_index_expr(expr, env);

    if (item) {
      return api.eval_front_value(item.expr, item.env, hooks);
    }

    throw new Error("Cannot evaluate dynamic index access yet");
  }

  return capture_deferred_expr(expr, env);
}
