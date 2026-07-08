import type { TypeField } from "./ast.ts";
import { lookup_type_field } from "./fields.ts";

export function same_union_cases(
  left: TypeField[],
  right: TypeField[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (const left_case of left) {
    const right_case = lookup_type_field(right, left_case.name);

    if (!right_case) {
      return false;
    }

    if (left_case.type_name !== right_case.type_name) {
      return false;
    }
  }

  return true;
}
