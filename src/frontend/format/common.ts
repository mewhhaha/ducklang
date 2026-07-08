import type { Field, Param, TypeField, TypePattern } from "../ast.ts";

export function format_field(
  field: Field,
  format_expr: (expr: Field["value"]) => string,
): string {
  return field.name + ": " + format_expr(field.value);
}

export function format_type_field(field: TypeField): string {
  return field.name + ": " + field.type_name;
}

export function format_type_pattern(pattern: TypePattern): string {
  const fields = pattern.fields.map(format_type_field);

  if (pattern.open) {
    fields.push("..");
  }

  return pattern.kind + " { " + fields.join(", ") + " }";
}

export function format_params(params: Param[]): string {
  return params.map((param) => {
    let text = "";

    if (param.is_const) {
      text += "const ";
    }

    if (param.is_linear) {
      text += "!";
    }

    text += param.name;

    if (param.annotation) {
      text += ": " + param.annotation;
    }

    return text;
  }).join(", ");
}
