import type { CoreBorrowBarrierAction, CoreBorrowState } from "./types.ts";

export function check_borrowed_owner_barriers(
  owners: string[],
  action: CoreBorrowBarrierAction,
  scope: string,
  state: CoreBorrowState,
): void {
  for (const owner of owners) {
    check_borrowed_owner_barrier(owner, action, scope, state);
  }
}

function check_borrowed_owner_barrier(
  owner: string,
  action: CoreBorrowBarrierAction,
  scope: string,
  state: CoreBorrowState,
): void {
  for (const active of state.active_borrows) {
    if (active.owner !== owner) {
      continue;
    }

    if (!scope_is_within(scope, active.scope, state)) {
      continue;
    }

    state.barriers.push({
      scope,
      owner,
      action,
      borrow_id: active.id,
      message: "Cannot " + borrow_barrier_action_text(action) +
        " borrowed owner " + owner + " in " + scope + " while " +
        active.id + " is active",
    });
  }
}

function scope_is_within(
  scope: string,
  ancestor: string,
  state: CoreBorrowState,
): boolean {
  let current: string | undefined = scope;

  while (current) {
    if (current === ancestor) {
      return true;
    }

    current = state.scope_parents.get(current);
  }

  return false;
}

function borrow_barrier_action_text(action: CoreBorrowBarrierAction): string {
  switch (action) {
    case "assign":
      return "move or replace";

    case "freeze":
      return "freeze";

    case "index_assign":
      return "mutate";

    case "transfer":
      return "transfer";
  }
}

export function owner_list_text(owners: string[]): string {
  if (owners.length === 0) {
    return "<unknown>";
  }

  return owners.join(", ");
}
