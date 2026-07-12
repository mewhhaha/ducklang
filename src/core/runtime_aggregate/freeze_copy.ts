import { expect } from "../../expect.ts";
import type { ValType } from "../../op.ts";
import type { Wat } from "../../wat.ts";
import type { CoreExpr } from "../ast.ts";
import { emit_persistent_alloc } from "../runtime_allocator.ts";
import { store_instr } from "../memory.ts";
import {
  declare_runtime_text_slice_locals,
  emit_runtime_text_freeze_copy,
  runtime_text_slice_plan,
} from "../runtime_text.ts";
import type { TypeStaticCtx } from "../type_static.ts";
import {
  runtime_aggregate_layout_for_type,
  type RuntimeAggregateField,
} from "./layout.ts";
import {
  declare_runtime_aggregate_locals,
  runtime_aggregate_plan,
} from "./plan.ts";
import type {
  RuntimeAggregateEmitCtx,
  RuntimeAggregateFreezeCopyHooks,
  RuntimeAggregateFreezeCopyLocalHooks,
  RuntimeAggregateFreezeCopySupportHooks,
  RuntimeAggregateTempCtx,
} from "./types.ts";

export function emit_runtime_aggregate_freeze_copy<
  ctx extends RuntimeAggregateEmitCtx & TypeStaticCtx,
>(
  subject: CoreExpr,
  source: CoreExpr,
  type_expr: CoreExpr,
  ctx: ctx,
  hooks: RuntimeAggregateFreezeCopyHooks<ctx>,
): Wat {
  const layout = runtime_aggregate_layout_for_type(type_expr, ctx);
  const plan = runtime_aggregate_plan(ctx);
  declare_runtime_aggregate_locals(plan, ctx);
  ctx.heap.needed = true;
  const lines = [
    emit_persistent_alloc(
      ctx,
      subject,
      "i32.const " + layout.size.toString(),
      8,
      "runtime_aggregate",
      "runtime_aggregate.aligned_fields",
      "runtime_aggregate.freeze_copy",
    ),
    "local.set $" + plan.local,
  ];

  emit_runtime_aggregate_freeze_copy_field_stores(
    subject,
    plan.local,
    source,
    layout.fields,
    ctx,
    hooks,
    lines,
  );

  lines.push("local.get $" + plan.local);
  return lines.join("\n");
}

export function declare_runtime_aggregate_freeze_copy_locals<
  ctx extends RuntimeAggregateTempCtx & TypeStaticCtx & { next_loop: number },
>(
  type_expr: CoreExpr,
  ctx: ctx,
  hooks?: RuntimeAggregateFreezeCopyLocalHooks<ctx>,
): void {
  const plan = runtime_aggregate_plan(ctx);
  declare_runtime_aggregate_locals(plan, ctx);
  const layout = runtime_aggregate_layout_for_type(type_expr, ctx);
  declare_runtime_aggregate_freeze_field_copy_locals(
    layout.fields,
    ctx,
    hooks,
  );
}

export function runtime_aggregate_freeze_copy_supported<
  ctx extends TypeStaticCtx,
>(
  type_expr: CoreExpr,
  ctx: ctx,
  hooks?: RuntimeAggregateFreezeCopySupportHooks<ctx>,
): boolean {
  const layout = runtime_aggregate_layout_for_type(type_expr, ctx);
  return runtime_aggregate_freeze_fields_supported(layout.fields, ctx, hooks);
}

function emit_runtime_aggregate_freeze_copy_field_stores<
  ctx extends RuntimeAggregateEmitCtx & TypeStaticCtx,
>(
  subject: CoreExpr,
  local_name: string,
  source: CoreExpr,
  fields: RuntimeAggregateField[],
  ctx: ctx,
  hooks: RuntimeAggregateFreezeCopyHooks<ctx>,
  lines: string[],
): void {
  for (const field_info of fields) {
    if (field_info.tag === "unit") {
      continue;
    }

    const source_field: CoreExpr = {
      tag: "field",
      object: source,
      name: field_info.name,
    };

    if (field_info.tag === "struct") {
      emit_runtime_aggregate_freeze_copy_field_stores(
        subject,
        local_name,
        source_field,
        field_info.fields,
        ctx,
        hooks,
        lines,
      );
      continue;
    }

    lines.push("local.get $" + local_name);

    if (field_info.union_type_expr) {
      const source_type = hooks.runtime_union_type_expr(source_field, ctx);
      expect(
        source_type &&
          hooks.same_runtime_union_type_expr(
            field_info.union_type_expr,
            source_type,
            ctx,
          ),
        "Core runtime aggregate field " + field_info.name +
          " expects a matching union value",
      );
      lines.push(
        hooks.emit_runtime_union_freeze_copy(
          subject,
          source_field,
          field_info.union_type_expr,
          ctx,
          hooks,
        ),
      );
    } else if (field_info.text) {
      lines.push(
        emit_runtime_text_freeze_copy(subject, source_field, ctx, {
          emit_expr: hooks.emit_expr,
        }),
      );
    } else {
      lines.push(hooks.emit_expr(source_field, ctx));
    }

    lines.push(store_instr(field_info.type, field_info.offset));
  }
}

function runtime_aggregate_freeze_fields_supported<ctx extends TypeStaticCtx>(
  fields: RuntimeAggregateField[],
  ctx: ctx,
  hooks: RuntimeAggregateFreezeCopySupportHooks<ctx> | undefined,
): boolean {
  for (const field of fields) {
    if (field.tag === "unit") {
      continue;
    }

    if (field.tag === "struct") {
      if (
        !runtime_aggregate_freeze_fields_supported(field.fields, ctx, hooks)
      ) {
        return false;
      }

      continue;
    }

    if (field.union_type_expr) {
      if (!hooks) {
        return false;
      }

      if (
        !hooks.runtime_union_freeze_copy_supported(field.union_type_expr, ctx)
      ) {
        return false;
      }
    }
  }

  return true;
}

function declare_runtime_aggregate_freeze_field_copy_locals<
  ctx extends {
    locals: Map<string, ValType>;
    next_temp: number;
    next_loop: number;
  } & TypeStaticCtx,
>(
  fields: RuntimeAggregateField[],
  ctx: ctx,
  hooks: RuntimeAggregateFreezeCopyLocalHooks<ctx> | undefined,
): void {
  for (const field of fields) {
    if (field.tag === "unit") {
      continue;
    }

    if (field.tag === "struct") {
      declare_runtime_aggregate_freeze_field_copy_locals(
        field.fields,
        ctx,
        hooks,
      );
      continue;
    }

    if (field.union_type_expr) {
      if (
        hooks && hooks.runtime_union_freeze_copy_supported(
          field.union_type_expr,
          ctx,
        )
      ) {
        hooks.declare_runtime_union_freeze_copy_locals(
          field.union_type_expr,
          ctx,
        );
      }

      continue;
    }

    if (field.text) {
      const locals = runtime_text_slice_plan(ctx);
      declare_runtime_text_slice_locals(locals, ctx);
    }
  }
}
