import type { Ic as IcNode } from "../ic.ts";
import type { Env, FrontExpr, FrontType } from "./ast.ts";

export type FrontTypedLowerHooks = {
  infer_expr: (expr: FrontExpr, env: Env) => FrontType;
  lower_app_as_front_type?: (
    expr: Extract<FrontExpr, { tag: "app" }>,
    type: FrontType,
    env: Env,
  ) => IcNode | undefined;
  lower_expr: (expr: FrontExpr, env: Env) => IcNode;
  resolve_annotation_type?: (
    annotation: string,
    env: Env,
  ) => FrontType | undefined;
};

export type LowerExprAsFrontType = (
  expr: FrontExpr,
  type: FrontType,
  env: Env,
  hooks: FrontTypedLowerHooks,
) => IcNode;

export type TypedFrontExpr = {
  value: FrontExpr;
  type: FrontType;
};
