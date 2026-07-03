import type { Ic as IcNode } from "../../ic.ts";
import type { Env, FrontExpr, FrontType, Stmt, TypeField } from "../ast.ts";

export type ResolvedUnionValue = {
  expr: Extract<FrontExpr, { tag: "union_case" }>;
  env: Env;
};

export type StatementDone = (() => IcNode) | undefined;

export type LowerStatementsWithDone = (
  stmts: Stmt[],
  index: number,
  env: Env,
  hooks: StatementLowerHooks,
  on_done: StatementDone,
) => IcNode;

export type StatementLowerHooks = {
  apply_annotation_context: (
    annotation: string,
    value: FrontExpr,
    env: Env,
  ) => FrontExpr;
  apply_index_assignment: (
    stmt: Extract<Stmt, { tag: "index_assign" }>,
    env: Env,
  ) => FrontExpr;
  apply_runtime_binding_annotation: (
    annotation: string,
    value: FrontExpr,
    env: Env,
  ) => { value: FrontExpr; type: FrontType };
  assignment_type: (
    previous: FrontType,
    value_type: FrontType,
    mode: "same" | "change",
  ) => FrontType;
  check_binding_annotation: (
    annotation: string,
    value: FrontExpr,
    env: Env,
  ) => void;
  check_type_pattern: (
    stmt: Extract<Stmt, { tag: "type_check" }>,
    env: Env,
  ) => void;
  expand_for_collection: (
    stmt: Extract<Stmt, { tag: "for_collection" }>,
    env: Env,
  ) => Stmt[];
  expand_for_range: (
    stmt: Extract<Stmt, { tag: "for_range" }>,
    env: Env,
  ) => Stmt[];
  infer_dynamic_if_let_cases: (
    expr: FrontExpr,
    env: Env,
  ) => TypeField[] | undefined;
  infer_expr: (expr: FrontExpr, env: Env) => FrontType;
  is_deferred_frontend_value: (expr: FrontExpr, env: Env) => boolean;
  lower_expr: (expr: FrontExpr, env: Env) => IcNode;
  prepare_const_value: (expr: FrontExpr, env: Env) => FrontExpr;
  prepare_runtime_value: (expr: FrontExpr, env: Env) => FrontExpr;
  requires_specialized_call: (
    expr: Extract<FrontExpr, { tag: "lam" }>,
    env: Env,
  ) => boolean;
  resolve_static_i32_expr: (
    expr: FrontExpr,
    env: Env,
  ) => number | undefined;
  resolve_union_value: (
    expr: FrontExpr,
    env: Env,
  ) => ResolvedUnionValue | undefined;
};
