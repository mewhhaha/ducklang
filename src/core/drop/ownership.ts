import {
  core_host_import_for_app,
  type CoreHostImportCtx,
} from "../host_import.ts";
import { core_expr_ownership, type CoreOwnership } from "../ownership.ts";
import { emit_host_transfer } from "./emit.ts";
import {
  drop_static_value,
  is_drop_static_non_runtime_closure,
  is_drop_static_ownerless_value,
} from "./static_owner.ts";
import { resolve_drop_owner } from "./state.ts";
import type {
  CoreDropExprResult,
  CoreDropHooks,
  CoreDropOwner,
  CoreDropState,
  CoreExpr,
  CoreHostImport,
  CoreUniqueHeapOwnership,
} from "./types.ts";

export function moved_expr_owner(
  expr: CoreExpr,
  owners: Map<string, CoreDropOwner>,
  state: CoreDropState,
): CoreDropOwner | undefined {
  const direct = moved_named_owner(expr, owners, state);

  if (direct) {
    return direct;
  }

  return simple_expr_result_owner(state.expr_results.get(expr));
}

export function consume_runtime_union_payload_owner<ctx>(
  expr: CoreExpr,
  owners: Map<string, CoreDropOwner>,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
): void {
  const runtime_value = hooks.runtime_union_value(expr, ctx);
  if (!runtime_value) {
    return;
  }

  if (runtime_value.tag !== "union_case") {
    return;
  }

  if (!runtime_value.value) {
    return;
  }

  const union_ownership = unique_heap_ownership(expr, ctx, hooks);
  if (!union_ownership) {
    return;
  }

  if (union_ownership.reason !== "runtime_union") {
    return;
  }

  const moved_owner = moved_expr_owner(runtime_value.value, owners, state);
  if (!moved_owner) {
    return;
  }

  if (
    moved_owner.ownership.reason !== "runtime_aggregate" &&
    moved_owner.ownership.reason !== "runtime_union"
  ) {
    return;
  }

  owners.delete(moved_owner.name);
}

export function expr_consumes_owner_name(
  expr: CoreExpr,
  name: string,
  owners: Map<string, CoreDropOwner>,
  state: CoreDropState,
): boolean {
  const frozen_owner = frozen_expr_consumed_owner(expr, owners, state);

  if (frozen_owner && frozen_owner.name === name) {
    return true;
  }

  const moved_owner = moved_expr_owner(expr, owners, state);

  if (moved_owner && moved_owner.name === name) {
    return true;
  }

  return false;
}

export function frozen_expr_consumed_owner(
  expr: CoreExpr,
  owners: Map<string, CoreDropOwner>,
  state: CoreDropState,
): CoreDropOwner | undefined {
  if (expr.tag !== "freeze") {
    return undefined;
  }

  return moved_expr_owner(expr.value, owners, state);
}

export function mark_final_expr_escape<ctx>(
  expr: CoreExpr,
  owners: Map<string, CoreDropOwner>,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
): void {
  const expr_result = state.expr_results.get(expr);
  if (expr_result && expr_result.tag === "branch") {
    return;
  }

  if (expr_result && expr_result.tag === "none") {
    return;
  }

  const frozen_owner = frozen_expr_consumed_owner(expr, owners, state);

  if (frozen_owner) {
    owners.delete(frozen_owner.name);
    return;
  }

  if (expr.tag === "freeze") {
    return;
  }

  const moved_owner = moved_expr_owner(expr, owners, state);

  if (moved_owner) {
    owners.delete(moved_owner.name);
    return;
  }

  if (mark_named_final_owner_escape(expr, owners)) {
    return;
  }

  if (state.final_escape === "named_only") {
    return;
  }

  unique_heap_ownership(expr, ctx, hooks);
}

export function consume_host_transfer_args<ctx>(
  expr: Extract<CoreExpr, { tag: "app" }>,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
): void {
  const host_import = drop_host_import_for_app(expr, ctx);

  if (!host_import) {
    return;
  }

  for (let index = 0; index < expr.args.length; index += 1) {
    const contract = host_import.args[index];

    if (!contract) {
      continue;
    }

    if (contract.tag !== "ownership_transfer") {
      continue;
    }

    const arg = expr.args[index];
    if (!arg) {
      throw new Error("Missing host transfer argument " + index.toString());
    }

    const owner = moved_expr_owner(arg, owners, state);

    if (owner) {
      let owner_name: string | undefined;

      if (owner.name.length > 0) {
        owner_name = owner.name;
        owners.delete(owner.name);
      }

      emit_host_transfer(
        scope,
        host_import.name,
        index,
        owner_name,
        owner.ownership,
        state,
      );
      continue;
    }

    if (arg.tag === "var") {
      continue;
    }

    const ownership = unique_heap_ownership(arg, ctx, hooks);

    if (!ownership) {
      continue;
    }

    emit_host_transfer(
      scope,
      host_import.name,
      index,
      undefined,
      ownership,
      state,
    );
  }
}

export function unique_heap_ownership<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
): CoreUniqueHeapOwnership | undefined {
  const static_value = drop_static_value(expr, ctx, hooks);

  if (static_value && is_drop_static_ownerless_value(static_value)) {
    const materialized_static_aggregate =
      unique_heap_static_aggregate_ownership(expr, ctx, hooks);

    if (materialized_static_aggregate) {
      return materialized_static_aggregate;
    }

    return undefined;
  }

  if (
    static_value &&
    is_drop_static_non_runtime_closure(static_value, ctx, hooks)
  ) {
    return undefined;
  }

  let ownership: CoreOwnership;

  try {
    ownership = core_drop_expr_ownership(expr, ctx, hooks);
  } catch (error) {
    if (drop_unknown_host_boundary_probe_error(error)) {
      return undefined;
    }

    throw error;
  }

  if (ownership.tag === "unique_heap") {
    return ownership;
  }

  return undefined;
}

export function drop_unknown_host_boundary_probe_error(
  error: unknown,
): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.message === "Cannot type core app expression yet") {
    return true;
  }

  return false;
}

function moved_named_owner(
  expr: CoreExpr,
  owners: Map<string, CoreDropOwner>,
  state: CoreDropState,
): CoreDropOwner | undefined {
  if (expr.tag !== "var") {
    return undefined;
  }

  const temporary = state.temporary_aliases.get(expr.name);

  if (temporary) {
    return { name: "", ownership: temporary };
  }

  return owners.get(resolve_drop_owner(expr.name, state));
}

export function simple_expr_result_owner(
  result: CoreDropExprResult | undefined,
): CoreDropOwner | undefined {
  if (!result) {
    return undefined;
  }

  if (result.tag !== "owner") {
    return undefined;
  }

  return result.owner;
}

function mark_named_final_owner_escape(
  expr: CoreExpr,
  owners: Map<string, CoreDropOwner>,
): boolean {
  if (expr.tag !== "var") {
    return false;
  }

  if (!owners.has(expr.name)) {
    return false;
  }

  owners.delete(expr.name);
  return true;
}

function drop_host_import_for_app(
  expr: Extract<CoreExpr, { tag: "app" }>,
  ctx: unknown,
): CoreHostImport | undefined {
  if (!drop_ctx_has_host_imports(ctx)) {
    return undefined;
  }

  return core_host_import_for_app(expr, ctx);
}

function drop_ctx_has_host_imports(ctx: unknown): ctx is CoreHostImportCtx {
  if (typeof ctx !== "object") {
    return false;
  }

  if (ctx === null) {
    return false;
  }

  return "host_imports" in ctx;
}

function unique_heap_static_aggregate_ownership<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
): CoreUniqueHeapOwnership | undefined {
  let ownership: CoreOwnership;

  try {
    ownership = core_drop_expr_ownership(expr, ctx, hooks);
  } catch (error) {
    if (drop_unknown_host_boundary_probe_error(error)) {
      return undefined;
    }

    throw error;
  }

  if (ownership.tag !== "unique_heap") {
    return undefined;
  }

  if (ownership.reason !== "runtime_aggregate") {
    return undefined;
  }

  return ownership;
}

function core_drop_expr_ownership<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
): CoreOwnership {
  return core_expr_ownership(expr, ctx, {
    bind_core_if_let_payload_fact: hooks.bind_core_if_let_payload_fact,
    bind_dynamic_if_let_payload: hooks.bind_dynamic_if_let_payload,
    block_ctx: hooks.block_ctx,
    closure_fn_type: hooks.closure_fn_type,
    collect_stmt_locals: hooks.collect_stmt_locals,
    core_expr_is_text: hooks.core_expr_is_text,
    dynamic_union_if: hooks.dynamic_union_if,
    expr_type: hooks.expr_type,
    frozen_local: hooks.frozen_local,
    if_let_branch_ctx: hooks.block_ctx,
    runtime_union_match_info: hooks.runtime_union_match_info,
    runtime_union_target: hooks.runtime_union_target,
    runtime_aggregate_type_expr: hooks.runtime_aggregate_type_expr,
    runtime_union_value: hooks.runtime_union_value,
    static_runtime_union_match_branch_ctx:
      hooks.static_runtime_union_match_branch_ctx,
    static_struct_value: hooks.static_struct_value,
    static_text_value: hooks.static_text_value,
    static_union_case: hooks.static_union_case,
  });
}
