import { expect } from "../../expect.ts";
import type { CoreExpr, CoreField } from "../ast.ts";
import { fresh_temp_local, indent_lines, set_local } from "../backend/util.ts";
import type { DynamicUnionIf } from "../if_let.ts";
import type { StaticStructIfBranches } from "../struct_static.ts";
import type { StaticTextIfBranches } from "../text_static.ts";
import { static_block_result } from "../type_static.ts";
import { is_scratch_free_static_value_expr } from "./scratch_free.ts";
import type {
  StaticValueCtx,
  StaticValueHooks,
  StaticValuePlan,
} from "./types.ts";

export function plan_static_value_expr<
  ctx extends StaticValueCtx,
  emit_ctx extends ctx,
>(
  value: CoreExpr,
  ctx: ctx,
  emit_ctx: emit_ctx | undefined,
  hooks: StaticValueHooks<ctx, emit_ctx>,
): StaticValuePlan {
  const inlined = hooks.static_core_call_value(value, ctx);

  if (inlined) {
    return plan_static_value_expr(inlined, ctx, emit_ctx, hooks);
  }

  const union_case = hooks.static_union_case(value, ctx);

  if (union_case) {
    return plan_static_union_case(union_case, ctx, emit_ctx, hooks);
  }

  const text_value = hooks.static_text_value(value, ctx);

  if (text_value) {
    if (text_value.tag === "if") {
      const text_if = hooks.static_text_if_branches(text_value, ctx);
      expect(text_if, "Missing static text if branches");
      return plan_static_text_if(text_value, text_if, ctx, emit_ctx, hooks);
    }

    return { value: text_value, setup: "" };
  }

  if (value.tag === "freeze") {
    const frozen_struct = hooks.static_struct_value(value.value, ctx);

    if (frozen_struct) {
      const planned = plan_static_struct_value(
        frozen_struct,
        ctx,
        emit_ctx,
        hooks,
      );
      return {
        value: {
          tag: "freeze",
          value: planned.value,
        },
        setup: planned.setup,
      };
    }
  }

  const struct_value = hooks.static_struct_value(value, ctx);

  if (struct_value) {
    return plan_static_struct_value(struct_value, ctx, emit_ctx, hooks);
  }

  if (value.tag === "text") {
    return { value, setup: "" };
  }

  if (value.tag === "struct_value") {
    return plan_static_struct_value(value, ctx, emit_ctx, hooks);
  }

  if (value.tag === "struct_update") {
    const updated = hooks.static_struct_update_value(value, ctx);
    expect(updated, "Cannot update non-static core struct value");
    return plan_static_struct_value(updated, ctx, emit_ctx, hooks);
  }

  if (value.tag === "scratch") {
    expect(
      is_scratch_free_static_value_expr(value.body, ctx, hooks),
      "Cannot plan scratch static core value that may reference scratch storage",
    );
    return plan_static_value_expr(value.body, ctx, emit_ctx, hooks);
  }

  const dynamic_union = hooks.dynamic_union_if(value, ctx);

  if (dynamic_union) {
    return plan_static_union_if(dynamic_union, ctx, emit_ctx, hooks);
  }

  if (value.tag === "if") {
    const struct_if = hooks.static_struct_if_branches(value, ctx);

    if (struct_if) {
      return plan_static_struct_if(value, struct_if, ctx, emit_ctx, hooks);
    }

    const text_if = hooks.static_text_if_branches(value, ctx);

    if (text_if) {
      return plan_static_text_if(value, text_if, ctx, emit_ctx, hooks);
    }
  }

  const block_value = static_block_result(value);

  if (block_value) {
    return plan_static_value_expr(block_value, ctx, emit_ctx, hooks);
  }

  throw new Error("Cannot plan static core value: " + value.tag);
}

export function plan_static_struct_value<
  ctx extends StaticValueCtx,
  emit_ctx extends ctx,
>(
  value: Extract<CoreExpr, { tag: "struct_value" }>,
  ctx: ctx,
  emit_ctx: emit_ctx | undefined,
  hooks: StaticValueHooks<ctx, emit_ctx>,
): StaticValuePlan {
  const setup: string[] = [];
  const fields: CoreField[] = [];

  for (let index = 0; index < value.fields.length; index += 1) {
    const field = value.fields[index];
    expect(field, "Missing static struct field " + index.toString());
    const planned = plan_static_capture_expr(
      "field_" + field.name,
      field.value,
      ctx,
      emit_ctx,
      hooks,
    );
    fields.push({ name: field.name, value: planned.value });

    if (planned.setup !== "") {
      setup.push(planned.setup);
    }
  }

  return {
    value: {
      tag: "struct_value",
      type_expr: value.type_expr,
      fields,
    },
    setup: setup.join("\n"),
  };
}

export function plan_static_capture_expr<
  ctx extends StaticValueCtx,
  emit_ctx extends ctx,
>(
  prefix: string,
  value: CoreExpr,
  ctx: ctx,
  emit_ctx: emit_ctx | undefined,
  hooks: StaticValueHooks<ctx, emit_ctx>,
): StaticValuePlan {
  if (hooks.is_stable_static_expr(value)) {
    return { value, setup: "" };
  }

  const type = hooks.expr_type(value, ctx);
  const name = fresh_temp_local(ctx, prefix);
  set_local(ctx.locals, name, type);

  if (hooks.core_expr_is_text(value, ctx)) {
    ctx.text_locals.add(name);
  } else {
    ctx.text_locals.delete(name);
  }

  const struct_type = hooks.runtime_aggregate_type_expr(value, ctx);

  if (struct_type) {
    ctx.struct_locals.set(name, struct_type);
  } else {
    ctx.struct_locals.delete(name);
  }

  const union_type = hooks.runtime_union_type_expr(value, ctx);

  if (union_type) {
    ctx.union_locals.set(name, union_type);
  } else {
    ctx.union_locals.delete(name);
  }

  const planned_value: CoreExpr = { tag: "var", name };
  const setup: string[] = [];

  if (emit_ctx) {
    setup.push(hooks.emit_expr(value, emit_ctx));
    setup.push("local.set $" + name);
  } else {
    hooks.collect_expr_locals(value, ctx);
  }

  return { value: planned_value, setup: setup.join("\n") };
}

function plan_static_union_case<
  ctx extends StaticValueCtx,
  emit_ctx extends ctx,
>(
  value: Extract<CoreExpr, { tag: "union_case" }>,
  ctx: ctx,
  emit_ctx: emit_ctx | undefined,
  hooks: StaticValueHooks<ctx, emit_ctx>,
): StaticValuePlan {
  if (!value.value) {
    return { value, setup: "" };
  }

  const planned = plan_static_capture_expr(
    "payload_" + value.name,
    value.value,
    ctx,
    emit_ctx,
    hooks,
  );

  return {
    value: {
      tag: "union_case",
      name: value.name,
      value: planned.value,
      type_expr: value.type_expr,
    },
    setup: planned.setup,
  };
}

function plan_static_struct_if<
  ctx extends StaticValueCtx,
  emit_ctx extends ctx,
>(
  value: Extract<CoreExpr, { tag: "if" }>,
  branches: StaticStructIfBranches,
  ctx: ctx,
  emit_ctx: emit_ctx | undefined,
  hooks: StaticValueHooks<ctx, emit_ctx>,
): StaticValuePlan {
  const planned_cond = plan_static_capture_expr(
    "if_cond",
    value.cond,
    ctx,
    emit_ctx,
    hooks,
  );
  const fields: CoreField[] = [];

  for (let index = 0; index < branches.then_struct.fields.length; index += 1) {
    const then_field = branches.then_struct.fields[index];
    const else_field = branches.else_struct.fields[index];
    expect(then_field, "Missing then struct field " + index.toString());
    expect(else_field, "Missing else struct field " + index.toString());
    fields.push({
      name: then_field.name,
      value: {
        tag: "if",
        cond: planned_cond.value,
        then_branch: then_field.value,
        else_branch: else_field.value,
      },
    });
  }

  const planned_struct = plan_static_struct_value(
    {
      tag: "struct_value",
      type_expr: branches.then_struct.type_expr,
      fields,
    },
    ctx,
    emit_ctx,
    hooks,
  );
  const setup: string[] = [];

  if (planned_cond.setup !== "") {
    setup.push(planned_cond.setup);
  }

  if (planned_struct.setup !== "") {
    setup.push(planned_struct.setup);
  }

  return {
    value: planned_struct.value,
    setup: setup.join("\n"),
  };
}

function plan_static_union_if<
  ctx extends StaticValueCtx,
  emit_ctx extends ctx,
>(
  target: DynamicUnionIf,
  ctx: ctx,
  emit_ctx: emit_ctx | undefined,
  hooks: StaticValueHooks<ctx, emit_ctx>,
): StaticValuePlan {
  const planned_cond = plan_static_capture_expr(
    "if_cond",
    target.cond,
    ctx,
    emit_ctx,
    hooks,
  );
  const then_case = plan_static_union_if_case(
    target.then_case,
    ctx,
    emit_ctx,
    hooks,
  );
  const else_case = plan_static_union_if_case(
    target.else_case,
    ctx,
    emit_ctx,
    hooks,
  );
  const setup: string[] = [];

  if (planned_cond.setup !== "") {
    setup.push(planned_cond.setup);
  }

  if (emit_ctx && (then_case.setup !== "" || else_case.setup !== "")) {
    setup.push(hooks.emit_expr(planned_cond.value, emit_ctx));
    setup.push("if");
    setup.push(indent_lines(then_case.setup, 2));
    setup.push("else");
    setup.push(indent_lines(else_case.setup, 2));
    setup.push("end");
  }

  return {
    value: {
      tag: "if",
      cond: planned_cond.value,
      then_branch: then_case.value,
      else_branch: else_case.value,
    },
    setup: setup.join("\n"),
  };
}

function plan_static_union_if_case<
  ctx extends StaticValueCtx,
  emit_ctx extends ctx,
>(
  union_case: Extract<CoreExpr, { tag: "union_case" }>,
  ctx: ctx,
  emit_ctx: emit_ctx | undefined,
  hooks: StaticValueHooks<ctx, emit_ctx>,
): StaticValuePlan {
  if (!union_case.value) {
    return { value: union_case, setup: "" };
  }

  const text_value = hooks.static_text_value(union_case.value, ctx);

  if (text_value) {
    const planned = plan_static_value_expr(text_value, ctx, emit_ctx, hooks);
    return {
      value: {
        tag: "union_case",
        name: union_case.name,
        value: planned.value,
        type_expr: union_case.type_expr,
      },
      setup: planned.setup,
    };
  }

  const struct_value = hooks.static_struct_value(union_case.value, ctx);

  if (struct_value) {
    const planned = plan_static_struct_value(
      struct_value,
      ctx,
      emit_ctx,
      hooks,
    );
    return {
      value: {
        tag: "union_case",
        name: union_case.name,
        value: planned.value,
        type_expr: union_case.type_expr,
      },
      setup: planned.setup,
    };
  }

  if (hooks.is_stable_static_expr(union_case.value)) {
    return { value: union_case, setup: "" };
  }

  const planned = plan_static_capture_expr(
    "payload_" + union_case.name,
    union_case.value,
    ctx,
    emit_ctx,
    hooks,
  );

  return {
    value: {
      tag: "union_case",
      name: union_case.name,
      value: planned.value,
      type_expr: union_case.type_expr,
    },
    setup: planned.setup,
  };
}

function plan_static_text_if<
  ctx extends StaticValueCtx,
  emit_ctx extends ctx,
>(
  value: Extract<CoreExpr, { tag: "if" }>,
  branches: StaticTextIfBranches,
  ctx: ctx,
  emit_ctx: emit_ctx | undefined,
  hooks: StaticValueHooks<ctx, emit_ctx>,
): StaticValuePlan {
  const planned_cond = plan_static_capture_expr(
    "if_cond",
    value.cond,
    ctx,
    emit_ctx,
    hooks,
  );
  const setup: string[] = [];

  if (planned_cond.setup !== "") {
    setup.push(planned_cond.setup);
  }

  return {
    value: {
      tag: "if",
      cond: planned_cond.value,
      then_branch: branches.then_text,
      else_branch: branches.else_text,
    },
    setup: setup.join("\n"),
  };
}
