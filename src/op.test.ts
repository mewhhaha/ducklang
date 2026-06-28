import { assertEquals } from "./assert.ts";
import { Prim } from "./op.ts";
import { Callable, Emit, Format } from "./trait.ts";

Deno.test("Prim.fmt formats typed primitives", () => {
  assertEquals(Format.fmt(Prim, "i32.add"), "+");
  assertEquals(Format.fmt(Prim, "i64.add"), "+");
  assertEquals(Format.fmt(Prim, "i32.sub"), "-");
  assertEquals(Format.fmt(Prim, "i64.sub"), "-");
  assertEquals(Format.fmt(Prim, "i32.mul"), "*");
  assertEquals(Format.fmt(Prim, "i64.mul"), "*");
});

Deno.test("Prim.arity returns binary primitive arity", () => {
  assertEquals(Callable.arity(Prim, "i32.add"), 2);
  assertEquals(Callable.arity(Prim, "i64.mul"), 2);
});

Deno.test("Prim.type returns primitive function signatures", () => {
  assertEquals(Callable.type(Prim, "i32.add"), {
    args: ["i32", "i32"],
    result: "i32",
  });
  assertEquals(Callable.type(Prim, "i64.mul"), {
    args: ["i64", "i64"],
    result: "i64",
  });
});

Deno.test("Prim.emit returns the typed primitive instruction", () => {
  assertEquals(Emit.emit(Prim, "i32.sub"), "i32.sub");
  assertEquals(Emit.emit(Prim, "i64.mul"), "i64.mul");
});
