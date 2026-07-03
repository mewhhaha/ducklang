import { expect } from "../expect.ts";
import type { ValType } from "../op.ts";
import type { Wat } from "../wat.ts";
import type { CoreExpr, CoreStmt } from "./ast.ts";
import { fresh_temp_local, indent_lines, set_local } from "./backend/util.ts";
import { closure_heap_global } from "./closure_runtime.ts";
import { type CoreScratchHeap, scratch_heap_global } from "./scratch.ts";
import type { RuntimeTextEq } from "./text_facts.ts";

export type RuntimeTextHeap = {
  needed: boolean;
};

type RuntimeTextTempCtx = {
  locals: Map<string, ValType>;
  next_temp: number;
};

type RuntimeTextLoopCtx = RuntimeTextTempCtx & {
  next_loop: number;
};

type RuntimeTextEmitCtx = RuntimeTextLoopCtx & {
  heap: RuntimeTextHeap;
  scratch: CoreScratchHeap;
  scratch_return_resets: string[];
};

export type RuntimeTextHooks<ctx> = {
  emit_expr: (expr: CoreExpr, ctx: ctx) => Wat;
  expr_type: (expr: CoreExpr, ctx: ctx) => ValType;
  runtime_text_concat_operands: (
    expr: CoreExpr,
    ctx: ctx,
  ) => [CoreExpr, CoreExpr] | undefined;
  runtime_text_eq_operands: (
    expr: CoreExpr,
    ctx: ctx,
  ) => RuntimeTextEq | undefined;
};

export type RuntimeTextConcatPlan = {
  id: number;
  result: string;
  left: string;
  right: string;
  left_len: string;
  right_len: string;
  total_len: string;
  index: string;
};

export type RuntimeTextIndexAssignPlan = {
  index: string;
  value: string;
};

export type RuntimeTextEqPlan = {
  id: number;
  left: string;
  right: string;
  left_len: string;
  right_len: string;
  index: string;
  result: string;
};

export type RuntimeTextSlicePlan = {
  id: number;
  text: string;
  start: string;
  end: string;
  source_len: string;
  result: string;
  slice_len: string;
  index: string;
};

export function runtime_text_concat_plan(
  ctx: RuntimeTextLoopCtx,
): RuntimeTextConcatPlan {
  const id = ctx.next_loop;
  ctx.next_loop += 1;

  return {
    id,
    result: fresh_temp_local(ctx, "text_concat_result"),
    left: fresh_temp_local(ctx, "text_concat_left"),
    right: fresh_temp_local(ctx, "text_concat_right"),
    left_len: fresh_temp_local(ctx, "text_concat_left_len"),
    right_len: fresh_temp_local(ctx, "text_concat_right_len"),
    total_len: fresh_temp_local(ctx, "text_concat_total_len"),
    index: fresh_temp_local(ctx, "text_concat_index"),
  };
}

export function runtime_text_eq_plan(
  ctx: RuntimeTextLoopCtx,
): RuntimeTextEqPlan {
  const id = ctx.next_loop;
  ctx.next_loop += 1;

  return {
    id,
    left: fresh_temp_local(ctx, "text_eq_left"),
    right: fresh_temp_local(ctx, "text_eq_right"),
    left_len: fresh_temp_local(ctx, "text_eq_left_len"),
    right_len: fresh_temp_local(ctx, "text_eq_right_len"),
    index: fresh_temp_local(ctx, "text_eq_index"),
    result: fresh_temp_local(ctx, "text_eq_result"),
  };
}

export function runtime_text_slice_plan(
  ctx: RuntimeTextLoopCtx,
): RuntimeTextSlicePlan {
  const id = ctx.next_loop;
  ctx.next_loop += 1;

  return {
    id,
    text: fresh_temp_local(ctx, "text_slice_text"),
    start: fresh_temp_local(ctx, "text_slice_start"),
    end: fresh_temp_local(ctx, "text_slice_end"),
    source_len: fresh_temp_local(ctx, "text_slice_source_len"),
    result: fresh_temp_local(ctx, "text_slice_result"),
    slice_len: fresh_temp_local(ctx, "text_slice_len"),
    index: fresh_temp_local(ctx, "text_slice_index"),
  };
}

export function runtime_text_index_assign_plan(
  ctx: RuntimeTextTempCtx,
): RuntimeTextIndexAssignPlan {
  return {
    index: fresh_temp_local(ctx, "text_assign_index"),
    value: fresh_temp_local(ctx, "text_assign_value"),
  };
}

export function declare_runtime_text_concat_locals(
  locals: RuntimeTextConcatPlan,
  ctx: { locals: Map<string, ValType> },
): void {
  set_local(ctx.locals, locals.result, "i32");
  set_local(ctx.locals, locals.left, "i32");
  set_local(ctx.locals, locals.right, "i32");
  set_local(ctx.locals, locals.left_len, "i32");
  set_local(ctx.locals, locals.right_len, "i32");
  set_local(ctx.locals, locals.total_len, "i32");
  set_local(ctx.locals, locals.index, "i32");
}

export function declare_runtime_text_eq_locals(
  locals: RuntimeTextEqPlan,
  ctx: { locals: Map<string, ValType> },
): void {
  set_local(ctx.locals, locals.left, "i32");
  set_local(ctx.locals, locals.right, "i32");
  set_local(ctx.locals, locals.left_len, "i32");
  set_local(ctx.locals, locals.right_len, "i32");
  set_local(ctx.locals, locals.index, "i32");
  set_local(ctx.locals, locals.result, "i32");
}

export function declare_runtime_text_slice_locals(
  locals: RuntimeTextSlicePlan,
  ctx: { locals: Map<string, ValType> },
): void {
  set_local(ctx.locals, locals.text, "i32");
  set_local(ctx.locals, locals.start, "i32");
  set_local(ctx.locals, locals.end, "i32");
  set_local(ctx.locals, locals.source_len, "i32");
  set_local(ctx.locals, locals.result, "i32");
  set_local(ctx.locals, locals.slice_len, "i32");
  set_local(ctx.locals, locals.index, "i32");
}

export function declare_runtime_text_index_assign_locals(
  locals: RuntimeTextIndexAssignPlan,
  ctx: { locals: Map<string, ValType> },
): void {
  set_local(ctx.locals, locals.index, "i32");
  set_local(ctx.locals, locals.value, "i32");
}

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

  const lines = [
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
    "global.get $" + heap_name,
    "local.set $" + locals.result,
    "global.get $" + heap_name,
    "local.get $" + locals.total_len,
    "i32.const 4",
    "i32.add",
    "i32.const 7",
    "i32.add",
    "i32.const -8",
    "i32.and",
    "i32.add",
    "global.set $" + heap_name,
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
  ];

  return lines.join("\n");
}

export function emit_runtime_text_eq<ctx extends RuntimeTextEmitCtx>(
  expr: Extract<CoreExpr, { tag: "prim" }>,
  ctx: ctx,
  hooks: RuntimeTextHooks<ctx>,
): Wat {
  const operands = hooks.runtime_text_eq_operands(expr, ctx);
  expect(operands, "Core runtime text equality requires text operands");
  const left_wat = hooks.emit_expr(operands.left, ctx);
  const right_wat = hooks.emit_expr(operands.right, ctx);
  const locals = runtime_text_eq_plan(ctx);
  declare_runtime_text_eq_locals(locals, ctx);
  const exit_label = "text_eq_exit_" + locals.id.toString();
  const loop_label = "text_eq_loop_" + locals.id.toString();
  const lines = [
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
    "i32.const 1",
    "local.set $" + locals.result,
    "local.get $" + locals.left_len,
    "local.get $" + locals.right_len,
    "i32.ne",
    "if",
    "  i32.const 0",
    "  local.set $" + locals.result,
    "else",
    indent_lines(
      [
        "i32.const 0",
        "local.set $" + locals.index,
        "block $" + exit_label,
        "  loop $" + loop_label,
        "    local.get $" + locals.index,
        "    local.get $" + locals.left_len,
        "    i32.ge_s",
        "    br_if $" + exit_label,
        indent_lines(
          [
            "local.get $" + locals.left,
            "i32.const 4",
            "i32.add",
            "local.get $" + locals.index,
            "i32.add",
            "i32.load8_u",
            "local.get $" + locals.right,
            "i32.const 4",
            "i32.add",
            "local.get $" + locals.index,
            "i32.add",
            "i32.load8_u",
            "i32.ne",
            "if",
            "  i32.const 0",
            "  local.set $" + locals.result,
            "  br $" + exit_label,
            "end",
            "local.get $" + locals.index,
            "i32.const 1",
            "i32.add",
            "local.set $" + locals.index,
            "br $" + loop_label,
          ].join("\n"),
          4,
        ),
        "  end",
        "end",
      ].join("\n"),
      2,
    ),
    "end",
    "local.get $" + locals.result,
  ];

  if (operands.prim === "i32.ne") {
    lines.push("i32.eqz");
  }

  return lines.join("\n");
}

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

function runtime_text_alloc_heap(ctx: RuntimeTextEmitCtx): string {
  if (ctx.scratch_return_resets.length > 0) {
    ctx.scratch.needed = true;
    return scratch_heap_global;
  }

  ctx.heap.needed = true;
  return closure_heap_global;
}

export function emit_runtime_text_len<ctx>(
  text: CoreExpr,
  ctx: ctx,
  hooks: Pick<RuntimeTextHooks<ctx>, "emit_expr">,
): Wat {
  return [
    hooks.emit_expr(text, ctx),
    "i32.load",
  ].join("\n");
}

export function emit_runtime_text_byte_index<ctx>(
  text: CoreExpr,
  index: CoreExpr,
  ctx: ctx,
  hooks: Pick<RuntimeTextHooks<ctx>, "emit_expr" | "expr_type">,
): Wat {
  const index_type = hooks.expr_type(index, ctx);
  expect(index_type === "i32", "Core text byte index must be i32");
  return [
    hooks.emit_expr(index, ctx),
    "i32.const 0",
    "i32.lt_s",
    "if (result i32)",
    "  unreachable",
    "else",
    indent_lines(
      [
        hooks.emit_expr(index, ctx),
        emit_runtime_text_len(text, ctx, hooks),
        "i32.ge_s",
        "if (result i32)",
        "  unreachable",
        "else",
        indent_lines(
          [
            hooks.emit_expr(text, ctx),
            "i32.const 4",
            "i32.add",
            hooks.emit_expr(index, ctx),
            "i32.add",
            "i32.load8_u",
          ].join("\n"),
          2,
        ),
        "end",
      ].join("\n"),
      2,
    ),
    "end",
  ].join("\n");
}

export function emit_runtime_text_index_assign<ctx extends RuntimeTextTempCtx>(
  stmt: Extract<CoreStmt, { tag: "index_assign" }>,
  ctx: ctx,
  hooks: Pick<RuntimeTextHooks<ctx>, "emit_expr" | "expr_type">,
): Wat {
  const index_type = hooks.expr_type(stmt.index, ctx);
  const value_type = hooks.expr_type(stmt.value, ctx);
  expect(index_type === "i32", "Core text index assignment index must be i32");
  expect(value_type === "i32", "Core text index assignment value must be i32");
  const locals = runtime_text_index_assign_plan(ctx);
  declare_runtime_text_index_assign_locals(locals, ctx);

  return [
    hooks.emit_expr(stmt.index, ctx),
    "local.set $" + locals.index,
    hooks.emit_expr(stmt.value, ctx),
    "local.set $" + locals.value,
    "local.get $" + locals.index,
    "i32.const 0",
    "i32.lt_s",
    "if",
    "  unreachable",
    "else",
    indent_lines(
      [
        "local.get $" + locals.index,
        "local.get $" + stmt.name,
        "i32.load",
        "i32.ge_s",
        "if",
        "  unreachable",
        "else",
        indent_lines(
          [
            "local.get $" + stmt.name,
            "i32.const 4",
            "i32.add",
            "local.get $" + locals.index,
            "i32.add",
            "local.get $" + locals.value,
            "i32.store8",
          ].join("\n"),
          2,
        ),
        "end",
      ].join("\n"),
      2,
    ),
    "end",
  ].join("\n");
}

function emit_runtime_text_slice_copy(
  locals: RuntimeTextSlicePlan,
  exit_label: string,
  loop_label: string,
): Wat {
  return [
    "i32.const 0",
    "local.set $" + locals.index,
    "block $" + exit_label,
    "  loop $" + loop_label,
    "    local.get $" + locals.index,
    "    local.get $" + locals.slice_len,
    "    i32.ge_s",
    "    br_if $" + exit_label,
    indent_lines(
      [
        "local.get $" + locals.result,
        "i32.const 4",
        "i32.add",
        "local.get $" + locals.index,
        "i32.add",
        "local.get $" + locals.text,
        "i32.const 4",
        "i32.add",
        "local.get $" + locals.start,
        "i32.add",
        "local.get $" + locals.index,
        "i32.add",
        "i32.load8_u",
        "i32.store8",
        "local.get $" + locals.index,
        "i32.const 1",
        "i32.add",
        "local.set $" + locals.index,
        "br $" + loop_label,
      ].join("\n"),
      4,
    ),
    "  end",
    "end",
  ].join("\n");
}

function emit_runtime_text_concat_copy(
  locals: RuntimeTextConcatPlan,
  source: string,
  length: string,
  after_left: boolean,
): Wat {
  let side = "left";

  if (after_left) {
    side = "right";
  }

  const exit_label = "text_concat_" + side + "_exit_" +
    locals.id.toString();
  const loop_label = "text_concat_" + side + "_loop_" +
    locals.id.toString();
  const dest_prefix: string[] = [
    "local.get $" + locals.result,
    "i32.const 4",
    "i32.add",
  ];

  if (after_left) {
    dest_prefix.push("local.get $" + locals.left_len);
    dest_prefix.push("i32.add");
  }

  return [
    "i32.const 0",
    "local.set $" + locals.index,
    "block $" + exit_label,
    "  loop $" + loop_label,
    "    local.get $" + locals.index,
    "    local.get $" + length,
    "    i32.ge_s",
    "    br_if $" + exit_label,
    indent_lines(
      [
        ...dest_prefix,
        "local.get $" + locals.index,
        "i32.add",
        "local.get $" + source,
        "i32.const 4",
        "i32.add",
        "local.get $" + locals.index,
        "i32.add",
        "i32.load8_u",
        "i32.store8",
        "local.get $" + locals.index,
        "i32.const 1",
        "i32.add",
        "local.set $" + locals.index,
        "br $" + loop_label,
      ].join("\n"),
      4,
    ),
    "  end",
    "end",
  ].join("\n");
}
