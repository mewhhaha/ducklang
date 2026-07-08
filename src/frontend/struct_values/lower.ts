import { expect } from "../../expect.ts";
import type { Ic as IcNode } from "../../ic.ts";
import type { Env, Field, FrontExpr } from "../ast.ts";
import { fresh } from "../env.ts";
import {
  check_object_fields,
  is_object_type_expr,
  lookup_field,
} from "../fields.ts";
import { lower_lambda_binding } from "../ic_share.ts";
import {
  check_struct_fields,
  resolve_struct_type_value,
} from "../struct_value_type.ts";
import type { StructValueHooks } from "./types.ts";

export function lower_struct_value(
  expr: Extract<FrontExpr, { tag: "struct_value" }>,
  env: Env,
  hooks: StructValueHooks,
): IcNode {
  const fields: { field: Field; type_name: string | undefined }[] = [];

  if (is_object_type_expr(expr.type_expr)) {
    check_object_fields(expr.fields);

    for (const field of expr.fields) {
      fields.push({ field, type_name: undefined });
    }
  } else {
    const struct_type = resolve_struct_type_value(
      expr.type_expr,
      env,
      hooks,
    );

    if (!struct_type) {
      throw new Error("Cannot lower struct value to Ic frontend yet");
    }

    check_struct_fields(struct_type, expr.fields, env, hooks);

    for (const declared of struct_type.fields) {
      const field = lookup_field(expr.fields, declared.name);
      expect(field, "Missing struct field: " + declared.name);
      fields.push({ field, type_name: declared.type_name });
    }
  }

  const handler_name = fresh(env, "pick");
  let body: IcNode = { tag: "var", name: handler_name };

  for (const field_info of fields) {
    body = {
      tag: "app",
      func: body,
      arg: hooks.lower_expr_as_declared_type(
        field_info.field.value,
        env,
        field_info.type_name,
      ),
    };
  }

  return lower_lambda_binding(handler_name, body);
}
