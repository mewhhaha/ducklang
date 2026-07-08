import type { Env, FrontExpr, TypeField } from "./ast.ts";
import { capture_expr } from "./capture.ts";
import { infer_dynamic_union_if_cases } from "./dynamic_union_cases.ts";
import { clone_env, push_binding } from "./env.ts";
import { resolve_dynamic_union_if_target } from "./if_let_target.ts";
import type { ResolvedUnionValue } from "./if_let_types.ts";
import type { TextLowerHooks } from "./text_lower_types.ts";

type VisibleTextValue = (
  expr: FrontExpr,
  env: Env,
  seen: Set<string>,
  hooks: TextLowerHooks,
) => FrontExpr | undefined;

export function visible_if_let_value(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  env: Env,
  seen: Set<string>,
  hooks: TextLowerHooks,
  visible_text_value: VisibleTextValue,
): FrontExpr | undefined {
  const target = hooks.resolve_union_value(expr.target, env);

  if (target) {
    return visible_resolved_if_let_branch(
      expr,
      target,
      env,
      seen,
      hooks,
      visible_text_value,
    );
  }

  return visible_dynamic_if_let_value(
    expr,
    env,
    seen,
    hooks,
    visible_text_value,
  );
}

function visible_resolved_if_let_branch(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  target: ResolvedUnionValue,
  env: Env,
  seen: Set<string>,
  hooks: TextLowerHooks,
  visible_text_value: VisibleTextValue,
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
  visible_text_value: VisibleTextValue,
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
    visible_text_value,
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
    visible_text_value,
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
  visible_text_value: VisibleTextValue,
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
    visible_text_value,
  );
}
