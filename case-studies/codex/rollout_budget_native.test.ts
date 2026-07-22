import { assert_equals } from "../../src/assert.ts";
import { TestSource } from "../../src/frontend/test_source.ts";
import { instantiate_wat } from "../../src/wasm_test_util.ts";

const fixtures = [
  ["rollout_budget_usage_fixture.duck", 11_111],
  ["rollout_budget_reminder_fixture.duck", 111_111],
] as const;

Deno.test("Codex rollout budgets run through the native backend", async () => {
  for (const [fixture, expected_score] of fixtures) {
    const fixture_url = new URL("./" + fixture, import.meta.url);
    const source = TestSource.load_fragment_file(fixture_url.href);
    const wat = TestSource.wat(source);
    const instance = await instantiate_wat(
      wat,
      "rollout_budget_native",
      {},
    );

    if (typeof instance.exports.main !== "function") {
      throw new Error("Missing main export for " + fixture);
    }
    if (!(instance.exports.memory instanceof WebAssembly.Memory)) {
      throw new Error("Missing memory export for " + fixture);
    }

    const result = instance.exports.main();
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
