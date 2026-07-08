export {
  emit_runtime_text_byte_index,
  emit_runtime_text_index_assign,
  emit_runtime_text_len,
} from "./runtime_text/access.ts";
export {
  emit_runtime_text_append,
  emit_runtime_text_concat,
} from "./runtime_text/concat.ts";
export { emit_runtime_text_eq } from "./runtime_text/eq.ts";
export {
  emit_runtime_text_freeze_copy,
  emit_runtime_text_freeze_copy_from_wat,
  emit_runtime_text_slice,
} from "./runtime_text/slice.ts";
export type {
  RuntimeTextConcatPlan,
  RuntimeTextEqPlan,
  RuntimeTextIndexAssignPlan,
  RuntimeTextSlicePlan,
} from "./runtime_text/plan.ts";
export {
  declare_runtime_text_concat_locals,
  declare_runtime_text_eq_locals,
  declare_runtime_text_index_assign_locals,
  declare_runtime_text_slice_locals,
  runtime_text_concat_plan,
  runtime_text_eq_plan,
  runtime_text_index_assign_plan,
  runtime_text_slice_plan,
} from "./runtime_text/plan.ts";
export type {
  RuntimeTextEmitCtx,
  RuntimeTextHeap,
  RuntimeTextHooks,
  RuntimeTextLoopCtx,
  RuntimeTextTempCtx,
} from "./runtime_text/types.ts";
