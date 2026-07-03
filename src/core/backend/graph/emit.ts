import type { CoreBackendExprEmit } from "../emit/expr.ts";
import type { CoreBackendGraphDeps } from "../graph_deps.ts";
import type { CoreBackendStmtEmit } from "../emit/stmt.ts";
import { create_core_backend_graph_expr_emit } from "./emit/expr.ts";
import { create_core_backend_graph_stmt_emit } from "./emit/stmt.ts";

export type CoreBackendEmitGraph = {
  expr_emit: CoreBackendExprEmit;
  stmt_emit: CoreBackendStmtEmit;
};

export function create_core_backend_emit_graph(
  deps: CoreBackendGraphDeps,
): CoreBackendEmitGraph {
  const expr_emit = create_core_backend_graph_expr_emit(deps);
  const stmt_emit = create_core_backend_graph_stmt_emit(deps, expr_emit);

  return {
    expr_emit,
    stmt_emit,
  };
}
