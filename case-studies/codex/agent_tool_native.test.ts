import { assert_equals } from "../../src/assert.ts";
import { TestSource } from "../../src/frontend/test_source.ts";
import { instantiate_wat } from "../../src/wasm_test_util.ts";

Deno.test("Codex collaboration availability runs through native Core", async () => {
  const fixture_url = new URL(
    "./agent_tool_availability_fixture.duck",
    import.meta.url,
  );
  const source = TestSource.load_fragment_file(fixture_url.href);
  const wat = TestSource.wat(source);
  const instance = await instantiate_wat(wat, "agent_tool_native", {});

  if (typeof instance.exports.main !== "function") {
    throw new Error("Missing collaboration availability main export");
  }
  if (!(instance.exports.memory instanceof WebAssembly.Memory)) {
    throw new Error("Missing collaboration availability memory export");
  }

  let result: unknown;
  try {
    result = instance.exports.main();
  } catch (error) {
    throw new Error("Native collaboration availability fixture trapped", {
      cause: error,
    });
  }
  if (typeof result !== "number") {
    throw new Error(
      "Expected managed collaboration availability result pointer",
    );
  }

  const score = new DataView(instance.exports.memory.buffer).getInt32(
    result,
    true,
  );
  assert_equals(score, 111);
});
