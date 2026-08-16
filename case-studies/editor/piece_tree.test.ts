import { assert_equals } from "../../src/assert.ts";
import { DuckCompiler } from "../../src/compiler.ts";
import { Source } from "../../src/frontend.ts";

const encoder = new TextEncoder();

Deno.test("piece tree source infers spans without diagnostics", () => {
  const source_url = new URL("./piece_tree.duck", import.meta.url);
  const analysis = Source.analyze_file(source_url.href, {
    warnings: true,
  });

  assert_equals(analysis.diagnostics, []);
});

Deno.test("piece tree edits preserve prior snapshots", async () => {
  const compiler = await DuckCompiler.create();

  try {
    const source_url = new URL("./piece_tree_fixture.duck", import.meta.url);
    const execution = await compiler.run_file(source_url.href);

    assert_equals(execution.value, {
      kind: "constructor",
      name: "duck::$DuckStruct:duck_entry_result_type",
      fields: [
        { kind: "bytes", value: encoder.encode("abcd") },
        { kind: "bytes", value: encoder.encode("acd") },
        { kind: "integer", value: 3 },
        { kind: "integer", value: "a".charCodeAt(0) },
      ],
    });
  } finally {
    compiler.destroy();
  }
});
