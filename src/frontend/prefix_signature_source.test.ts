import { assert_equals } from "../assert.ts";
import { parse_duck_source } from "./baba_parser.ts";
import { diagnostics_of } from "./checked.ts";
import { associate_prefix_signatures } from "./prefix_signature.ts";
import { extract_prefix_source_metadata } from "./prefix_signature_source.ts";

Deno.test("prefix source extraction preserves clauses and masks declarations", () => {
  const source =
    "type identity = (value: I32) -> (result: I32)\n" +
    "requires value = value\n" +
    "ensures result = value\n" +
    "let identity = value => value;\n";
  const metadata = extract_prefix_source_metadata(parse_duck_source(source));
  assert_equals(metadata.signatures[0]?.name, "identity");
  assert_equals(metadata.signatures[0]?.requires, ["value = value"]);
  assert_equals(metadata.signatures[0]?.ensures, ["result = value"]);
  assert_equals(metadata.definitions[0]?.name, "identity");
  assert_equals(metadata.masked_source.includes("let identity"), true);
  assert_equals(metadata.masked_source.includes("ensures"), false);
});

Deno.test("prefix source extraction records fact definition kinds", () => {
  const source =
    "type multiple_of = (value: I32) -> Prop\n" +
    "opaque fact multiple_of = value => true;\n";
  const metadata = extract_prefix_source_metadata(parse_duck_source(source));
  assert_equals(metadata.definitions[0]?.kind, "opaque fact");
  assert_equals(metadata.signatures[0]?.kind, "opaque fact");
});

Deno.test("prefix source extraction handles non-space clause separators", () => {
  const source =
    "type f = (value: I32) -> (result: I32)\n" +
    "requires\tvalue = value\n" +
    "ensures\nresult = value\n" +
    "let f = value => value;\n";
  const metadata = extract_prefix_source_metadata(parse_duck_source(source));
  assert_equals(metadata.signatures[0]?.requires, ["value = value"]);
  assert_equals(metadata.signatures[0]?.ensures, ["result = value"]);
});

Deno.test("prefix source extraction retains decreases clauses", () => {
  const source =
    "type f = (value: I32) -> I32\n" +
    "decreases value\n" +
    "decreases value\n" +
    "let f = value => value;\n";
  const metadata = extract_prefix_source_metadata(parse_duck_source(source));
  assert_equals(metadata.signatures[0]?.decreases, ["value", "value"]);
  const signature = metadata.signatures[0];
  if (signature === undefined) throw new Error("Expected extracted signature.");
  const result = associate_prefix_signatures(
    [signature],
    [{ name: "f", kind: "let", scope: "root", span: { start: 80, end: 90 } }],
  );
  assert_equals(diagnostics_of(result)[0]?.code, "DUCK2603");
});

Deno.test("prefix source extraction separates block scopes", () => {
  const source =
    "let outer = do\n" +
    "type inner = (value: I32) -> I32\n" +
    "let inner = value => value;\n" +
    "end;\n";
  const metadata = extract_prefix_source_metadata(parse_duck_source(source));
  assert_equals(metadata.signatures[0]?.scope.startsWith("root/"), true);
  const inner_definition = metadata.definitions.find((definition) =>
    definition.name === "inner"
  );
  assert_equals(inner_definition?.scope, metadata.signatures[0]?.scope);
});

Deno.test("prefix source extraction keeps adjacent clauses separate", () => {
  const source =
    "type f = (value: I32) -> (result: I32) requires value = value ensures result = value\n" +
    "let f = value => value;\n";
  const signature = extract_prefix_source_metadata(parse_duck_source(source)).signatures[0];
  assert_equals(signature?.requires, ["value = value"]);
  assert_equals(signature?.ensures, ["result = value"]);
});

Deno.test("prefix source extraction diagnoses an empty clause", () => {
  const source =
    "type f = (value: I32) -> (result: I32)\n" +
    "requires\n" +
    "ensures result = value\n" +
    "let f = value => value;\n";
  const signature = extract_prefix_source_metadata(parse_duck_source(source)).signatures[0];
  assert_equals(signature?.requires, ["false"]);
  assert_equals(signature?.ensures, ["result = value"]);
});

Deno.test("prefix source extraction separates inline clauses from result types", () => {
  const source =
    "type f = (value: I32) -> I32 ensures false\n" +
    "let f = value => value;\n";
  const signature = extract_prefix_source_metadata(parse_duck_source(source)).signatures[0];
  assert_equals(signature?.type_text, "(value: I32) -> I32");
  assert_equals(signature?.ensures, ["false"]);
});
