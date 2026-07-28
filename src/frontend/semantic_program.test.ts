import { assert_equals } from "../assert.ts";
import { analyze_duck_source, lower_duck_source } from "./semantic_program.ts";
import { parse_duck_source } from "./baba_parser.ts";
import { checked_value, diagnostics_of } from "./checked.ts";

Deno.test("semantic program stages preserve Baba input and stable symbols", () => {
  const parsed = parse_duck_source("let value = 1;\n");
  const analysis = analyze_duck_source(parsed);
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.symbols.has("value"), true);
  const lowered = lower_duck_source(analysis);
  assert_equals(diagnostics_of(lowered), []);
  const inspected = lowered.map((program) => {
    assert_equals(program.core.tag, "program");
    return null;
  });
  assert_equals(diagnostics_of(inspected), []);
});

Deno.test("Baba reaches unchanged semantic Core without the handwritten parser", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "let value = 1;\n" +
      "value + 2\n",
  ));
  const lowered = lower_duck_source(analysis);
  assert_equals(diagnostics_of(lowered), []);
  assert_equals(checked_value(lowered)?.core, {
    tag: "program",
    statements: [
      {
        tag: "bind",
        kind: "let",
        name: "value",
        is_linear: false,
        annotation: undefined,
        value: { tag: "num", type: "i32", value: 1 },
      },
      {
        tag: "expr",
        expr: {
          tag: "prim",
          prim: "i32.add",
          args: [
            { tag: "var", name: "value" },
            { tag: "num", type: "i32", value: 2 },
          ],
          integer: undefined,
        },
      },
    ],
  });
});

Deno.test("semantic program lowering preserves source diagnostics", () => {
  const parsed = parse_duck_source("let value = ;\n");
  const analysis = analyze_duck_source(parsed);
  assert_equals(analysis.diagnostics.length, 1);
  const lowered = lower_duck_source(analysis);
  assert_equals(diagnostics_of(lowered).length > 0, true);
});

Deno.test("Baba parse results cannot be mutated after branding", () => {
  const parsed = parse_duck_source("let value = 1;\n");
  let rejected = false;
  try {
    parsed.cst.text = "let forged = 1;\n";
  } catch (_error) {
    rejected = true;
  }
  assert_equals(rejected, true);
});

Deno.test("semantic analysis reports prefix-signature association diagnostics", () => {
  const parsed = parse_duck_source("type value = (x: I32) -> I32\n");
  const analysis = analyze_duck_source(parsed);
  assert_equals(
    analysis.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2601"),
    true,
  );
});

Deno.test("semantic analysis extracts and masks source prefix signatures", () => {
  const parsed = parse_duck_source(
    "type identity = (value: I32) -> (result: I32)\n" +
      "ensures result = value\n" +
      "let identity = value => value;\n",
  );
  const analysis = analyze_duck_source(parsed);
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.symbols.has("identity"), true);
});

Deno.test("analysis options cannot suppress source prefix signatures", () => {
  const parsed = parse_duck_source(
    "type identity = (value: I32) -> (result: I32)\n" +
      "\n",
  );
  const analysis = analyze_duck_source(parsed);
  assert_equals(
    analysis.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2601"),
    true,
  );
});

Deno.test("semantic analysis rejects an unsatisfiable literal contract", () => {
  const parsed = parse_duck_source(
    "type f = (value: I32) -> I32\n" +
      "ensures false\n" +
      "let f = value => value;\n",
  );
  const analysis = analyze_duck_source(parsed);
  assert_equals(
    analysis.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2604"),
    true,
  );
});

Deno.test("semantic analysis checks identity postconditions against lambda bodies", () => {
  const parsed = parse_duck_source(
    "type f = (value: I32) -> (result: I32)\n" +
      "ensures result = value\n" +
      "let f = value => 0;\n",
  );
  const analysis = analyze_duck_source(parsed);
  assert_equals(
    analysis.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2604"),
    true,
  );
});

Deno.test("semantic analysis alpha-renames contract parameters positionally", () => {
  const accepted = analyze_duck_source(parse_duck_source(
    "type f = (value: I32) -> (result: I32)\n" +
      "ensures result = value\n" +
      "let f = ignored => ignored;\n",
  ));
  assert_equals(accepted.diagnostics, []);

  const rejected = analyze_duck_source(parse_duck_source(
    "let value = 0;\n" +
      "type f = (value: I32) -> (result: I32)\n" +
      "ensures result = value\n" +
      "let f = ignored => value;\n",
  ));
  assert_equals(
    rejected.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2604"),
    true,
  );

  const multiple = analyze_duck_source(parse_duck_source(
    "type pair = (first: I32, second: I32) -> (result: I32)\n" +
      "ensures result = second\n" +
      "let pair = (left, right) => right;\n",
  ));
  assert_equals(multiple.diagnostics, []);
});

Deno.test("semantic analysis rejects unsupported raw postconditions", () => {
  const parsed = parse_duck_source(
    "type f = (value: I32) -> I32\n" +
      "ensures false and true\n" +
      "let f = value => value;\n",
  );
  const analysis = analyze_duck_source(parsed);
  assert_equals(
    analysis.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2604"),
    true,
  );
});

Deno.test("semantic analysis rejects binding semantics not yet lowered from Baba", () => {
  for (
    const source of [
      "let value: Bool = 1;\n",
      "let !value = 1;\n",
      "let rec identity = value => value;\n",
      "let values = [1, 2];\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(
      analysis.diagnostics.some((diagnostic) =>
        diagnostic.message.startsWith(
          "Baba semantic lowering does not support",
        )
      ),
      true,
    );
  }
});
