import type {
  Env,
  FrontExpr,
  FrontType,
  ResolvedFrontExpr,
  Stmt,
} from "../ast.ts";

export type ResolvedUnionValue = {
  expr: Extract<FrontExpr, { tag: "union_case" }>;
  env: Env;
};

export type FrontEvalHooks = {
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
  check_binding_annotation: (
    annotation: string,
    value: FrontExpr,
    env: Env,
  ) => void;
  check_type_pattern: (
    stmt: Extract<Stmt, { tag: "type_check" }>,
    env: Env,
  ) => void;
  eval_const_call: (
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
    allow_unmarked_params: boolean,
  ) => FrontExpr | undefined;
  eval_i32_expr: (expr: FrontExpr, env: Env, label: string) => number;
  expand_for_collection: (
    stmt: Extract<Stmt, { tag: "for_collection" }>,
    env: Env,
  ) => Stmt[];
  expand_for_range: (
    stmt: Extract<Stmt, { tag: "for_range" }>,
    env: Env,
  ) => Stmt[];
  infer_expr: (expr: FrontExpr, env: Env) => FrontType;
  inline_deferred_const_call: (
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  prepare_const_value: (expr: FrontExpr, env: Env) => FrontExpr;
  resolve_const_field_expr: (
    expr: Extract<FrontExpr, { tag: "field" }>,
    env: Env,
  ) => FrontExpr | undefined;
  resolve_const_expr_with_env: (
    expr: FrontExpr,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  resolve_index_expr: (
    expr: Extract<FrontExpr, { tag: "index" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  resolve_struct_field_expr: (
    expr: Extract<FrontExpr, { tag: "field" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  resolve_union_constructor_call: (
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  resolve_union_value: (
    expr: FrontExpr,
    env: Env,
  ) => ResolvedUnionValue | undefined;
  visible_text_value: (
    expr: FrontExpr,
    env: Env,
    seen: Set<string>,
  ) => FrontExpr | undefined;
};
