import { expect } from "../../expect.ts";
import type { FrontExpr, Param } from "../ast.ts";
import { collect_linear_closure_names } from "../linear_closure_names.ts";
import { is_builtin_type_name, same_param_annotation } from "../types.ts";

export function same_linear_closure_param_shape(
  left: Extract<FrontExpr, { tag: "lam" }>,
  right: Extract<FrontExpr, { tag: "lam" }>,
): boolean {
  if (left.params.length !== right.params.length) {
    return false;
  }

  for (let index = 0; index < left.params.length; index += 1) {
    const left_param = left.params[index];
    const right_param = right.params[index];
    expect(left_param, "Missing left linear closure parameter");
    expect(right_param, "Missing right linear closure parameter");

    if (left_param.is_const !== right_param.is_const) {
      return false;
    }

    if (left_param.is_linear !== right_param.is_linear) {
      return false;
    }

    if (
      !same_linear_closure_param_annotation(
        left_param.annotation,
        right_param.annotation,
      )
    ) {
      return false;
    }
  }

  return true;
}

export function canonical_linear_closure_params(
  value: FrontExpr,
  params: Param[],
): Param[] {
  const used = new Set<string>();
  collect_linear_closure_names(value, used);

  return params.map((param, index) => ({
    name: fresh_linear_closure_param_name(used, index),
    is_const: param.is_const,
    is_linear: param.is_linear,
    annotation: param.annotation,
  }));
}

function same_linear_closure_param_annotation(
  left: string | undefined,
  right: string | undefined,
): boolean {
  if (same_param_annotation(left, right)) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  if (is_builtin_type_name(left) || is_builtin_type_name(right)) {
    return false;
  }

  return true;
}

function fresh_linear_closure_param_name(
  used: Set<string>,
  index: number,
): string {
  let suffix = index;

  while (true) {
    const name = "__linear_closure_param#" + suffix.toString();

    if (!used.has(name)) {
      used.add(name);
      return name;
    }

    suffix += 1;
  }
}
