import { expect } from "../expect.ts";
import { Prim } from "../op.ts";
import { Callable } from "../trait.ts";
import type { Ic } from "./ast.ts";

type Num = Extract<Ic, { tag: "num" }>;
type BinaryPrim = Exclude<
  Prim,
  | "i32.select"
  | "i64.select"
  | "i32.load"
  | "i64.load"
  | "i32.load8_u"
  | "i64.load8_u"
  | "i32.trap"
  | "i64.trap"
>;
type I32Prim = Exclude<
  Extract<Prim, `i32.${string}`>,
  "i32.select" | "i32.load" | "i32.load8_u" | "i32.trap"
>;
type I64Prim = Exclude<
  Extract<Prim, `i64.${string}`>,
  "i64.select" | "i64.load" | "i64.load8_u" | "i64.trap"
>;

function arg(args: Ic[], index: number): Ic {
  const value = args[index];
  expect(value, "Missing argument " + index);
  return value;
}

export function is_binary_prim(prim: Prim): prim is BinaryPrim {
  if (
    prim === "i32.select" || prim === "i64.select" ||
    prim === "i32.load" || prim === "i64.load" ||
    prim === "i32.load8_u" || prim === "i64.load8_u" ||
    prim === "i32.trap" || prim === "i64.trap"
  ) {
    return false;
  }

  return true;
}

export function fold_select(prim: Prim, args: Ic[]): Ic {
  const then_branch = arg(args, 0);
  const else_branch = arg(args, 1);
  const cond = arg(args, 2);

  if (cond.tag !== "num") {
    return {
      tag: "prim",
      prim: select_prim(prim, then_branch, else_branch),
      args,
    };
  }

  expect(cond.type === "i32", "Select condition must be i32");
  const value = cond.value;
  expect(typeof value === "number", "Expected i32 select condition");

  if (value !== 0) {
    return then_branch;
  }

  return else_branch;
}

function select_prim(prim: Prim, then_branch: Ic, else_branch: Ic): Prim {
  if (then_branch.tag === "num" && else_branch.tag === "num") {
    if (then_branch.type === "i64" && else_branch.type === "i64") {
      return "i64.select";
    }

    if (then_branch.type === "i32" && else_branch.type === "i32") {
      return "i32.select";
    }
  }

  return prim;
}

export function fold_prim(
  prim: BinaryPrim,
  left: Num,
  right: Num,
): Ic {
  expect(left.type === right.type, "Primitive numbers must have the same type");

  const prim_type = Callable.type(Prim, prim);
  const left_expected = prim_type.args[0];
  const right_expected = prim_type.args[1];
  expect(left_expected, "Missing primitive argument type 0");
  expect(right_expected, "Missing primitive argument type 1");
  expect(
    left.type === left_expected,
    "Primitive " + prim + " argument 0 expects " + left_expected + ", got " +
      left.type,
  );
  expect(
    right.type === right_expected,
    "Primitive " + prim + " argument 1 expects " + right_expected + ", got " +
      right.type,
  );
  switch (prim) {
    case "i32.add":
    case "i32.sub":
    case "i32.mul":
    case "i32.div_s":
    case "i32.rem_s":
    case "i32.eq":
    case "i32.ne":
    case "i32.lt_s":
    case "i32.le_s":
    case "i32.gt_s":
    case "i32.ge_s":
      return fold_i32(prim, left, right);

    case "i64.add":
    case "i64.sub":
    case "i64.mul":
    case "i64.div_s":
    case "i64.rem_s":
    case "i64.eq":
    case "i64.ne":
    case "i64.lt_s":
    case "i64.le_s":
    case "i64.gt_s":
    case "i64.ge_s":
      return fold_i64(prim, left, right);
  }
}

function fold_i32(
  prim: I32Prim,
  left: Num,
  right: Num,
): Ic {
  const left_value = left.value;
  const right_value = right.value;
  expect(typeof left_value === "number", "Expected i32 number");
  expect(typeof right_value === "number", "Expected i32 number");

  switch (prim) {
    case "i32.add":
      return { tag: "num", type: "i32", value: (left_value + right_value) | 0 };

    case "i32.sub":
      return { tag: "num", type: "i32", value: (left_value - right_value) | 0 };

    case "i32.mul":
      return {
        tag: "num",
        type: "i32",
        value: Math.imul(left_value, right_value),
      };

    case "i32.div_s":
      if (right_value === 0) {
        throw new Error("i32.div_s by zero");
      }

      return {
        tag: "num",
        type: "i32",
        value: Math.trunc(left_value / right_value) | 0,
      };

    case "i32.rem_s":
      if (right_value === 0) {
        throw new Error("i32.rem_s by zero");
      }

      return { tag: "num", type: "i32", value: (left_value % right_value) | 0 };

    case "i32.eq":
      if (left_value === right_value) {
        return { tag: "num", type: "i32", value: 1 };
      }

      return { tag: "num", type: "i32", value: 0 };

    case "i32.ne":
      if (left_value !== right_value) {
        return { tag: "num", type: "i32", value: 1 };
      }

      return { tag: "num", type: "i32", value: 0 };

    case "i32.lt_s":
      if (left_value < right_value) {
        return { tag: "num", type: "i32", value: 1 };
      }

      return { tag: "num", type: "i32", value: 0 };

    case "i32.le_s":
      if (left_value <= right_value) {
        return { tag: "num", type: "i32", value: 1 };
      }

      return { tag: "num", type: "i32", value: 0 };

    case "i32.gt_s":
      if (left_value > right_value) {
        return { tag: "num", type: "i32", value: 1 };
      }

      return { tag: "num", type: "i32", value: 0 };

    case "i32.ge_s":
      if (left_value >= right_value) {
        return { tag: "num", type: "i32", value: 1 };
      }

      return { tag: "num", type: "i32", value: 0 };
  }
}

function fold_i64(
  prim: I64Prim,
  left: Num,
  right: Num,
): Ic {
  const left_value = left.value;
  const right_value = right.value;
  expect(typeof left_value === "bigint", "Expected i64 bigint");
  expect(typeof right_value === "bigint", "Expected i64 bigint");

  switch (prim) {
    case "i64.add":
      return {
        tag: "num",
        type: "i64",
        value: BigInt.asIntN(64, left_value + right_value),
      };

    case "i64.sub":
      return {
        tag: "num",
        type: "i64",
        value: BigInt.asIntN(64, left_value - right_value),
      };

    case "i64.mul":
      return {
        tag: "num",
        type: "i64",
        value: BigInt.asIntN(64, left_value * right_value),
      };

    case "i64.div_s":
      if (right_value === 0n) {
        throw new Error("i64.div_s by zero");
      }

      return {
        tag: "num",
        type: "i64",
        value: BigInt.asIntN(64, left_value / right_value),
      };

    case "i64.rem_s":
      if (right_value === 0n) {
        throw new Error("i64.rem_s by zero");
      }

      return {
        tag: "num",
        type: "i64",
        value: BigInt.asIntN(64, left_value % right_value),
      };

    case "i64.eq":
      if (left_value === right_value) {
        return { tag: "num", type: "i32", value: 1 };
      }

      return { tag: "num", type: "i32", value: 0 };

    case "i64.ne":
      if (left_value !== right_value) {
        return { tag: "num", type: "i32", value: 1 };
      }

      return { tag: "num", type: "i32", value: 0 };

    case "i64.lt_s":
      if (left_value < right_value) {
        return { tag: "num", type: "i32", value: 1 };
      }

      return { tag: "num", type: "i32", value: 0 };

    case "i64.le_s":
      if (left_value <= right_value) {
        return { tag: "num", type: "i32", value: 1 };
      }

      return { tag: "num", type: "i32", value: 0 };

    case "i64.gt_s":
      if (left_value > right_value) {
        return { tag: "num", type: "i32", value: 1 };
      }

      return { tag: "num", type: "i32", value: 0 };

    case "i64.ge_s":
      if (left_value >= right_value) {
        return { tag: "num", type: "i32", value: 1 };
      }

      return { tag: "num", type: "i32", value: 0 };
  }
}
