import { expect } from "../expect.ts";
import type { Env, FrontExpr, TypeField } from "./ast.ts";
import { merge_type_fields } from "./fields.ts";
import { infer_rec_expr } from "./rec_infer.ts";
import type { StaticRecHooks } from "./rec_hooks.ts";
import {
  lookup_rec_type_field,
  rec_front_type_for_type_name,
} from "./rec_util.ts";
import { type_name_from_front_type } from "./types.ts";

export type RecDynamicUnionIfTarget = {
  expr: Extract<FrontExpr, { tag: "if" }>;
  env: Env;
};

export function resolve_rec_dynamic_union_if_target(
  expr: FrontExpr,
  env: Env,
  hooks: StaticRecHooks,
): RecDynamicUnionIfTarget | undefined {
  if (expr.tag === "captured") {
    return resolve_rec_dynamic_union_if_target(expr.expr, expr.env, hooks);
  }

  if (expr.tag === "if") {
    return { expr, env };
  }

  if (expr.tag === "app") {
    const inlined = hooks.inline_deferred_const_call(expr, env);

    if (inlined) {
      return resolve_rec_dynamic_union_if_target(
        inlined.expr,
        inlined.env,
        hooks,
      );
    }

    const specialized = hooks.inline_specialized_call_expr(expr, env);

    if (specialized) {
      return resolve_rec_dynamic_union_if_target(
        specialized.expr,
        specialized.env,
        hooks,
      );
    }

    const runtime = hooks.inline_runtime_call_expr(expr, env);

    if (runtime) {
      return resolve_rec_dynamic_union_if_target(
        runtime.expr,
        runtime.env,
        hooks,
      );
    }
  }

  if (expr.tag === "block" && expr.statements.length === 1) {
    const stmt = expr.statements[0];
    expect(stmt, "Missing block statement");

    if (stmt.tag === "expr") {
      return resolve_rec_dynamic_union_if_target(
        stmt.expr,
        hooks.clone_env(env),
        hooks,
      );
    }

    if (stmt.tag === "return") {
      return resolve_rec_dynamic_union_if_target(
        stmt.value,
        hooks.clone_env(env),
        hooks,
      );
    }
  }

  if (expr.tag !== "var") {
    return undefined;
  }

  const binding = hooks.lookup(env, expr.name);

  if (!binding || !binding.value) {
    return undefined;
  }

  let value_env = env;

  if (binding.value_env) {
    value_env = binding.value_env;
  }

  return resolve_rec_dynamic_union_if_target(binding.value, value_env, hooks);
}

export function infer_rec_dynamic_union_if_cases(
  expr: Extract<FrontExpr, { tag: "if" }>,
  env: Env,
  hooks: StaticRecHooks,
): TypeField[] | undefined {
  const then_cases = infer_rec_union_cases(expr.then_branch, env, hooks);
  const else_cases = infer_rec_union_cases(expr.else_branch, env, hooks);

  if (!then_cases || !else_cases) {
    return undefined;
  }

  return merge_type_fields(then_cases, else_cases);
}

export function infer_rec_if_let_result_union_cases(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  cases: TypeField[],
  env: Env,
  hooks: StaticRecHooks,
): TypeField[] | undefined {
  const then_env = hooks.clone_env(env);

  if (expr.value_name) {
    const matched = lookup_rec_type_field(cases, expr.case_name);

    if (!matched) {
      throw new Error("Missing union case: " + expr.case_name);
    }

    if (matched.type_name === "Unit") {
      throw new Error("Union case has no payload: " + expr.case_name);
    }

    hooks.push_binding(then_env, {
      name: expr.value_name,
      ic_name: expr.value_name,
      type: rec_front_type_for_type_name(matched.type_name, env, hooks),
      is_const: false,
      is_linear: false,
      value: undefined,
      value_env: undefined,
    });
  }

  const then_cases = infer_rec_union_cases(expr.then_branch, then_env, hooks);
  const else_cases = infer_rec_union_cases(expr.else_branch, env, hooks);

  if (!then_cases || !else_cases) {
    return undefined;
  }

  return merge_type_fields(then_cases, else_cases);
}

function infer_rec_union_cases(
  expr: FrontExpr,
  env: Env,
  hooks: StaticRecHooks,
): TypeField[] | undefined {
  if (expr.tag === "captured") {
    return infer_rec_union_cases(expr.expr, expr.env, hooks);
  }

  const target = hooks.resolve_union_value(expr, env);

  if (target) {
    return [infer_rec_untyped_union_case(target.expr, target.env, hooks)];
  }

  if (expr.tag === "if") {
    return infer_rec_dynamic_union_if_cases(expr, env, hooks);
  }

  if (expr.tag === "block" && expr.statements.length === 1) {
    const stmt = expr.statements[0];
    expect(stmt, "Missing union block statement");

    if (stmt.tag === "expr") {
      return infer_rec_union_cases(stmt.expr, hooks.clone_env(env), hooks);
    }

    if (stmt.tag === "return") {
      return infer_rec_union_cases(stmt.value, hooks.clone_env(env), hooks);
    }
  }

  return undefined;
}

function infer_rec_untyped_union_case(
  expr: Extract<FrontExpr, { tag: "union_case" }>,
  env: Env,
  hooks: StaticRecHooks,
): TypeField {
  if (!expr.value) {
    return { name: expr.name, type_name: "Unit" };
  }

  const type_name = type_name_from_front_type(
    infer_rec_expr(expr.value, env, hooks),
  );

  if (!type_name) {
    return { name: expr.name, type_name: "unknown" };
  }

  return { name: expr.name, type_name };
}
