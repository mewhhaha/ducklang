import { assert_equals } from "../../src/assert.ts";
import { TestSource } from "../../src/frontend/test_source.ts";
import { instantiate_wat } from "../../src/wasm_test_util.ts";

const fixture_url = new URL(
  "./current_time_schedule_fixture.duck",
  import.meta.url,
);

Deno.test("Codex current-time reminders run through the native backend", async () => {
  const source = TestSource.load_fragment_file(fixture_url.href);
  const wat = TestSource.wat(source);
  const instance = await instantiate_wat(
    wat,
    "current_time_schedule_native",
    {},
  );

  if (typeof instance.exports.main !== "function") {
    throw new Error("Missing main export");
  }
  if (!(instance.exports.memory instanceof WebAssembly.Memory)) {
    throw new Error("Missing memory export");
  }

  const result = instance.exports.main();
  if (typeof result !== "number") {
    throw new Error("Expected managed result pointer");
  }

  const score = new DataView(instance.exports.memory.buffer).getInt32(
    result,
    true,
  );
  assert_equals(score, 1111);
});
