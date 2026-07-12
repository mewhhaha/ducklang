import type { CoreExpr } from "../ast.ts";
import { core_expr_ownership, type CoreOwnership } from "../ownership.ts";
import type { CoreTransferState } from "./types.ts";

type RecordTransfer<ctx> = (
  owner: string,
  scope: string,
  callee: string,
  argument: number,
  subject: CoreExpr,
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

  // Ownership transfer is defined only for payload forms that end in a named
  // owner (possibly through a block wrapper). Other inline expressions are
  // temporaries whose cleanup facts belong to the allocation/drop passes.
  const payload = named_union_payload(runtime_value.value);
  if (!payload) {
    return;
  }

  const callee = "union_case." + runtime_value.name;
  const payload_ownership = union_payload_ownership(
    payload,
    state,
  );
  if (!payload_ownership) {
    return;
  }

  if (
    payload_ownership.tag === "borrow_view" ||
    payload_ownership.tag === "scratch_backed"
  ) {
    let owner: string | undefined;

    if (payload.tag === "var") {
      owner = payload.name;
    }
    const message = "Runtime union payload for " + callee + " has " +
      payload_ownership.tag +
      " ownership without move or freeze/promotion facts";

    state.issues.push({
      tag: "invalid_union_payload_ownership",
      owner,
      callee,
      ownership: payload_ownership,
      message,
    });
    return;
  }

  if (payload_ownership.tag !== "unique_heap") {
    return;
  }

  if (
    payload_ownership.reason !== "runtime_aggregate" &&
    payload_ownership.reason !== "runtime_union" &&
    !(payload_ownership.reason === "closure" && runtime_value.resume_payload)
  ) {
    return;
  }

  if (payload.tag !== "var" && payload.tag !== "linear") {
    return;
  }

  if (!union_payload_transfers_owner(expr, payload_ownership, state)) {
    return;
  }

  record_transfer(
    payload.name,
    scope,
    callee,
    0,
    payload,
    state,
  );
}

function direct_union_payload_may_be_owner_transfer(expr: CoreExpr): boolean {
  if (expr.tag === "union_case") {
    if (!expr.value) {
      return false;
    }

    return direct_union_payload_ownership_form(expr.value);
  }

  if (expr.tag === "app" && expr.func.tag === "field") {
    const payload = expr.args[0];

    if (!payload) {
      return false;
    }

    return direct_union_payload_ownership_form(payload);
  }

  return true;
}

function direct_union_payload_ownership_form(payload: CoreExpr): boolean {
  return payload.tag === "var" || payload.tag === "linear" ||
    payload.tag === "borrow" ||
    payload.tag === "scratch" || payload.tag === "freeze" ||
    named_union_payload(payload) !== undefined;
}

function named_union_payload(
  payload: CoreExpr,
):
  | Extract<
    CoreExpr,
    { tag: "var" | "linear" | "borrow" | "scratch" | "freeze" }
  >
  | undefined {
  if (
    payload.tag === "var" || payload.tag === "linear" ||
    payload.tag === "borrow" ||
    payload.tag === "scratch" || payload.tag === "freeze"
  ) {
    return payload;
  }

  if (payload.tag !== "block") {
    return undefined;
  }

  const final_stmt = payload.statements[payload.statements.length - 1];
  if (!final_stmt) {
    return undefined;
  }

  if (final_stmt.tag === "expr") {
    return resolve_block_payload_alias(
      named_union_payload(final_stmt.expr),
      payload,
    );
  }

  if (final_stmt.tag === "return") {
    return resolve_block_payload_alias(
      named_union_payload(final_stmt.value),
      payload,
    );
  }

  return undefined;
}

function resolve_block_payload_alias(
  result: ReturnType<typeof named_union_payload>,
  block: Extract<CoreExpr, { tag: "block" }>,
): ReturnType<typeof named_union_payload> {
  if (!result || (result.tag !== "var" && result.tag !== "linear")) {
    return result;
  }

  const aliases = new Map<string, string>();
  for (const stmt of block.statements) {
    if (
      stmt.tag !== "bind" ||
      (stmt.value.tag !== "var" && stmt.value.tag !== "linear")
    ) {
      continue;
    }
    aliases.set(stmt.name, stmt.value.name);
  }

  const seen = new Set<string>();
  let name = result.name;
  while (aliases.has(name)) {
    if (seen.has(name)) {
      throw new Error("Recursive runtime union payload alias: " + name);
    }
    seen.add(name);
    const next = aliases.get(name);
    if (!next) {
      throw new Error("Missing runtime union payload alias target: " + name);
    }
    name = next;
  }

  return { tag: "var", name };
}

function union_payload_transfers_owner<ctx>(
  expr: CoreExpr,
  payload_ownership: CoreOwnership,
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

  if (payload_ownership.tag !== "unique_heap") {
    return false;
  }

  if (
    payload_ownership.reason === "runtime_aggregate" ||
    payload_ownership.reason === "runtime_union"
  ) {
    return true;
  }

  return payload_ownership.reason === "closure" &&
    runtime_value.resume_payload === true;
}

function union_payload_ownership<ctx>(
  payload: CoreExpr,
  state: CoreTransferState<ctx>,
): CoreOwnership | undefined {
  if (payload.tag === "var" || payload.tag === "linear") {
    const ownership = state.alias_ownership.get(payload.name);

    if (ownership) {
      return ownership;
    }
  }

  try {
    return core_expr_ownership(payload, state.ctx, state.hooks);
  } catch {
    return undefined;
  }
}
