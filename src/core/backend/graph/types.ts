import type { CoreBackendAnalysisGraph } from "./analysis.ts";
import type { CoreBackendEmitGraph } from "./emit.ts";
import type { CoreBackendEntryGraph } from "./entry.ts";
import type { CoreBackendRuntimeGraph } from "./runtime.ts";
import type { CoreBackendValuesGraph } from "./values.ts";

export type CoreBackendGraph =
  & CoreBackendAnalysisGraph
  & CoreBackendEmitGraph
  & CoreBackendEntryGraph
  & CoreBackendRuntimeGraph
  & CoreBackendValuesGraph;
