import { create_core_backend_analysis_graph } from "./analysis.ts";
import type { CoreBackendAnalysisGraph } from "./analysis.ts";
import { create_core_backend_graph_deps } from "./deps.ts";
import { create_core_backend_emit_graph } from "./emit.ts";
import type { CoreBackendEmitGraph } from "./emit.ts";
import { create_core_backend_entry_graph } from "./entry.ts";
import type { CoreBackendEntryGraph } from "./entry.ts";
import { create_core_backend_runtime_graph } from "./runtime.ts";
import type { CoreBackendRuntimeGraph } from "./runtime.ts";
import { create_core_backend_values_graph } from "./values.ts";
import type { CoreBackendValuesGraph } from "./values.ts";
import type { CoreBackendGraph } from "./types.ts";

export type { CoreBackendGraph };

export function create_core_backend_graph(): CoreBackendGraph {
  let analysis: CoreBackendAnalysisGraph;
  let emit: CoreBackendEmitGraph;
  let entry: CoreBackendEntryGraph;
  let runtime: CoreBackendRuntimeGraph;
  let values: CoreBackendValuesGraph;

  const graph_deps = create_core_backend_graph_deps({
    analysis: () => analysis,
    emit: () => emit,
    entry: () => entry,
    runtime: () => runtime,
    values: () => values,
  });

  analysis = create_core_backend_analysis_graph(graph_deps);
  emit = create_core_backend_emit_graph(graph_deps);
  values = create_core_backend_values_graph(graph_deps);
  runtime = create_core_backend_runtime_graph(graph_deps);
  entry = create_core_backend_entry_graph(graph_deps);

  return {
    ...analysis,
    ...emit,
    ...entry,
    ...runtime,
    ...values,
  };
}
