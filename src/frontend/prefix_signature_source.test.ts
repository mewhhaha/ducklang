import { assert_equals } from "../assert.ts";
import { parse_duck_source } from "./baba_parser.ts";
import { checked_value, diagnostics_of } from "./checked.ts";
import { associate_prefix_signatures } from "./prefix_signature.ts";
import { extract_prefix_source_metadata } from "./prefix_signature_source.ts";

Deno.test("prefix source extraction preserves clauses and masks declarations", () => {
  const source = "type identity = (value: I32) -> (result: I32)\n" +
    "requires value = value\n" +
    "ensures result = value\n" +
    "let identity = value => value;\n";
  const metadata = extract_prefix_source_metadata(parse_duck_source(source));
  assert_equals(metadata.signatures[0]?.name, "identity");
  assert_equals(metadata.signatures[0]?.requires[0]?.tag, "equal");
  assert_equals(metadata.signatures[0]?.ensures[0]?.tag, "equal");
  const requirement = metadata.signatures[0]?.requires[0];
  const guarantee = metadata.signatures[0]?.ensures[0];
  if (requirement === undefined || guarantee === undefined) {
    throw new Error("Expected structured contract clauses.");
  }
  assert_equals(
    source.slice(requirement.span.start, requirement.span.end),
    "value = value",
  );
  assert_equals(
    source.slice(guarantee.span.start, guarantee.span.end),
    "result = value",
  );
  assert_equals(metadata.definitions[0]?.name, "identity");
  assert_equals(metadata.masked_source.includes("let identity"), true);
  assert_equals(metadata.masked_source.includes("ensures"), false);
});

Deno.test("prefix source extraction records fact definition kinds", () => {
  const source = "type multiple_of = (value: I32) -> Prop\n" +
    "opaque fact multiple_of = value => true;\n";
  const metadata = extract_prefix_source_metadata(parse_duck_source(source));
  assert_equals(metadata.definitions[0]?.kind, "opaque fact");
  assert_equals(metadata.signatures[0]?.kind, "opaque fact");
});

Deno.test("prefix source extraction handles non-space clause separators", () => {
  const source = "type f = (value: I32) -> (result: I32)\n" +
    "requires\tvalue = value\n" +
    "ensures\nresult = value\n" +
    "let f = value => value;\n";
  const metadata = extract_prefix_source_metadata(parse_duck_source(source));
  assert_equals(metadata.signatures[0]?.requires[0]?.tag, "equal");
  assert_equals(metadata.signatures[0]?.ensures[0]?.tag, "equal");
});

Deno.test("prefix source extraction retains decreases clauses", () => {
  const source = "type f = (value: I32) -> I32\n" +
    "decreases value\n" +
    "decreases value\n" +
    "let f = value => value;\n";
  const metadata = extract_prefix_source_metadata(parse_duck_source(source));
  assert_equals(
    metadata.signatures[0]?.decreases.map((metric) => metric.text),
    ["value", "value"],
  );
  assert_equals(
    metadata.signatures[0]?.decreases.map((metric) => metric.shape),
    [
      { tag: "name", name: "value" },
      { tag: "name", name: "value" },
    ],
  );
  const signature = metadata.signatures[0];
  if (signature === undefined) throw new Error("Expected extracted signature.");
  const result = associate_prefix_signatures(
    [signature],
    [{ name: "f", kind: "let", scope: "root", span: { start: 80, end: 90 } }],
  );
  assert_equals(diagnostics_of(result)[0]?.code, "DUCK2603");
});

Deno.test("prefix source extraction separates block scopes", () => {
  const source = "let outer = do\n" +
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
  const signature =
    extract_prefix_source_metadata(parse_duck_source(source)).signatures[0];
  assert_equals(signature?.requires[0]?.tag, "equal");
  assert_equals(signature?.ensures[0]?.tag, "equal");
});

Deno.test("prefix source extraction does not invent an empty clause", () => {
  const source = "type f = (value: I32) -> (result: I32)\n" +
    "requires\n" +
    "ensures result = value\n" +
    "let f = value => value;\n";
  const parsed = parse_duck_source(source);
  const signature = extract_prefix_source_metadata(parsed).signatures[0];
  assert_equals(parsed.diagnostics, [{
    message: "Contract clause requires a proposition before the next clause",
    span: {
      start: source.indexOf("requires") + "requires".length,
      end: source.indexOf("requires") + "requires".length,
    },
  }]);
  assert_equals(signature?.requires[0]?.tag, "holds");
  if (signature?.requires[0]?.tag !== "holds") {
    throw new Error("Expected the explicit requires proposition.");
  }
  assert_equals(signature.requires[0].value.text, "ensures");
  assert_equals(signature.ensures, []);
});

Deno.test("prefix source extraction separates inline clauses from result types", () => {
  const source = "type f = (value: I32) -> I32 ensures false\n" +
    "let f = value => value;\n";
  const signature =
    extract_prefix_source_metadata(parse_duck_source(source)).signatures[0];
  assert_equals(signature?.type.parameters[0]?.type.text, "I32");
  assert_equals(signature?.type.parameters[0]?.type.canonical, "I32");
  assert_equals(signature?.type.result.type.text, "I32");
  assert_equals(signature?.type.result.type.canonical, "I32");
  assert_equals(signature?.ensures[0]?.tag, "holds");
});

Deno.test("prefix source extraction follows structural binding names", () => {
  const repeated = extract_prefix_source_metadata(
    parse_duck_source("let x | x = value;\n"),
  );
  assert_equals(repeated.definitions.map((definition) => definition.name), [
    "x",
  ]);

  const destructured = extract_prefix_source_metadata(
    parse_duck_source("let [left, right] = value;\n"),
  );
  assert_equals(
    destructured.definitions.map((definition) => definition.name),
    ["left", "right"],
  );
});

Deno.test("structural binders associate with source prefix signatures", () => {
  const source = "type left = (value: I32) -> I32\n" +
    "let [left, right] = pair;\n";
  const metadata = extract_prefix_source_metadata(parse_duck_source(source));
  const associated = associate_prefix_signatures(
    metadata.signatures,
    metadata.definitions,
  );
  assert_equals(diagnostics_of(associated), []);
});

Deno.test("prefix source extraction retains every mutual definition", () => {
  const source = "let rec even = value => value\n" +
    "and odd = value => value;\n";
  const metadata = extract_prefix_source_metadata(parse_duck_source(source));
  assert_equals(metadata.definitions.map((definition) => definition.name), [
    "even",
    "odd",
  ]);
});

Deno.test("prefix source extraction accepts a contextual fixity name", () => {
  const source = "type prefix = (value: I32) -> I32\n" +
    "let prefix = value => value;\n";
  const metadata = extract_prefix_source_metadata(parse_duck_source(source));
  assert_equals(metadata.signatures.map((signature) => signature.name), [
    "prefix",
  ]);
  assert_equals(metadata.definitions.map((definition) => definition.name), [
    "prefix",
  ]);
  const associated = associate_prefix_signatures(
    metadata.signatures,
    metadata.definitions,
  );
  assert_equals(diagnostics_of(associated), []);
  assert_equals(checked_value(associated)?.size, 1);
});

Deno.test("prefix type canonicalization preserves application boundaries", () => {
  const metadata = extract_prefix_source_metadata(parse_duck_source(
    "type Box a = a\n" +
      "type p = forall (a: Type). (value: Box a) -> Prop\n" +
      "fact p = value => True;\n",
  ));
  assert_equals(
    metadata.signatures[0]?.type.parameters[0]?.type.canonical,
    "Box a",
  );
});
