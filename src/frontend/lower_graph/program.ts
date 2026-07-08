import {
  create_frontend_expression_hooks,
  type FrontendExpressionHooksApi,
} from "../lower_expression_hooks_adapter.ts";
import {
  create_frontend_call_graph,
  type FrontendCallGraph,
} from "../lower_call_graph.ts";
import {
  create_frontend_program_hooks,
  type FrontendProgramHooksApi,
} from "../lower_program_hooks_adapter.ts";
import {
  create_frontend_static_rec_hooks,
  type FrontendStaticRecApi,
} from "../lower_static_rec_adapter.ts";
import type { Env, FrontExpr, Stmt } from "../ast.ts";
import type { FrontEvalHooks } from "../eval.ts";
import type { ExprLowerHooks } from "../expr_lower.ts";
import type { IfExprHooks } from "../if_expr.ts";
import type { IfLetHooks } from "../if_let.ts";
import type { InferHooks } from "../infer.ts";
import type { IndexAssignmentHooks } from "../index_assignment.ts";
import type { FrontPrepareHooks } from "../prepare.ts";
import type { StaticRecHooks } from "../rec_hooks.ts";
import type { StatementLowerHooks } from "../stmt.ts";

export type FrontendLowerGraphProgramApi =
  & FrontendExpressionHooksApi
  & Omit<FrontendProgramHooksApi, "apply_index_assignment">
  & Omit<FrontendStaticRecApi, "apply_index_assignment" | "check_type_pattern">
  & {
    apply_index_assignment: (
      stmt: Extract<Stmt, { tag: "index_assign" }>,
      env: Env,
      hooks: IndexAssignmentHooks,
    ) => FrontExpr;
    check_static_type_pattern: FrontendStaticRecApi["check_type_pattern"];
  };

export type FrontendLowerGraphProgramHooks = {
  eval_hooks: FrontEvalHooks;
  expr_lower_hooks: ExprLowerHooks;
  frontend_call_graph: FrontendCallGraph;
  if_expr_hooks: IfExprHooks;
  if_let_hooks: IfLetHooks;
  infer_hooks: InferHooks;
  prepare_hooks: FrontPrepareHooks;
  statement_lower_hooks: StatementLowerHooks;
  static_rec_hooks: StaticRecHooks;
};

export function create_frontend_lower_graph_program_hooks(
  api: FrontendLowerGraphProgramApi,
): FrontendLowerGraphProgramHooks {
  const frontend_expression_hooks = create_frontend_expression_hooks(api);
  const frontend_call_graph = create_frontend_call_graph(
    frontend_expression_hooks.call_specialize_hooks,
  );

  const apply_index_assignment = (
    stmt: Extract<Stmt, { tag: "index_assign" }>,
    env: Env,
  ): FrontExpr => {
    return api.apply_index_assignment(
      stmt,
      env,
      frontend_expression_hooks.index_assignment_hooks,
    );
  };

  const frontend_program_hooks = create_frontend_program_hooks({
    ...api,
    apply_index_assignment,
  });

  const static_rec_hooks = create_frontend_static_rec_hooks({
    ...api,
    apply_index_assignment,
    check_type_pattern: api.check_static_type_pattern,
  });

  return {
    eval_hooks: frontend_program_hooks.eval_hooks,
    expr_lower_hooks: frontend_expression_hooks.expr_lower_hooks,
    frontend_call_graph,
    if_expr_hooks: frontend_expression_hooks.if_expr_hooks,
    if_let_hooks: frontend_expression_hooks.if_let_hooks,
    infer_hooks: frontend_program_hooks.infer_hooks,
    prepare_hooks: frontend_program_hooks.prepare_hooks,
    statement_lower_hooks: frontend_program_hooks.statement_lower_hooks,
    static_rec_hooks,
  };
}
