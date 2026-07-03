import type { CoreBackendGraphDeps } from "../graph_deps.ts";
import type { CoreBackendAnalysisGraph } from "./analysis.ts";
import type { CoreBackendEmitGraph } from "./emit.ts";
import type { CoreBackendEntryGraph } from "./entry.ts";
import type { CoreBackendRuntimeGraph } from "./runtime.ts";
import type { CoreBackendValuesGraph } from "./values.ts";

export type CoreBackendGraphParts = {
  analysis: () => CoreBackendAnalysisGraph;
  emit: () => CoreBackendEmitGraph;
  entry: () => CoreBackendEntryGraph;
  runtime: () => CoreBackendRuntimeGraph;
  values: () => CoreBackendValuesGraph;
};

export function create_core_backend_graph_deps(
  parts: CoreBackendGraphParts,
): CoreBackendGraphDeps {
  return {
    app: () => parts.entry().app,
    artifact: () => parts.entry().artifact,
    closure: () => parts.runtime().closure,
    control_flow: () => parts.runtime().control_flow,
    expr_emit: () => parts.emit().expr_emit,
    expr_type: () => parts.analysis().expr_type,
    index: () => parts.entry().index,
    local_collect: () => parts.entry().local_collect,
    local_facts: () => parts.analysis().local_facts,
    rec: () => parts.runtime().rec,
    static_call: () => parts.values().static_call,
    static_value: () => parts.values().static_value,
    stmt_emit: () => parts.emit().stmt_emit,
    struct: () => parts.values().struct,
    text: () => parts.values().text,
    type_check: () => parts.analysis().type_check,
    union: () => parts.runtime().union,
  };
}
