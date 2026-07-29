import { assert_equals } from "../assert.ts";
import { parse_duck_source } from "./baba_parser.ts";

Deno.test("Baba parser preserves source tokens and CST spans", () => {
  const parsed = parse_duck_source("stored 1;\n");

  assert_equals(parsed.diagnostics, []);
  assert_equals(parsed.recovery_intervals, []);
  assert_equals(parsed.tokens, [
    { kind: "identifier", text: "stored", start: 0, end: 6 },
    { kind: "number", text: "1", start: 7, end: 8 },
    { kind: ";", text: ";", start: 8, end: 9 },
  ]);
  if (!parsed.cst.tree.includes("application_expression")) {
    throw new Error("Baba CST did not contain the application expression");
  }
});

Deno.test("Baba CST IDs and token spans are deterministic", () => {
  const source = 'let first = "same"; let second = "same";\n';
  const left = parse_duck_source(source);
  const right = parse_duck_source(source);

  assert_equals(left.tokens, right.tokens);
  assert_equals(left.cst.root, right.cst.root);
  assert_equals(
    left.tokens.filter((token) => token.text === '"same"').length,
    2,
  );
});

Deno.test("Baba CST preserves sibling statements with different coordinate widths", () => {
  const parsed = parse_duck_source(
    "let value = 1;\n" +
      "value + 2\n",
  );
  assert_equals(
    parsed.cst.root?.children.map((child) => child.kind),
    ["binding_statement", "expression_statement"],
  );

  const recovered = parse_duck_source(
    "let broken = ;\n" +
      "let good = 1;\n",
  );
  assert_equals(
    recovered.cst.root?.children.map((child) => child.kind),
    ["binding_statement", "binding_statement"],
  );
});

Deno.test("Baba diagnostics identify a local recovery node", () => {
  const parsed = parse_duck_source("stored ( ;\nlet ok = 1;\n");

  assert_equals(parsed.diagnostics[0]?.span, { start: 7, end: 8 });
  assert_equals(parsed.recovery_intervals[0]?.skipped, {
    start: 7,
    end: 8,
  });
  const recovery = parsed.recovery_intervals[0];
  if (recovery === undefined) {
    throw new Error("Baba parser did not return its recovery interval");
  }
  if (recovery.diagnostic !== parsed.diagnostics[0]) {
    throw new Error("Baba recovery interval lost its parser diagnostic");
  }
  const recovery_node_ids: string[] = [];
  const pending = [...(parsed.cst.root?.children || [])];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) continue;
    if (node.kind === "ERROR" || node.kind === "MISSING") {
      recovery_node_ids.push(node.id);
    }
    pending.push(...node.children);
  }
  assert_equals(
    recovery_node_ids.includes(recovery.source_node_id),
    true,
  );
  assert_equals(parsed.tokens.some((token) => token.text === "ok"), true);
});

Deno.test("Baba accepts source literals containing ERROR", () => {
  const parsed = parse_duck_source('let text = "ERROR";\n');
  assert_equals(parsed.diagnostics, []);
});

Deno.test("Baba rejects malformed intrinsic identifier paths", () => {
  for (const source of ["@foo.\n", "@foo..bar\n", "@foo.1\n", "@foo._bar\n"]) {
    const parsed = parse_duck_source(source);
    assert_equals(parsed.diagnostics.length > 0, true);
  }
});

Deno.test("Baba converts UTF-8 columns to UTF-16 source spans", () => {
  const source = 'let text = "é";\nlet next = 1;\n';
  const parsed = parse_duck_source(source);
  assert_equals(parsed.diagnostics, []);
  const next_start = source.indexOf("next");
  assert_equals(
    parsed.tokens.some((token) =>
      token.text === "next" && token.start === next_start
    ),
    true,
  );
});

Deno.test("Baba preserves UTF-16 spans after astral characters", () => {
  const source = 'let text = "🦆";\nlet next = 1;\n';
  const parsed = parse_duck_source(source);
  assert_equals(parsed.diagnostics, []);
  const next_start = source.indexOf("next");
  assert_equals(
    parsed.tokens.some((token) =>
      token.text === "next" && token.start === next_start
    ),
    true,
  );
});

Deno.test("Baba reports blank-line recovery without throwing", () => {
  const parsed = parse_duck_source("\n");
  assert_equals(parsed.diagnostics.length > 0, true);
});

Deno.test("Baba maps CRLF recovery spans", () => {
  const parsed = parse_duck_source("\r\n");
  assert_equals(parsed.diagnostics.length > 0, true);
});

Deno.test("Baba reports missing-token recovery at its local byte span", () => {
  const parsed = parse_duck_source("let value = ;\n");
  assert_equals(parsed.diagnostics[0]?.span, { start: 12, end: 12 });
  assert_equals(parsed.recovery_intervals[0]?.skipped, {
    start: 12,
    end: 12,
  });
});

Deno.test("Baba reports every missing-token recovery", () => {
  const parsed = parse_duck_source("let a = ;\nlet b = (1;\n");
  assert_equals(parsed.diagnostics.length >= 2, true);
  assert_equals(
    parsed.diagnostics.some((diagnostic) => diagnostic.span.start === 8),
    true,
  );
  assert_equals(
    parsed.diagnostics.some((diagnostic) => diagnostic.span.start === 20),
    true,
  );
});

Deno.test("Baba reports nested structural recoveries independently", () => {
  const parsed = parse_duck_source("let a = [;\nlet b = [;\n");
  assert_equals(parsed.diagnostics.length >= 2, true);
  assert_equals(
    parsed.diagnostics.some((diagnostic) => diagnostic.span.start === 0),
    true,
  );
  assert_equals(
    parsed.diagnostics.some((diagnostic) => diagnostic.span.start === 17),
    true,
  );
});

Deno.test("Baba parses prefix signatures and contract clauses", () => {
  const parsed = parse_duck_source(
    "type identity = (value: I32) -> (result: I32)\n" +
      "ensures result = value\n" +
      "let identity = value => value;\n",
  );
  assert_equals(parsed.diagnostics, []);
  assert_equals(parsed.cst.tree.includes("prefix_signature_statement"), true);
  assert_equals(parsed.cst.tree.includes("prefix_contract_clause"), true);
  assert_equals(parsed.cst.tree.includes("prefix_signature_result"), true);
});

Deno.test("Baba parses refinement types in prefix signatures", () => {
  const parsed = parse_duck_source(
    "type keep = " +
      "(value: {refined: I32 | refined = refined}) -> " +
      "(result: {answer: I32 | answer = value})\n" +
      "let keep = value => value;\n",
  );
  assert_equals(parsed.diagnostics, []);
  assert_equals(parsed.cst.tree.includes("prefix_refinement_type"), true);
});

Deno.test("Baba rejects uppercase prefix type binders", () => {
  const parsed = parse_duck_source(
    "type f = forall (A: Type). (value: A) -> (result: A)\n" +
      "let f = value => value;\n",
  );
  assert_equals(parsed.diagnostics.length > 0, true);
});

Deno.test("Baba rejects a contract clause without a proposition", () => {
  const source = "type f = (value: I32) -> (result: I32)\n" +
    "requires\n" +
    "ensures result = value\n" +
    "let f = value => value;\n";
  const parsed = parse_duck_source(source);
  assert_equals(parsed.diagnostics, [{
    message: "Contract clause requires a proposition before the next clause",
    span: {
      start: source.indexOf("requires") + "requires".length,
      end: source.indexOf("requires") + "requires".length,
    },
  }]);
});

Deno.test("Baba does not consume a definition as a requires proposition", () => {
  const source = "type f = (value: I32) -> (result: I32)\n" +
    "requires\n" +
    "let f = value => value;\n";
  const parsed = parse_duck_source(source);
  assert_equals(parsed.diagnostics, [{
    message: "Contract clause requires a proposition before the next clause",
    span: {
      start: source.indexOf("requires") + "requires".length,
      end: source.indexOf("requires") + "requires".length,
    },
  }]);
});

Deno.test("Baba does not consume a definition as an ensures proposition", () => {
  const source = "type f = (value: I32) -> (result: I32)\n" +
    "ensures\n" +
    "let f = value => value;\n";
  const parsed = parse_duck_source(source);
  assert_equals(parsed.diagnostics, [{
    message: "Contract clause requires a proposition before the next clause",
    span: {
      start: source.indexOf("ensures") + "ensures".length,
      end: source.indexOf("ensures") + "ensures".length,
    },
  }]);
});

Deno.test("Baba does not consume a definition as a decreases metric", () => {
  const source = "type f = (value: I32) -> (result: I32)\n" +
    "decreases\n" +
    "let f = value => value;\n";
  const parsed = parse_duck_source(source);
  assert_equals(parsed.diagnostics, [{
    message: "Contract clause requires a metric before the next clause",
    span: {
      start: source.indexOf("decreases") + "decreases".length,
      end: source.indexOf("decreases") + "decreases".length,
    },
  }]);
});

Deno.test("Baba does not consume an ensures clause as a decreases metric", () => {
  const source = "type f = (value: I32) -> (result: I32)\n" +
    "decreases\n" +
    "ensures result = value\n" +
    "let f = value => value;\n";
  const parsed = parse_duck_source(source);
  assert_equals(parsed.diagnostics, [{
    message: "Contract clause requires a metric before the next clause",
    span: {
      start: source.indexOf("decreases") + "decreases".length,
      end: source.indexOf("decreases") + "decreases".length,
    },
  }]);
});

Deno.test("Baba keeps PascalCase declarations on the ordinary type path", () => {
  const parsed = parse_duck_source("type Identity = I32 -> I32\n");
  assert_equals(parsed.diagnostics, []);
  assert_equals(parsed.cst.tree.includes("type_declaration_statement"), true);
  assert_equals(parsed.cst.tree.includes("prefix_signature_statement"), false);
});

Deno.test("Baba distinguishes tight type arguments from following statements", () => {
  for (
    const source of [
      "type Alias = Type\n(value)\n",
      "do\n  f as Type\n  (value)\nend\n",
      "do\n  f is Type\n  ()\nend\n",
    ]
  ) {
    const parsed = parse_duck_source(source);
    assert_equals(parsed.diagnostics.length, 1);
    assert_equals(
      parsed.diagnostics[0]?.message,
      "Parenthesized type application must start on the constructor's line",
    );
  }

  for (
    const source of [
      "type Alias = Type(value)\n",
      "type Alias = Type(\n  value\n)\n",
      "let value: Type() = ();\n",
      "let value: Type(I32, I64) = ();\n",
    ]
  ) {
    assert_equals(parse_duck_source(source).diagnostics, []);
  }
});

Deno.test("Baba parses transparent and opaque fact definitions", () => {
  const parsed = parse_duck_source(
    "fact multiple_of = (value, divisor) => divisor != 0 and value % divisor = 0;\n" +
      "opaque fact sorted = values => true;\n",
  );
  assert_equals(parsed.diagnostics, []);
  assert_equals(parsed.cst.tree.includes("prefix_fact_statement"), true);
  assert_equals(parsed.cst.tree.includes('"opaque"'), true);
});

Deno.test("Baba keeps fixity words contextual at statement boundaries", () => {
  for (const name of ["infix", "infixl", "infixr", "prefix"]) {
    const source = "let " + name + " = 1;\n" +
      name + " = 2\n" +
      name;
    assert_equals(parse_duck_source(source).diagnostics, []);
  }

  for (
    const source of [
      "let f = do prefix end;\n",
      "prefix 1;\n",
      "prefix(1);\n",
      "prefix.field;\n",
      "prefix[0];\n",
    ]
  ) {
    assert_equals(parse_duck_source(source).diagnostics, []);
  }
});

Deno.test("Baba fixity lookahead honors comment extras", () => {
  for (
    const source of [
      "prefix // keyword\n80 ^^ = wrap\n",
      "prefix 80 // precedence\n^^ = wrap\n",
      "prefix 80 ^^ // operator\n= wrap\n",
      "infixl 70 / = divide\n",
    ]
  ) {
    const parsed = parse_duck_source(source);
    assert_equals(parsed.diagnostics, []);
    assert_equals(
      parsed.cst.root?.children[0]?.kind,
      "fixity_declaration_statement",
    );
  }
});

Deno.test("Baba keeps union payload patterns distinct from loop collections", () => {
  const parsed = parse_duck_source(
    "for #Some value in values do value; end\n" +
      "for #Some value | #Other value in values do value; end\n" +
      "for #Some[left] in values do left; end\n" +
      "for #Some[left] | #Other[right] in values do left; end\n" +
      "for #Some(left, right) in values do left; end\n" +
      "for #Some#Other value in values do value; end\n" +
      "for #Some[left]..finish do left; end\n" +
      "let #Some[left] = current;\n",
  );
  assert_equals(parsed.diagnostics, []);
  assert_equals(
    parsed.cst.tree.includes(
      "(alternative_pattern (union_pattern",
    ),
    true,
  );
  assert_equals(
    parsed.cst.tree.includes(
      "(condition_binary_expression",
    ),
    false,
  );
  assert_equals(
    parsed.cst.tree.includes(
      "(condition_index_expression",
    ),
    true,
  );
});

Deno.test("Baba reports excessive CST nesting without exhausting the host stack", () => {
  const allowed_depth = 100;
  const allowed = "let " + "[".repeat(allowed_depth) + "x" +
    "]".repeat(allowed_depth) + " = value;\n";
  assert_equals(parse_duck_source(allowed).diagnostics, []);

  const rejected_depth = 4000;
  const rejected = "let " + "[".repeat(rejected_depth) + "x" +
    "]".repeat(rejected_depth) + " = value;\n";
  const parsed = parse_duck_source(rejected);
  assert_equals(parsed.diagnostics.length, 1);
  assert_equals(
    parsed.diagnostics[0]?.message.includes("nesting exceeds the maximum"),
    true,
  );
  assert_equals(parsed.recovery_intervals.length, 1);
  assert_equals(
    parsed.recovery_intervals[0]?.diagnostic.message.includes(
      "nesting exceeds the maximum",
    ),
    true,
  );
  assert_equals(parsed.recovery_intervals[0]?.skipped, {
    start: 0,
    end: rejected.length,
  });
  assert_equals(
    parsed.tokens.some((token) => token.text === "x"),
    true,
  );
});

Deno.test("Baba rejects raw newlines in string literals", () => {
  for (const newline of ["\n", "\r"]) {
    const parsed = parse_duck_source(
      'let value = "first' + newline + 'second";\n',
    );
    assert_equals(parsed.diagnostics.length > 0, true);
  }
});
