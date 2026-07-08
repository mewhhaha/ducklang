export {
  dynamic_if_let_can_match,
  dynamic_union_if,
} from "./union_static/dynamic_if.ts";
export { find_core_type_field } from "./union_static/field.ts";
export { bind_dynamic_if_let_payload } from "./union_static/payload.ts";
export { static_union_case } from "./union_static/static_case.ts";
export type { CoreUnionCtx, CoreUnionHooks } from "./union_static/types.ts";
