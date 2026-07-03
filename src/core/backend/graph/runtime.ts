import type { CoreBackendClosure } from "../closure/types.ts";
import type { CoreBackendControlFlow } from "../control_flow/types.ts";
import type { CoreBackendGraphDeps } from "../graph_deps.ts";
import { create_core_backend_runtime_closure } from "./runtime/closure.ts";
import { create_core_backend_runtime_control_flow } from "./runtime/control_flow.ts";
import { create_core_backend_runtime_rec } from "./runtime/rec.ts";
import { create_core_backend_runtime_union } from "./runtime/union.ts";
import type { CoreBackendRec } from "../runtime/rec/types.ts";
import type { CoreBackendUnion } from "../union/types.ts";

export type CoreBackendRuntimeGraph = {
  closure: CoreBackendClosure;
  control_flow: CoreBackendControlFlow;
  rec: CoreBackendRec;
  union: CoreBackendUnion;
};

export function create_core_backend_runtime_graph(
  deps: CoreBackendGraphDeps,
): CoreBackendRuntimeGraph {
  const closure = create_core_backend_runtime_closure(deps, () => union);
  const union = create_core_backend_runtime_union(deps, closure);
  const control_flow = create_core_backend_runtime_control_flow(
    deps,
    union,
    closure,
  );
  const rec = create_core_backend_runtime_rec(deps);

  return {
    closure,
    control_flow,
    rec,
    union,
  };
}
