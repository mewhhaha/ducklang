import type { Env, FrontType, TypeField } from "./ast.ts";
import type { StaticRecHooks } from "./rec_hooks.ts";
import { front_type_from_type_name } from "./types.ts";

export function lookup_rec_type_field(
  fields: TypeField[],
  name: string,
): TypeField | undefined {
  for (const field of fields) {
    if (field.name === name) {
      return field;
    }
  }

  return undefined;
}

export function rec_front_type_for_type_name(
  type_name: string,
  env: Env,
  hooks: StaticRecHooks,
): FrontType {
  const resolved = hooks.resolve_annotation_type(type_name, env);

  if (resolved) {
    return resolved;
  }

  return front_type_from_type_name(type_name);
}
