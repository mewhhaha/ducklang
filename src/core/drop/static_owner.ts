import type { CoreDropHooks, CoreExpr, CoreFnType } from "./types.ts";

export function should_skip_drop_owner_bind<ctx>(
  kind: "let" | "const",
  name: string,
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
): boolean {
  const static_value = drop_static_value(expr, ctx, hooks);

  if (!static_value) {
    return false;
  }

  if (kind === "const") {
    return true;
  }

  if (is_drop_static_ownerless_value(static_value)) {
    return true;
  }

  if (is_scoped_static_drop_helper(name, static_value, ctx, hooks)) {
    return true;
  }

  return is_drop_static_non_runtime_closure(static_value, ctx, hooks);
}

export function should_skip_drop_owner_assign<ctx>(
  name: string,
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
): boolean {
  const static_value = drop_static_value(expr, ctx, hooks);

  if (!static_value) {
    return false;
  }

  if (is_drop_static_ownerless_value(static_value)) {
    return true;
  }

  if (is_scoped_static_drop_helper(name, static_value, ctx, hooks)) {
    return true;
  }

  return is_drop_static_non_runtime_closure(static_value, ctx, hooks);
}

export function drop_static_value<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
): CoreExpr | undefined {
  if (!hooks.static_value) {
    return undefined;
  }

  return hooks.static_value(expr, ctx);
}

export function is_drop_static_ownerless_value(expr: CoreExpr): boolean {
  if (is_drop_static_type_value(expr)) {
    return true;
  }

  if (expr.tag === "text") {
    return true;
  }

  if (expr.tag === "struct_value") {
    return true;
  }

  if (expr.tag === "struct_update") {
    return true;
  }

  if (expr.tag === "union_case") {
    return true;
  }

  if (expr.tag === "with") {
    return true;
  }

  if (expr.tag === "if") {
    return true;
  }

  return false;
}

export function is_drop_static_non_runtime_closure<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
): boolean {
  if (expr.tag === "rec") {
    return true;
  }

  if (expr.tag !== "lam") {
    return false;
  }

  let fn_type: CoreFnType | undefined;

  try {
    fn_type = hooks.closure_fn_type(expr, ctx);
  } catch (error) {
    if (drop_closure_probe_error(error)) {
      return true;
    }

    throw error;
  }

  if (fn_type) {
    return false;
  }

  return true;
}

function is_drop_static_type_value(expr: CoreExpr): boolean {
  if (expr.tag === "type_name") {
    return true;
  }

  if (expr.tag === "struct_type") {
    return true;
  }

  if (expr.tag === "union_type") {
    return true;
  }

  return false;
}

function is_scoped_static_drop_helper<ctx>(
  name: string,
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
): boolean {
  if (!hooks.static_core_call_target) {
    return false;
  }

  if (!hooks.static_core_call_requires_scope) {
    return false;
  }

  if (expr.tag !== "lam") {
    return false;
  }

  const target = hooks.static_core_call_target(
    { tag: "var", name },
    ctx,
  );

  if (!target) {
    return false;
  }

  if (target !== expr) {
    return false;
  }

  return hooks.static_core_call_requires_scope(target);
}

function drop_closure_probe_error(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (
    error.message.startsWith(
      "Core first-class closure parameter must use a scalar annotation:",
    )
  ) {
    return true;
  }

  if (
    error.message === "Core runtime aggregate requires a static struct type"
  ) {
    return true;
  }

  return false;
}
