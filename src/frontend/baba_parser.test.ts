import { assert_equals } from "../assert.ts";
import { parse_duck_source } from "./baba_parser.ts";

Deno.test("Baba parser preserves source tokens and CST spans", () => {
  const parsed = parse_duck_source("stored 1;\n");

  assert_equals(parsed.diagnostics, []);
  assert_equals(parsed.recovery_intervals, []);
  assert_equals(parsed.tokens, [
    { text: "stored", start: 0, end: 6 },
    { text: "1", start: 7, end: 8 },
    { text: ";", start: 8, end: 9 },
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

Deno.test("Baba keeps PascalCase declarations on the ordinary type path", () => {
  const parsed = parse_duck_source("type Identity = I32 -> I32\n");
  assert_equals(parsed.diagnostics, []);
  assert_equals(parsed.cst.tree.includes("type_declaration_statement"), true);
  assert_equals(parsed.cst.tree.includes("prefix_signature_statement"), false);
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
