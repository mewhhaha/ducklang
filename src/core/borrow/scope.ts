import type { CoreCleanupExitEdge } from "../cleanup.ts";
import type {
  CoreBorrowScope,
  CoreBorrowScopeKind,
  CoreBorrowState,
} from "./types.ts";

export function add_scope(
  state: CoreBorrowState,
  kind: CoreBorrowScopeKind,
  exit_edges: CoreCleanupExitEdge[] | undefined,
  parent: string | undefined,
): CoreBorrowScope {
  const id = next_scope_id(state, kind);
  state.scope_parents.set(id, parent);

  if (kind === "scratch") {
    const scratch_edges = exit_edges_for_scratch(exit_edges);
    return {
      id,
      kind,
      exit_edges: scratch_edges,
    };
  }

  return {
    id,
    kind,
  };
}

function next_scope_id(
  state: CoreBorrowState,
  kind: CoreBorrowScopeKind,
): string {
  switch (kind) {
    case "program": {
      const id = "program#" + state.next_program.toString();
      state.next_program += 1;
      return id;
    }

    case "block": {
      const id = "block#" + state.next_block.toString();
      state.next_block += 1;
      return id;
    }

    case "loop": {
      const id = "loop#" + state.next_loop.toString();
      state.next_loop += 1;
      return id;
    }

    case "function_call": {
      const id = "function_call#" + state.next_function_call.toString();
      state.next_function_call += 1;
      return id;
    }

    case "closure": {
      const id = "closure#" + state.next_closure.toString();
      state.next_closure += 1;
      return id;
    }

    case "scratch": {
      const id = "scratch#" + state.next_scratch.toString();
      state.next_scratch += 1;
      return id;
    }
  }
}

function exit_edges_for_scratch(
  exit_edges: CoreCleanupExitEdge[] | undefined,
): CoreCleanupExitEdge[] {
  if (exit_edges) {
    return exit_edges;
  }

  return ["fallthrough"];
}
