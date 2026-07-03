import { expect } from "../expect.ts";
import type { CoreExpr, CoreFnType } from "./ast.ts";

export type CoreLocalFactCtx = {
  fn_types: Map<string, CoreFnType>;
  text_locals: Set<string>;
  struct_locals: Map<string, CoreExpr>;
  union_locals: Map<string, CoreExpr>;
  frozen_locals?: Set<string>;
};

export type CoreLocalFactHooks<ctx extends CoreLocalFactCtx> = {
  closure_fn_type: (
    expr: CoreExpr,
    ctx: ctx,
  ) => CoreFnType | undefined;
  runtime_union_type_expr: (
    expr: CoreExpr,
    ctx: ctx,
  ) => CoreExpr | undefined;
  runtime_aggregate_type_expr: (
    expr: CoreExpr,
    ctx: ctx,
  ) => CoreExpr | undefined;
  same_runtime_aggregate_type_expr: (
    left: CoreExpr,
    right: CoreExpr,
    ctx: ctx,
  ) => boolean;
  same_runtime_union_type_expr: (
    left: CoreExpr,
    right: CoreExpr,
    ctx: ctx,
  ) => boolean;
  static_type_value: (
    expr: CoreExpr,
    ctx: ctx,
  ) => CoreExpr | undefined;
};

export function bind_core_fn_type<ctx extends CoreLocalFactCtx>(
  name: string,
  value: CoreExpr,
  ctx: ctx,
  hooks: CoreLocalFactHooks<ctx>,
): void {
  const fn_type = hooks.closure_fn_type(value, ctx);

  if (!fn_type) {
    ctx.fn_types.delete(name);
    return;
  }

  ctx.fn_types.set(name, fn_type);
}

export function bind_core_union_type<ctx extends CoreLocalFactCtx>(
  name: string,
  value: CoreExpr,
  annotation: string | undefined,
  ctx: ctx,
  hooks: CoreLocalFactHooks<ctx>,
): void {
  const annotation_type = core_annotation_union_type_expr(
    annotation,
    ctx,
    hooks,
  );

  if (annotation_type) {
    const actual = hooks.runtime_union_type_expr(value, ctx);
    expect(
      actual && hooks.same_runtime_union_type_expr(
        annotation_type,
        actual,
        ctx,
      ),
      "Core union annotation expects " + annotation,
    );
    ctx.union_locals.set(name, annotation_type);
    return;
  }

  const inferred = hooks.runtime_union_type_expr(value, ctx);

  if (inferred) {
    ctx.union_locals.set(name, inferred);
    return;
  }

  ctx.union_locals.delete(name);
}

export function bind_core_struct_type<ctx extends CoreLocalFactCtx>(
  name: string,
  value: CoreExpr,
  annotation: string | undefined,
  ctx: ctx,
  hooks: CoreLocalFactHooks<ctx>,
): void {
  const annotation_type = core_annotation_struct_type_expr(
    annotation,
    ctx,
    hooks,
  );

  if (annotation_type) {
    const actual = hooks.runtime_aggregate_type_expr(value, ctx);
    expect(
      actual && hooks.same_runtime_aggregate_type_expr(
        annotation_type,
        actual,
        ctx,
      ),
      "Core struct annotation expects " + annotation,
    );
    ctx.struct_locals.set(name, annotation_type);
    return;
  }

  const inferred = hooks.runtime_aggregate_type_expr(value, ctx);

  if (inferred) {
    ctx.struct_locals.set(name, inferred);
    return;
  }

  ctx.struct_locals.delete(name);
}

export function bind_core_assignment_union_type<
  ctx extends CoreLocalFactCtx,
>(
  name: string,
  value: CoreExpr,
  mode: "same" | "change",
  ctx: ctx,
  hooks: CoreLocalFactHooks<ctx>,
): void {
  const expected = ctx.union_locals.get(name);
  const actual = hooks.runtime_union_type_expr(value, ctx);

  if (expected && mode === "same") {
    expect(
      actual && hooks.same_runtime_union_type_expr(expected, actual, ctx),
      "Core union assignment expects the same union type",
    );
    ctx.union_locals.set(name, expected);
    return;
  }

  if (actual) {
    ctx.union_locals.set(name, actual);
    return;
  }

  ctx.union_locals.delete(name);
}

export function bind_core_assignment_struct_type<
  ctx extends CoreLocalFactCtx,
>(
  name: string,
  value: CoreExpr,
  mode: "same" | "change",
  ctx: ctx,
  hooks: CoreLocalFactHooks<ctx>,
): void {
  const expected = ctx.struct_locals.get(name);
  const actual = hooks.runtime_aggregate_type_expr(value, ctx);

  if (expected && mode === "same") {
    expect(
      actual && hooks.same_runtime_aggregate_type_expr(expected, actual, ctx),
      "Core struct assignment expects the same struct type",
    );
    ctx.struct_locals.set(name, expected);
    return;
  }

  if (actual) {
    ctx.struct_locals.set(name, actual);
    return;
  }

  ctx.struct_locals.delete(name);
}

export function core_annotation_union_type_expr<
  ctx extends CoreLocalFactCtx,
>(
  annotation: string | undefined,
  ctx: ctx,
  hooks: CoreLocalFactHooks<ctx>,
): CoreExpr | undefined {
  if (!annotation) {
    return undefined;
  }

  const type_value = hooks.static_type_value(
    { tag: "var", name: annotation },
    ctx,
  );

  if (!type_value || type_value.tag !== "union_type") {
    return undefined;
  }

  return { tag: "var", name: annotation };
}

export function core_annotation_struct_type_expr<
  ctx extends CoreLocalFactCtx,
>(
  annotation: string | undefined,
  ctx: ctx,
  hooks: CoreLocalFactHooks<ctx>,
): CoreExpr | undefined {
  if (!annotation) {
    return undefined;
  }

  const type_value = hooks.static_type_value(
    { tag: "var", name: annotation },
    ctx,
  );

  if (!type_value || type_value.tag !== "struct_type") {
    return undefined;
  }

  return { tag: "var", name: annotation };
}

export function clear_core_local_facts<ctx extends CoreLocalFactCtx>(
  name: string,
  ctx: ctx,
): void {
  ctx.fn_types.delete(name);
  ctx.text_locals.delete(name);
  ctx.struct_locals.delete(name);
  ctx.union_locals.delete(name);
  if (ctx.frozen_locals) {
    ctx.frozen_locals.delete(name);
  }
}

export function clear_optional_core_union_local<
  ctx extends CoreLocalFactCtx,
>(
  name: string | undefined,
  ctx: ctx,
): void {
  if (!name) {
    return;
  }

  ctx.union_locals.delete(name);
}
