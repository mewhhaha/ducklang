import { closure_heap_global } from "../closure_runtime.ts";
import { scratch_heap_global } from "../scratch.ts";
import type { RuntimeTextEmitCtx } from "./types.ts";

export function runtime_text_alloc_heap(ctx: RuntimeTextEmitCtx): string {
  if (ctx.scratch_return_resets.length > 0) {
    ctx.scratch.needed = true;
    return scratch_heap_global;
  }

  ctx.heap.needed = true;
  return closure_heap_global;
}
