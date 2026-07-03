import { expect } from "../expect.ts";
import type { Env, FrontExpr, ResolvedFrontExpr } from "./ast.ts";
import { capture_expr } from "./capture.ts";
import { clone_env, lookup } from "./env.ts";
import { lookup_field } from "./fields.ts";
import { substitute_type_fields } from "./type_patterns.ts";
import { is_builtin_type_name } from "./types.ts";

export type ConstResolveHooks = {
  eval_const_builtin: (
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ) => FrontExpr | undefined;
  eval_simple_front_block: (
    expr: Extract<FrontExpr, { tag: "block" }>,
    env: Env,
  ) => FrontExpr | undefined;
  resolve_index_expr: (
    expr: Extract<FrontExpr, { tag: "index" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  resolve_static_i32_expr: (
    expr: FrontExpr,
    env: Env,
  ) => number | undefined;
  try_eval_all_const_call: (
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ) => FrontExpr | undefined;
};

export function resolve_const_expr(
  expr: FrontExpr,
  env: Env,
  hooks: ConstResolveHooks,
): FrontExpr | undefined {
  const resolved = resolve_const_expr_with_env(expr, env, hooks);

  if (!resolved) {
    return undefined;
  }

  return resolved.expr;
}

export function resolve_const_expr_with_env(
  expr: FrontExpr,
  env: Env,
  hooks: ConstResolveHooks,
): ResolvedFrontExpr | undefined {
  if (expr.tag === "captured") {
    return resolve_const_expr_with_env(expr.expr, expr.env, hooks);
  }

  if (expr.tag === "block" && expr.statements.length === 1) {
    const stmt = expr.statements[0];
    expect(stmt, "Missing const block statement");

    if (stmt.tag === "expr") {
      return resolve_const_expr_with_env(stmt.expr, clone_env(env), hooks);
    }

    if (stmt.tag === "return") {
      return resolve_const_expr_with_env(stmt.value, clone_env(env), hooks);
    }
  }

  if (expr.tag === "block") {
    const value = hooks.eval_simple_front_block(expr, env);

    if (value) {
      return resolve_const_expr_with_env(value, env, hooks);
    }
  }

  if (expr.tag === "struct_type") {
    return {
      expr: {
        tag: "struct_type",
        fields: substitute_const_type_fields(expr.fields, env, hooks),
      },
      env,
    };
  }

  if (expr.tag === "union_type") {
    return {
      expr: {
        tag: "union_type",
        cases: substitute_const_type_fields(expr.cases, env, hooks),
      },
      env,
    };
  }

  if (expr.tag === "field") {
    const value = resolve_const_field_expr(expr, env, hooks);

    if (!value) {
      return undefined;
    }

    return resolve_const_expr_with_env(value, env, hooks);
  }

  if (expr.tag === "index") {
    const static_index = hooks.resolve_static_i32_expr(expr.index, env);

    if (static_index === undefined) {
      return undefined;
    }

    const item = hooks.resolve_index_expr(expr, env);

    if (!item) {
      return undefined;
    }

    return resolve_const_expr_with_env(item.expr, item.env, hooks);
  }

  if (expr.tag === "app") {
    const value = hooks.eval_const_builtin(expr, env);

    if (value) {
      return resolve_const_expr_with_env(value, env, hooks);
    }

    const const_call = hooks.try_eval_all_const_call(expr, env);

    if (const_call) {
      return resolve_const_expr_with_env(const_call, env, hooks);
    }
  }

  if (expr.tag !== "var") {
    return { expr, env };
  }

  if (is_builtin_type_name(expr.name)) {
    return { expr: { tag: "type_name", name: expr.name }, env };
  }

  const binding = lookup(env, expr.name);

  if (!binding || !binding.is_const) {
    return undefined;
  }

  expect(binding.value, "Missing const value: " + expr.name);
  let value_env = env;

  if (binding.value_env) {
    value_env = binding.value_env;
  }

  return resolve_const_expr_with_env(binding.value, value_env, hooks);
}

export function resolve_const_field_expr(
  expr: Extract<FrontExpr, { tag: "field" }>,
  env: Env,
  hooks: ConstResolveHooks,
): FrontExpr | undefined {
  const value = resolve_const_expr_with_env(expr.object, env, hooks);

  if (!value) {
    return undefined;
  }

  if (value.expr.tag === "struct_value") {
    const field = lookup_field(value.expr.fields, expr.name);

    if (!field) {
      throw new Error("Missing struct field: " + expr.name);
    }

    return capture_expr(field.value, value.env);
  }

  const field = lookup_const_field(value.expr, expr.name, value.env, hooks);

  if (!field) {
    return undefined;
  }

  return capture_expr(field.expr, field.env);
}

export function lookup_const_field(
  value: FrontExpr,
  name: string,
  env: Env,
  hooks: ConstResolveHooks,
): ResolvedFrontExpr | undefined {
  if (value.tag !== "with") {
    return undefined;
  }

  for (let index = value.fields.length - 1; index >= 0; index -= 1) {
    const field = value.fields[index];
    expect(field, "Missing extension field " + index);

    if (field.name === name) {
      return { expr: field.value, env };
    }
  }

  const base = resolve_const_expr_with_env(value.base, env, hooks);

  if (!base) {
    return undefined;
  }

  return lookup_const_field(base.expr, name, base.env, hooks);
}

function substitute_const_type_fields(
  fields: { name: string; type_name: string }[],
  env: Env,
  hooks: ConstResolveHooks,
): { name: string; type_name: string }[] {
  return substitute_type_fields(fields, env, {
    resolve_const_expr: (expr, value_env) =>
      resolve_const_expr(expr, value_env, hooks),
  });
}
