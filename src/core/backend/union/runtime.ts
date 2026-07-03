import type { CoreBackendUnionStatic } from "./static.ts";
import type { CoreBackendUnionApi } from "./types.ts";
import { create_core_backend_union_runtime_emit } from "./runtime/emit.ts";
import { create_core_backend_union_runtime_info } from "./runtime/info.ts";
import type { CoreBackendUnionRuntime } from "./runtime/types.ts";

export type { CoreBackendUnionRuntime };

export function create_core_backend_union_runtime(
  api: CoreBackendUnionApi,
  static_union: CoreBackendUnionStatic,
): CoreBackendUnionRuntime {
  const runtime_info = create_core_backend_union_runtime_info(
    api,
    static_union,
  );
  const runtime_emit = create_core_backend_union_runtime_emit(
    api,
    runtime_info,
  );

  return {
    ...runtime_info,
    ...runtime_emit,
  };
}
