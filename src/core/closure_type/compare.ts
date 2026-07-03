import type { CoreFnType } from "../ast.ts";
import { same_runtime_aggregate_type_expr } from "../runtime_aggregate.ts";
import { same_runtime_union_type_expr } from "../runtime_union.ts";

export function same_core_fn_type(
  left: CoreFnType,
  right: CoreFnType,
): boolean {
  if (left.result !== right.result) {
    return false;
  }

  if (left.result_text !== right.result_text) {
    return false;
  }

  if (!same_runtime_union_type_expr(left.result_union, right.result_union)) {
    return false;
  }

  if (
    !same_runtime_aggregate_type_expr(left.result_struct, right.result_struct)
  ) {
    return false;
  }

  if (left.params.length !== right.params.length) {
    return false;
  }

  for (let index = 0; index < left.params.length; index += 1) {
    const left_param = left.params[index];
    const right_param = right.params[index];
    const left_text = left.param_texts[index];
    const right_text = right.param_texts[index];

    if (left_param !== right_param) {
      return false;
    }

    if (left_text !== right_text) {
      return false;
    }
  }

  return true;
}
