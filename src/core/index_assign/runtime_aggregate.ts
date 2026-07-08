import { expect } from "../../expect.ts";
import type { ValType } from "../../op.ts";
import type { Wat } from "../../wat.ts";
import type { CoreExpr } from "../ast.ts";
import {
  fresh_temp_local,
  indent_lines,
  maybe_static_i32,
  set_local,
} from "../backend/util.ts";
import { load_instr, store_instr } from "../memory.ts";
import {
  runtime_aggregate_layout_for_type,
  type RuntimeAggregateField,
} from "../runtime_aggregate.ts";
import type { TypeStaticCtx } from "../type_static.ts";
import type {
  CoreIndexAssignCtx,
  CoreIndexAssignHooks,
  CoreIndexAssignStmt,
  RuntimeAggregateIndexAssignPlan,
} from "./types.ts";

export function plan_core_runtime_aggregate_index_assign<
  ctx extends CoreIndexAssignCtx & TypeStaticCtx,
>(
  type_expr: CoreExpr,
  stmt: CoreIndexAssignStmt,
  ctx: ctx,
  hooks: Pick<
    CoreIndexAssignHooks<ctx, ctx>,
    | "core_expr_is_text"
    | "expr_type"
    | "runtime_aggregate_type_expr"
    | "runtime_union_type_expr"
    | "same_runtime_aggregate_type_expr"
    | "same_runtime_union_type_expr"
  >,
): RuntimeAggregateIndexAssignPlan {
  const target_type = ctx.locals.get(stmt.name);
  expect(
    target_type === "i32",
    "Core runtime aggregate index assignment target must be an i32 pointer",
  );
  const index_type = hooks.expr_type(stmt.index, ctx);
  expect(
    index_type === "i32",
    "Core runtime aggregate index assignment index must be i32",
  );
  const value_type = hooks.expr_type(stmt.value, ctx);
  const value_is_text = hooks.core_expr_is_text(stmt.value, ctx);
  const value_aggregate_type = hooks.runtime_aggregate_type_expr(
    stmt.value,
    ctx,
  );
  const value_union_type = hooks.runtime_union_type_expr(stmt.value, ctx);
  const layout = runtime_aggregate_layout_for_type(type_expr, ctx);
  expect(
    layout.fields.length > 0,
    "Core runtime aggregate index assignment requires a non-empty layout",
  );
  const static_index = maybe_static_i32(stmt.index);
  let index_local: string | undefined;
  let value_local: string | undefined;

  if (static_index !== undefined) {
    const field = static_indexed_runtime_aggregate_field(
      layout.fields,
      static_index,
    );
    expect_runtime_aggregate_index_assign_type(
      field,
      value_type,
      value_is_text,
      value_aggregate_type,
      value_union_type,
      false,
      ctx,
      hooks,
    );
    if (field.tag === "struct") {
      value_local = fresh_temp_local(ctx, "aggregate_value");
      set_local(ctx.locals, value_local, value_type);
    }
  } else {
    let dynamic_field_kind: RuntimeAggregateIndexAssignFieldKind | undefined;

    for (const field of layout.fields) {
      const field_kind = runtime_aggregate_index_assign_field_kind(
        field,
      );

      if (!dynamic_field_kind) {
        dynamic_field_kind = field_kind;
      } else {
        expect(
          dynamic_field_kind === field_kind,
          "Core runtime aggregate dynamic index assignment field text fact mismatch",
        );
      }

      expect_runtime_aggregate_index_assign_type(
        field,
        value_type,
        value_is_text,
        value_aggregate_type,
        value_union_type,
        true,
        ctx,
        hooks,
      );
    }

    index_local = fresh_temp_local(ctx, "aggregate_index");
    set_local(ctx.locals, index_local, "i32");
    value_local = fresh_temp_local(ctx, "aggregate_value");
    set_local(ctx.locals, value_local, value_type);
  }

  return {
    fields: layout.fields,
    index_local,
    static_index,
    value_local,
    value_type,
  };
}

export function emit_core_runtime_aggregate_index_assign<
  ctx extends CoreIndexAssignCtx & TypeStaticCtx,
>(
  type_expr: CoreExpr,
  stmt: CoreIndexAssignStmt,
  ctx: ctx,
  hooks: Pick<
    CoreIndexAssignHooks<ctx, ctx>,
    | "core_expr_is_text"
    | "emit_expr"
    | "expr_type"
    | "runtime_aggregate_type_expr"
    | "runtime_union_type_expr"
    | "same_runtime_aggregate_type_expr"
    | "same_runtime_union_type_expr"
  >,
): Wat {
  const static_index = maybe_static_i32(stmt.index);

  if (static_index !== undefined) {
    const value = hooks.emit_expr(stmt.value, ctx);
    const plan = plan_core_runtime_aggregate_index_assign(
      type_expr,
      stmt,
      ctx,
      hooks,
    );
    const field = static_indexed_runtime_aggregate_field(
      plan.fields,
      static_index,
    );
    return emit_static_runtime_aggregate_index_assign(
      stmt.name,
      field,
      value,
      plan,
      ctx,
    );
  }

  const index = hooks.emit_expr(stmt.index, ctx);
  const value = hooks.emit_expr(stmt.value, ctx);
  const plan = plan_core_runtime_aggregate_index_assign(
    type_expr,
    stmt,
    ctx,
    hooks,
  );
  expect(
    plan.index_local,
    "Missing runtime aggregate index assignment index local",
  );
  expect(
    plan.value_local,
    "Missing runtime aggregate index assignment value local",
  );

  return [
    index,
    "local.set $" + plan.index_local,
    value,
    "local.set $" + plan.value_local,
    emit_dynamic_runtime_aggregate_index_assign(stmt.name, plan, ctx),
  ].join("\n");
}

function emit_static_runtime_aggregate_index_assign<
  ctx extends CoreIndexAssignCtx & TypeStaticCtx,
>(
  name: string,
  field: RuntimeAggregateField,
  value: Wat,
  plan: RuntimeAggregateIndexAssignPlan,
  ctx: ctx,
): Wat {
  if (field.tag === "value") {
    return [
      "local.get $" + name,
      value,
      store_instr(field.type, field.offset),
    ].join("\n");
  }

  expect(
    field.tag === "struct",
    "Core runtime aggregate index assignment only supports scalar, Text, union-pointer, and nested aggregate fields: " +
      field.name,
  );
  expect(
    plan.value_local,
    "Missing runtime aggregate static nested index assignment value local",
  );
  return [
    value,
    "local.set $" + plan.value_local,
    emit_runtime_aggregate_index_assign_stores(name, field, plan, ctx),
  ].join("\n");
}

function emit_dynamic_runtime_aggregate_index_assign<
  ctx extends TypeStaticCtx,
>(
  name: string,
  plan: RuntimeAggregateIndexAssignPlan,
  ctx: ctx,
): Wat {
  expect(
    plan.index_local,
    "Missing runtime aggregate dynamic index assignment index local",
  );
  expect(
    plan.value_local,
    "Missing runtime aggregate dynamic index assignment value local",
  );
  let result = "unreachable";

  for (let index = plan.fields.length - 1; index >= 0; index -= 1) {
    const field = plan.fields[index];
    expect(
      field,
      "Missing runtime aggregate field " + index.toString(),
    );
    result = [
      "local.get $" + plan.index_local,
      "i32.const " + index.toString(),
      "i32.eq",
      "if",
      indent_lines(
        emit_runtime_aggregate_index_assign_stores(name, field, plan, ctx),
        2,
      ),
      "else",
      indent_lines(result, 2),
      "end",
    ].join("\n");
  }

  return result;
}

function emit_runtime_aggregate_index_assign_stores<
  ctx extends TypeStaticCtx,
>(
  name: string,
  field: RuntimeAggregateField,
  plan: RuntimeAggregateIndexAssignPlan,
  ctx?: ctx,
): Wat {
  expect(
    plan.value_local,
    "Missing runtime aggregate index assignment value local",
  );

  if (field.tag === "value") {
    return [
      "local.get $" + name,
      "local.get $" + plan.value_local,
      store_instr(field.type, field.offset),
    ].join("\n");
  }

  expect(
    field.tag === "struct",
    "Core runtime aggregate index assignment only supports scalar, Text, union-pointer, and nested aggregate fields: " +
      field.name,
  );
  expect(
    ctx,
    "Core runtime aggregate nested index assignment requires type context",
  );
  const source_layout = runtime_aggregate_layout_for_type(field.type_expr, ctx);
  const source_fields = runtime_aggregate_index_assign_value_fields(
    source_layout.fields,
  );
  const target_fields = runtime_aggregate_index_assign_value_fields(
    field.fields,
  );
  expect(
    source_fields.length === target_fields.length,
    "Core runtime aggregate nested index assignment layout mismatch",
  );
  const lines: string[] = [];

  for (let index = 0; index < source_fields.length; index += 1) {
    const source_field = source_fields[index];
    const target_field = target_fields[index];
    expect(source_field, "Missing nested source field " + index.toString());
    expect(target_field, "Missing nested target field " + index.toString());
    lines.push("local.get $" + name);
    lines.push("local.get $" + plan.value_local);
    lines.push(load_instr(source_field.type, source_field.offset));
    lines.push(store_instr(target_field.type, target_field.offset));
  }

  return lines.join("\n");
}

function static_indexed_runtime_aggregate_field(
  fields: RuntimeAggregateField[],
  index: number,
): RuntimeAggregateField {
  if (index < 0 || index >= fields.length) {
    throw new Error("Index out of bounds: " + index.toString());
  }

  const field = fields[index];
  expect(
    field,
    "Missing runtime aggregate field " + index.toString(),
  );
  return field;
}

function runtime_aggregate_index_assign_value_fields(
  fields: RuntimeAggregateField[],
): Array<Extract<RuntimeAggregateField, { tag: "value" }>> {
  const result: Array<Extract<RuntimeAggregateField, { tag: "value" }>> = [];

  for (const field of fields) {
    if (field.tag === "unit") {
      continue;
    }

    if (field.tag === "struct") {
      result.push(...runtime_aggregate_index_assign_value_fields(field.fields));
      continue;
    }

    result.push(field);
  }

  return result;
}

function runtime_aggregate_index_assign_supported_field(
  field: RuntimeAggregateField,
): Extract<RuntimeAggregateField, { tag: "value" | "struct" }> {
  expect(
    field.tag === "value" || field.tag === "struct",
    "Core runtime aggregate index assignment only supports scalar, Text, union-pointer, and nested aggregate fields: " +
      field.name,
  );
  return field;
}

type RuntimeAggregateIndexAssignFieldKind =
  | "scalar"
  | "text"
  | "union"
  | "struct";

function runtime_aggregate_index_assign_field_kind(
  field: RuntimeAggregateField,
): RuntimeAggregateIndexAssignFieldKind {
  const supported = runtime_aggregate_index_assign_supported_field(field);

  if (supported.tag === "struct") {
    return "struct";
  }

  if (supported.text) {
    return "text";
  }

  if (supported.union_type_expr) {
    return "union";
  }

  return "scalar";
}

function expect_runtime_aggregate_index_assign_type<
  ctx extends CoreIndexAssignCtx,
>(
  field: RuntimeAggregateField,
  value_type: ValType,
  value_is_text: boolean,
  value_aggregate_type: CoreExpr | undefined,
  value_union_type: CoreExpr | undefined,
  dynamic: boolean,
  ctx: ctx,
  hooks: Pick<
    CoreIndexAssignHooks<ctx, ctx>,
    "same_runtime_aggregate_type_expr" | "same_runtime_union_type_expr"
  >,
): void {
  let prefix = "Core runtime aggregate index assignment field ";

  if (dynamic) {
    prefix = "Core runtime aggregate dynamic index assignment field ";
  }

  const supported = runtime_aggregate_index_assign_supported_field(field);

  if (supported.tag === "struct") {
    expect(
      !value_is_text,
      prefix + supported.name + " expects a matching aggregate value, got Text",
    );
    expect(
      !value_union_type,
      prefix + supported.name +
        " expects a matching aggregate value, got union value",
    );
    expect(
      value_type === "i32",
      prefix + supported.name + " expects i32, got " + value_type,
    );
    expect(
      hooks.same_runtime_aggregate_type_expr(
        supported.type_expr,
        value_aggregate_type,
        ctx,
      ),
      prefix + supported.name + " expects a matching aggregate value",
    );
    return;
  }

  if (supported.union_type_expr) {
    expect(
      !value_is_text,
      prefix + supported.name + " expects a matching union value, got Text",
    );
    expect(
      value_type === "i32",
      prefix + supported.name + " expects i32, got " + value_type,
    );
    expect(
      hooks.same_runtime_union_type_expr(
        supported.union_type_expr,
        value_union_type,
        ctx,
      ),
      prefix + supported.name + " expects a matching union value",
    );
    return;
  }

  if (supported.text) {
    expect(
      value_is_text,
      prefix + supported.name + " expects Text",
    );
    expect(
      value_type === "i32",
      prefix + supported.name + " expects i32, got " + value_type,
    );
    return;
  }

  expect(
    !value_is_text,
    prefix + supported.name + " expects " + supported.type + ", got Text",
  );
  expect(
    !value_union_type,
    prefix + supported.name + " expects " + supported.type +
      ", got union value",
  );
  expect(
    !value_aggregate_type,
    prefix + supported.name + " expects " + supported.type +
      ", got aggregate value",
  );
  expect(
    value_type === supported.type,
    prefix + supported.name + " expects " + supported.type + ", got " +
      value_type,
  );
}
