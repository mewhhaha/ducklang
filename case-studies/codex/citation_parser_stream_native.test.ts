import { assert_equals } from "../../src/assert.ts";
import { TestSource } from "../../src/frontend/test_source.ts";
import { instantiate_wat } from "../../src/wasm_test_util.ts";

const fixture_url = new URL(
  "./citation_parser_stream_fixture.duck",
  import.meta.url,
);

Deno.test("Codex citation streaming runs through the native backend", async () => {
  const source = TestSource.load_fragment_file(fixture_url.href);
  const wat = TestSource.wat(source);
  const instance = await instantiate_wat(
    wat,
    "citation_parser_stream_native",
    {},
  );

  if (typeof instance.exports.main !== "function") {
    throw new Error("Missing main export");
  }

  assert_equals(instance.exports.main(), 474_580_703);
});
