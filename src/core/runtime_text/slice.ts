import { expect } from "../../expect.ts";
import type { Wat } from "../../wat.ts";
import type { CoreExpr } from "../ast.ts";
import { indent_lines } from "../backend/util.ts";
import { closure_heap_global } from "../closure_runtime.ts";
import { emit_runtime_text_slice_copy } from "./copy.ts";
import {
  declare_runtime_text_slice_locals,
  runtime_text_slice_plan,
} from "./plan.ts";
import { runtime_text_alloc_heap } from "./alloc.ts";
import type { RuntimeTextEmitCtx, RuntimeTextHooks } from "./types.ts";

export function emit_runtime_text_slice<ctx extends RuntimeTextEmitCtx>(
  text: CoreExpr,
  start: CoreExpr,
  end: CoreExpr,
  ctx: ctx,
  hooks: Pick<RuntimeTextHooks<ctx>, "emit_expr" | "expr_type">,
): Wat {
  const start_type = hooks.expr_type(start, ctx);
  const end_type = hooks.expr_type(end, ctx);
  expect(start_type === "i32", "Core text slice start must be i32");
  expect(end_type === "i32", "Core text slice end must be i32");
  const locals = runtime_text_slice_plan(ctx);
  declare_runtime_text_slice_locals(locals, ctx);
  const heap_name = runtime_text_alloc_heap(ctx);
  const exit_label = "text_slice_exit_" + locals.id.toString();
  const loop_label = "text_slice_loop_" + locals.id.toString();

  return [
    hooks.emit_expr(text, ctx),
    "local.set $" + locals.text,
    hooks.emit_expr(start, ctx),
    "local.set $" + locals.start,
    hooks.emit_expr(end, ctx),
    "local.set $" + locals.end,
    "local.get $" + locals.text,
    "i32.load",
    "local.set $" + locals.source_len,
    "local.get $" + locals.start,
    "i32.const 0",
    "i32.lt_s",
    "if",
    "  unreachable",
    "else",
    indent_lines(
      [
        "local.get $" + locals.end,
        "local.get $" + locals.start,
        "i32.lt_s",
        "if",
        "  unreachable",
        "else",
        indent_lines(
          [
            "local.get $" + locals.end,
            "local.get $" + locals.source_len,
            "i32.gt_s",
            "if",
            "  unreachable",
            "else",
            indent_lines(
              [
                "local.get $" + locals.end,
                "local.get $" + locals.start,
                "i32.sub",
                "local.set $" + locals.slice_len,
                "global.get $" + heap_name,
                "local.set $" + locals.result,
                "global.get $" + heap_name,
                "local.get $" + locals.slice_len,
                "i32.const 4",
                "i32.add",
                "i32.const 7",
                "i32.add",
                "i32.const -8",
                "i32.and",
                "i32.add",
                "global.set $" + heap_name,
                "local.get $" + locals.result,
                "local.get $" + locals.slice_len,
                "i32.store",
                emit_runtime_text_slice_copy(locals, exit_label, loop_label),
              ].join("\n"),
              2,
            ),
            "end",
          ].join("\n"),
          2,
        ),
        "end",
      ].join("\n"),
      2,
    ),
    "end",
    "local.get $" + locals.result,
  ].join("\n");
}

export function emit_runtime_text_freeze_copy<ctx extends RuntimeTextEmitCtx>(
  text: CoreExpr,
  ctx: ctx,
  hooks: Pick<RuntimeTextHooks<ctx>, "emit_expr">,
): Wat {
  const text_wat = hooks.emit_expr(text, ctx);
  return emit_runtime_text_freeze_copy_from_wat(text_wat, ctx);
}

export function emit_runtime_text_freeze_copy_from_wat<
  ctx extends RuntimeTextEmitCtx,
>(
  text_wat: Wat,
  ctx: ctx,
): Wat {
  const locals = runtime_text_slice_plan(ctx);
  declare_runtime_text_slice_locals(locals, ctx);
  const exit_label = "text_freeze_exit_" + locals.id.toString();
  const loop_label = "text_freeze_loop_" + locals.id.toString();
  ctx.heap.needed = true;

  return [
    text_wat,
    "local.set $" + locals.text,
    "i32.const 0",
    "local.set $" + locals.start,
    "local.get $" + locals.text,
    "i32.load",
    "local.set $" + locals.source_len,
    "local.get $" + locals.source_len,
    "local.set $" + locals.slice_len,
    "global.get $" + closure_heap_global,
    "local.set $" + locals.result,
    "global.get $" + closure_heap_global,
    "local.get $" + locals.slice_len,
    "i32.const 4",
    "i32.add",
    "i32.const 7",
    "i32.add",
    "i32.const -8",
    "i32.and",
    "i32.add",
    "global.set $" + closure_heap_global,
    "local.get $" + locals.result,
    "local.get $" + locals.slice_len,
    "i32.store",
    emit_runtime_text_slice_copy(locals, exit_label, loop_label),
    "local.get $" + locals.result,
  ].join("\n");
}
