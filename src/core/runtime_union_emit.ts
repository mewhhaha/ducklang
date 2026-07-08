export {
  declare_runtime_union_freeze_copy_locals,
  emit_runtime_union_freeze_copy,
  runtime_union_freeze_copy_supported,
  type RuntimeUnionFreezeCopyCtx,
  type RuntimeUnionFreezeCopyHooks,
} from "./runtime_union/freeze_copy.ts";

export {
  collect_runtime_union_value_locals,
  emit_runtime_union_value,
} from "./runtime_union_emit/value.ts";

export {
  emit_runtime_union_if_let_expr,
  emit_runtime_union_if_let_stmt,
} from "./runtime_union_emit/if_let.ts";

export {
  type RuntimeUnionEmitCtx,
  type RuntimeUnionEmitHeap,
  type RuntimeUnionEmitHooks,
  type RuntimeUnionIfLetCtx,
  type RuntimeUnionIfLetHooks,
  type RuntimeUnionLocalCtx,
  type RuntimeUnionLocalHooks,
  type RuntimeUnionPayloadEmitBinding,
} from "./runtime_union_emit/types.ts";
