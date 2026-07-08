import type { CoreExpr } from "../ast.ts";
import type {
  CoreDropExitOwners,
  CoreDropOwner,
  CoreDropState,
} from "./types.ts";

export function clone_drop_owners(
  owners: Map<string, CoreDropOwner>,
): Map<string, CoreDropOwner> {
  const cloned = new Map<string, CoreDropOwner>();

  for (const [name, owner] of owners) {
    cloned.set(name, {
      name: owner.name,
      ownership: owner.ownership,
    });
  }

  return cloned;
}

export function empty_exit_owners(): CoreDropExitOwners {
  return {
    return_owners: [],
    break_owners: [],
    continue_owners: [],
  };
}

export function child_exit_owners(
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
): CoreDropExitOwners {
  const local_owners = Array.from(owners.values());

  return {
    return_owners: exit_owners.return_owners.concat(local_owners),
    break_owners: exit_owners.break_owners.concat(local_owners),
    continue_owners: exit_owners.continue_owners.concat(local_owners),
  };
}

export function loop_exit_owners(
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
): CoreDropExitOwners {
  return {
    return_owners: exit_owners.return_owners.concat(
      Array.from(owners.values()),
    ),
    break_owners: [],
    continue_owners: [],
  };
}

export function returned_owner_name(expr: CoreExpr): string | undefined {
  if (expr.tag === "var") {
    return expr.name;
  }

  return undefined;
}

export function next_block_scope(state: CoreDropState): string {
  const scope = "block#" + state.next_block.toString();
  state.next_block += 1;
  return scope;
}

export function next_loop_scope(state: CoreDropState): string {
  const scope = "loop#" + state.next_loop.toString();
  state.next_loop += 1;
  return scope;
}

export function next_closure_scope(state: CoreDropState): string {
  const scope = "closure#" + state.next_closure.toString();
  state.next_closure += 1;
  return scope;
}

export function resolve_drop_owner(
  owner: string,
  state: CoreDropState,
): string {
  const seen = new Set<string>();
  let current = owner;

  while (true) {
    if (seen.has(current)) {
      return current;
    }

    seen.add(current);
    const next = state.aliases.get(current);

    if (!next) {
      return current;
    }

    current = next;
  }
}
