import { IC } from "./src/ic.ts";
import { Expr } from "./src/expr.ts";
import { Mod } from "./src/mod.ts";

const program: IC = {
  tag: "dup",
  label: "A",
  name: "x",
  expr: {
    tag: "sup",
    label: "B",
    left: { tag: "num", type: "i32", value: 40 },
    right: { tag: "num", type: "i32", value: 2 },
  },
  body: {
    tag: "dup",
    label: "B",
    name: "y",
    expr: { tag: "var", name: "x0" },
    body: {
      tag: "prim",
      prim: "add",
      args: [
        { tag: "var", name: "y0" },
        { tag: "var", name: "y1" },
      ],
    },
  },
};

const reduced = IC.reduce(program);
const expr = IC.emit(program);

const mod: Mod = {
  funcs: {
    main: {
      name: "main",
      result: Expr.type(expr),
      body: Expr.emit(expr),
    },
  },
  exports: ["main"],
};

const watText = Mod.emit(mod);

await Deno.mkdir("build", { recursive: true });
await Deno.writeTextFile("build/out.wat", watText);

console.log("IC:");
console.log(IC.fmt(program));

console.log("Reduced IC:");
console.log(IC.fmt(reduced));

console.log("Expr:");
console.log(Expr.fmt(expr));

console.log("WAT:");
console.log(watText);
