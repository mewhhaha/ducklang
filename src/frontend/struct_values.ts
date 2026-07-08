import type { Env, FrontExpr } from "./ast.ts";
import { resolve_struct_value } from "./struct_values/resolve.ts";
import { apply_struct_update_with_resolver } from "./struct_values/update.ts";
import type { StructValueHooks } from "./struct_values/types.ts";

export { resolve_struct_value } from "./struct_values/resolve.ts";
export { lower_struct_value } from "./struct_values/lower.ts";

export {
  check_struct_fields,
  maybe_struct_type_value,
  resolve_struct_type_value,
  resolve_struct_value_type_fields,
  validate_struct_value,
} from "./struct_value_type.ts";

export type {
  StructValueHooks,
  StructValueTarget,
} from "./struct_values/types.ts";

export function apply_struct_update(
  expr: Extract<FrontExpr, { tag: "struct_update" }>,
  env: Env,
  hooks: StructValueHooks,
): FrontExpr {
  return apply_struct_update_with_resolver(
    expr,
    env,
    hooks,
    resolve_struct_value,
  );
}
