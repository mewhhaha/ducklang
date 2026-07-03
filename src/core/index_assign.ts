import { expect } from "../expect.ts";
import type { ValType } from "../op.ts";
import type { Wat } from "../wat.ts";
import type { CoreExpr, CoreField, CoreStmt } from "./ast.ts";
import {
  fresh_temp_local,
  indent_lines,
  maybe_static_i32,
  set_local,
  static_indexed_field,
} from "./backend/util.ts";
import { load_instr, store_instr } from "./memory.ts";
import {
  runtime_aggregate_layout_for_type,
  type RuntimeAggregateField,
} from "./runtime_aggregate.ts";
import type { TypeStaticCtx } from "./type_static.ts";

export type CoreIndexAssignCtx = {
  locals: Map<string, ValType>;
  next_temp: number;
};

export type CoreIndexAssignHooks<
  ctx extends CoreIndexAssignCtx,
  emit_ctx extends ctx,
> = {
  core_expr_is_text: (expr: CoreExpr, ctx: ctx) => boolean;
  emit_expr: (expr: CoreExpr, ctx: emit_ctx) => Wat;
  expr_type: (expr: CoreExpr, ctx: ctx) => ValType;
  is_stable_static_expr: (expr: CoreExpr) => boolean;
  plan_static_value_expr: (
    expr: CoreExpr,
    ctx: ctx,
    emit_ctx: emit_ctx | undefined,
  ) => CoreIndexAssignValuePlan;
  runtime_union_type_expr: (
    expr: CoreExpr,
    ctx: ctx,
  ) => CoreExpr | undefined;
  runtime_aggregate_type_expr: (
    expr: CoreExpr,
    ctx: ctx,
  ) => CoreExpr | undefined;
  same_runtime_aggregate_type_expr: (
    left: CoreExpr | undefined,
    right: CoreExpr | undefined,
    ctx: ctx,
  ) => boolean;
  same_runtime_union_type_expr: (
    left: CoreExpr | undefined,
    right: CoreExpr | undefined,
    ctx: ctx,
  ) => boolean;
  static_text_value: (
    expr: CoreExpr,
    ctx: ctx,
  ) => CoreExpr | undefined;
};

export type StaticIndexAssignPlan = {
  value: Extract<CoreExpr, { tag: "struct_value" }>;
  setup: Wat;
};

export type RuntimeAggregateIndexAssignPlan = {
  fields: RuntimeAggregateField[];
  static_index: number | undefined;
  index_local: string | undefined;
  value_local: string | undefined;
  value_type: ValType;
};

type CoreIndexAssignValuePlan = {
  value: CoreExpr;
  setup: Wat;
};

export function plan_core_static_index_assign<
  ctx extends CoreIndexAssignCtx,
  emit_ctx extends ctx,
>(
  target: Extract<CoreExpr, { tag: "struct_value" }>,
  index_expr: CoreExpr,
  value: CoreExpr,
  ctx: ctx,
  emit_ctx: emit_ctx | undefined,
  hooks: CoreIndexAssignHooks<ctx, emit_ctx>,
): StaticIndexAssignPlan {
  const index_type = hooks.expr_type(index_expr, ctx);
  expect(index_type === "i32", "Core index assignment index must be i32");
  const value_type = hooks.expr_type(value, ctx);
  const static_index = maybe_static_i32(index_expr);
  const setup: string[] = [];
  let resolved_index = index_expr;
  let value_expr = value;

  if (static_index === undefined) {
    const index_name = fresh_temp_local(ctx, "index");
    set_local(ctx.locals, index_name, "i32");

    if (emit_ctx) {
      setup.push(hooks.emit_expr(index_expr, emit_ctx));
      setup.push("local.set $" + index_name);
    }

    resolved_index = { tag: "var", name: index_name };
  }

  const text_value = hooks.static_text_value(value, ctx);

  if (text_value) {
    const planned = hooks.plan_static_value_expr(text_value, ctx, emit_ctx);
    value_expr = planned.value;

    if (planned.setup !== "") {
      setup.push(planned.setup);
    }
  } else {
    if (!hooks.is_stable_static_expr(value)) {
      const value_name = fresh_temp_local(ctx, "index_value");
      set_local(ctx.locals, value_name, value_type);

      if (emit_ctx) {
        setup.push(hooks.emit_expr(value, emit_ctx));
        setup.push("local.set $" + value_name);
      }

      value_expr = { tag: "var", name: value_name };
    }
  }

  const fields: CoreField[] = [];

  for (let item_index = 0; item_index < target.fields.length; item_index += 1) {
    const item = target.fields[item_index];
    expect(item, "Missing static collection field " + item_index.toString());
    const field_type = hooks.expr_type(item.value, ctx);

    if (static_index !== undefined) {
      if (item_index !== static_index) {
        fields.push(item);
        continue;
      }

      expect(
        value_type === field_type,
        "Core index assignment field " + item.name + " expects " + field_type +
          ", got " + value_type,
      );
      fields.push({ name: item.name, value: value_expr });
      continue;
    }

    expect(
      value_type === field_type,
      "Core dynamic index assignment field " + item.name + " expects " +
        field_type + ", got " + value_type,
    );
    fields.push({
      name: item.name,
      value: {
        tag: "if",
        cond: {
          tag: "prim",
          prim: "i32.eq",
          args: [
            resolved_index,
            { tag: "num", type: "i32", value: item_index },
          ],
        },
        then_branch: value_expr,
        else_branch: item.value,
      },
    });
  }

  if (static_index !== undefined) {
    static_indexed_field(target.fields, static_index);
  }

  return {
    value: {
      tag: "struct_value",
      type_expr: target.type_expr,
      fields,
    },
    setup: setup.join("\n"),
  };
}

export function emit_core_static_index_assign<
  ctx extends CoreIndexAssignCtx & { statics: Map<string, CoreExpr> },
>(
  target: Extract<CoreExpr, { tag: "struct_value" }>,
  stmt: Extract<CoreStmt, { tag: "index_assign" }>,
  ctx: ctx,
  hooks: CoreIndexAssignHooks<ctx, ctx>,
): Wat {
  const plan = plan_core_static_index_assign(
    target,
    stmt.index,
    stmt.value,
    ctx,
    ctx,
    hooks,
  );
  ctx.statics.set(stmt.name, plan.value);
  return plan.setup;
}

export function plan_core_runtime_aggregate_index_assign<
  ctx extends CoreIndexAssignCtx & TypeStaticCtx,
>(
  type_expr: CoreExpr,
  stmt: Extract<CoreStmt, { tag: "index_assign" }>,
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
  stmt: Extract<CoreStmt, { tag: "index_assign" }>,
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
