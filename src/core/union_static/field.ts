import type { CoreTypeField } from "../ast.ts";

export function find_core_type_field(
  fields: CoreTypeField[],
  name: string,
): CoreTypeField | undefined {
  for (const field of fields) {
    if (field.name === name) {
      return field;
    }
  }

  return undefined;
}
