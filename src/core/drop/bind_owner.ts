import type { CoreExpr } from "../ast.ts";
import {
  frozen_expr_consumed_owner,
  moved_expr_owner,
  unique_heap_ownership,
} from "./ownership.ts";
import type { CoreDropHooks, CoreDropOwner, CoreDropState } from "./types.ts";

export function bind_drop_owner<ctx>(
  name: string,
  expr: CoreExpr,
  owners: Map<string, CoreDropOwner>,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
): void {
  const expr_result = state.expr_results.get(expr);
  if (expr_result && expr_result.tag === "branch") {
    const ownership = unique_heap_ownership(expr, ctx, hooks);
    if (ownership) {
      owners.set(name, {
        name,
        ownership,
        pointer: "named",
        subject: expr,
      });
      return;
    }

    owners.delete(name);
    return;
  }

  if (expr_result && expr_result.tag === "none") {
    owners.delete(name);
    return;
  }

  const frozen_owner = frozen_expr_consumed_owner(expr, owners, state);

  if (frozen_owner) {
    owners.delete(frozen_owner.name);
    owners.delete(name);
    return;
  }

  if (expr.tag === "freeze") {
    owners.delete(name);
    return;
  }

  const moved_owner = moved_expr_owner(expr, owners, state);

  if (moved_owner) {
    owners.delete(moved_owner.name);
    owners.set(name, {
      name,
      ownership: moved_owner.ownership,
      pointer: moved_owner.pointer,
      subject: moved_owner.subject,
    });
    return;
  }

  const ownership = unique_heap_ownership(expr, ctx, hooks);

  if (ownership) {
    owners.set(name, {
      name,
      ownership,
      pointer: "named",
      subject: expr,
    });
    return;
  }

  owners.delete(name);
}
