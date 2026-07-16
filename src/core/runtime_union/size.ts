import type { CoreExpr } from "../ast.ts";
import { align_to } from "../memory.ts";
import {
  runtime_union_payload,
  runtime_union_payload_align,
  runtime_union_payload_size,
} from "../runtime_union_payload.ts";
import { resolve_core_type_name, type TypeStaticCtx } from "../type_static.ts";

export function runtime_union_type_size<ctx extends TypeStaticCtx>(
  type_value: Extract<CoreExpr, { tag: "union_type" }>,
  ctx: ctx,
): number {
  return runtime_union_type_layout(type_value, ctx).size;
}

export type RuntimeUnionLayout = {
  size: number;
  align: 8 | 16;
  payload_offset: number;
};

export function runtime_union_type_layout<ctx extends TypeStaticCtx>(
  type_value: Extract<CoreExpr, { tag: "union_type" }>,
  ctx: ctx,
): RuntimeUnionLayout {
  let max_payload = 0;
  let max_payload_align = 1;

  for (const union_case of type_value.cases) {
    const resolved_type_name = resolve_core_type_name(
      union_case.type_name,
      ctx,
    );

    if (resolved_type_name === "Unit") {
      continue;
    }

    const payload = runtime_union_payload(resolved_type_name, ctx);
    const payload_size = runtime_union_payload_size(payload);
    const payload_align = runtime_union_payload_align(payload);

    if (payload_size > max_payload) {
      max_payload = payload_size;
    }

    if (payload_align > max_payload_align) {
      max_payload_align = payload_align;
    }
  }

  let align: 8 | 16 = 8;
  let payload_offset = 4;

  if (max_payload_align === 16) {
    align = 16;
    payload_offset = align_to(4, align);
  }

  return {
    size: align_to(payload_offset + max_payload, align),
    align,
    payload_offset,
  };
}
