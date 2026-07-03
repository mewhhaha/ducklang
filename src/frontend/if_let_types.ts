import type { Ic as IcNode } from "../ic.ts";
import type { ValType } from "../op.ts";
import type { Env, FrontExpr, FrontType, TypeField } from "./ast.ts";
import type { IfLetTargetHooks } from "./if_let_target.ts";

export type ResolvedUnionValue = {
  expr: Extract<FrontExpr, { tag: "union_case" }>;
  env: Env;
};

export type ResolvedStructValue = {
  expr: Extract<FrontExpr, { tag: "struct_value" }>;
  env: Env;
};

export type IfLetHooks = IfLetTargetHooks & {
  infer_expr: (expr: FrontExpr, env: Env) => FrontType;
  infer_union_cases: (expr: FrontExpr, env: Env) => TypeField[] | undefined;
  lower_expr: (expr: FrontExpr, env: Env) => IcNode;
  lower_struct_value: (
    expr: Extract<FrontExpr, { tag: "struct_value" }>,
    env: Env,
  ) => IcNode;
  resolve_dynamic_if_let_struct_value: (
    expr: Extract<FrontExpr, { tag: "if_let" }>,
    env: Env,
  ) => ResolvedStructValue | undefined;
  resolve_numeric_expr_type: (
    expr: FrontExpr,
    env: Env,
  ) => ValType | undefined;
  resolve_annotation_type: (
    annotation: string,
    env: Env,
  ) => FrontType | undefined;
  resolve_union_value: (
    expr: FrontExpr,
    env: Env,
  ) => ResolvedUnionValue | undefined;
};
