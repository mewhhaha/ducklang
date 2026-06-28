import { IC } from "./src/ic.ts";
import { Expr } from "./src/expr.ts";

type Format<self> = {
  fmt: (value: self) => string;
};

type Emit<from, to> = {
  emit: (value: from) => to;
};

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);

  return text
    .split("\n")
    .map((line) => line.length === 0 ? line : pad + line)
    .join("\n");
}

const program: IC = {
  tag: "dup",
  name: "x",
  expr: { tag: "num", value: 21 },
  body: {
    tag: "add",
    left: { tag: "var", name: "x0" },
    right: { tag: "var", name: "x1" },
  },
};

IC satisfies Format<IC> & Emit<IC, Expr>;
const expr = IC.emit(program);

Expr satisfies Emit<Expr, string>;
const wat = `
(module
  (func $main (result i32)
${indent(Expr.emit(expr), 4)}
  )

  (export "main" (func $main))
)
`;

await Deno.writeTextFile("build/out.wat", wat);

console.log("IC:");
console.log(IC.fmt(program));

console.log("\nExpr:");
console.log(Expr.fmt(expr));

console.log("\nWAT:");
console.log(wat);
