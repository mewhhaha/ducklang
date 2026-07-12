import type { Core } from "./ast.ts";
import { scan_drop_stmts } from "./drop/scan.ts";
import { top_level_drop_functions } from "./drop/static_function.ts";
import { empty_exit_owners } from "./drop/state.ts";
import type {
  CoreDropHooks,
  CoreDropOwner,
  CoreDropPlan,
  CoreDropState,
} from "./drop/types.ts";

export type {
  CoreDropEdge,
  CoreDropPlan,
  CoreDropRuntime,
  CoreDropStep,
  CoreUniqueHeapOwnership,
} from "./drop/types.ts";

export function core_drop_plan<ctx>(
  core: Core,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
): CoreDropPlan {
  const state: CoreDropState = {
    next_drop: 0,
    next_transfer: 0,
    next_block: 0,
    next_closure: 0,
    next_loop: 0,
    final_escape: "typed",
    steps: [],
    expr_results: new Map(),
    functions: top_level_drop_functions(core),
    aliases: new Map(),
    temporary_aliases: new Map(),
    consumed_temporary_subjects: new WeakSet(),
    static_aggregate_fields: new Map(),
    frozen_aggregate_owners: new Set(),
    frozen_text_owners: new Set(),
    active_functions: new Set(),
  };
  const owners = new Map<string, CoreDropOwner>();

  scan_drop_stmts(
    core.statements,
    "program#0",
    owners,
    empty_exit_owners(),
    ctx,
    hooks,
    state,
  );

  return { steps: state.steps };
}
