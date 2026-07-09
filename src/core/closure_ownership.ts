import { empty_closure_ownership_facts } from "./closure_ownership/facts.ts";
import { scan_closure_ownership_stmts } from "./closure_ownership/scan.ts";
export type {
  CoreClosureCaptureDecision,
  CoreClosureCaptureSlot,
  CoreClosureOwnershipCtx,
  CoreClosureOwnershipEdge,
  CoreClosureOwnershipFacts,
  CoreClosureOwnershipHooks,
  CoreClosureOwnershipPlan,
  CoreClosureOwnershipState,
} from "./closure_ownership/types.ts";
import type {
  CoreClosureOwnershipCtx,
  CoreClosureOwnershipHooks,
  CoreClosureOwnershipPlan,
  CoreClosureOwnershipState,
} from "./closure_ownership/types.ts";
import type { Core } from "./ast.ts";

export function core_closure_ownership_plan<
  ctx extends CoreClosureOwnershipCtx,
>(
  core: Core,
  ctx: ctx,
  hooks: CoreClosureOwnershipHooks<ctx>,
): CoreClosureOwnershipPlan {
  const state: CoreClosureOwnershipState = {
    next_block: 0,
    edges: [],
  };

  scan_closure_ownership_stmts(
    core.statements,
    "program#0",
    ctx,
    empty_closure_ownership_facts(),
    hooks,
    state,
  );

  return { edges: state.edges };
}
