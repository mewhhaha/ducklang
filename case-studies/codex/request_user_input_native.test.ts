import { assert_equals } from "../../src/assert.ts";
import { TestSource } from "../../src/frontend/test_source.ts";
import { instantiate_wat } from "../../src/wasm_test_util.ts";

const fixtures = [
  ["request_user_input_normalization_fixture.duck", 11],
  ["request_user_input_options_fixture.duck", 11],
  ["request_user_input_availability_fixture.duck", 1_111_111],
  ["request_user_input_plan_fixture.duck", 111],
  ["request_user_input_registration_fixture.duck", 111],
  ["request_user_input_output_fixture.duck", 1],
  ["request_user_input_execution_fixture.duck", 11],
] as const;

for (const [fixture, expected_score] of fixtures) {
  Deno.test("Codex request-user-input runs natively: " + fixture, async () => {
    await run_fixture(fixture, expected_score);
  });
}

async function run_fixture(
  fixture: string,
  expected_score: number,
): Promise<void> {
  const fixture_url = new URL("./" + fixture, import.meta.url);
  const source = TestSource.load_fragment_file(fixture_url.href);
  const wat = TestSource.wat(source);
  const instance = await instantiate_wat(
    wat,
    "request_user_input_native",
    {},
  );

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
    throw new Error("Native request-user-input fixture trapped: " + fixture, {
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
  assert_equals(score, expected_score, fixture);
}
