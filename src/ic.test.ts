import { assertEquals, assertThrows } from "./assert.ts";
import { Expr } from "./expr.ts";
import { Ic, type Ic as IcNode } from "./ic.ts";

function i32(value: number): IcNode {
  return { tag: "num", type: "i32", value };
}

function i64(value: bigint): IcNode {
  return { tag: "num", type: "i64", value };
}

function var_(name: string): IcNode {
  return { tag: "var", name };
}

function add(left: IcNode, right: IcNode): IcNode {
  return { tag: "prim", prim: "i32.add", args: [left, right] };
}

function id(name: string): IcNode {
  return { tag: "lam", name, body: var_(name) };
}

Deno.test("Ic.fmt formats dup and sup terms", () => {
  const program: IcNode = {
    tag: "dup",
    label: "A",
    name: "x",
    expr: { tag: "sup", label: "A", left: i32(1), right: i32(2) },
    body: add(var_("x0"), var_("x1")),
  };

  assertEquals(
    Ic.fmt(program),
    "! x &A = &A{1:i32, 2:i32};\nx0 + x1",
  );
});

Deno.test("Ic.fmt formats explicit erasure", () => {
  const program: IcNode = {
    tag: "era",
    expr: i32(1),
    body: i32(2),
  };

  assertEquals(Ic.fmt(program), "~ 1:i32;\n2:i32");
});

Deno.test("Ic.reduce applies APP-LAM", () => {
  const program: IcNode = {
    tag: "app",
    func: id("x"),
    arg: i32(42),
  };

  assertEquals(Ic.reduce(program), i32(42));
});

Deno.test("Ic.reduce annihilates same-label DUP-SUP", () => {
  const program: IcNode = {
    tag: "dup",
    label: "A",
    name: "x",
    expr: { tag: "sup", label: "A", left: i32(40), right: i32(2) },
    body: add(var_("x0"), var_("x1")),
  };

  assertEquals(Ic.reduce(program), i32(42));
});

Deno.test("Ic.reduce commutes different-label DUP-SUP enough to lower", () => {
  const program: IcNode = {
    tag: "dup",
    label: "A",
    name: "x",
    expr: { tag: "sup", label: "B", left: i32(40), right: i32(2) },
    body: {
      tag: "dup",
      label: "B",
      name: "y",
      expr: var_("x0"),
      body: add(var_("y0"), var_("y1")),
    },
  };

  const expr = Ic.emit(program);

  assertEquals(
    Expr.fmt(expr),
    "let _a0:i32 = 40:i32;\nlet _b1:i32 = 2:i32;\n(_a0:i32 +:i32 _b1:i32)",
  );
});

Deno.test("Ic.reduce applies APP-SUP and then same-label DUP-SUP", () => {
  const program: IcNode = {
    tag: "dup",
    label: "A",
    name: "r",
    expr: {
      tag: "app",
      func: { tag: "sup", label: "A", left: id("x"), right: id("y") },
      arg: { tag: "sup", label: "A", left: i32(40), right: i32(2) },
    },
    body: add(var_("r0"), var_("r1")),
  };

  assertEquals(Ic.reduce(program), i32(42));
});

Deno.test("Ic.reduce applies DUP-LAM", () => {
  const program: IcNode = {
    tag: "dup",
    label: "A",
    name: "r",
    expr: {
      tag: "dup",
      label: "A",
      name: "f",
      expr: id("x"),
      body: {
        tag: "sup",
        label: "A",
        left: { tag: "app", func: var_("f0"), arg: i32(40) },
        right: { tag: "app", func: var_("f1"), arg: i32(2) },
      },
    },
    body: add(var_("r0"), var_("r1")),
  };

  assertEquals(Ic.reduce(program), i32(42));
});

Deno.test("Ic.reduce propagates primitive calls over superpositions", () => {
  const program: IcNode = {
    tag: "dup",
    label: "A",
    name: "r",
    expr: {
      tag: "prim",
      prim: "i32.add",
      args: [
        { tag: "sup", label: "A", left: i32(1), right: i32(2) },
        { tag: "sup", label: "A", left: i32(10), right: i32(20) },
      ],
    },
    body: add(var_("r0"), var_("r1")),
  };

  assertEquals(Ic.reduce(program), i32(33));
});

Deno.test("Ic.reduce folds i32 primitives with wrapping", () => {
  const program: IcNode = {
    tag: "prim",
    prim: "i32.add",
    args: [i32(2147483647), i32(1)],
  };

  assertEquals(Ic.reduce(program), i32(-2147483648));
});

Deno.test("Ic.reduce folds i64 primitives with wrapping", () => {
  const program: IcNode = {
    tag: "prim",
    prim: "i64.mul",
    args: [i64(3n), i64(7n)],
  };

  assertEquals(Ic.reduce(program), i64(21n));
});

Deno.test("Ic.reduce erases numbers and continues", () => {
  const program: IcNode = {
    tag: "era",
    expr: i32(1),
    body: i32(42),
  };

  assertEquals(Ic.reduce(program), i32(42));
});

Deno.test("Ic.reduce erases superpositions structurally", () => {
  const program: IcNode = {
    tag: "era",
    expr: { tag: "sup", label: "A", left: i32(1), right: i32(2) },
    body: i32(42),
  };

  assertEquals(Ic.reduce(program), i32(42));
});

Deno.test("Ic.reduce erases applications structurally", () => {
  const program: IcNode = {
    tag: "era",
    expr: {
      tag: "app",
      func: id("x"),
      arg: { tag: "sup", label: "A", left: i32(1), right: i32(2) },
    },
    body: i32(42),
  };

  assertEquals(Ic.reduce(program), i32(42));
});

Deno.test("Ic.reduce erases duplicated values structurally", () => {
  const program: IcNode = {
    tag: "era",
    expr: {
      tag: "dup",
      label: "A",
      name: "x",
      expr: { tag: "sup", label: "A", left: i32(1), right: i32(2) },
      body: add(var_("x0"), var_("x1")),
    },
    body: i32(42),
  };

  assertEquals(Ic.reduce(program), i32(42));
});

Deno.test("Ic.emit rejects unreduced superpositions", () => {
  const program: IcNode = {
    tag: "sup",
    label: "A",
    left: i32(1),
    right: i32(2),
  };

  assertThrows(
    () => Ic.emit(program),
    "Cannot lower superposition before reduction",
  );
});
