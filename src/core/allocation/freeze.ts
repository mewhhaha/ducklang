import type { CoreExpr } from "../ast.ts";
import { expect } from "../../expect.ts";
import { core_expr_ownership } from "../ownership.ts";
import {
  runtime_aggregate_freeze_copy_supported,
  runtime_aggregate_layout_for_type,
  type RuntimeAggregateField,
} from "../runtime_aggregate.ts";
import { runtime_union_freeze_copy_supported } from "../runtime_union_emit.ts";
import {
  runtime_union_payload,
  type RuntimeUnionPayload,
  type RuntimeUnionPayloadField,
} from "../runtime_union_payload.ts";
import { static_type_value, type TypeStaticCtx } from "../type_static.ts";
import { record_allocation } from "./record.ts";
import type {
  CoreAllocationHooks,
  CoreAllocationScope,
  CoreAllocationState,
} from "./types.ts";

export function freeze_promotes_runtime_text<ctx>(
  expr: Extract<CoreExpr, { tag: "freeze" }>,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
): boolean {
  const ownership = core_expr_ownership(expr.value, ctx, hooks);

  if (ownership.tag !== "unique_heap") {
    return false;
  }

  return ownership.reason === "text";
}

export function freeze_promotes_runtime_closure<ctx>(
  expr: Extract<CoreExpr, { tag: "freeze" }>,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
): boolean {
  const ownership = core_expr_ownership(expr.value, ctx, hooks);

  if (ownership.tag !== "unique_heap") {
    return false;
  }

  return ownership.reason === "closure";
}

export function freeze_promotes_runtime_aggregate<ctx>(
  expr: Extract<CoreExpr, { tag: "freeze" }>,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
): boolean {
  const ownership = core_expr_ownership(expr.value, ctx, hooks);

  if (ownership.tag !== "unique_heap") {
    return false;
  }

  if (ownership.reason !== "runtime_aggregate") {
    return false;
  }

  return expr.value.tag === "struct_value" &&
    !!hooks.static_struct_value(expr.value, ctx);
}

export function freeze_copies_runtime_aggregate<ctx>(
  expr: Extract<CoreExpr, { tag: "freeze" }>,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
): boolean {
  const ownership = core_expr_ownership(expr.value, ctx, hooks);

  if (ownership.tag !== "unique_heap") {
    return false;
  }

  if (ownership.reason !== "runtime_aggregate") {
    return false;
  }

  if (freeze_promotes_runtime_aggregate(expr, ctx, hooks)) {
    return false;
  }

  if (!hooks.runtime_aggregate_type_expr) {
    return false;
  }

  const type_expr = hooks.runtime_aggregate_type_expr(expr.value, ctx);

  if (!type_expr) {
    return false;
  }

  return runtime_aggregate_freeze_copy_supported(
    type_expr,
    ctx as ctx & TypeStaticCtx,
    {
      runtime_union_freeze_copy_supported,
    },
  );
}

export function record_runtime_aggregate_freeze_copy_allocations<ctx>(
  expr: Extract<CoreExpr, { tag: "freeze" }>,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
): void {
  expect_runtime_aggregate_type_expr(expr, ctx, hooks);
  record_allocation(expr, "runtime_aggregate", scope, state);
  record_runtime_aggregate_freeze_field_allocations(
    expr,
    scope,
    ctx,
    hooks,
    state,
  );
}

function record_runtime_aggregate_freeze_field_allocations<ctx>(
  expr: Extract<CoreExpr, { tag: "freeze" }>,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
): void {
  const type_expr = expect_runtime_aggregate_type_expr(expr, ctx, hooks);
  const layout = runtime_aggregate_layout_for_type(
    type_expr,
    ctx as ctx & TypeStaticCtx,
  );
  record_runtime_aggregate_freeze_text_allocations(
    expr,
    layout.fields,
    scope,
    ctx,
    state,
  );
}

function expect_runtime_aggregate_type_expr<ctx>(
  expr: Extract<CoreExpr, { tag: "freeze" }>,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
): CoreExpr {
  expect(
    hooks.runtime_aggregate_type_expr,
    "Missing runtime aggregate allocation type hook",
  );
  const type_expr = hooks.runtime_aggregate_type_expr(expr.value, ctx);
  expect(type_expr, "Missing runtime aggregate freeze-copy type");
  return type_expr;
}

function record_runtime_aggregate_freeze_text_allocations(
  expr: Extract<CoreExpr, { tag: "freeze" }>,
  fields: RuntimeAggregateField[],
  scope: CoreAllocationScope,
  ctx: unknown,
  state: CoreAllocationState,
): void {
  for (const field of fields) {
    if (field.tag === "unit") {
      continue;
    }

    if (field.tag === "struct") {
      record_runtime_aggregate_freeze_text_allocations(
        expr,
        field.fields,
        scope,
        ctx,
        state,
      );
      continue;
    }

    if (field.union_type_expr) {
      record_allocation(expr, "runtime_union", scope, state);
      record_runtime_union_freeze_text_allocations(
        expr,
        field.union_type_expr,
        scope,
        ctx,
        state,
      );
      continue;
    }

    if (field.text) {
      record_allocation(
        expr,
        "runtime_text",
        scope,
        state,
      );
    }
  }
}

export function freeze_promotes_runtime_union<ctx>(
  expr: Extract<CoreExpr, { tag: "freeze" }>,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
): boolean {
  const ownership = core_expr_ownership(expr.value, ctx, hooks);

  if (ownership.tag !== "unique_heap") {
    return false;
  }

  if (ownership.reason !== "runtime_union") {
    return false;
  }

  const value = hooks.runtime_union_value(expr.value, ctx);

  if (!value) {
    return false;
  }

  return expr.value.tag !== "var" && value.tag === "union_case";
}

export function freeze_copies_runtime_union<ctx>(
  expr: Extract<CoreExpr, { tag: "freeze" }>,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
): boolean {
  const ownership = core_expr_ownership(expr.value, ctx, hooks);

  if (ownership.tag !== "unique_heap") {
    return false;
  }

  if (ownership.reason !== "runtime_union") {
    return false;
  }

  if (freeze_promotes_runtime_union(expr, ctx, hooks)) {
    return false;
  }

  const type_expr = runtime_union_freeze_copy_type_expr(expr.value, ctx, hooks);

  if (!type_expr) {
    return false;
  }

  return runtime_union_freeze_copy_supported(
    type_expr,
    ctx as ctx & TypeStaticCtx,
  );
}

export function record_runtime_union_freeze_copy_allocations<ctx>(
  expr: Extract<CoreExpr, { tag: "freeze" }>,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
): void {
  const type_expr = runtime_union_freeze_copy_type_expr(expr.value, ctx, hooks);
  expect(type_expr, "Missing runtime union freeze-copy type");
  record_allocation(expr, "runtime_union", scope, state);
  record_runtime_union_freeze_text_allocations(
    expr,
    type_expr,
    scope,
    ctx,
    state,
  );
}

function runtime_union_freeze_copy_type_expr<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
): CoreExpr | undefined {
  const value = hooks.runtime_union_value(expr, ctx);

  if (value) {
    if (value.tag === "union_case") {
      return value.type_expr;
    }

    if (value.tag === "if") {
      return runtime_union_freeze_copy_type_expr(
        value.then_branch,
        ctx,
        hooks,
      );
    }
  }

  if (hooks.runtime_union_target) {
    const target = hooks.runtime_union_target(expr, ctx);

    if (target) {
      return target.type_expr;
    }
  }

  return undefined;
}

function record_runtime_union_freeze_text_allocations<ctx>(
  expr: Extract<CoreExpr, { tag: "freeze" }>,
  type_expr: CoreExpr,
  scope: CoreAllocationScope,
  ctx: ctx,
  state: CoreAllocationState,
): void {
  const type_value = static_type_value(type_expr, ctx as ctx & TypeStaticCtx);
  expect(
    type_value && type_value.tag === "union_type",
    "Core runtime union freeze-copy allocations require a union type",
  );

  for (const union_case of type_value.cases) {
    const payload = runtime_union_payload(
      union_case.type_name,
      ctx as ctx & TypeStaticCtx,
    );
    record_runtime_union_payload_text_allocations(
      expr,
      payload,
      scope,
      ctx,
      state,
    );
  }
}

function record_runtime_union_payload_text_allocations<ctx>(
  expr: Extract<CoreExpr, { tag: "freeze" }>,
  payload: RuntimeUnionPayload,
  scope: CoreAllocationScope,
  ctx: ctx,
  state: CoreAllocationState,
): void {
  if (payload.tag === "aggregate") {
    record_runtime_aggregate_type_freeze_copy_allocations(
      expr,
      payload.type_expr,
      scope,
      ctx,
      state,
    );
    return;
  }

  if (payload.tag === "value") {
    if (payload.union_type_expr) {
      record_allocation(expr, "runtime_union", scope, state);
      record_runtime_union_freeze_text_allocations(
        expr,
        payload.union_type_expr,
        scope,
        ctx,
        state,
      );
      return;
    }

    if (payload.text) {
      record_allocation(expr, "runtime_text", scope, state);
    }

    return;
  }

  if (payload.tag !== "struct") {
    return;
  }

  record_runtime_union_payload_field_text_allocations(
    expr,
    payload.fields,
    scope,
    ctx,
    state,
  );
}

function record_runtime_aggregate_type_freeze_copy_allocations<ctx>(
  expr: Extract<CoreExpr, { tag: "freeze" }>,
  type_expr: CoreExpr,
  scope: CoreAllocationScope,
  ctx: ctx,
  state: CoreAllocationState,
): void {
  const layout = runtime_aggregate_layout_for_type(
    type_expr,
    ctx as ctx & TypeStaticCtx,
  );
  record_allocation(expr, "runtime_aggregate", scope, state);
  record_runtime_aggregate_freeze_text_allocations(
    expr,
    layout.fields,
    scope,
    ctx,
    state,
  );
}

function record_runtime_union_payload_field_text_allocations(
  expr: Extract<CoreExpr, { tag: "freeze" }>,
  fields: RuntimeUnionPayloadField[],
  scope: CoreAllocationScope,
  ctx: unknown,
  state: CoreAllocationState,
): void {
  for (const field of fields) {
    if (field.tag === "struct") {
      record_runtime_union_payload_field_text_allocations(
        expr,
        field.fields,
        scope,
        ctx,
        state,
      );
      continue;
    }

    if (field.union_type_expr) {
      record_allocation(expr, "runtime_union", scope, state);
      record_runtime_union_freeze_text_allocations(
        expr,
        field.union_type_expr,
        scope,
        ctx,
        state,
      );
      continue;
    }

    if (field.text) {
      record_allocation(expr, "runtime_text", scope, state);
    }
  }
}
