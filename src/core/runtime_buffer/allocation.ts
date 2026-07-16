import type { CoreExpr } from "../ast.ts";
import { closure_heap_global } from "../closure_runtime.ts";
import {
  consume_scratch_alloc,
  emit_persistent_alloc,
} from "../runtime_allocator.ts";
import { runtime_text_alloc_heap } from "../runtime_text/alloc.ts";
import type { RuntimeTextEmitCtx } from "../runtime_text/types.ts";
import type { CoreRuntimeBufferBuiltin } from "../runtime_buffer.ts";
import { runtime_buffer_allocation } from "../runtime_buffer.ts";

export function emit_runtime_buffer_allocation<
  ctx extends RuntimeTextEmitCtx,
>(
  subject: CoreExpr,
  builtin: CoreRuntimeBufferBuiltin,
  length_local: string,
  result_local: string,
  ctx: ctx,
): string[] {
  const heap_name = runtime_text_alloc_heap(ctx);
  const allocation = runtime_buffer_allocation(builtin);

  if (heap_name === closure_heap_global) {
    return [
      emit_persistent_alloc(
        ctx,
        subject,
        "local.get $" + length_local + "\ni32.const 4\ni32.add",
        8,
        allocation.reason,
        allocation.layout,
        allocation.emission_site,
      ),
      "local.set $" + result_local,
    ];
  }

  consume_scratch_alloc(
    ctx,
    subject,
    allocation.reason,
    allocation.layout,
    allocation.emission_site,
  );
  return [
    "global.get $" + heap_name,
    "local.set $" + result_local,
    "global.get $" + heap_name,
    "local.get $" + length_local,
    "i32.const 4",
    "i32.add",
    "i32.const 7",
    "i32.add",
    "i32.const -8",
    "i32.and",
    "i32.add",
    "global.set $" + heap_name,
  ];
}
