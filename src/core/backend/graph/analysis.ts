import type { CoreBackendExprType } from "../analysis/expr_type.ts";
import type { CoreBackendLocalFacts } from "../analysis/local_facts.ts";
import type { CoreBackendTypeCheck } from "../analysis/type_check.ts";
import type { CoreBackendGraphDeps } from "../graph_deps.ts";
import { create_core_backend_graph_expr_type } from "./analysis/expr_type.ts";
import { create_core_backend_graph_local_facts } from "./analysis/local_facts.ts";
import { create_core_backend_graph_type_check } from "./analysis/type_check.ts";

export type CoreBackendAnalysisGraph = {
  expr_type: CoreBackendExprType;
  local_facts: CoreBackendLocalFacts;
  type_check: CoreBackendTypeCheck;
};

export function create_core_backend_analysis_graph(
  deps: CoreBackendGraphDeps,
): CoreBackendAnalysisGraph {
  const local_facts = create_core_backend_graph_local_facts(deps);
  const expr_type = create_core_backend_graph_expr_type(deps, local_facts);
  const type_check = create_core_backend_graph_type_check(deps, expr_type);

  return {
    expr_type,
    local_facts,
    type_check,
  };
}
