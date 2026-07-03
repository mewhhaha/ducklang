import type { CoreBackendApp } from "../entry/app.ts";
import type { CoreBackendArtifact } from "../entry/artifact/types.ts";
import type { CoreBackendIndex } from "../entry/index.ts";
import type { CoreBackendLocalCollect } from "../entry/local_collect/types.ts";
import { create_core_backend_graph_app } from "./entry/app.ts";
import { create_core_backend_graph_artifact } from "./entry/artifact.ts";
import { create_core_backend_graph_index } from "./entry/index.ts";
import { create_core_backend_graph_local_collect } from "./entry/local_collect.ts";
import type { CoreBackendGraphDeps } from "../graph_deps.ts";

export type CoreBackendEntryGraph = {
  app: CoreBackendApp;
  artifact: CoreBackendArtifact;
  index: CoreBackendIndex;
  local_collect: CoreBackendLocalCollect;
};

export function create_core_backend_entry_graph(
  deps: CoreBackendGraphDeps,
): CoreBackendEntryGraph {
  const index = create_core_backend_graph_index(deps);
  const app = create_core_backend_graph_app(deps, index);
  const local_collect = create_core_backend_graph_local_collect(deps, index);
  const artifact = create_core_backend_graph_artifact(deps, local_collect);

  return {
    app,
    artifact,
    index,
    local_collect,
  };
}
