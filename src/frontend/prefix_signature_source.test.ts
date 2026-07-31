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

Deno.test("prefix source extraction retains refinement binders", () => {
  const source = "type keep = " +
    "(value: {refined: I32 | refined = refined}) -> " +
    "(result: {answer: I32 | answer = value})\n" +
    "let keep = value => value;\n";
  const signature =
    extract_prefix_source_metadata(parse_duck_source(source)).signatures[0];
  assert_equals(signature?.type.parameters[0]?.type.canonical, "I32");
  assert_equals(
    signature?.type.parameters[0]?.type.refinement?.binder,
    "refined",
  );
  assert_equals(
    signature?.type.parameters[0]?.type.refinement?.proposition.tag,
    "equal",
  );
  assert_equals(signature?.type.result.type.canonical, "I32");
  assert_equals(signature?.type.result.type.refinement?.binder, "answer");
});

Deno.test("prefix source extraction retains constructor membership", () => {
  const source = "type use_some = " +
    "(value: Maybe, evidence: Proof value is #Some) -> I32\n" +
    "let use_some = (value, evidence) => 1;\n";
  const metadata = extract_prefix_source_metadata(parse_duck_source(source));
  const proof = metadata.signatures[0]?.type.parameters[1]?.type.proof;
  if (proof?.tag !== "is") {
    throw new Error("Expected constructor membership proposition.");
  }

  assert_equals(proof.type.canonical, "#Some");
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

Deno.test("prefix source extraction retains proof propositions and bodies", () => {
  const metadata = extract_prefix_source_metadata(parse_duck_source(
    "type keep = " +
      "(value: I32, evidence: Proof value = value) -> Proof value = value\n" +
      "let keep = (actual, proof) => by proof;\n",
  ));
  const signature = metadata.signatures[0];
  assert_equals(signature?.type.parameters[1]?.type.canonical, "Proof");
  assert_equals(signature?.type.parameters[1]?.type.proof?.tag, "equal");
  assert_equals(signature?.type.result.type.proof?.tag, "equal");
  const body = metadata.definitions[0]?.callable_proof_body;
  assert_equals(body?.tag, "name");
  if (body?.tag !== "name") throw new Error("Expected a named proof body.");
  assert_equals(body.name, "proof");
});

Deno.test("prefix source extraction retains propositional proof binders", () => {
  const metadata = extract_prefix_source_metadata(parse_duck_source(
    "type merge = (choice: Proof True or True) -> Proof True\n" +
      "let merge = choice => " +
      "by or_cases(choice, left => left, right => right);\n",
  ));
  const body = metadata.definitions[0]?.callable_proof_body;

  assert_equals(body?.tag, "or_cases");
  if (body?.tag !== "or_cases") {
    throw new Error("Expected a disjunction elimination proof body.");
  }
  assert_equals(body.proof.tag, "name");
  assert_equals(body.left_name, "left");
  assert_equals(body.left_body.tag, "name");
  assert_equals(body.right_name, "right");
  assert_equals(body.right_body.tag, "name");

  const lambda = extract_prefix_source_metadata(parse_duck_source(
    "let implication = () => by evidence => evidence;\n",
  )).definitions[0]?.callable_proof_body;
  assert_equals(lambda?.tag, "lambda");
  if (lambda?.tag !== "lambda") {
    throw new Error("Expected an implication introduction proof body.");
  }
  assert_equals(lambda.name, "evidence");
  assert_equals(lambda.body.tag, "name");
});

Deno.test("prefix source extraction retains quantified proof terms", () => {
  const metadata = extract_prefix_source_metadata(parse_duck_source(
    "let specialize = (universal, value) => " +
      "by forall_apply(universal, value);\n" +
      "let pack = (value, evidence) => " +
      "by exists_intro(value, evidence);\n" +
      "let open = existence => " +
      "by exists_elim(existence, witness, evidence => evidence);\n",
  ));
  const specialize = metadata.definitions[0]?.callable_proof_body;
  const pack = metadata.definitions[1]?.callable_proof_body;
  const open = metadata.definitions[2]?.callable_proof_body;

  assert_equals(specialize?.tag, "forall_apply");
  if (specialize?.tag !== "forall_apply") {
    throw new Error("Expected universal application.");
  }
  assert_equals(specialize.argument.shape, {
    tag: "name",
    name: "value",
  });
  assert_equals(pack?.tag, "exists_intro");
  if (pack?.tag !== "exists_intro") {
    throw new Error("Expected existential introduction.");
  }
  assert_equals(pack.witness.shape, { tag: "name", name: "value" });
  assert_equals(open?.tag, "exists_elim");
  if (open?.tag !== "exists_elim") {
    throw new Error("Expected existential elimination.");
  }
  assert_equals(open.witness_name, "witness");
  assert_equals(open.evidence_name, "evidence");
  assert_equals(open.body.tag, "name");
});

Deno.test("prefix source extraction retains tactic blocks", () => {
  const source =
    "type prove = (evidence: Proof True) -> Proof True and True\n" +
    "let prove = evidence => " +
    "by { constructor exact evidence apply evidence cases evidence " +
    "rewrite evidence decide simp [evidence] };\n";
  const metadata = extract_prefix_source_metadata(parse_duck_source(source));
  const proof = metadata.definitions[0]?.callable_proof_body;
  assert_equals(proof?.tag, "tactics");
  if (proof?.tag !== "tactics") {
    throw new Error("Expected extracted tactic block.");
  }
  assert_equals(
    proof.commands.map((command) => command.tag),
    ["constructor", "exact", "apply", "cases", "rewrite", "decide", "simp"],
  );
  const exact = proof.commands[1];
  assert_equals(exact?.tag, "exact");
  if (exact?.tag !== "exact") throw new Error("Expected exact tactic.");
  assert_equals(exact.proof.tag, "name");
  const apply = proof.commands[2];
  assert_equals(apply?.tag, "apply");
  if (apply?.tag !== "apply") throw new Error("Expected apply tactic.");
  assert_equals(apply.proof.tag, "name");
  const cases = proof.commands[3];
  assert_equals(cases?.tag, "cases");
  if (cases?.tag !== "cases") throw new Error("Expected cases tactic.");
  assert_equals(cases.proof.tag, "name");
  const rewrite = proof.commands[4];
  assert_equals(rewrite?.tag, "rewrite");
  if (rewrite?.tag !== "rewrite") {
    throw new Error("Expected rewrite tactic.");
  }
  assert_equals(rewrite.proof.tag, "name");
  assert_equals(proof.commands[5]?.tag, "decide");
  assert_equals(proof.commands[6]?.tag, "simp");
  if (proof.commands[6]?.tag === "simp") {
    assert_equals(proof.commands[6].lemmas, [{
      tag: "name",
      name: "evidence",
      span: { start: 175, end: 183 },
    }]);
  }
});

Deno.test("prefix source extraction retains equality transformations", () => {
  const metadata = extract_prefix_source_metadata(parse_duck_source(
    "let mapped = equality => by congr(value => value, equality);\n" +
      "let substituted = (equality, evidence) => " +
      "by transport(equality, value => predicate(value), evidence);\n",
  ));
  const mapped = metadata.definitions[0]?.callable_proof_body;
  const substituted = metadata.definitions[1]?.callable_proof_body;

  assert_equals(mapped?.tag, "congr");
  if (mapped?.tag !== "congr") {
    throw new Error("Expected a congruence proof.");
  }
  assert_equals(mapped.parameter_name, "value");
  assert_equals(mapped.function.shape, { tag: "name", name: "value" });
  assert_equals(mapped.proof.tag, "name");

  assert_equals(substituted?.tag, "transport");
  if (substituted?.tag !== "transport") {
    throw new Error("Expected an equality transport proof.");
  }
  assert_equals(substituted.motive_name, "value");
  assert_equals(substituted.motive.tag, "holds");
  assert_equals(substituted.proof.tag, "name");
});

Deno.test("prefix source extraction retains unsafe proof provenance", () => {
  const source = "type admitted = () -> Proof False\n" +
    "unsafe let admitted = () => by unsafe { assume False };\n";
  const metadata = extract_prefix_source_metadata(parse_duck_source(source));
  const definition = metadata.definitions[0];
  const body = definition?.callable_proof_body;

  assert_equals(
    definition?.unsafe_span,
    {
      start: source.indexOf("unsafe let"),
      end: source.indexOf("unsafe let") + "unsafe".length,
    },
  );
  assert_equals(body?.tag, "unsafe_assume");
  if (body?.tag !== "unsafe_assume") {
    throw new Error("Expected an unsafe proof assumption.");
  }
  assert_equals(body.proposition.tag, "false");
  assert_equals(
    source.slice(body.span.start, body.span.end),
    "unsafe { assume False }",
  );
});
