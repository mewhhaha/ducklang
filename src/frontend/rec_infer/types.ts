import type { Env, FrontExpr, FrontType } from "../ast.ts";
import type { StaticRecHooks } from "../rec_hooks.ts";

export type RecExprInfer = (
  expr: FrontExpr,
  env: Env,
  hooks: StaticRecHooks,
) => FrontType;
