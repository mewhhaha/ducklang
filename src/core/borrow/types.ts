import type { CoreExpr, CoreHostImport } from "../ast.ts";
import type { CoreCleanupExitEdge } from "../cleanup.ts";
import type { CoreLifetimeDecision } from "../lifetime.ts";
import type { CoreOwnership, CoreOwnershipHooks } from "../ownership.ts";

export type CoreBorrowEdge = {
  id: string;
  source_scope: string;
  target_scope: string;
  ownership: CoreOwnership;
  decision: CoreLifetimeDecision;
};

export type CoreBorrowBarrierAction =
  | "assign"
  | "freeze"
  | "index_assign"
  | "transfer";

export type CoreBorrowBarrier = {
  scope: string;
  owner: string;
  action: CoreBorrowBarrierAction;
  borrow_id: string;
  message: string;
};

export type CoreBorrowSkippedClosure = {
  scope: string;
  reason: string;
};

export type CoreBorrowPlan = {
  edges: CoreBorrowEdge[];
  barriers: CoreBorrowBarrier[];
  skipped_closures: CoreBorrowSkippedClosure[];
};

export type CoreBorrowValidationIssue =
  | {
    tag: "rejected_borrow";
    edge: CoreBorrowEdge;
    message: string;
  }
  | {
    tag: "skipped_closure";
    scope: string;
    message: string;
  }
  | {
    tag: "borrowed_owner_barrier";
    barrier: CoreBorrowBarrier;
    message: string;
  };

export type CoreBorrowValidation = {
  ok: boolean;
  issues: CoreBorrowValidationIssue[];
};

export type CoreBorrowClosureCtx<ctx> =
  | {
    tag: "scan";
    ctx: ctx;
  }
  | {
    tag: "skip";
    reason: string;
  };

export type CoreBorrowHooks<ctx> = CoreOwnershipHooks<ctx> & {
  closure_body_ctx: (
    expr: Extract<CoreExpr, { tag: "lam" | "rec" }>,
    ctx: ctx,
  ) => CoreBorrowClosureCtx<ctx>;
  host_import_for_app?: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    ctx: ctx,
  ) => CoreHostImport | undefined;
  static_core_call_value: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    ctx: ctx,
  ) => CoreExpr | undefined;
  static_value: (name: string, ctx: ctx) => CoreExpr | undefined;
};

export type CoreBorrowScope =
  | {
    id: string;
    kind: "program" | "block" | "loop" | "function_call" | "closure";
  }
  | {
    id: string;
    kind: "scratch";
    exit_edges: CoreCleanupExitEdge[];
  };

export type CoreBorrowScopeKind = CoreBorrowScope["kind"];

export type CoreBorrowState = {
  next_program: number;
  next_block: number;
  next_loop: number;
  next_function_call: number;
  next_closure: number;
  next_scratch: number;
  next_borrow: number;
  edges: CoreBorrowEdge[];
  barriers: CoreBorrowBarrier[];
  skipped_closures: CoreBorrowSkippedClosure[];
  active_borrows: CoreActiveBorrow[];
  scope_parents: Map<string, string | undefined>;
};

export type CoreBorrowUse = "bounded" | "escaping";

export type CoreActiveBorrow = {
  id: string;
  owner: string;
  scope: string;
};

export type CoreStoredBorrowView = {
  owners: string[];
  borrow_id: string;
  scope: string;
  iteration_scope: string | undefined;
  ownership: CoreOwnership;
};

export type CoreFieldBorrowOwner = {
  owners: string[];
  iteration_scope: string | undefined;
  ownership: CoreOwnership;
};

export type CoreStoredBorrowViewResult = {
  view: CoreStoredBorrowView | undefined;
  scanned: boolean;
};

export type CoreBorrowAliases = {
  owners: Map<string, string>;
  field_owners: Map<string, CoreFieldBorrowOwner>;
  views: Map<string, CoreStoredBorrowView>;
  union_types: Map<string, string>;
  known: Set<string>;
  assigned: Set<string>;
};

export type CoreRecordedBorrow = {
  id: string;
  owners: string[];
  scope: string;
  iteration_scope: string | undefined;
  ownership: CoreOwnership;
  decision: CoreLifetimeDecision;
};
