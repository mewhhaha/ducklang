import type { Ic as IcNode } from "../../ic.ts";
import type { Env, FrontExpr, FrontType, TypeField } from "../ast.ts";

export type ResolvedStructValue = {
  expr: Extract<FrontExpr, { tag: "struct_value" }>;
  env: Env;
};

export type ResolvedUnionValue = {
  expr: Extract<FrontExpr, { tag: "union_case" }>;
  env: Env;
};

export type DynamicBranchHooks = {
  infer_dynamic_if_let_cases: (
    expr: FrontExpr,
    env: Env,
  ) => TypeField[] | undefined;
  infer_dynamic_union_if_cases: (
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ) => TypeField[] | undefined;
  infer_expr: (expr: FrontExpr, env: Env) => FrontType;
  lower_expr: (expr: FrontExpr, env: Env) => IcNode;
  lower_struct_value: (
    expr: Extract<FrontExpr, { tag: "struct_value" }>,
    env: Env,
  ) => IcNode;
  lower_union_case_value: (
    expr: Extract<FrontExpr, { tag: "union_case" }>,
    env: Env,
  ) => IcNode;
  resolve_annotation_type: (
    annotation: string,
    env: Env,
  ) => FrontType | undefined;
  resolve_struct_type_value: (
    expr: FrontExpr,
    env: Env,
  ) => Extract<FrontExpr, { tag: "struct_type" }> | undefined;
  resolve_struct_value: (
    expr: FrontExpr,
    env: Env,
  ) => ResolvedStructValue | undefined;
  resolve_union_value: (
    expr: FrontExpr,
    env: Env,
  ) => ResolvedUnionValue | undefined;
};
