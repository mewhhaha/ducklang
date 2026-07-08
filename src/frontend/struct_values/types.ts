import type { Ic as IcNode } from "../../ic.ts";
import type { Env, FrontExpr, FrontType, ResolvedFrontExpr } from "../ast.ts";

export type StructValueTarget = {
  expr: Extract<FrontExpr, { tag: "struct_value" }>;
  env: Env;
};

export type StructValueHooks = {
  capture_expr: (expr: FrontExpr, env: Env) => FrontExpr;
  eval_simple_front_block: (
    expr: Extract<FrontExpr, { tag: "block" }>,
    env: Env,
  ) => FrontExpr | undefined;
  infer_expr: (expr: FrontExpr, env: Env) => FrontType;
  inline_deferred_const_call: (
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  inline_runtime_call_expr: (
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  inline_specialized_call_expr: (
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  lower_expr_as_declared_type: (
    expr: FrontExpr,
    env: Env,
    type_name: string | undefined,
  ) => IcNode;
  lower_expr: (expr: FrontExpr, env: Env) => IcNode;
  resolve_const_expr: (expr: FrontExpr, env: Env) => FrontExpr | undefined;
  resolve_dynamic_if_let_struct_value: (
    expr: Extract<FrontExpr, { tag: "if_let" }>,
    env: Env,
  ) => StructValueTarget | undefined;
  resolve_dynamic_struct_if_value: (
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ) => StructValueTarget | undefined;
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
