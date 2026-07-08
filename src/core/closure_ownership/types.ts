import type { CoreExpr, CoreStmt } from "../ast.ts";
import type { CoreCaptureInfo } from "../closure_capture.ts";
import type { CoreOwnership, CoreOwnershipHooks } from "../ownership.ts";

export type CoreClosureCaptureDecision =
  | {
    tag: "allowed";
    reason: string;
  }
  | {
    tag: "reserved";
    reason: string;
  };

export type CoreClosureCaptureSlot = {
  name: string;
  ownership: CoreOwnership;
  decision: CoreClosureCaptureDecision;
};

export type CoreClosureOwnershipEdge = {
  id: string;
  scope: string;
  expression: "lam" | "rec";
  captures: CoreClosureCaptureSlot[];
  decision: CoreClosureCaptureDecision;
};

export type CoreClosureOwnershipPlan = {
  edges: CoreClosureOwnershipEdge[];
};

export type CoreClosureOwnershipState = {
  next_block: number;
  edges: CoreClosureOwnershipEdge[];
};

export type CoreClosureOwnershipHooks<ctx> = CoreOwnershipHooks<ctx> & {
  block_ctx: (ctx: ctx) => ctx;
  collect_stmt_locals: (stmt: CoreStmt, ctx: ctx) => void;
  core_lam_capture_info: (
    expr: Extract<CoreExpr, { tag: "lam" }>,
    ctx: ctx,
  ) => CoreCaptureInfo;
};

export type CoreClosureOwnershipFacts = {
  borrow_views: Map<string, CoreOwnership>;
  scratch_locals: Map<string, CoreOwnership>;
  scratch_depth: number;
  direct_call_depth: number;
};
