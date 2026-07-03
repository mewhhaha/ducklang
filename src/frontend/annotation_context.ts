import type { Env, FrontExpr } from "./ast.ts";
import type { AnnotationHooks } from "./annotation_types.ts";
import { is_object_type_expr, lookup_type_field } from "./fields.ts";
import { resolve_annotation_type_value } from "./annotation_resolve.ts";

export function apply_annotation_context(
  annotation: string,
  value: FrontExpr,
  env: Env,
  hooks: AnnotationHooks,
): FrontExpr {
  const type_value = resolve_annotation_type_value(annotation, env, hooks);

  if (!type_value) {
    return value;
  }

  if (type_value.tag === "struct_type") {
    const struct = hooks.resolve_struct_value(value, env);

    if (!struct || !is_object_type_expr(struct.expr.type_expr)) {
      return value;
    }

    hooks.check_struct_fields(type_value, struct.expr.fields, struct.env);

    return {
      tag: "struct_value",
      type_expr: { tag: "var", name: annotation },
      fields: struct.expr.fields.map((field) => ({
        name: field.name,
        value: hooks.capture_expr(field.value, struct.env),
      })),
    };
  }

  return apply_union_annotation_context(
    annotation,
    type_value,
    value,
    env,
    hooks,
  );
}

function apply_union_annotation_context(
  annotation: string,
  type_value: Extract<FrontExpr, { tag: "union_type" }>,
  value: FrontExpr,
  env: Env,
  hooks: AnnotationHooks,
): FrontExpr {
  if (value.tag === "captured") {
    return {
      tag: "captured",
      expr: apply_union_annotation_context(
        annotation,
        type_value,
        value.expr,
        value.env,
        hooks,
      ),
      env: value.env,
    };
  }

  if (value.tag === "if") {
    return {
      tag: "if",
      cond: value.cond,
      then_branch: apply_union_annotation_context(
        annotation,
        type_value,
        value.then_branch,
        env,
        hooks,
      ),
      else_branch: apply_union_annotation_context(
        annotation,
        type_value,
        value.else_branch,
        env,
        hooks,
      ),
      implicit_else: value.implicit_else,
    };
  }

  const union_value = hooks.resolve_union_value(value, env);

  if (!union_value) {
    return value;
  }

  let payload: FrontExpr | undefined;

  if (union_value.expr.value) {
    const declared = lookup_type_field(type_value.cases, union_value.expr.name);
    const payload_value = apply_union_payload_context(
      declared,
      union_value.expr.value,
      union_value.env,
      hooks,
    );
    payload = hooks.capture_expr(payload_value, union_value.env);
  }

  return {
    tag: "union_case",
    name: union_value.expr.name,
    value: payload,
    type_expr: { tag: "var", name: annotation },
  };
}

function apply_union_payload_context(
  declared: { name: string; type_name: string } | undefined,
  value: FrontExpr,
  env: Env,
  hooks: AnnotationHooks,
): FrontExpr {
  if (!declared || declared.type_name === "Unit") {
    return value;
  }

  const type_value = resolve_annotation_type_value(
    declared.type_name,
    env,
    hooks,
  );

  if (!type_value) {
    return value;
  }

  return apply_annotation_context(declared.type_name, value, env, hooks);
}
