import type { CoreExpr, CoreField } from "../ast.ts";
import { core_expr_ownership } from "../ownership.ts";
import {
  record_runtime_union_allocations,
  runtime_union_allocation_value,
  runtime_union_case_payload,
  runtime_union_value_materializes,
  scan_runtime_union_payload_allocations,
} from "./runtime_union.ts";
import type {
  CoreAllocationHooks,
  CoreAllocationScope,
  CoreAllocationState,
} from "./types.ts";

type AllocationExprScanner<ctx> = (
  expr: CoreExpr,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
) => void;

type AllocationFieldsScanner<ctx> = (
  fields: CoreField[],
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
) => void;

export function scan_static_value_allocation_expr<ctx>(
  expr: CoreExpr,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
  record_runtime_union_owner: boolean,
  allocation_instance: string,
  scan_expr: AllocationExprScanner<ctx>,
  scan_fields: AllocationFieldsScanner<ctx>,
): Extract<CoreExpr, { tag: "struct_value" }> | undefined {
  if (record_runtime_union_owner) {
    const union_value = runtime_union_allocation_value(expr, ctx, hooks);
    const allocation_value = union_value || expr;
    record_runtime_union_allocations(
      allocation_value,
      scope,
      ctx,
      hooks,
      state,
      scan_expr,
      allocation_instance,
    );
    const facts: CoreAllocationState["facts"] = [];
    collect_static_runtime_union_owner_facts(allocation_value, facts, state);
    if (facts.length === 0) {
      throw new Error("Missing materialized static union allocation facts");
    }
    const unique: CoreAllocationState["facts"] = [];
    const seen = new Set<string>();
    for (const fact of facts) {
      if (seen.has(fact.allocation_id)) {
        continue;
      }
      seen.add(fact.allocation_id);
      unique.push(fact);
    }
    state.value_allocations.set(expr, unique);
    return undefined;
  }
  const struct_value = hooks.static_struct_value(expr, ctx);

  if (struct_value) {
    scan_fields(struct_value.fields, scope, ctx, hooks, state);
    return struct_value;
  }

  const union_value = runtime_union_allocation_value(expr, ctx, hooks);

  if (union_value) {
    scan_static_value_union_allocations(
      union_value,
      scope,
      ctx,
      hooks,
      state,
      scan_expr,
    );
  }
  return undefined;
}

function collect_static_runtime_union_owner_facts(
  value: CoreExpr,
  facts: CoreAllocationState["facts"],
  state: CoreAllocationState,
): void {
  if (value.tag === "if") {
    collect_static_runtime_union_owner_facts(
      value.then_branch,
      facts,
      state,
    );
    collect_static_runtime_union_owner_facts(
      value.else_branch,
      facts,
      state,
    );
    return;
  }
  const direct = state.value_allocations.get(value);
  if (!direct) {
    return;
  }
  for (const fact of direct) {
    if (fact.reason === "runtime_union") {
      facts.push(fact);
    }
  }
}

export function static_value_materializes_runtime_union_owner<ctx>(
  expr: CoreExpr,
  has_annotation: boolean,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
): boolean {
  if (expr.tag === "app" && expr.func.tag === "field") {
    return true;
  }

  const ownership = core_expr_ownership(expr, ctx, hooks);

  if (ownership.tag !== "unique_heap") {
    return false;
  }

  if (ownership.reason !== "runtime_union") {
    return false;
  }

  if (has_annotation) {
    return true;
  }

  const runtime_value = runtime_union_allocation_value(expr, ctx, hooks);
  if (!runtime_value) {
    return true;
  }

  return runtime_union_value_materializes(runtime_value);
}

function scan_static_value_union_allocations<ctx>(
  expr: CoreExpr,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
  scan_expr: AllocationExprScanner<ctx>,
): void {
  if (expr.tag === "if") {
    scan_static_value_union_allocations(
      expr.then_branch,
      scope,
      ctx,
      hooks,
      state,
      scan_expr,
    );
    scan_static_value_union_allocations(
      expr.else_branch,
      scope,
      ctx,
      hooks,
      state,
      scan_expr,
    );
    return;
  }

  if (expr.tag !== "union_case") {
    return;
  }

  if (expr.value) {
    if (!expr.type_expr) {
      scan_expr(expr.value, scope, ctx, hooks, state);
      return;
    }
    const payload = runtime_union_case_payload(expr, ctx);
    if (!payload) {
      throw new Error("Missing static union payload allocation metadata");
    }
    scan_runtime_union_payload_allocations(
      expr.value,
      payload,
      scope,
      ctx,
      hooks,
      state,
      scan_expr,
    );
  }
}
