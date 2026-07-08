import { expect } from "../../expect.ts";
import type { CoreExpr, CoreField } from "../ast.ts";
import { plan_static_capture_expr } from "./capture.ts";
import type {
  StaticValueCtx,
  StaticValueHooks,
  StaticValuePlan,
} from "./types.ts";

export function plan_static_struct_value<
  ctx extends StaticValueCtx,
  emit_ctx extends ctx,
>(
  value: Extract<CoreExpr, { tag: "struct_value" }>,
  ctx: ctx,
  emit_ctx: emit_ctx | undefined,
  hooks: StaticValueHooks<ctx, emit_ctx>,
  frozen = false,
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
      frozen,
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
