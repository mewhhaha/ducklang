import type { FrontExpr } from "../ast.ts";
import {
  clone_linear_closures,
  type LinearClosureBinding,
  type LinearClosureEnv,
} from "../linear_closure.ts";
import { same_name_set, same_names } from "../linear_state.ts";
import type {
  LinearBranch,
  LinearExprConsume,
  LinearExprHooks,
  LinearUseMode,
} from "./types.ts";

export function consume_linear_condition_with_consumer(
  expr: FrontExpr,
  available: Set<string>,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
  hooks: LinearExprHooks,
  consume_linear_expr: LinearExprConsume,
): void {
  const condition_available = new Set(available);
  consume_linear_expr(
    expr,
    condition_available,
    "discard",
    clone_linear_closures(closures),
    new Set(active_calls),
    hooks,
  );
}

export function consume_linear_branch_with_consumer(
  expr: FrontExpr,
  available: Set<string>,
  mode: LinearUseMode,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
  hooks: LinearExprHooks,
  consume_linear_expr: LinearExprConsume,
): LinearBranch {
  const branch_available = new Set(available);
  const branch_closures = clone_linear_closures(closures);
  const branch_consumed = consume_linear_expr(
    expr,
    branch_available,
    mode,
    branch_closures,
    new Set(active_calls),
    hooks,
  );
  return {
    available: branch_available,
    consumed: branch_consumed,
    used_closures: new Set(branch_closures.used),
  };
}

export function merge_linear_branches(
  available: Set<string>,
  consumed: string[],
  closures: LinearClosureEnv,
  left: LinearBranch,
  right: LinearBranch,
): void {
  if (!same_names(left.consumed, right.consumed)) {
    throw new Error("Linear branches must consume the same values");
  }

  if (!same_name_set(left.available, right.available)) {
    throw new Error("Linear branches must leave the same available values");
  }

  if (
    !same_linear_closure_binding_set(
      left.used_closures,
      right.used_closures,
    )
  ) {
    throw new Error("Linear branches must consume the same closures");
  }

  available.clear();

  for (const name of left.available) {
    available.add(name);
  }

  for (const name of left.consumed) {
    if (!consumed.includes(name)) {
      consumed.push(name);
    }
  }

  for (const id of left.used_closures) {
    closures.used.add(id);
  }
}

function same_linear_closure_binding_set(
  left: Set<LinearClosureBinding>,
  right: Set<LinearClosureBinding>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const binding of left) {
    if (!right.has(binding)) {
      return false;
    }
  }

  return true;
}
