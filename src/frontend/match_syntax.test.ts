import { assert_equals, assert_throws } from "../assert.ts";
import { TestSource as Source } from "./test_source.ts";
import { instantiate_wat, wat_from_core_source } from "../wasm_test_util.ts";

function main_result(instance: WebAssembly.Instance): unknown {
  const main = instance.exports.main;

  if (typeof main !== "function") {
    throw new Error("Missing main export");
  }

  return main();
}

Deno.test("match over literals compiles through WAT to Wasm", async () => {
  const wat = wat_from_core_source(`
let byte = 10
let value = match byte {
  0 => 1,
  10 => 42,
  _ => 3,
}
value
`);
  const instance = await instantiate_wat(wat, "match_literals", {});

  assert_equals(main_result(instance), 42);
});

Deno.test("match over a dynamic union compiles through WAT to Wasm", async () => {
  const wat = wat_from_core_source(`
const result_type = union {
  ok: Int,
  err: Int
}

let flag = 1
let result: result_type = if flag {
  result_type.ok(41)
} else {
  result_type.err(2)
}
let value = match result {
  .ok(found) => found + 1,
  .err(code) => code,
}
value
`);
  const instance = await instantiate_wat(wat, "match_dynamic_union", {});

  assert_equals(main_result(instance), 42);
});

Deno.test("match guards fall through to later arms", async () => {
  const wat = wat_from_core_source(`
const result_type = union {
  ok: Int,
  err: Int
}

let flag = 1
let result: result_type = if flag {
  result_type.ok(41)
} else {
  result_type.err(2)
}
let value = match result {
  .ok(found), found == 0 => 7,
  .ok(found) => found + 1,
  .err(code) => code,
}
value
`);
  const instance = await instantiate_wat(wat, "match_guard_fallthrough", {});

  assert_equals(main_result(instance), 42);
});

Deno.test("match guards select their arm when the guard holds", async () => {
  const wat = wat_from_core_source(`
const result_type = union {
  ok: Int,
  err: Int
}

let flag = 1
let result: result_type = if flag {
  result_type.ok(0)
} else {
  result_type.err(2)
}
let value = match result {
  .ok(found), found == 0 => 42,
  .ok(found) => found,
  .err(code) => code,
}
value
`);
  const instance = await instantiate_wat(wat, "match_guard_selected", {});

  assert_equals(main_result(instance), 42);
});

Deno.test("match hoists non-name targets into a hidden binding", async () => {
  const wat = wat_from_core_source(`
let pick = (n: Int) => n + 1
let value = match pick(9) {
  10 => 42,
  _ => 0,
}
value
`);
  const instance = await instantiate_wat(wat, "match_hoisted_target", {});

  assert_equals(main_result(instance), 42);
});

Deno.test("match without a matching arm traps as unreachable", async () => {
  const wat = wat_from_core_source(`
const result_type = union {
  ok: Int,
  err: Int
}

let flag = 0
let result: result_type = if flag {
  result_type.ok(41)
} else {
  result_type.err(2)
}
let value = match result {
  .ok(found) => found + 1,
}
value
`);
  const instance = await instantiate_wat(wat, "match_unreachable", {});

  let trapped = false;

  try {
    main_result(instance);
  } catch (_error) {
    trapped = true;
  }

  assert_equals(trapped, true);
});

Deno.test("if let conditions accept guards in both spellings", async () => {
  const wat = wat_from_core_source(`
const result_type = union {
  ok: Int,
  err: Int
}

let result: result_type = result_type.ok(0)
let value = 1

if (let .ok(x) = result, x == 0) {
  value = 41
}

if let .ok(x) = result, value == 41 {
  value = value + 1
}

value
`);
  const instance = await instantiate_wat(wat, "if_let_guards", {});

  assert_equals(main_result(instance), 42);
});

Deno.test("if let guard failure selects the else branch", async () => {
  const wat = wat_from_core_source(`
const result_type = union {
  ok: Int,
  err: Int
}

let result: result_type = result_type.ok(5)
let value = if let .ok(x) = result, x == 0 {
  7
} else {
  42
}
value
`);
  const instance = await instantiate_wat(wat, "if_let_guard_else", {});

  assert_equals(main_result(instance), 42);
});

Deno.test("literal patterns accept guards", async () => {
  const wat = wat_from_core_source(`
let byte = 10
let extra = 1
let value = 0

if (let 10 = byte, extra == 1) {
  value = 42
}

value
`);
  const instance = await instantiate_wat(wat, "literal_guard", {});

  assert_equals(main_result(instance), 42);
});

Deno.test("match rejects arms after an unguarded wildcard", () => {
  assert_throws(
    () =>
      Source.parse(`
let byte = 1
let value = match byte {
  _ => 1,
  0 => 2,
}
value
`),
    "Match arm after a wildcard arm is unreachable",
  );
});
