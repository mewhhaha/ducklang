import type { Expr } from "./expr.ts";
import { isOp, OPS, type Op } from "./op.ts";

type BinaryIC = { tag: Op; left: IC; right: IC };

export type IC =
  | { tag: "num"; value: number }
  | { tag: "var"; name: string }
  | BinaryIC
  | { tag: "dup"; name: string; expr: IC; body: IC };

export function IC() {}

IC.fmt = function fmt(ic: IC): string {
  if (ic.tag === "num") {
    return ic.value.toString();
  }

  if (ic.tag === "var") {
    return ic.name;
  }

  if (isOp(ic.tag)) {
    const left = fmt(ic.left);
    const right = fmt(ic.right);
    return `${left} ${OPS[ic.tag].fmt} ${right}`;
  }

  if (ic.tag === "dup") {
    const expr = fmt(ic.expr);
    const body = fmt(ic.body);
    return `! ${ic.name} &D = ${expr};\n${body}`;
  }

  ic satisfies never;
  throw new Error("panic");
};

IC.emit = function emit(ic: IC): Expr {
  if (ic.tag === "num") {
    return { tag: "num", value: ic.value };
  }

  if (ic.tag === "var") {
    return { tag: "var", name: ic.name };
  }

  if (isOp(ic.tag)) {
    return {
      tag: ic.tag,
      left: emit(ic.left),
      right: emit(ic.right),
    };
  }

  if (ic.tag === "dup") {
    return {
      tag: "let",
      name: ic.name,
      value: emit(ic.expr),
      body: rename(emit(ic.body), ic.name),
    };
  }

  ic satisfies never;
  throw new Error("panic");
};

function rename(expr: Expr, name: string): Expr {
  if (expr.tag === "num") {
    return expr;
  }

  if (expr.tag === "var") {
    if (expr.name === `${name}0` || expr.name === `${name}1`) {
      return { tag: "var", name };
    }

    return expr;
  }

  if (isOp(expr.tag)) {
    return {
      tag: expr.tag,
      left: rename(expr.left, name),
      right: rename(expr.right, name),
    };
  }

  if (expr.tag === "let") {
    return {
      tag: "let",
      name: expr.name,
      value: rename(expr.value, name),
      body: rename(expr.body, name),
    };
  }

  expr satisfies never;
  throw new Error("panic");
}
