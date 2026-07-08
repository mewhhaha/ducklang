import type { Core } from "./ast.ts";
import { scan_allocation_stmts } from "./allocation/scan.ts";
import type {
  CoreAllocationHooks,
  CoreAllocationPlan,
  CoreAllocationState,
} from "./allocation/types.ts";

export type {
  CoreAllocationFact,
  CoreAllocationHooks,
  CoreAllocationPlan,
  CoreAllocationReason,
} from "./allocation/types.ts";

export function core_allocation_plan<ctx>(
  core: Core,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
): CoreAllocationPlan {
  const state: CoreAllocationState = {
    next_allocation: 0,
    next_block: 0,
    next_closure: 0,
    next_scratch: 0,
    facts: [],
    recorded: new WeakMap(),
  };

  scan_allocation_stmts(
    core.statements,
    { name: "program#0", scratch: undefined },
    ctx,
    hooks,
    state,
  );

  return { facts: state.facts };
}
