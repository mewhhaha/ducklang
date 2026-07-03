import type {
  CoreBackendClosure,
  CoreBackendClosureApi,
} from "./closure/types.ts";
import { create_core_backend_closure_capture } from "./closure/capture.ts";
import { create_core_backend_closure_emit } from "./closure/emit.ts";
import { create_core_backend_closure_if } from "./closure/if.ts";
import { create_core_backend_closure_type } from "./closure/type.ts";

export type { CoreBackendClosure, CoreBackendClosureApi };

export function create_core_backend_closure(
  api: CoreBackendClosureApi,
): CoreBackendClosure {
  const capture = create_core_backend_closure_capture(api);
  const closure_type = create_core_backend_closure_type(api, capture);
  const closure_emit = create_core_backend_closure_emit(
    api,
    capture,
    closure_type,
  );
  const closure_if = create_core_backend_closure_if(
    api,
    closure_type,
    closure_emit,
  );

  return {
    ...capture,
    ...closure_type,
    ...closure_emit,
    ...closure_if,
  };
}
