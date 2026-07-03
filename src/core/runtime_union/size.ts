import type { CoreExpr } from "../ast.ts";
import { align_to } from "../memory.ts";
import {
  runtime_union_payload,
  runtime_union_payload_size,
} from "../runtime_union_payload.ts";
import { resolve_core_type_name, type TypeStaticCtx } from "../type_static.ts";

export function runtime_union_type_size<ctx extends TypeStaticCtx>(
  type_value: Extract<CoreExpr, { tag: "union_type" }>,
  ctx: ctx,
): number {
  let max_payload = 0;

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

    if (payload_size > max_payload) {
      max_payload = payload_size;
    }
  }

  return align_to(4 + max_payload, 8);
}
