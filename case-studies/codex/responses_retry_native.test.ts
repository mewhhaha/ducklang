import { assert_equals } from "../../src/assert.ts";
import { TestSource } from "../../src/frontend/test_source.ts";
import { instantiate_wat } from "../../src/wasm_test_util.ts";

const fixture = "responses_retry_fixture.duck";
const fixture_url = new URL("./" + fixture, import.meta.url);

Deno.test("Codex response stream retries run through the native backend", async () => {
  const source = TestSource.load_fragment_file(fixture_url.href);
  const wat = TestSource.wat(source);
  const instance = await instantiate_wat(wat, "responses_retry_native", {});

  if (typeof instance.exports.main !== "function") {
    throw new Error("Missing main export for " + fixture);
  }
  if (!(instance.exports.memory instanceof WebAssembly.Memory)) {
    throw new Error("Missing memory export for " + fixture);
  }

  let result: unknown;
  try {
    result = instance.exports.main();
  } catch (error) {
    throw new Error("Native response-retry fixture trapped: " + fixture, {
      cause: error,
    });
  }
  if (typeof result !== "number") {
    throw new Error("Expected managed result pointer for " + fixture);
  }

  const score = new DataView(instance.exports.memory.buffer).getInt32(
    result,
    true,
  );
  assert_equals(score, 111_111, fixture);
});
