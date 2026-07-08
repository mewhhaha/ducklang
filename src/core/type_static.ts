export { static_block_result } from "./type_static/block.ts";
export {
  core_val_type_from_type_name,
  is_core_builtin_type_name,
} from "./type_static/names.ts";
export type { TypeStaticCtx } from "./type_static/types.ts";
export {
  is_type_level_expr,
  resolve_core_type_name,
  static_function_value,
  static_type_level_value,
  static_type_name,
  static_type_value,
} from "./type_static/value.ts";
