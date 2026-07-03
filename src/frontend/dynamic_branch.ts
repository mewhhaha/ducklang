export type {
  DynamicBranchHooks,
  ResolvedStructValue,
  ResolvedUnionValue,
} from "./dynamic_branch/types.ts";
export {
  lower_dynamic_struct_if,
  resolve_dynamic_if_let_struct_value,
  resolve_dynamic_struct_if_value,
} from "./dynamic_branch/struct.ts";
export {
  can_lower_dynamic_union_if_as_value,
  lower_dynamic_union_if,
} from "./dynamic_branch/union.ts";
