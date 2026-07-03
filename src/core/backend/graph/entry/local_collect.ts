import type { CoreBackendIndex } from "../../entry/index.ts";
import { create_core_backend_local_collect } from "../../entry/local_collect.ts";
import type { CoreBackendLocalCollect } from "../../entry/local_collect/types.ts";
import type { CoreBackendGraphDeps } from "../../graph_deps.ts";

export function create_core_backend_graph_local_collect(
  deps: CoreBackendGraphDeps,
  index: CoreBackendIndex,
): CoreBackendLocalCollect {
  return create_core_backend_local_collect({
    closure: deps.closure(),
    control_flow: deps.control_flow(),
    index,
    local_facts: deps.local_facts(),
    rec: deps.rec(),
    static_call: deps.static_call(),
    static_value: deps.static_value(),
    struct: deps.struct(),
    text: deps.text(),
    type_check: deps.type_check(),
    union: deps.union(),
    expr_type: deps.expr_type().expr_type,
  });
}
