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
  environment?: {
    offset: number;
    storage: "unique_heap";
    lifetime?: "persistent";
    transfer: "move" | "share";
  };
};

export type CoreClosureOwnershipEdge = {
  id: string;
  scope: string;
  expression: "lam" | "rec";
  captures: CoreClosureCaptureSlot[];
  decision: CoreClosureCaptureDecision;
  callable?: "once";
  environment_storage?: "persistent_unique_heap";
};

export type CoreClosureOwnershipPlan = {
  edges: CoreClosureOwnershipEdge[];
};

export type CoreClosureOwnershipState = {
  next_block: number;
  edges: CoreClosureOwnershipEdge[];
};

export type CoreClosureOwnershipCtx = { statics: Map<string, CoreExpr> };

export type CoreClosureOwnershipHooks<ctx extends CoreClosureOwnershipCtx> =
  & CoreOwnershipHooks<ctx>
  & {
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
  linear_names: Set<string>;
  linear_ownerships: Map<string, CoreOwnership>;
};
