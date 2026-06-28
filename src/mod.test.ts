import { assertEquals, assertThrows } from "./assert.ts";
import { Mod, type Mod as ModNode } from "./mod.ts";
import { Emit } from "./trait.ts";

Deno.test("Mod.emit emits functions and exports", () => {
  const mod: ModNode = {
    funcs: {
      main: {
        name: "main",
        result: "i32",
        body: "i32.const 42",
      },
    },
    exports: ["main"],
  };

  assertEquals(
    Emit.emit(Mod, mod),
    '(module\n  (func $main (result i32)\n    i32.const 42\n  )\n  (export "main" (func $main))\n)',
  );
});

Deno.test("Mod.emit rejects missing exports", () => {
  const mod: ModNode = {
    funcs: {},
    exports: ["main"],
  };

  assertThrows(() => Emit.emit(Mod, mod), "Missing function for export: main");
});

Deno.test("Mod.emit rejects function key and name mismatches", () => {
  const mod: ModNode = {
    funcs: {
      main: {
        name: "other",
        result: "i32",
        body: "i32.const 42",
      },
    },
    exports: ["main"],
  };

  assertThrows(() => Emit.emit(Mod, mod), "Function key/name mismatch: main");
});
