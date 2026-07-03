import { expect } from "../expect.ts";
import type { Env, FrontExpr, TypeField } from "./ast.ts";
import { capture_expr } from "./capture.ts";
import { infer_dynamic_union_if_cases } from "./dynamic_union_cases.ts";
import { clone_env, push_binding } from "./env.ts";
import { resolve_dynamic_union_if_target } from "./if_let_target.ts";
import type { ResolvedUnionValue } from "./if_let_types.ts";
import {
  concat_visible_text_values,
  slice_visible_text_value,
} from "./text.ts";
import type { TextLowerHooks } from "./text_lower_types.ts";

export function visible_text_value(
  expr: FrontExpr,
  env: Env,
  seen: Set<string>,
  hooks: TextLowerHooks,
): FrontExpr | undefined {
  if (expr.tag === "captured") {
    return visible_text_value(expr.expr, expr.env, seen, hooks);
  }

  if (expr.tag === "text") {
    return expr;
  }

  if (expr.tag === "comptime") {
    return visible_text_value(expr.expr, env, seen, hooks);
  }

  if (expr.tag === "borrow" || expr.tag === "freeze") {
    return visible_text_value(expr.value, env, seen, hooks);
  }

  if (expr.tag === "scratch") {
    return visible_text_value(expr.body, env, seen, hooks);
  }

  if (expr.tag === "prim" && expr.prim === "i32.add") {
    const left = visible_text_value(expr.left, env, seen, hooks);
    const right = visible_text_value(expr.right, env, seen, hooks);

    if (!left || !right) {
      return undefined;
    }

    return concat_visible_text_values(left, right);
  }

  if (expr.tag === "var") {
    if (seen.has(expr.name)) {
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

    const next_seen = new Set(seen);
    next_seen.add(expr.name);
    return visible_text_value(binding.value, value_env, next_seen, hooks);
  }

  if (expr.tag === "if") {
    const then_branch = visible_text_value(
      expr.then_branch,
      env,
      seen,
      hooks,
    );

    if (!then_branch) {
      return undefined;
    }

    let else_branch: FrontExpr | undefined;

    if (expr.implicit_else) {
      else_branch = { tag: "text", value: "" };
    } else {
      else_branch = visible_text_value(
        expr.else_branch,
        env,
        seen,
        hooks,
      );
    }

    if (!else_branch) {
      return undefined;
    }

    return {
      tag: "if",
      cond: expr.cond,
      then_branch,
      else_branch,
    };
  }

  if (expr.tag === "if_let") {
    return visible_if_let_value(expr, env, seen, hooks);
  }

  if (expr.tag === "block") {
    let value: FrontExpr | undefined;

    try {
      value = hooks.eval_simple_front_block(expr, env);
    } catch {
      value = undefined;
    }

    if (value) {
      return visible_text_value(value, env, seen, hooks);
    }

    if (expr.statements.length !== 1) {
      return undefined;
    }

    const final_stmt = expr.statements[0];
    expect(final_stmt, "Missing text block statement");

    if (final_stmt.tag === "expr") {
      return visible_text_value(final_stmt.expr, env, seen, hooks);
    }

    if (final_stmt.tag === "return") {
      return visible_text_value(final_stmt.value, env, seen, hooks);
    }

    return undefined;
  }

  if (expr.tag === "app") {
    const slice = visible_slice_value(expr, env, seen, hooks);

    if (slice) {
      return slice;
    }

    const append = visible_append_value(expr, env, seen, hooks);

    if (append) {
      return append;
    }

    const value = hooks.try_eval_all_const_call(expr, env);

    if (value) {
      return visible_text_value(value, env, seen, hooks);
    }

    let runtime: { expr: FrontExpr; env: Env } | undefined;

    try {
      runtime = hooks.inline_runtime_call_expr(expr, env);
    } catch {
      runtime = undefined;
    }

    if (!runtime) {
      return undefined;
    }

    return visible_text_value(runtime.expr, runtime.env, seen, hooks);
  }

  if (expr.tag === "field") {
    const field = hooks.resolve_struct_field_expr(expr, env);

    if (!field) {
      return undefined;
    }

    return visible_text_value(field.expr, field.env, seen, hooks);
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

    return visible_text_value(item.expr, item.env, seen, hooks);
  }

  return undefined;
}

function visible_if_let_value(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  env: Env,
  seen: Set<string>,
  hooks: TextLowerHooks,
): FrontExpr | undefined {
  const target = hooks.resolve_union_value(expr.target, env);

  if (target) {
    return visible_resolved_if_let_branch(
      expr,
      target,
      env,
      seen,
      hooks,
    );
  }

  return visible_dynamic_if_let_value(expr, env, seen, hooks);
}

function visible_resolved_if_let_branch(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  target: ResolvedUnionValue,
  env: Env,
  seen: Set<string>,
  hooks: TextLowerHooks,
): FrontExpr | undefined {
  if (target.expr.name !== expr.case_name) {
    if (expr.implicit_else) {
      const then_branch = visible_text_value(
        expr.then_branch,
        env,
        seen,
        hooks,
      );

      if (then_branch) {
        return { tag: "text", value: "" };
      }

      return undefined;
    }

    return visible_text_value(expr.else_branch, env, seen, hooks);
  }

  if (!expr.value_name) {
    return visible_text_value(expr.then_branch, env, seen, hooks);
  }

  const value = target.expr.value;

  if (!value) {
    throw new Error("Union case has no payload: " + expr.case_name);
  }

  const branch_env = clone_env(env);
  push_binding(branch_env, {
    name: expr.value_name,
    ic_name: expr.value_name,
    type: hooks.infer_expr(value, target.env),
    is_const: false,
    is_linear: false,
    value,
    value_env: target.env,
  });

  const branch_seen = new Set(seen);
  branch_seen.delete(expr.value_name);
  return visible_text_value(expr.then_branch, branch_env, branch_seen, hooks);
}

function visible_dynamic_if_let_value(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  env: Env,
  seen: Set<string>,
  hooks: TextLowerHooks,
): FrontExpr | undefined {
  const target = resolve_dynamic_union_if_target(expr.target, env, hooks);

  if (!target) {
    return undefined;
  }

  const cases = infer_dynamic_union_if_cases(target.expr, target.env, hooks);

  if (!cases) {
    return undefined;
  }

  const then_branch = visible_dynamic_if_let_branch(
    expr,
    target.expr.then_branch,
    target.env,
    cases,
    env,
    seen,
    hooks,
  );

  if (!then_branch) {
    return undefined;
  }

  const else_branch = visible_dynamic_if_let_branch(
    expr,
    target.expr.else_branch,
    target.env,
    cases,
    env,
    seen,
    hooks,
  );

  if (!else_branch) {
    return undefined;
  }

  return {
    tag: "if",
    cond: capture_expr(target.expr.cond, target.env),
    then_branch,
    else_branch,
  };
}

function visible_dynamic_if_let_branch(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  branch_expr: FrontExpr,
  branch_env: Env,
  _cases: TypeField[],
  env: Env,
  seen: Set<string>,
  hooks: TextLowerHooks,
): FrontExpr | undefined {
  const target = hooks.resolve_union_value(branch_expr, branch_env);

  if (!target) {
    return undefined;
  }

  return visible_resolved_if_let_branch(
    expr,
    target,
    env,
    seen,
    hooks,
  );
}

function visible_slice_value(
  expr: Extract<FrontExpr, { tag: "app" }>,
  env: Env,
  seen: Set<string>,
  hooks: TextLowerHooks,
): FrontExpr | undefined {
  if (expr.func.tag !== "var" || expr.func.name !== "slice") {
    return undefined;
  }

  if (expr.args.length !== 3) {
    return undefined;
  }

  const text_arg = expr.args[0];
  const start_arg = expr.args[1];
  const end_arg = expr.args[2];
  expect(text_arg, "Missing slice text argument");
  expect(start_arg, "Missing slice start argument");
  expect(end_arg, "Missing slice end argument");
  const text = visible_text_value(text_arg, env, seen, hooks);
  const start = hooks.resolve_static_i32_expr(start_arg, env);
  const end = hooks.resolve_static_i32_expr(end_arg, env);

  if (!text || start === undefined || end === undefined) {
    return undefined;
  }

  return slice_visible_text_value(text, start, end);
}

function visible_append_value(
  expr: Extract<FrontExpr, { tag: "app" }>,
  env: Env,
  seen: Set<string>,
  hooks: TextLowerHooks,
): FrontExpr | undefined {
  if (expr.func.tag !== "var" || expr.func.name !== "append") {
    return undefined;
  }

  if (hooks.lookup(env, expr.func.name)) {
    return undefined;
  }

  if (expr.args.length !== 2) {
    return undefined;
  }

  const left_arg = expr.args[0];
  const right_arg = expr.args[1];
  expect(left_arg, "Missing append left argument");
  expect(right_arg, "Missing append right argument");
  const left = visible_text_value(left_arg, env, seen, hooks);
  const right = visible_text_value(right_arg, env, seen, hooks);

  if (!left || !right) {
    return undefined;
  }

  return concat_visible_text_values(left, right);
}

export function check_text_concat_operand_visibility(
  expr: FrontExpr,
  env: Env,
  hooks: TextLowerHooks,
): void {
  if (expr.tag !== "prim" || expr.prim !== "i32.add") {
    return;
  }

  const left = visible_text_value(expr.left, env, new Set(), hooks);
  const right = visible_text_value(expr.right, env, new Set(), hooks);

  if ((left && !right) || (!left && right)) {
    throw new Error("Text concatenation requires visible text operands");
  }
}
