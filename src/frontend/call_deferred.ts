import type { Env, FrontExpr, FrontType, ResolvedFrontExpr } from "./ast.ts";
import { is_object_type_expr } from "./fields.ts";

export type CallDeferredHooks = {
  can_lower_dynamic_union_if_as_value: (
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ) => boolean;
  infer_expr: (expr: FrontExpr, env: Env) => FrontType;
  resolve_dynamic_if_let_struct_value: (
    expr: Extract<FrontExpr, { tag: "if_let" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  resolve_struct_value: (
    expr: FrontExpr,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  resolve_union_value: (
    expr: FrontExpr,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  visible_text_value: (
    expr: FrontExpr,
    env: Env,
    seen: Set<string>,
  ) => FrontExpr | undefined;
};

export function is_deferred_frontend_value(
  expr: FrontExpr,
  env: Env | undefined,
  hooks: CallDeferredHooks,
): boolean {
  if (expr.tag === "captured") {
    return is_deferred_frontend_value(expr.expr, expr.env, hooks);
  }

  if (expr.tag === "struct_value") {
    if (is_object_type_expr(expr.type_expr)) {
      return true;
    }

    return false;
  }

  if (expr.tag === "union_case") {
    return !expr.type_expr;
  }

  if (expr.tag === "if" && env) {
    const type = hooks.infer_expr(expr, env);

    if (type.tag === "struct" && !type.field_types) {
      return true;
    }

    return type.tag === "union_value" &&
      !hooks.can_lower_dynamic_union_if_as_value(expr, env);
  }

  if (expr.tag === "if_let" && env) {
    return hooks.resolve_dynamic_if_let_struct_value(expr, env) !== undefined;
  }

  return false;
}

export function resolve_deferred_frontend_value(
  expr: FrontExpr,
  env: Env,
  hooks: CallDeferredHooks,
): ResolvedFrontExpr | undefined {
  const struct_value = hooks.resolve_struct_value(expr, env);

  if (struct_value) {
    return struct_value;
  }

  const union_value = hooks.resolve_union_value(expr, env);

  if (union_value) {
    return union_value;
  }

  return undefined;
}

export function resolve_deferred_text_value(
  expr: FrontExpr,
  env: Env,
  hooks: Pick<CallDeferredHooks, "visible_text_value">,
): ResolvedFrontExpr | undefined {
  const text_value = hooks.visible_text_value(expr, env, new Set());

  if (!text_value) {
    return undefined;
  }

  return { expr: text_value, env };
}
