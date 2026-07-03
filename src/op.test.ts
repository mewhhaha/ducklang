import { assert_equals, assert_throws } from "./assert.ts";
import { Prim, specialize_prim_for_operands } from "./op.ts";
import { Callable, Emit, Format } from "./trait.ts";

Deno.test("Prim.fmt formats typed primitives", () => {
  assert_equals(Format.fmt(Prim, "i32.add"), "+");
  assert_equals(Format.fmt(Prim, "i64.add"), "+");
  assert_equals(Format.fmt(Prim, "i32.sub"), "-");
  assert_equals(Format.fmt(Prim, "i64.sub"), "-");
  assert_equals(Format.fmt(Prim, "i32.mul"), "*");
  assert_equals(Format.fmt(Prim, "i64.mul"), "*");
  assert_equals(Format.fmt(Prim, "i32.div_s"), "/");
  assert_equals(Format.fmt(Prim, "i64.rem_s"), "%");
  assert_equals(Format.fmt(Prim, "i32.eq"), "==");
  assert_equals(Format.fmt(Prim, "i64.lt_s"), "<");
  assert_equals(Format.fmt(Prim, "i32.ge_s"), ">=");
  assert_equals(Format.fmt(Prim, "i32.select"), "select");
  assert_equals(Format.fmt(Prim, "i32.load"), "load");
  assert_equals(Format.fmt(Prim, "i32.load8_u"), "load8_u");
  assert_equals(Format.fmt(Prim, "i32.trap"), "trap");
});

Deno.test("Prim.arity returns primitive arity", () => {
  assert_equals(Callable.arity(Prim, "i32.add"), 2);
  assert_equals(Callable.arity(Prim, "i64.mul"), 2);
  assert_equals(Callable.arity(Prim, "i32.rem_s"), 2);
  assert_equals(Callable.arity(Prim, "i32.lt_s"), 2);
  assert_equals(Callable.arity(Prim, "i64.select"), 3);
  assert_equals(Callable.arity(Prim, "i32.load"), 1);
  assert_equals(Callable.arity(Prim, "i32.load8_u"), 1);
  assert_equals(Callable.arity(Prim, "i32.trap"), 0);
});

Deno.test("Prim.type returns primitive function signatures", () => {
  assert_equals(Callable.type(Prim, "i32.add"), {
    args: ["i32", "i32"],
    result: "i32",
  });
  assert_equals(Callable.type(Prim, "i64.mul"), {
    args: ["i64", "i64"],
    result: "i64",
  });
  assert_equals(Callable.type(Prim, "i32.div_s"), {
    args: ["i32", "i32"],
    result: "i32",
  });
  assert_equals(Callable.type(Prim, "i64.lt_s"), {
    args: ["i64", "i64"],
    result: "i32",
  });
  assert_equals(Callable.type(Prim, "i64.select"), {
    args: ["i64", "i64", "i32"],
    result: "i64",
  });
  assert_equals(Callable.type(Prim, "i32.load"), {
    args: ["i32"],
    result: "i32",
  });
  assert_equals(Callable.type(Prim, "i32.load8_u"), {
    args: ["i32"],
    result: "i32",
  });
  assert_equals(Callable.type(Prim, "i32.trap"), {
    args: [],
    result: "i32",
  });
});

Deno.test("Prim specializes parse-time defaults from operand types", () => {
  assert_equals(
    specialize_prim_for_operands("i32.add", "i64", "i64"),
    "i64.add",
  );
  assert_equals(
    specialize_prim_for_operands("i32.lt_s", "i64", "i64"),
    "i64.lt_s",
  );
  assert_equals(
    specialize_prim_for_operands("i64.add", "i32", "i32"),
    "i32.add",
  );
  assert_equals(
    specialize_prim_for_operands("i32.select", "i64", "i64"),
    "i32.select",
  );
  assert_throws(
    () => specialize_prim_for_operands("i32.add", "i64", "i32"),
    "Mixed i32 and i64 operands for operator +",
  );
});

Deno.test("Prim.emit returns the typed primitive instruction", () => {
  assert_equals(Emit.emit(Prim, "i32.sub"), "i32.sub");
  assert_equals(Emit.emit(Prim, "i64.mul"), "i64.mul");
  assert_equals(Emit.emit(Prim, "i32.div_s"), "i32.div_s");
  assert_equals(Emit.emit(Prim, "i32.eq"), "i32.eq");
  assert_equals(Emit.emit(Prim, "i32.select"), "select");
  assert_equals(Emit.emit(Prim, "i32.load"), "i32.load");
  assert_equals(Emit.emit(Prim, "i32.load8_u"), "i32.load8_u");
  assert_equals(Emit.emit(Prim, "i32.trap"), "unreachable");
  assert_equals(Emit.all(Prim, ["i32.sub", "i64.mul", "i32.eq"]), [
    "i32.sub",
    "i64.mul",
    "i32.eq",
  ]);
});
