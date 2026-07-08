import type { Env, FrontType } from "./ast.ts";
import { front_type_from_type_name } from "./types.ts";
import type { FrontTypedLowerHooks } from "./typed_hooks.ts";

export function type_for_type_name(
  type_name: string,
  env: Env,
  hooks: FrontTypedLowerHooks,
): FrontType {
  if (hooks.resolve_annotation_type) {
    const resolved = hooks.resolve_annotation_type(type_name, env);

    if (resolved) {
      return resolved;
    }
  }

  return front_type_from_type_name(type_name);
}
