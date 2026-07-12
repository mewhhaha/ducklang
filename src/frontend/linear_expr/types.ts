import type { FrontExpr, Stmt } from "../ast.ts";
import type {
  LinearClosureBinding,
  LinearClosureEnv,
} from "../linear_closure.ts";
import type { LinearState } from "../linear_state.ts";

export type LinearUseMode = "assignment" | "bind" | "discard" | "final";

export type LinearExprHooks = {
  validate_linear_block: (
    stmts: Stmt[],
    available: LinearState,
    closures: LinearClosureEnv,
    active_calls: Set<string>,
  ) => void;
};

export type LinearExprConsume = (
  expr: FrontExpr,
  available: LinearState,
  mode: LinearUseMode,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
  hooks: LinearExprHooks,
) => string[];

export type LinearBranch = {
  available: LinearState;
  consumed: string[];
  used_closures: Set<LinearClosureBinding>;
  closure_consumes: Map<LinearClosureBinding, FrontExpr>;
};
