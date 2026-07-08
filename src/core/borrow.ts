import type { Core } from "./ast.ts";
import { add_scope } from "./borrow/scope.ts";
import { scan_borrow_stmts } from "./borrow/scan.ts";
import { empty_borrow_aliases } from "./borrow/aliases.ts";
import type {
  CoreBorrowHooks,
  CoreBorrowPlan,
  CoreBorrowState,
} from "./borrow/types.ts";

export {
  core_check_borrow_plan,
  core_validate_borrow_plan,
} from "./borrow/validate.ts";

export type {
  CoreBorrowBarrier,
  CoreBorrowBarrierAction,
  CoreBorrowClosureCtx,
  CoreBorrowEdge,
  CoreBorrowHooks,
  CoreBorrowPlan,
  CoreBorrowSkippedClosure,
  CoreBorrowValidation,
  CoreBorrowValidationIssue,
} from "./borrow/types.ts";

export function core_borrow_plan<ctx>(
  core: Core,
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
): CoreBorrowPlan {
  const state: CoreBorrowState = {
    next_program: 0,
    next_block: 0,
    next_loop: 0,
    next_function_call: 0,
    next_closure: 0,
    next_scratch: 0,
    next_borrow: 0,
    edges: [],
    barriers: [],
    skipped_closures: [],
    active_borrows: [],
    scope_parents: new Map(),
  };
  const program = add_scope(state, "program", undefined, undefined);

  scan_borrow_stmts(
    core.statements,
    ctx,
    hooks,
    program.id,
    state,
    "escaping",
    empty_borrow_aliases(),
  );

  return {
    edges: state.edges,
    barriers: state.barriers,
    skipped_closures: state.skipped_closures,
  };
}
