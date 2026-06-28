import { Ic } from "./src/ic.ts";
import { Expr } from "./src/expr.ts";
import { Mod } from "./src/mod.ts";
import { Emit, Format } from "./src/trait.ts";

const program: Ic = {
  tag: "era",
  expr: {
    tag: "app",
    func: {
      tag: "lam",
      name: "unused",
      body: { tag: "var", name: "unused" },
    },
    arg: {
      tag: "sup",
      label: "Z",
      left: { tag: "num", type: "i32", value: 100 },
      right: { tag: "num", type: "i32", value: 200 },
    },
  },
  body: {
    tag: "dup",
    label: "A",
    name: "r",
    expr: {
      tag: "prim",
      prim: "i32.add",
      args: [
        {
          tag: "sup",
          label: "A",
          left: { tag: "num", type: "i32", value: 1 },
          right: { tag: "num", type: "i32", value: 2 },
        },
        {
          tag: "sup",
          label: "A",
          left: { tag: "num", type: "i32", value: 10 },
          right: { tag: "num", type: "i32", value: 20 },
        },
      ],
    },
    body: {
      tag: "prim",
      prim: "i32.add",
      args: [
        { tag: "var", name: "r0" },
        { tag: "var", name: "r1" },
      ],
    },
  },
};

const reduced = Ic.reduce(program);
const expr = Emit.emit(Ic, program);

const mod: Mod = {
  funcs: {
    main: {
      name: "main",
      result: Expr.type(expr),
      body: Emit.emit(Expr, expr),
    },
  },
  exports: ["main"],
};

const watText = Emit.emit(Mod, mod);

await Deno.mkdir("build", { recursive: true });
await Deno.writeTextFile("build/out.wat", watText);

console.log("IC:");
console.log(Format.fmt(Ic, program));

console.log("Reduced IC:");
console.log(Format.fmt(Ic, reduced));

console.log("Expr:");
console.log(Format.fmt(Expr, expr));

console.log("WAT:");
console.log(watText);
