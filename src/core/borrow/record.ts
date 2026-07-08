import type { CoreExpr } from "../ast.ts";
import {
  core_borrow_lifetime_decision,
  type CoreLifetimeDecision,
} from "../lifetime.ts";
import {
  core_expr_ownership,
  core_ownership_result_text,
  type CoreOwnership,
} from "../ownership.ts";
import {
  bind_stored_borrow_view_alias,
  borrow_owner_names_with_aliases,
  clear_borrow_alias,
  field_owner_for_borrow_value,
  resolve_borrow_alias_expr,
} from "./aliases.ts";
import type {
  CoreBorrowAliases,
  CoreBorrowHooks,
  CoreBorrowState,
  CoreBorrowUse,
  CoreRecordedBorrow,
} from "./types.ts";

export type ScanBorrowExpr<ctx> = (
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  parent: string,
  state: CoreBorrowState,
  use: CoreBorrowUse,
  aliases: CoreBorrowAliases,
) => void;

export function record_borrow_expr_with_scan<ctx>(
  expr: Extract<CoreExpr, { tag: "borrow" }>,
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  parent: string,
  state: CoreBorrowState,
  use: CoreBorrowUse,
  aliases: CoreBorrowAliases,
  scan_expr: ScanBorrowExpr<ctx>,
): CoreRecordedBorrow {
  const value = resolve_borrow_alias_expr(expr.value, aliases);
  const field_owner = field_owner_for_borrow_value(expr.value, aliases);
  let ownership: CoreOwnership;

  if (field_owner) {
    ownership = field_owner.ownership;
  } else {
    ownership = core_expr_ownership(value, ctx, hooks);
  }

  const id = "borrow#" + state.next_borrow.toString();
  state.next_borrow += 1;
  const decision = core_borrow_decision(ownership, use, parent);
  state.edges.push({
    id,
    source_scope: parent,
    target_scope: parent,
    ownership,
    decision,
  });
  const owners = borrow_owner_names_with_aliases(expr.value, aliases);
  if (
    owners.length > 0 && ownership.tag === "unique_heap" &&
    decision.tag === "allowed" && use === "bounded"
  ) {
    for (const owner of owners) {
      state.active_borrows.push({
        id,
        owner,
        scope: parent,
      });
    }
  }
  scan_expr(
    expr.value,
    ctx,
    hooks,
    parent,
    state,
    "bounded",
    aliases,
  );
  return {
    id,
    owners,
    scope: parent,
    ownership,
    decision,
  };
}

function core_borrow_decision(
  ownership: CoreOwnership,
  use: CoreBorrowUse,
  scope: string,
): CoreLifetimeDecision {
  const decision = core_borrow_lifetime_decision(ownership);

  if (decision.tag === "allowed") {
    return decision;
  }

  if (ownership.tag === "unique_heap" && use === "bounded") {
    return {
      tag: "allowed",
      reason: "borrow over " + core_ownership_result_text(ownership) +
        " is bounded to " + scope,
    };
  }

  return decision;
}

export function update_borrow_alias_from_record(
  name: string,
  recorded: CoreRecordedBorrow,
  aliases: CoreBorrowAliases,
): void {
  if (
    recorded.owners.length > 0 && recorded.ownership.tag === "unique_heap" &&
    recorded.decision.tag === "allowed"
  ) {
    bind_stored_borrow_view_alias(name, {
      owners: recorded.owners,
      borrow_id: recorded.id,
      scope: recorded.scope,
      ownership: recorded.ownership,
    }, aliases);
    return;
  }

  clear_borrow_alias(name, aliases);
}
