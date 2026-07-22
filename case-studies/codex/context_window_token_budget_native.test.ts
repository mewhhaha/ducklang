import { assert_equals } from "../../src/assert.ts";
import { TestSource } from "../../src/frontend/test_source.ts";
import { instantiate_wat } from "../../src/wasm_test_util.ts";

const fixtures = [
  ["context_window_status_fixture.duck", 1_111],
  ["context_window_body_status_fixture.duck", 111],
  ["token_budget_tool_registration_fixture.duck", 111],
  ["token_budget_tool_output_fixture.duck", 1_111],
  ["new_context_window_tool_fixture.duck", 1],
] as const;

Deno.test("Codex context-window token-budget tools run through the native backend", async () => {
  for (const [fixture, expected_score] of fixtures) {
    const fixture_url = new URL("./" + fixture, import.meta.url);
    const source = TestSource.load_fragment_file(fixture_url.href);
    const wat = TestSource.wat(source);
    const instance = await instantiate_wat(
      wat,
      "context_window_token_budget_native",
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
      throw new Error("Native token-budget fixture trapped: " + fixture, {
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
});
