import { assert_equals } from "../../src/assert.ts";
import { TestSource } from "../../src/frontend/test_source.ts";
import { instantiate_wat } from "../../src/wasm_test_util.ts";

const fixtures = [
  ["request_plugin_install_registration_fixture.duck", 11],
  ["request_plugin_install_list_spec_fixture.duck", 100],
  ["request_plugin_install_recommended_spec_fixture.duck", 1_000],
  ["request_plugin_install_execution_fixture.duck", 1],
  ["request_plugin_install_declined_execution_fixture.duck", 10],
] as const;

for (const [fixture, expected_score] of fixtures) {
  Deno.test(
    "Codex plugin-install requests run natively: " + fixture,
    async () => {
      const fixture_url = new URL("./" + fixture, import.meta.url);
      const source = TestSource.load_fragment_file(fixture_url.href);
      const wat = TestSource.wat(source);
      const instance = await instantiate_wat(
        wat,
        "request_plugin_install_native",
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
        throw new Error(
          "Native plugin-install request fixture trapped: " + fixture,
          {
            cause: error,
          },
        );
      }
      if (typeof result !== "number") {
        throw new Error("Expected managed result pointer for " + fixture);
      }

      const score = new DataView(instance.exports.memory.buffer).getInt32(
        result,
        true,
      );
      assert_equals(score, expected_score, fixture);
    },
  );
}
