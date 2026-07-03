import type {
  CoreBackendStaticValue,
  CoreBackendStaticValueApi,
} from "./static_value/types.ts";
import {
  create_core_backend_static_value_hooks,
  create_core_backend_static_value_recognition_hooks,
} from "./static_value/hooks.ts";
import { create_core_backend_static_value_plan } from "./static_value/plan.ts";
import { create_core_backend_static_value_recognition } from "./static_value/recognition.ts";

export function create_core_backend_static_value(
  api: CoreBackendStaticValueApi,
): CoreBackendStaticValue {
  const static_value_hooks = create_core_backend_static_value_hooks(api);
  const static_value_recognition_hooks =
    create_core_backend_static_value_recognition_hooks(api);
  const recognition = create_core_backend_static_value_recognition(
    static_value_recognition_hooks,
  );
  const plan = create_core_backend_static_value_plan(static_value_hooks);

  return {
    ...recognition,
    ...plan,
  };
}
