import { expect } from "../../expect.ts";
import type { Wat } from "../../wat.ts";
import type { CoreExpr } from "../ast.ts";
import { closure_heap_global } from "../closure_runtime.ts";
import { emit_persistent_alloc } from "../runtime_allocator.ts";
import { emit_runtime_text_concat_copy } from "./copy.ts";
import {
  declare_runtime_text_concat_locals,
  runtime_text_concat_plan,
} from "./plan.ts";
import { runtime_text_alloc_heap } from "./alloc.ts";
import type { RuntimeTextEmitCtx, RuntimeTextHooks } from "./types.ts";

export function emit_runtime_text_concat<ctx extends RuntimeTextEmitCtx>(
  expr: Extract<CoreExpr, { tag: "prim" }>,
  ctx: ctx,
  hooks: RuntimeTextHooks<ctx>,
): Wat {
  const operands = hooks.runtime_text_concat_operands(expr, ctx);
  expect(operands, "Core runtime text concat requires text operands");
  const left = operands[0];
  const right = operands[1];
  return emit_runtime_text_append(left, right, ctx, hooks);
}

export function emit_runtime_text_append<ctx extends RuntimeTextEmitCtx>(
  left: CoreExpr,
  right: CoreExpr,
  ctx: ctx,
  hooks: Pick<RuntimeTextHooks<ctx>, "emit_expr">,
): Wat {
  const left_wat = hooks.emit_expr(left, ctx);
  const right_wat = hooks.emit_expr(right, ctx);
  const locals = runtime_text_concat_plan(ctx);
  declare_runtime_text_concat_locals(locals, ctx);
  const heap_name = runtime_text_alloc_heap(ctx);

  const lines: string[] = [
    left_wat,
    "local.set $" + locals.left,
    right_wat,
    "local.set $" + locals.right,
    "local.get $" + locals.left,
    "i32.load",
    "local.set $" + locals.left_len,
    "local.get $" + locals.right,
    "i32.load",
    "local.set $" + locals.right_len,
    "local.get $" + locals.left_len,
    "local.get $" + locals.right_len,
    "i32.add",
    "local.set $" + locals.total_len,
  ];

  if (heap_name === closure_heap_global) {
    lines.push(emit_persistent_alloc(
      "local.get $" + locals.total_len + "\ni32.const 4\ni32.add",
      8,
    ));
    lines.push("local.set $" + locals.result);
  } else {
    lines.push("global.get $" + heap_name);
    lines.push("local.set $" + locals.result);
    lines.push("global.get $" + heap_name);
    lines.push("local.get $" + locals.total_len);
    lines.push("i32.const 4");
    lines.push("i32.add");
    lines.push("i32.const 7");
    lines.push("i32.add");
    lines.push("i32.const -8");
    lines.push("i32.and");
    lines.push("i32.add");
    lines.push("global.set $" + heap_name);
  }

  lines.push(
    "local.get $" + locals.result,
    "local.get $" + locals.total_len,
    "i32.store",
    emit_runtime_text_concat_copy(
      locals,
      locals.left,
      locals.left_len,
      false,
    ),
    emit_runtime_text_concat_copy(
      locals,
      locals.right,
      locals.right_len,
      true,
    ),
    "local.get $" + locals.result,
  );

  return lines.join("\n");
}
