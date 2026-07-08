import type { FrontExpr, Stmt } from "../ast.ts";
import type {
  LinearClosureBinding,
  LinearClosureEnv,
} from "../linear_closure.ts";

export type LinearUseMode = "assignment" | "bind" | "discard" | "final";

export type LinearExprHooks = {
  validate_linear_block: (
    stmts: Stmt[],
    available: Set<string>,
    closures: LinearClosureEnv,
    active_calls: Set<string>,
  ) => void;
};

export type LinearExprConsume = (
  expr: FrontExpr,
  available: Set<string>,
  mode: LinearUseMode,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
  hooks: LinearExprHooks,
) => string[];

export type LinearBranch = {
  available: Set<string>;
  consumed: string[];
  used_closures: Set<LinearClosureBinding>;
};
