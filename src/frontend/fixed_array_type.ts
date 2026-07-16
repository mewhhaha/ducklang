import type { ArrayLengthExpr, TypeExpr } from "./ast.ts";

export type FixedArrayLengthResolver = (
  name: string,
) => number | undefined;

export function fixed_array_length(
  length: ArrayLengthExpr,
  resolve_name?: FixedArrayLengthResolver,
): number {
  const value = evaluate_fixed_array_length(length, resolve_name);

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      "Fixed array length must be a non-negative safe integer, got " +
        value.toString(),
    );
  }

  return value;
}

export function normalize_fixed_array_type_lengths(
  type: TypeExpr,
  resolve_name: FixedArrayLengthResolver,
): TypeExpr {
  switch (type.tag) {
    case "forall":
      return {
        ...type,
        body: normalize_fixed_array_type_lengths(type.body, resolve_name),
      };

    case "name":
    case "atom":
    case "top":
    case "never":
      return type;

    case "frozen":
    case "borrow":
      return {
        ...type,
        value: normalize_fixed_array_type_lengths(type.value, resolve_name),
      };

    case "union":
    case "intersection":
    case "difference":
      return {
        ...type,
        left: normalize_fixed_array_type_lengths(type.left, resolve_name),
        right: normalize_fixed_array_type_lengths(type.right, resolve_name),
      };

    case "apply":
      return {
        ...type,
        func: normalize_fixed_array_type_lengths(type.func, resolve_name),
        arg: normalize_fixed_array_type_lengths(type.arg, resolve_name),
      };

    case "tuple":
      return {
        ...type,
        items: type.items.map((item) =>
          normalize_fixed_array_type_lengths(item, resolve_name)
        ),
      };

    case "product":
      return {
        ...type,
        entries: type.entries.map((entry) => ({
          ...entry,
          type_expr: normalize_fixed_array_type_lengths(
            entry.type_expr,
            resolve_name,
          ),
        })),
      };

    case "array":
      return {
        ...type,
        element: normalize_fixed_array_type_lengths(
          type.element,
          resolve_name,
        ),
        length: {
          tag: "number",
          value: fixed_array_length(type.length, resolve_name),
        },
      };

    case "arrow":
      return {
        ...type,
        param: normalize_fixed_array_type_lengths(type.param, resolve_name),
        result: normalize_fixed_array_type_lengths(type.result, resolve_name),
      };
  }
}

function evaluate_fixed_array_length(
  length: ArrayLengthExpr,
  resolve_name: FixedArrayLengthResolver | undefined,
): number {
  if (length.tag === "number") {
    return length.value;
  }

  if (length.tag === "name") {
    let value: number | undefined;

    if (resolve_name !== undefined) {
      value = resolve_name(length.name);
    }

    if (value === undefined) {
      throw new Error(
        "Fixed array length requires a compile-time natural: " + length.name,
      );
    }

    return value;
  }

  const left = evaluate_fixed_array_length(length.left, resolve_name);
  const right = evaluate_fixed_array_length(length.right, resolve_name);
  let value: number;

  if (length.op === "+") {
    value = left + right;
  } else if (length.op === "-") {
    value = left - right;
  } else if (length.op === "*") {
    value = left * right;
  } else if (length.op === "/") {
    if (right === 0) {
      throw new Error("Fixed array length divides by zero");
    }

    value = Math.trunc(left / right);
  } else {
    if (right === 0) {
      throw new Error("Fixed array length divides by zero");
    }

    value = left % right;
  }

  if (!Number.isSafeInteger(value)) {
    throw new Error(
      "Fixed array length arithmetic overflowed a safe integer",
    );
  }

  return value;
}
