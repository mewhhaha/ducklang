import { expect } from "../../../expect.ts";
import type { CoreBackendGraphDeps } from "../graph_deps.ts";
import type { CoreBackendText } from "../text/types.ts";
import { create_core_backend_values_static_call } from "./values/static_call.ts";
import { create_core_backend_values_static_value } from "./values/static_value.ts";
import { create_core_backend_values_struct } from "./values/struct.ts";
import { create_core_backend_values_text } from "./values/text.ts";
import type { CoreBackendValuesGraph } from "./values/types.ts";
import type { CoreBackendStruct } from "../values/struct/types.ts";

export type { CoreBackendValuesGraph };

export function create_core_backend_values_graph(
  deps: CoreBackendGraphDeps,
): CoreBackendValuesGraph {
  let struct: CoreBackendStruct | undefined;
  let text: CoreBackendText | undefined;

  const get_struct = () => {
    expect(struct, "Core backend struct graph was used before initialization");
    return struct;
  };

  const get_text = () => {
    expect(text, "Core backend text graph was used before initialization");
    return text;
  };

  const static_call = create_core_backend_values_static_call(deps, get_struct);
  struct = create_core_backend_values_struct(deps, static_call);
  const static_value = create_core_backend_values_static_value(
    deps,
    static_call,
    struct,
    get_text,
  );
  text = create_core_backend_values_text(deps, static_call, struct);

  return {
    static_call,
    static_value,
    struct,
    text,
  };
}
