import type { CoreExpr, CoreStmt } from "../ast.ts";
import type { CoreAllocationPlan } from "../allocation.ts";
import type {
  CoreBorrowValidation,
  CoreBorrowValidationIssue,
} from "../borrow.ts";
import type { CoreCleanupPlan, CoreCleanupStep } from "../cleanup.ts";
import type {
  CoreClosureOwnershipEdge,
  CoreClosureOwnershipPlan,
} from "../closure_ownership.ts";
import type { CoreDropPlan } from "../drop.ts";
import type { CoreEscapeAnalysis } from "../escape.ts";
import type {
  CoreHostBoundaryEdge,
  CoreHostBoundaryPlan,
} from "../host_boundary.ts";
import type { CoreLifetimePlan } from "../lifetime_scope.ts";
import type { CoreTransferValidationIssue } from "../transfer.ts";
import type { CoreTransferValidation } from "../transfer.ts";
import type { CoreFreezeProofEdge } from "./freeze.ts";

export type CoreBaselineTarget = "core-3-nonweb";

export type CoreUnsupportedCodegenIssue = {
  tag: "unsupported_codegen";
  node: "stmt" | "expr";
  feature: string;
  message: string;
};

export type CoreUnsupportedCodegenHooks = {
  collection_loop_supported: (
    stmt: Extract<CoreStmt, { tag: "collection_loop" }>,
  ) => boolean;
  index_assign_supported: (
    stmt: Extract<CoreStmt, { tag: "index_assign" }>,
  ) => boolean;
  type_value_expr: (expr: CoreExpr) => boolean;
  if_let_expr_supported: (
    expr: Extract<CoreExpr, { tag: "if_let" }>,
  ) => boolean;
  if_let_stmt_supported: (
    stmt: Extract<CoreStmt, { tag: "if_let_stmt" }>,
  ) => boolean;
  index_expr_supported: (
    expr: Extract<CoreExpr, { tag: "index" }>,
  ) => boolean;
};

export type CoreProofIssue =
  | {
    tag: "borrow";
    issue: CoreBorrowValidationIssue;
    message: string;
  }
  | {
    tag: "freeze";
    edge: CoreFreezeProofEdge;
    message: string;
  }
  | {
    tag: "scratch_return";
    step: CoreCleanupStep;
    message: string;
  }
  | {
    tag: "final_result";
    analysis: CoreEscapeAnalysis;
    message: string;
  }
  | {
    tag: "host_boundary";
    edge: CoreHostBoundaryEdge;
    message: string;
  }
  | {
    tag: "closure_capture";
    edge: CoreClosureOwnershipEdge;
    message: string;
  }
  | {
    tag: "transfer";
    issue: CoreTransferValidationIssue;
    message: string;
  }
  | {
    tag: "unsupported_codegen";
    issue: CoreUnsupportedCodegenIssue;
    message: string;
  };

export type CoreBaselineProof = {
  target: CoreBaselineTarget;
  managed_storage: "disabled";
  ok: boolean;
  final_result: CoreEscapeAnalysis;
  borrows: CoreBorrowValidation;
  freeze_edges: CoreFreezeProofEdge[];
  cleanup: CoreCleanupPlan;
  closure_ownership: CoreClosureOwnershipPlan;
  drops: CoreDropPlan;
  allocations: CoreAllocationPlan;
  host_boundaries: CoreHostBoundaryPlan;
  transfers: CoreTransferValidation;
  lifetimes: CoreLifetimePlan;
  issues: CoreProofIssue[];
};

export type CoreBaselineProofInput = {
  final_result: CoreEscapeAnalysis;
  borrows: CoreBorrowValidation;
  freeze_edges: CoreFreezeProofEdge[];
  cleanup: CoreCleanupPlan;
  closure_ownership: CoreClosureOwnershipPlan;
  drops: CoreDropPlan;
  allocations: CoreAllocationPlan;
  host_boundaries: CoreHostBoundaryPlan;
  transfers: CoreTransferValidation;
  lifetimes: CoreLifetimePlan;
  unsupported_codegen: CoreUnsupportedCodegenIssue[];
};
