import { assert_equals } from "../../src/assert.ts";
import { TestSource } from "../../src/frontend/test_source.ts";
import { instantiate_wat } from "../../src/wasm_test_util.ts";

const fixtures = [
  ["view_image_registration_fixture.duck", 11],
  ["view_image_parameters_fixture.duck", 100],
  ["view_image_spec_fixture.duck", 1_000],
  ["view_image_disabled_spec_fixture.duck", 10_000],
  ["view_image_output_fixture.duck", 11],
] as const;

for (const [fixture, expected_score] of fixtures) {
  Deno.test("Codex image viewer runs natively: " + fixture, async () => {
    const fixture_url = new URL("./" + fixture, import.meta.url);
    const source = TestSource.load_fragment_file(fixture_url.href);
    const wat = TestSource.wat(source);
    const instance = await instantiate_wat(wat, "view_image_native", {});

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
      throw new Error("Native image viewer fixture trapped: " + fixture, {
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
  });
}
