import type { Ic as IcNode } from "../../ic.ts";
import type { Env, FrontExpr, FrontType, Stmt } from "../ast.ts";
import type { FrontEvalHooks } from "../eval.ts";
import {
  eval_front_block as eval_front_block_with_hooks,
  eval_front_value as eval_front_value_with_hooks,
  eval_simple_front_block as eval_simple_front_block_with_hooks,
} from "../eval.ts";
import type { ExprLowerHooks } from "../expr_lower.ts";
import { lower_expr as lower_expr_with_hooks } from "../expr_lower.ts";
import type { IfExprHooks } from "../if_expr.ts";
import { lower_if_expr as lower_if_expr_with_hooks } from "../if_expr.ts";
import type { IfLetHooks } from "../if_let.ts";
import {
  lower_if_let as lower_if_let_with_hooks,
  resolve_dynamic_union_if_target as resolve_dynamic_union_if_target_with_hooks,
} from "../if_let.ts";
import type { InferHooks } from "../infer.ts";
import { infer_front_expr } from "../infer.ts";
import type { FrontPrepareHooks } from "../prepare.ts";
import {
  prepare_const_value as prepare_const_value_with_hooks,
  prepare_runtime_value as prepare_runtime_value_with_hooks,
} from "../prepare.ts";
import type { StatementLowerHooks } from "../stmt.ts";
import { lower_statements as lower_statements_with_hooks } from "../stmt.ts";

export type FrontendLowerGraphBridgeApi = {
  eval_hooks: () => FrontEvalHooks;
  expr_lower_hooks: () => ExprLowerHooks;
  if_expr_hooks: () => IfExprHooks;
  if_let_hooks: () => IfLetHooks;
  infer_hooks: () => InferHooks;
  prepare_hooks: () => FrontPrepareHooks;
  resolve_static_i32_expr: (
    expr: FrontExpr,
    env: Env,
  ) => number | undefined;
  statement_lower_hooks: () => StatementLowerHooks;
};

export type FrontendLowerGraphBridge = {
  eval_front_block: (stmts: Stmt[], env: Env) => FrontExpr;
  eval_front_value: (expr: FrontExpr, env: Env) => FrontExpr;
  eval_simple_front_block: (
    expr: Extract<FrontExpr, { tag: "block" }>,
    env: Env,
  ) => FrontExpr | undefined;
  infer_expr: (expr: FrontExpr, env: Env) => FrontType;
  lower_expr: (expr: FrontExpr, env: Env) => IcNode;
  lower_if_expr: (
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ) => IcNode;
  lower_if_let: (
    expr: Extract<FrontExpr, { tag: "if_let" }>,
    env: Env,
  ) => IcNode;
  lower_statements: (stmts: Stmt[], index: number, env: Env) => IcNode;
  prepare_const_value: (expr: FrontExpr, env: Env) => FrontExpr;
  prepare_runtime_value: (expr: FrontExpr, env: Env) => FrontExpr;
  resolve_dynamic_union_if_target: (
    expr: FrontExpr,
    env: Env,
  ) => { expr: Extract<FrontExpr, { tag: "if" }>; env: Env } | undefined;
  resolve_static_if_branch: (
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ) => FrontExpr | undefined;
};

export function create_frontend_lower_graph_bridge(
  api: FrontendLowerGraphBridgeApi,
): FrontendLowerGraphBridge {
  function lower_statements(
    stmts: Stmt[],
    index: number,
    env: Env,
  ): IcNode {
    return lower_statements_with_hooks(
      stmts,
      index,
      env,
      api.statement_lower_hooks(),
    );
  }

  function lower_expr(expr: FrontExpr, env: Env): IcNode {
    return lower_expr_with_hooks(expr, env, api.expr_lower_hooks());
  }

  function resolve_static_if_branch(
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ): FrontExpr | undefined {
    const cond = api.resolve_static_i32_expr(expr.cond, env);

    if (cond === undefined) {
      return undefined;
    }

    if (cond !== 0) {
      return expr.then_branch;
    }

    return expr.else_branch;
  }

  function lower_if_expr(
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ): IcNode {
    return lower_if_expr_with_hooks(expr, env, api.if_expr_hooks());
  }

  function lower_if_let(
    expr: Extract<FrontExpr, { tag: "if_let" }>,
    env: Env,
  ): IcNode {
    return lower_if_let_with_hooks(expr, env, api.if_let_hooks());
  }

  function resolve_dynamic_union_if_target(
    expr: FrontExpr,
    env: Env,
  ): { expr: Extract<FrontExpr, { tag: "if" }>; env: Env } | undefined {
    return resolve_dynamic_union_if_target_with_hooks(
      expr,
      env,
      api.if_let_hooks(),
    );
  }

  function prepare_const_value(expr: FrontExpr, env: Env): FrontExpr {
    return prepare_const_value_with_hooks(expr, env, api.prepare_hooks());
  }

  function eval_front_value(expr: FrontExpr, env: Env): FrontExpr {
    return eval_front_value_with_hooks(expr, env, api.eval_hooks());
  }

  function eval_front_block(stmts: Stmt[], env: Env): FrontExpr {
    return eval_front_block_with_hooks(stmts, env, api.eval_hooks());
  }

  function eval_simple_front_block(
    expr: Extract<FrontExpr, { tag: "block" }>,
    env: Env,
  ): FrontExpr | undefined {
    return eval_simple_front_block_with_hooks(expr, env, api.eval_hooks());
  }

  function prepare_runtime_value(expr: FrontExpr, env: Env): FrontExpr {
    return prepare_runtime_value_with_hooks(expr, env, api.prepare_hooks());
  }

  function infer_expr(expr: FrontExpr, env: Env): FrontType {
    return infer_front_expr(expr, env, api.infer_hooks());
  }

  return {
    eval_front_block,
    eval_front_value,
    eval_simple_front_block,
    infer_expr,
    lower_expr,
    lower_if_expr,
    lower_if_let,
    lower_statements,
    prepare_const_value,
    prepare_runtime_value,
    resolve_dynamic_union_if_target,
    resolve_static_if_branch,
  };
}
