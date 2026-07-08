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
  const graph_deps = create_core_backend_graph_deps({
    analysis: () => analysis,
    emit: () => emit,
    entry: () => entry,
    runtime: () => runtime,
    values: () => values,
  });

  const analysis: CoreBackendAnalysisGraph = create_core_backend_analysis_graph(
    graph_deps,
  );
  const emit: CoreBackendEmitGraph = create_core_backend_emit_graph(graph_deps);
  const values: CoreBackendValuesGraph = create_core_backend_values_graph(
    graph_deps,
  );
  const runtime: CoreBackendRuntimeGraph = create_core_backend_runtime_graph(
    graph_deps,
  );
  const entry: CoreBackendEntryGraph = create_core_backend_entry_graph(
    graph_deps,
  );

  return {
    ...analysis,
    ...emit,
    ...entry,
    ...runtime,
    ...values,
  };
}
