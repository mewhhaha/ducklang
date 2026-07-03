import type { CoreBackendUnion, CoreBackendUnionApi } from "./union/types.ts";
import { create_core_backend_union_runtime } from "./union/runtime.ts";
import { create_core_backend_union_static } from "./union/static.ts";

export type { CoreBackendUnion, CoreBackendUnionApi };

export function create_core_backend_union(
  api: CoreBackendUnionApi,
): CoreBackendUnion {
  const static_union = create_core_backend_union_static(api);
  const runtime_union = create_core_backend_union_runtime(api, static_union);

  return {
    ...static_union,
    ...runtime_union,
  };
}
