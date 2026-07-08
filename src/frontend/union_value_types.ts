import type { Env, FrontExpr, FrontType, ResolvedFrontExpr } from "./ast.ts";
import type { UnionCallInlineHooks } from "./union_call_inline.ts";

export type UnionValueHooks = UnionCallInlineHooks & {
  eval_simple_front_block: (
    expr: Extract<FrontExpr, { tag: "block" }>,
    env: Env,
  ) => FrontExpr | undefined;
  infer_expr: (expr: FrontExpr, env: Env) => FrontType;
  lower_expr: (expr: FrontExpr, env: Env) => import("../ic.ts").Ic;
  resolve_const_expr: (expr: FrontExpr, env: Env) => FrontExpr | undefined;
  resolve_extended_type_value: (expr: FrontExpr, env: Env) => FrontExpr;
  resolve_index_expr: (
    expr: Extract<FrontExpr, { tag: "index" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  resolve_static_i32_expr: (
    expr: FrontExpr,
    env: Env,
  ) => number | undefined;
  resolve_struct_field_expr: (
    expr: Extract<FrontExpr, { tag: "field" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
};

export type UnionValueTarget = {
  expr: Extract<FrontExpr, { tag: "union_case" }>;
  env: Env;
};
