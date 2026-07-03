import type { Env, FrontType } from "../ast.ts";
import { common_front_type, front_type_from_type_name } from "../types.ts";
import type { InferHooks } from "./types.ts";

export function common_if_type(
  implicit_else: boolean | undefined,
  then_type: FrontType,
  else_type: FrontType,
): FrontType | undefined {
  const result_type = common_front_type(then_type, else_type);

  if (result_type) {
    return result_type;
  }

  if (
    implicit_else &&
    (then_type.tag === "int" || then_type.tag === "text")
  ) {
    return then_type;
  }

  return undefined;
}

export function front_type_for_type_name(
  type_name: string,
  env: Env,
  hooks: InferHooks,
): FrontType {
  const resolved = hooks.resolve_annotation_type(type_name, env);

  if (resolved) {
    return resolved;
  }

  return front_type_from_type_name(type_name);
}
