import type { Env, FrontExpr, FrontType } from "../../ast.ts";
import type { StaticLoopHooks } from "../types.ts";

export type DynamicLoopBindingFallback = (
  name: string,
  type: FrontType,
  value: FrontExpr,
  env: Env,
  hooks: StaticLoopHooks,
) => FrontExpr;

export type DynamicLoopStructTarget = {
  expr: Extract<FrontExpr, { tag: "struct_value" }>;
  env: Env;
};

export type DynamicLoopUnionTarget = {
  expr: Extract<FrontExpr, { tag: "union_case" }>;
  env: Env;
};
