import type { CoreExpr } from "../ast.ts";
import { core_expr_ownership, type CoreOwnership } from "../ownership.ts";
import type { CoreTransferState } from "./types.ts";

type RecordTransfer<ctx> = (
  owner: string,
  scope: string,
  callee: string,
  argument: number,
  state: CoreTransferState<ctx>,
) => void;

export function record_union_payload_transfer<ctx>(
  expr: CoreExpr,
  scope: string,
  state: CoreTransferState<ctx>,
  record_transfer: RecordTransfer<ctx>,
): void {
  if (!direct_union_payload_may_be_owner_transfer(expr)) {
    return;
  }

  const runtime_value = state.hooks.runtime_union_value(expr, state.ctx);
  if (!runtime_value) {
    return;
  }

  if (runtime_value.tag !== "union_case") {
    return;
  }

  if (!runtime_value.value) {
    return;
  }

  if (runtime_value.value.tag !== "var") {
    return;
  }

  if (!union_payload_transfers_owner(expr, state)) {
    return;
  }

  record_transfer(
    runtime_value.value.name,
    scope,
    "union_case." + runtime_value.name,
    0,
    state,
  );
}

function direct_union_payload_may_be_owner_transfer(expr: CoreExpr): boolean {
  if (expr.tag === "union_case") {
    if (!expr.value) {
      return false;
    }

    return expr.value.tag === "var";
  }

  if (expr.tag === "app" && expr.func.tag === "field") {
    const payload = expr.args[0];

    if (!payload) {
      return false;
    }

    return payload.tag === "var";
  }

  return true;
}

function union_payload_transfers_owner<ctx>(
  expr: CoreExpr,
  state: CoreTransferState<ctx>,
): boolean {
  let union_ownership: CoreOwnership;

  try {
    union_ownership = core_expr_ownership(expr, state.ctx, state.hooks);
  } catch {
    return false;
  }

  if (union_ownership.tag !== "unique_heap") {
    return false;
  }

  if (union_ownership.reason !== "runtime_union") {
    return false;
  }

  const runtime_value = state.hooks.runtime_union_value(expr, state.ctx);
  if (!runtime_value) {
    return false;
  }

  if (runtime_value.tag !== "union_case") {
    return false;
  }

  if (!runtime_value.value) {
    return false;
  }

  let payload_ownership: CoreOwnership;

  try {
    payload_ownership = core_expr_ownership(
      runtime_value.value,
      state.ctx,
      state.hooks,
    );
  } catch {
    return false;
  }

  if (payload_ownership.tag !== "unique_heap") {
    return false;
  }

  return payload_ownership.reason === "runtime_aggregate" ||
    payload_ownership.reason === "runtime_union";
}
