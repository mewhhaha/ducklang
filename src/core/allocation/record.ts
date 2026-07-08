import type { CoreExpr } from "../ast.ts";
import { core_storage_class } from "../escape.ts";
import type {
  CoreOwnership,
  CoreOwnershipPointerReason,
} from "../ownership.ts";
import type {
  CoreAllocationReason,
  CoreAllocationScope,
  CoreAllocationState,
} from "./types.ts";

export function record_allocation(
  expr: CoreExpr,
  reason: CoreAllocationReason,
  scope: CoreAllocationScope,
  state: CoreAllocationState,
): void {
  const key = allocation_record_key(reason, scope);
  const recorded = state.recorded.get(expr);

  if (recorded) {
    if (recorded.has(key)) {
      return;
    }

    recorded.add(key);
  } else {
    state.recorded.set(expr, new Set([key]));
  }

  const base: CoreOwnership = {
    tag: "unique_heap",
    reason: ownership_reason(reason),
  };
  let ownership: CoreOwnership = base;

  if (scope.scratch && reason !== "closure") {
    ownership = { tag: "scratch_backed", source: base };
  }

  const fact = {
    id: "allocation#" + state.next_allocation.toString(),
    scope: scope.name,
    storage: core_storage_class(ownership),
    ownership,
    reason,
    expression: expr.tag,
  };
  state.next_allocation += 1;
  state.facts.push(fact);
}

function allocation_record_key(
  reason: CoreAllocationReason,
  scope: CoreAllocationScope,
): string {
  let scratch = "";

  if (scope.scratch) {
    scratch = scope.scratch;
  }

  return scope.name + "|" + scratch + "|" + reason;
}

function ownership_reason(
  reason: CoreAllocationReason,
): CoreOwnershipPointerReason {
  switch (reason) {
    case "closure":
      return "closure";

    case "runtime_aggregate":
      return "runtime_aggregate";

    case "runtime_text":
      return "text";

    case "runtime_union":
      return "runtime_union";
  }
}
