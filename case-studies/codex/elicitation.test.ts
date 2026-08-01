import { assert_equals } from "../../src/assert.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL("./elicitation_fixture.duck", import.meta.url);

Deno.test("Codex keeps delivery paused for every active elicitation", async () => {
  const compiler = await DuckCompiler.create();

  try {
    const execution = await compiler.run_file(source_url.href);

    assert_equals(execution.value, {
      kind: "constructor",
      name: "duck::$DuckStruct:duck_entry_result_type",
      fields: [{ kind: "integer", value: 111 }],
    });
  } finally {
    compiler.destroy();
  }
});
