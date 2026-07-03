import { assert_equals, assert_throws } from "./assert.ts";
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

  assert_equals(
    Emit.emit(Mod, mod),
    '(module\n  (func $main (result i32)\n    i32.const 42\n  )\n  (export "main" (func $main))\n)',
  );
});

Deno.test("Mod.emit emits function imports before local functions", () => {
  const mod: ModNode = {
    imports: {
      host_add: {
        name: "host_add",
        module: "env",
        field: "add",
        params: ["i32", "i32"],
        result: "i32",
      },
    },
    funcs: {
      main: {
        name: "main",
        result: "i32",
        body: "i32.const 20\ni32.const 22\ncall $host_add",
      },
    },
    exports: ["main", "host_add"],
  };

  assert_equals(
    Emit.emit(Mod, mod),
    '(module\n  (import "env" "add" (func $host_add (param i32 i32) (result i32)))\n  (func $main (result i32)\n    i32.const 20\n    i32.const 22\n    call $host_add\n  )\n  (export "main" (func $main))\n  (export "host_add" (func $host_add))\n)',
  );
});

Deno.test("Mod.emit emits memory and data segments", () => {
  const mod: ModNode = {
    memory: {
      name: "memory",
      pages: 1,
      export_name: "memory",
    },
    data: [
      {
        offset: 0,
        bytes: [104, 101, 108, 108, 111],
      },
    ],
    funcs: {},
    exports: [],
  };

  assert_equals(
    Emit.emit(Mod, mod),
    '(module\n  (memory $memory 1)\n  (export "memory" (memory $memory))\n  (data (i32.const 0) "\\68\\65\\6c\\6c\\6f")\n)',
  );
});

Deno.test("Mod.emit emits types, globals, tables, and function params", () => {
  const mod: ModNode = {
    types: {
      closure_i32_i32_to_i32: {
        name: "closure_i32_i32_to_i32",
        params: ["i32", "i32"],
        result: "i32",
      },
    },
    memory: {
      name: "memory",
      pages: 1,
      export_name: undefined,
    },
    globals: {
      __closure_heap: {
        name: "__closure_heap",
        type: "i32",
        mutable: true,
        value: 8,
      },
    },
    table: {
      name: "__closure_table",
      elements: ["closure_0"],
    },
    funcs: {
      closure_0: {
        name: "closure_0",
        params: [
          { name: "__env", type: "i32" },
          { name: "x", type: "i32" },
        ],
        result: "i32",
        body: "local.get $x",
      },
      main: {
        name: "main",
        result: "i32",
        body: "i32.const 42",
      },
    },
    exports: ["main"],
  };

  assert_equals(
    Emit.emit(Mod, mod),
    '(module\n  (type $closure_i32_i32_to_i32 (func (param i32 i32) (result i32)))\n  (memory $memory 1)\n  (global $__closure_heap (mut i32) (i32.const 8))\n  (table $__closure_table 1 funcref)\n  (elem (i32.const 0) $closure_0)\n  (func $closure_0 (param $__env i32) (param $x i32) (result i32)\n    local.get $x\n  )\n\n  (func $main (result i32)\n    i32.const 42\n  )\n  (export "main" (func $main))\n)',
  );
});

Deno.test("Mod.emit rejects data segments without memory", () => {
  const mod: ModNode = {
    data: [
      {
        offset: 0,
        bytes: [1],
      },
    ],
    funcs: {},
    exports: [],
  };

  assert_throws(() => Emit.emit(Mod, mod), "Data segments require memory");
});

Deno.test("Mod.emit rejects invalid data segment bytes", () => {
  const mod: ModNode = {
    memory: {
      name: "memory",
      pages: 1,
      export_name: undefined,
    },
    data: [
      {
        offset: 0,
        bytes: [256],
      },
    ],
    funcs: {},
    exports: [],
  };

  assert_throws(
    () => Emit.emit(Mod, mod),
    "Data segment byte out of range: 256",
  );
});

Deno.test("Mod.emit rejects missing exports", () => {
  const mod: ModNode = {
    funcs: {},
    exports: ["main"],
  };

  assert_throws(() => Emit.emit(Mod, mod), "Missing function for export: main");
});

Deno.test("Mod.emit rejects function import key and name mismatches", () => {
  const mod: ModNode = {
    imports: {
      host: {
        name: "other",
        module: "env",
        field: "host",
        params: [],
        result: "i32",
      },
    },
    funcs: {},
    exports: ["host"],
  };

  assert_throws(
    () => Emit.emit(Mod, mod),
    "Function import key/name mismatch: host",
  );
});

Deno.test("Mod.emit rejects duplicate imported and local names", () => {
  const mod: ModNode = {
    imports: {
      main: {
        name: "main",
        module: "env",
        field: "main",
        params: [],
        result: "i32",
      },
    },
    funcs: {
      main: {
        name: "main",
        result: "i32",
        body: "i32.const 42",
      },
    },
    exports: ["main"],
  };

  assert_throws(() => Emit.emit(Mod, mod), "Duplicate function name: main");
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

  assert_throws(() => Emit.emit(Mod, mod), "Function key/name mismatch: main");
});
