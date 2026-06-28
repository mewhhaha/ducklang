import type { Expr } from "./expr.ts";

export type IC =
  | { tag: "num"; value: number }
  | { tag: "var"; name: string }
  | { tag: "add"; left: IC; right: IC }
  | { tag: "dup"; name: string; expr: IC; body: IC };

export function IC() {}

IC.fmt = function fmt(ic: IC): string {
  if (ic.tag === "num") {
    return ic.value.toString();
  }

  if (ic.tag === "var") {
    return ic.name;
  }

  if (ic.tag === "add") {
    const left = fmt(ic.left);
    const right = fmt(ic.right);
    return `${left} + ${right}`;
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

  if (ic.tag === "add") {
    return {
      tag: "add",
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

  if (expr.tag === "add") {
    return {
      tag: "add",
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
