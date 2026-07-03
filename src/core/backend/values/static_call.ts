import type {
  CoreBackendStaticCall,
  CoreBackendStaticCallApi,
} from "./static_call/types.ts";
import { create_core_backend_static_call_hooks } from "./static_call/hooks.ts";
import { create_core_backend_static_call_lookup } from "./static_call/lookup.ts";
import { create_core_backend_static_call_scoped } from "./static_call/scoped.ts";

export function create_core_backend_static_call(
  api: CoreBackendStaticCallApi,
): CoreBackendStaticCall {
  const static_call_hooks = create_core_backend_static_call_hooks(api);
  const scoped = create_core_backend_static_call_scoped(static_call_hooks);
  const lookup = create_core_backend_static_call_lookup(static_call_hooks);

  return {
    ...scoped,
    ...lookup,
  };
}
