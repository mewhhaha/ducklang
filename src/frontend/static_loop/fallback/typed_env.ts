import type { Env, FrontExpr, FrontType } from "../../ast.ts";
import { clone_env, lookup, push_binding } from "../../env.ts";

export function dynamic_loop_control_typed_value_env(
  value: FrontExpr,
  type: FrontType,
  env: Env,
): Env | undefined {
  if (value.tag === "captured") {
    return dynamic_loop_control_typed_value_env(value.expr, type, value.env);
  }

  if (value.tag === "field") {
    return env;
  }

  if (value.tag !== "var") {
    return undefined;
  }

  const local = clone_env(env);
  const existing = lookup(env, value.name);
  let ic_name = value.name;

  if (existing) {
    ic_name = existing.ic_name;
  }

  push_binding(local, {
    name: value.name,
    ic_name,
    type,
    is_const: false,
    is_linear: false,
    value: undefined,
    value_env: undefined,
  });
  return local;
}
