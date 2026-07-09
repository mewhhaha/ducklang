import type {
  CoreExpr,
  CoreField,
  CoreFnType,
  CoreHostImport,
  CoreParam,
  CoreStmt,
} from "../ast.ts";
import type { CoreStorageClass } from "../escape.ts";
import type {
  CoreAllocationByteSize,
  CoreAllocationLayout,
  CoreAllocationOwnedChild,
} from "../allocation.ts";
import type { CoreOwnership, CoreOwnershipHooks } from "../ownership.ts";

export type CoreDropEdge =
  | "scope_exit"
  | "return_exit"
  | "break_exit"
  | "continue_exit"
  | "conditional_cleanup"
  | "loop_zero_iteration_cleanup"
  | "assignment_replace"
  | "discarded_expr";

export type CoreDropRuntime = "reusable_free_list_allocator";

export type CoreUniqueHeapOwnership = Extract<
  CoreOwnership,
  { tag: "unique_heap" }
>;

export type CoreDropStep =
  | {
    tag: "heap_drop";
    id: string;
    edge: CoreDropEdge;
    scope: string;
    owner: string | undefined;
    ownership: CoreUniqueHeapOwnership;
    storage: CoreStorageClass;
    runtime: CoreDropRuntime;
    reason: string;
    allocation_id?: string;
    allocation_ids?: string[];
    byte_size?: CoreAllocationByteSize;
    alignment?: 4 | 8;
    layout?: CoreAllocationLayout;
    owned_children?: CoreAllocationOwnedChild[];
  }
  | {
    tag: "host_transfer";
    id: string;
    edge: "host_transfer";
    scope: string;
    callee: string;
    argument: number;
    owner: string | undefined;
    ownership: CoreUniqueHeapOwnership;
    storage: CoreStorageClass;
    runtime: "host_owned";
    reason: string;
    allocation_id?: undefined;
    allocation_ids?: undefined;
    byte_size?: undefined;
    alignment?: undefined;
    layout?: undefined;
    owned_children?: undefined;
  };

export type CoreDropPlan = {
  steps: CoreDropStep[];
};

export type CoreDropOwner = {
  name: string;
  ownership: CoreUniqueHeapOwnership;
};

export type CoreDropHooks<ctx> =
  & Omit<CoreOwnershipHooks<ctx>, "if_let_branch_ctx">
  & {
    block_ctx: (ctx: ctx) => ctx;
    closure_body_ctx?: (
      expr: Extract<CoreExpr, { tag: "lam" | "rec" }>,
      ctx: ctx,
    ) => ctx | undefined;
    collection_loop_body_ctx?: (
      stmt: Extract<CoreStmt, { tag: "collection_loop" }>,
      ctx: ctx,
    ) => CoreDropLoopBodyCtx<ctx>;
    if_let_branch_ctx?: (
      case_name: string,
      value_name: string | undefined,
      target: CoreExpr,
      ctx: ctx,
    ) => CoreDropIfLetBranchCtx<ctx>;
    collect_stmt_locals: (stmt: CoreStmt, ctx: ctx) => void;
    static_core_call_requires_scope?: (
      target: Extract<CoreExpr, { tag: "lam" }>,
    ) => boolean;
    static_core_call_target?: (
      expr: CoreExpr,
      ctx: ctx,
    ) => Extract<CoreExpr, { tag: "lam" }> | undefined;
    static_value: (expr: CoreExpr, ctx: ctx) => CoreExpr | undefined;
  };

export type CoreDropIfLetBranchCtx<ctx> =
  | { tag: "scan"; ctx: ctx }
  | { tag: "skip" }
  | { tag: "unknown" };

export type CoreDropLoopBodyCtx<ctx> =
  | { tag: "scan"; ctx: ctx }
  | { tag: "skip" };

export type CoreDropState = {
  next_drop: number;
  next_transfer: number;
  next_block: number;
  next_closure: number;
  next_loop: number;
  final_escape: CoreDropFinalEscape;
  steps: CoreDropStep[];
  expr_results: Map<CoreExpr, CoreDropExprResult>;
  functions: Map<string, StaticDropFunction>;
  aliases: Map<string, string>;
  temporary_aliases: Map<string, CoreUniqueHeapOwnership>;
  active_functions: Set<string>;
};

export type CoreDropFinalEscape = "typed" | "named_only";

export type CoreDropExitOwners = {
  return_owners: CoreDropOwner[];
  break_owners: CoreDropOwner[];
  continue_owners: CoreDropOwner[];
};

export type CoreDropBranchResult = {
  continues: boolean;
  owners: Map<string, CoreDropOwner>;
};

export type CoreDropExprResult =
  | { tag: "none" }
  | { tag: "owner"; owner: CoreDropOwner }
  | { tag: "branch"; branches: CoreDropExprBranchResult[] };

export type CoreDropExprBranchResult = {
  scope: string;
  continues: boolean;
  owners: Map<string, CoreDropOwner>;
  result: CoreDropExprResult | undefined;
};

export type StaticDropCallTransferBody =
  | { tag: "expr"; expr: CoreExpr; scope_suffix: string }
  | { tag: "block"; statements: CoreStmt[]; scope_suffix: string };

export type StaticDropFunction =
  | { tag: "lam"; value: Extract<CoreExpr, { tag: "lam" }> }
  | { tag: "rec"; value: Extract<CoreExpr, { tag: "rec" }> }
  | {
    tag: "branch";
    kind: "if" | "if_let";
    then_target: StaticDropFunction;
    else_target: StaticDropFunction;
  };

export type StaticDropCallBinding =
  | { tag: "owner"; owner: string }
  | { tag: "temporary"; ownership: CoreUniqueHeapOwnership };

export type {
  CoreExpr,
  CoreField,
  CoreFnType,
  CoreHostImport,
  CoreParam,
  CoreStmt,
};
