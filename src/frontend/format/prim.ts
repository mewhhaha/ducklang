import type { Prim } from "../../op.ts";

export function prim_symbol(prim: Prim): string {
  switch (prim) {
    case "i32.add":
    case "i64.add":
      return "+";

    case "i32.sub":
    case "i64.sub":
      return "-";

    case "i32.mul":
    case "i64.mul":
      return "*";

    case "i32.div_s":
    case "i64.div_s":
      return "/";

    case "i32.rem_s":
    case "i64.rem_s":
      return "%";

    case "i32.eq":
    case "i64.eq":
      return "==";

    case "i32.ne":
    case "i64.ne":
      return "!=";

    case "i32.lt_s":
    case "i64.lt_s":
      return "<";

    case "i32.le_s":
    case "i64.le_s":
      return "<=";

    case "i32.gt_s":
    case "i64.gt_s":
      return ">";

    case "i32.ge_s":
    case "i64.ge_s":
      return ">=";

    case "i32.select":
    case "i64.select":
      return "select";

    case "i32.load":
    case "i64.load":
      return "load";

    case "i32.load8_u":
    case "i64.load8_u":
      return "load8_u";

    case "i32.trap":
    case "i64.trap":
      return "trap";
  }
}
