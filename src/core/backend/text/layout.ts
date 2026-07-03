import type { Core as CoreNode } from "../../ast.ts";
import type { CoreBackendText, CoreBackendTextApi } from "./types.ts";
import type { CoreCtx } from "../../local_collect.ts";
import {
  build_text_layout as build_text_layout_with_hooks,
  type CoreTextLayoutHooks,
  type TextLayout,
} from "../../text_layout.ts";

export type CoreBackendTextLayout = Pick<
  CoreBackendText,
  "build_text_layout"
>;

export function create_core_backend_text_layout(
  api: CoreBackendTextApi,
): CoreBackendTextLayout {
  const text_layout_hooks = {
    core_binding_value: api.core_binding_value,
    core_type_const_value: api.core_type_const_value,
    dynamic_union_if: api.dynamic_union_if,
    expr_type: api.expr_type,
    static_collection_fields: api.static_collection_fields,
    static_core_call_value: api.static_core_call_value,
    static_struct_value: api.static_struct_value,
    static_union_case: api.static_union_case,
  } satisfies CoreTextLayoutHooks;

  function build_text_layout(
    core: CoreNode,
    core_ctx: CoreCtx,
  ): TextLayout {
    return build_text_layout_with_hooks(core, core_ctx, text_layout_hooks);
  }

  return {
    build_text_layout,
  };
}
