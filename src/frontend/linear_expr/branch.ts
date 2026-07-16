import type { FrontExpr } from "../ast.ts";
import {
  clone_linear_closures,
  type LinearClosureBinding,
  type LinearClosureEnv,
} from "../linear_closure.ts";
import {
  linear_binding_related,
  type LinearRelatedSubject,
  same_name_set,
  same_names,
  throw_linear_diagnostic,
} from "../linear_state.ts";
import type { LinearState } from "../linear_state.ts";
import type {
  LinearBranch,
  LinearExprConsume,
  LinearExprHooks,
  LinearUseMode,
} from "./types.ts";

export function consume_linear_condition_with_consumer(
  expr: FrontExpr,
  available: LinearState,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
  hooks: LinearExprHooks,
  consume_linear_expr: LinearExprConsume,
): void {
  const condition_available = available.clone();
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
  available: LinearState,
  mode: LinearUseMode,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
  hooks: LinearExprHooks,
  consume_linear_expr: LinearExprConsume,
): LinearBranch {
  const branch_available = available.clone();
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
    closure_consumes: new Map(branch_closures.consumed_at),
  };
}

export function merge_linear_branches(
  subject: FrontExpr,
  available: LinearState,
  consumed: string[],
  closures: LinearClosureEnv,
  left: LinearBranch,
  right: LinearBranch,
): void {
  if (!same_names(left.consumed, right.consumed)) {
    throw_linear_diagnostic(
      "DUCK2205",
      "Linear branches must consume the same values",
      subject,
      branch_mismatch_related(left, right),
    );
  }

  if (!same_name_set(left.available, right.available)) {
    throw_linear_diagnostic(
      "DUCK2205",
      "Linear branches must leave the same available values",
      subject,
      branch_mismatch_related(left, right),
    );
  }

  if (
    !same_linear_closure_binding_set(
      left.used_closures,
      right.used_closures,
    )
  ) {
    throw_linear_diagnostic(
      "DUCK2205",
      "Linear branches must consume the same closures",
      subject,
      closure_branch_mismatch_related(closures, left, right),
    );
  }

  available.replace_with(left.available);

  for (const name of left.consumed) {
    if (!consumed.includes(name)) {
      consumed.push(name);
    }
  }

  for (const id of left.used_closures) {
    closures.used.add(id);

    const consumed_at = left.closure_consumes.get(id);

    if (consumed_at) {
      closures.consumed_at.set(id, consumed_at);
    }
  }
}

function closure_branch_mismatch_related(
  closures: LinearClosureEnv,
  left: LinearBranch,
  right: LinearBranch,
): LinearRelatedSubject[] {
  const bindings = new Set([
    ...left.used_closures,
    ...right.used_closures,
  ]);

  for (const binding of bindings) {
    const used_left = left.used_closures.has(binding);
    const used_right = right.used_closures.has(binding);

    if (used_left === used_right) {
      continue;
    }

    const related: LinearRelatedSubject[] = [];
    let consumed_at = left.closure_consumes.get(binding);

    if (!consumed_at) {
      consumed_at = right.closure_consumes.get(binding);
    }

    if (consumed_at) {
      related.push({
        message: "Linear closure consumed on this branch",
        subject: consumed_at,
      });
    }

    for (const [name, declaration] of closures.declarations) {
      if (closures.get(name) === binding) {
        related.push({
          message: "Linear closure declared here",
          subject: declaration,
        });
        break;
      }
    }

    return related;
  }

  return [];
}

function branch_mismatch_related(
  left: LinearBranch,
  right: LinearBranch,
): LinearRelatedSubject[] {
  const names = new Set([...left.consumed, ...right.consumed]);

  for (const name of names) {
    const left_consumed = left.consumed.includes(name);
    const right_consumed = right.consumed.includes(name);

    if (left_consumed !== right_consumed) {
      const left_related = linear_binding_related(left.available, name);

      if (left_related.length > 0) {
        return left_related;
      }

      return linear_binding_related(right.available, name);
    }
  }

  for (const name of left.available) {
    if (!right.available.has(name)) {
      return linear_binding_related(left.available, name);
    }
  }

  for (const name of right.available) {
    if (!left.available.has(name)) {
      return linear_binding_related(right.available, name);
    }
  }

  return [];
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
