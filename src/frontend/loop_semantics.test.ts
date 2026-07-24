import { assert_includes, assert_throws } from "../assert.ts";
import { Source } from "../frontend.ts";

Deno.test("value loops type direct breaks through if expression branches", () => {
  const wat = Source.wat(`
let value = loop {
  if true {
    break 7;
  } else if false {
    break 8;
  } else {
    break 9;
  }
};
value
`);

  assert_includes(wat, "block $loop_exit_0 (result i32)");
  assert_includes(wat, "br $loop_exit_0");
});

Deno.test("value loops reject bare and valued breaks before Core erases Unit", () => {
  assert_throws(
    () =>
      Source.wat(`
let value = loop {
  if true {
    break;
  } else if false {
    break 1;
  } else {
    break;
  }
};
value
`),
    "Loop breaks must return one source type, got Unit and value",
  );
});

Deno.test("bare loop breaks produce a discardable Unit value", () => {
  const wat = Source.wat(`
loop {
  break;
}
42
`);

  assert_includes(wat, "i32.const 0");
  assert_includes(wat, "br $loop_exit_0");
  assert_includes(wat, "drop\n    i32.const 42");
});
