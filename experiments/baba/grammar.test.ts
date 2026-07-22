import { applyBundle, generate, parseMetadata } from "@mewhhaha/baba";
import { assert_equals } from "../../src/assert.ts";

interface GeneratedParser {
  parse(source: string): {
    readonly ok: boolean;
    readonly diagnostics: readonly unknown[];
  };
  dispose(): void;
}

interface GeneratedParserModule {
  createParser(options: {
    readonly bytes: Uint8Array;
    readonly plan: Uint8Array;
  }): GeneratedParser;
}

Deno.test("Baba generates a parser for Duck contextual lexer tokens", async () => {
  const grammar_url = new URL("./grammar.baba", import.meta.url);
  const grammar = await Deno.readTextFile(grammar_url);
  const metadata = parseMetadata(
    await Deno.readTextFile(new URL("./metadata.json", import.meta.url)),
  );
  const bundle = generate(grammar, {
    name: "duck_contextual_lexer",
    rootRule: "document",
    metadata,
  });
  const output_directory = await Deno.makeTempDir();

  try {
    await applyBundle(bundle, { root: output_directory });
    const module = await import(
      new URL(
        "./wasm/mod.ts",
        new URL("file://" + output_directory + "/"),
      ).href
    ) as GeneratedParserModule;
    const parser = module.createParser({
      bytes: await Deno.readFile(`${output_directory}/wasm/parser.wasm`),
      plan: await Deno.readFile(`${output_directory}/wasm/parser.plan`),
    });

    try {
      assert_parse(parser, "app:f x if y z");
      assert_parse(parser, "app:f 42 if y z");
      assert_parse(parser, 'app:f "text" if y z');
      assert_parse(parser, "app:f 'c' if y z");
      assert_parse(parser, "app:f _ if y z");
      assert_parse(parser, "app:f (x) if y z");
      assert_parse(parser, "app:f [x] if y z");
      assert_parse(parser, "app:f {x} if y z");
      assert_parse(parser, "app:f !x if y z");
      assert_parse(parser, "app:f #x if y z");
      for (
        const keyword of [
          "as",
          "by",
          "else",
          "if",
          "in",
          "is",
          "where",
          "with",
        ]
      ) {
        assert_parse(parser, `stop:f ${keyword} y`);
      }
      assert_parse(parser, "type:Option Value");
      assert_parse(parser, "type:Option #row");
      assert_parse(parser, "type:Option &Value");
      assert_parse(parser, "type:Option (Value)");
      assert_parse(parser, "type:Option [Value]");
      assert_parse(parser, "break:break 42");
      assert_parse(parser, "break:break ");
      assert_parse(parser, "extension:first\nsecond");
      assert_equals(parser.parse("app:f\nx if y").ok, false);
    } finally {
      parser.dispose();
    }
  } finally {
    await Deno.remove(output_directory, { recursive: true });
  }
});

function assert_parse(parser: GeneratedParser, source: string): void {
  const result = parser.parse(source);
  assert_equals(
    result.ok,
    true,
    `Baba did not parse ${JSON.stringify(source)}`,
  );
  assert_equals(result.diagnostics, []);
}
