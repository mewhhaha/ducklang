import { assert_equals, assert_includes, assert_throws } from "./assert.ts";
import { Expr, type Expr as ExprNode } from "./expr.ts";
import { Data, Emit, Format, Typed } from "./trait.ts";

function num(value: number): ExprNode {
  return { tag: "num", type: "i32", value };
}

function num64(value: bigint): ExprNode {
  return { tag: "num", type: "i64", value };
}

function var_(name: string): ExprNode {
  return { tag: "var", type: "i32", name };
}

function add(left: ExprNode, right: ExprNode): ExprNode {
  return { tag: "prim", type: "i32", prim: "i32.add", args: [left, right] };
}

Deno.test("Expr.type returns let body type", () => {
  const expr: ExprNode = {
    tag: "let",
    name: "x",
    value: num64(1n),
    body: add(num(1), num(2)),
  };

  assert_equals(Typed.type(Expr, expr), "i32");
});

Deno.test("Expr.fmt formats typed primitive expressions", () => {
  assert_equals(Format.fmt(Expr, add(num(1), num(2))), "(1:i32 +:i32 2:i32)");
});

Deno.test("Expr.emit emits typed primitive instructions", () => {
  assert_equals(
    Emit.emit(Expr, add(num(1), num(2))),
    "i32.const 1\ni32.const 2\ni32.add",
  );
});

Deno.test("Expr.emit emits i64 primitive instructions", () => {
  const expr: ExprNode = {
    tag: "prim",
    type: "i64",
    prim: "i64.mul",
    args: [num64(3n), num64(7n)],
  };

  assert_equals(Emit.emit(Expr, expr), "i64.const 3\ni64.const 7\ni64.mul");
});

Deno.test("Expr.emit emits select instructions", () => {
  const expr: ExprNode = {
    tag: "prim",
    type: "i32",
    prim: "i32.select",
    args: [num(42), num(0), var_("cond")],
  };

  const wrapped: ExprNode = {
    tag: "let",
    name: "cond",
    value: num(1),
    body: expr,
  };

  assert_equals(
    Format.fmt(Expr, expr),
    "(if cond:i32 then 42:i32 else 0:i32):i32",
  );
  assert_includes(Emit.emit(Expr, wrapped), "select");
});

Deno.test("Expr.emit emits structured if expressions", () => {
  const expr: ExprNode = {
    tag: "if",
    type: "i32",
    cond: var_("cond"),
    then_branch: num(42),
    else_branch: {
      tag: "prim",
      type: "i32",
      prim: "i32.trap",
      args: [],
    },
  };

  const wrapped: ExprNode = {
    tag: "let",
    name: "cond",
    value: num(1),
    body: expr,
  };

  assert_equals(
    Format.fmt(Expr, expr),
    "(if cond:i32 then 42:i32 else trap:i32):i32",
  );
  assert_includes(Emit.emit(Expr, wrapped), "if (result i32)");
  assert_includes(Emit.emit(Expr, wrapped), "else\n  unreachable\nend");
});

Deno.test("Expr.emit emits trap instructions", () => {
  const expr: ExprNode = {
    tag: "prim",
    type: "i32",
    prim: "i32.trap",
    args: [],
  };

  assert_equals(Format.fmt(Expr, expr), "trap:i32");
  assert_equals(Emit.emit(Expr, expr), "unreachable");
});

Deno.test("Expr.emit emits memory load instructions", () => {
  const expr: ExprNode = {
    tag: "prim",
    type: "i32",
    prim: "i32.load",
    args: [num(0)],
  };

  assert_equals(Format.fmt(Expr, expr), "load(0:i32):i32");
  assert_equals(Emit.emit(Expr, expr), "i32.const 0\ni32.load");

  const byte: ExprNode = {
    tag: "prim",
    type: "i32",
    prim: "i32.load8_u",
    args: [num(4)],
  };

  assert_equals(Format.fmt(Expr, byte), "load8_u(4:i32):i32");
  assert_equals(Emit.emit(Expr, byte), "i32.const 4\ni32.load8_u");
});

Deno.test("Expr.emit lowers text literals to pointers with data", () => {
  const expr: ExprNode = { tag: "text", value: "hi" };

  assert_equals(Typed.type(Expr, expr), "i32");
  assert_equals(Format.fmt(Expr, expr), '"hi":text');
  assert_equals(Emit.emit(Expr, expr), "i32.const 0");
  assert_equals(Data.data(Expr, expr), [
    { offset: 0, bytes: [2, 0, 0, 0, 104, 105] },
  ]);
});

Deno.test("Expr.data allocates text literals in expression order", () => {
  const expr: ExprNode = {
    tag: "let",
    name: "first",
    value: { tag: "text", value: "a" },
    body: { tag: "text", value: "bc" },
  };

  assert_equals(
    Emit.emit(Expr, expr),
    "(local $first i32)\ni32.const 0\nlocal.set $first\ni32.const 8",
  );
  assert_equals(Data.data(Expr, expr), [
    { offset: 0, bytes: [1, 0, 0, 0, 97] },
    { offset: 8, bytes: [2, 0, 0, 0, 98, 99] },
  ]);
});

Deno.test("Expr.emit emits let locals before the body", () => {
  const expr: ExprNode = {
    tag: "let",
    name: "x",
    value: num(41),
    body: add(var_("x"), num(1)),
  };

  assert_equals(
    Emit.emit(Expr, expr),
    "(local $x i32)\ni32.const 41\nlocal.set $x\nlocal.get $x\ni32.const 1\ni32.add",
  );
});

Deno.test("Expr.emit rejects unbound variables", () => {
  assert_throws(() => Emit.emit(Expr, var_("x")), "Unbound variable: x");
});

Deno.test("Expr.emit rejects local type mismatches", () => {
  const expr: ExprNode = {
    tag: "let",
    name: "x",
    value: num(1),
    body: { tag: "var", type: "i64", name: "x" },
  };

  assert_throws(() => Emit.emit(Expr, expr), "Local $x is i32, got i64");
});

Deno.test("Expr.emit rejects primitive operand type mismatches", () => {
  const expr: ExprNode = {
    tag: "prim",
    type: "i32",
    prim: "i32.add",
    args: [num(1), num64(2n)],
  };

  assert_throws(
    () => Emit.emit(Expr, expr),
    "Primitive i32.add argument 1 expects i32, got i64",
  );
});

Deno.test("Expr.fmt rejects primitive arity mismatches", () => {
  const expr: ExprNode = {
    tag: "prim",
    type: "i32",
    prim: "i32.add",
    args: [num(1)],
  };

  assert_throws(
    () => Format.fmt(Expr, expr),
    "Primitive i32.add expects 2 arguments",
  );
});

Deno.test("Expr.emit output can be matched by instruction snippets", () => {
  const emitted = Emit.emit(Expr, add(num(10), num(20)));

  assert_includes(emitted, "i32.const 10");
  assert_includes(emitted, "i32.add");
});
