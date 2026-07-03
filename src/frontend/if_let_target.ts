import { expect } from "../expect.ts";
import type { Env, FrontExpr, ResolvedFrontExpr } from "./ast.ts";
import { clone_env, lookup } from "./env.ts";

export type DynamicUnionIfTarget = {
  expr: Extract<FrontExpr, { tag: "if" }>;
  env: Env;
};

export type IfLetTargetHooks = {
  can_lower_dynamic_union_if_as_value: (
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ) => boolean;
  eval_simple_front_block: (
    expr: Extract<FrontExpr, { tag: "block" }>,
    env: Env,
  ) => FrontExpr | undefined;
  inline_deferred_const_call: (
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  inline_specialized_call_expr: (
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
};

export function resolve_dynamic_union_if_target(
  expr: FrontExpr,
  env: Env,
  hooks: IfLetTargetHooks,
): DynamicUnionIfTarget | undefined {
  if (expr.tag === "captured") {
    return resolve_dynamic_union_if_target(expr.expr, expr.env, hooks);
  }

  if (expr.tag === "if") {
    return { expr, env };
  }

  if (expr.tag === "app") {
    const inlined = hooks.inline_deferred_const_call(expr, env);

    if (inlined) {
      return resolve_dynamic_union_if_target(
        inlined.expr,
        inlined.env,
        hooks,
      );
    }

    const specialized = hooks.inline_specialized_call_expr(expr, env);

    if (specialized) {
      return resolve_dynamic_union_if_target(
        specialized.expr,
        specialized.env,
        hooks,
      );
    }
  }

  if (expr.tag === "block" && expr.statements.length === 1) {
    const stmt = expr.statements[0];
    expect(stmt, "Missing block statement");

    if (stmt.tag === "expr") {
      return resolve_dynamic_union_if_target(
        stmt.expr,
        clone_env(env),
        hooks,
      );
    }

    if (stmt.tag === "return") {
      return resolve_dynamic_union_if_target(
        stmt.value,
        clone_env(env),
        hooks,
      );
    }
  }

  if (expr.tag === "block") {
    const value = hooks.eval_simple_front_block(expr, env);

    if (value) {
      return resolve_dynamic_union_if_target(value, env, hooks);
    }
  }

  if (expr.tag !== "var") {
    return undefined;
  }

  const binding = lookup(env, expr.name);

  if (!binding || !binding.value) {
    return undefined;
  }

  let value_env = env;

  if (binding.value_env) {
    value_env = binding.value_env;
  }

  const target = resolve_dynamic_union_if_target(
    binding.value,
    value_env,
    hooks,
  );

  if (!target) {
    return undefined;
  }

  if (hooks.can_lower_dynamic_union_if_as_value(target.expr, target.env)) {
    return undefined;
  }

  return target;
}
