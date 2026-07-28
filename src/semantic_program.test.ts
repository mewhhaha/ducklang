import { assert_equals } from "./assert.ts";
import { analyze_duck_source, lower_duck_source } from "./semantic_program.ts";
import { parse_duck_source } from "./frontend/baba_parser.ts";
import { checked_value, diagnostics_of } from "./frontend/checked.ts";

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
  const parsed = parse_duck_source("let value = ;\n");
  let rejected = false;
  try {
    parsed.cst.text = "let forged = 1;\n";
  } catch (_error) {
    rejected = true;
  }
  assert_equals(rejected, true);

  rejected = false;
  const recovery = parsed.recovery_intervals[0];
  if (recovery === undefined) {
    throw new Error("Baba parser did not return its recovery interval");
  }
  try {
    recovery.skipped.end = parsed.cst.text.length;
  } catch (_error) {
    rejected = true;
  }
  assert_equals(rejected, true);

  const analysis = analyze_duck_source(parsed);
  assert_equals(
    analysis.parsed.recovery_intervals,
    parsed.recovery_intervals,
  );
  const analysis_recovery = analysis.parsed.recovery_intervals[0];
  if (analysis_recovery === undefined) {
    throw new Error("Semantic analysis lost the Baba recovery interval");
  }
  if (analysis_recovery.diagnostic !== analysis.parsed.diagnostics[0]) {
    throw new Error("Semantic analysis detached the recovery diagnostic");
  }
  assert_equals(Object.isFrozen(analysis_recovery), true);
  assert_equals(Object.isFrozen(analysis_recovery.skipped), true);
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
  const source = "let rec identity = value => value;\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.message.startsWith(
        "Baba semantic lowering does not support",
      )
    ),
    true,
  );
});

Deno.test("semantic Core elaborates product destructuring before lowering", () => {
  const source = "let [left, right] = [1, 2];\nleft + right;\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const program = checked_value(lower_duck_source(analysis));
  if (program === undefined) {
    throw new Error("Expected product destructuring to reach Core.");
  }
  assert_equals(
    program.core.statements.map((statement) => {
      if (statement.tag === "bind") return statement.name;
      return statement.tag;
    }),
    ["_pattern#source0", "left", "right", "expr"],
  );
  assert_equals(program.core.statements.at(-1), {
    tag: "expr",
    expr: {
      tag: "prim",
      prim: "i32.add",
      args: [
        { tag: "var", name: "left" },
        { tag: "var", name: "right" },
      ],
      integer: undefined,
    },
  });
});

Deno.test("semantic Core preserves irrefutable union alternatives", () => {
  for (
    const source of [
      "let x | #Some x = #Some 1;\nx;\n",
      "let #Some x | x = #Some 1;\nx;\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics, []);
    const lowered = lower_duck_source(analysis);
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(
      checked_value(lowered)?.core.statements.some((statement) =>
        statement.tag === "bind" && statement.name === "x"
      ),
      true,
    );
  }
});

Deno.test("refutable plain bindings stop at checked diagnostics", () => {
  for (
    const source of [
      "let #Some value = #Some 1;\nvalue;\n",
      "let 1 = 1;\n",
      "let true = true;\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(
      analysis.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2315"),
      true,
    );
    assert_equals(checked_value(lower_duck_source(analysis)), undefined);
  }
});

Deno.test("refutable bindings with terminating fallbacks reach Core", () => {
  const source = "let #Some value = #Some 1 else do return 0; end;\n" +
    "value;\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const lowered = lower_duck_source(analysis);
  assert_equals(diagnostics_of(lowered), []);
  assert_equals(checked_value(lowered) !== undefined, true);
});

Deno.test("redundant let-else fallbacks do not create unreachable matches", () => {
  for (
    const source of [
      "let x = 1 else do return 0; end;\nx;\n",
      "let [x] = [1] else do return 0; end;\nx;\n",
      "let { .x } = { .x = 1 } else do return 0; end;\nx;\n",
      "let x | #Some x = #Some 1 else do return 0; end;\nx;\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics, []);
    const lowered = lower_duck_source(analysis);
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered) !== undefined, true);
  }
});

Deno.test("structural formation failures stop before Core", () => {
  for (
    const source of [
      "let [head, ...tail] = value;\nhead;\n",
      "let (head, ...tail) = value;\nhead;\n",
      "let [x, y] = [1];\nx;\n",
      "let [x] = [1, 2];\nx;\n",
      "let { .missing } = { .present = 1 };\nmissing;\n",
      "let { .x } = [1];\nx;\n",
      "let [x] = 1;\nx;\n",
      "let [x] = #Some 1;\nx;\n",
      "let { .x } = 1;\nx;\n",
      "let { .x } = #Some 1;\nx;\n",
      "let f = (value: I32) => do let [x] = value; x end;\nf(1);\n",
      "let f = (value: [I32, I32]) => do let [x] = value; x end;\n" +
      "f([1, 2]);\n",
      "type Point = struct { .x = I32 }\n" +
      "let f = (value: Point) => do let { .y } = value; y end;\n" +
      "f(Point(1));\n",
      "let f = (value: [[I32, I32]]) => do let [[x]] = value; x end;\n" +
      "f([[1, 2]]);\n",
      "type Inner = struct { .x = I32 }\n" +
      "type Outer = struct { .inner = Inner }\n" +
      "let f = (value: Outer) => do " +
      "let { .inner = { .y } } = value; y end;\n",
      "let value = [[1]];\n" +
      "let [[x, y], ...tail] = value;\n" +
      "x;\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(
      analysis.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2316"),
      true,
    );
    assert_equals(checked_value(lower_duck_source(analysis)), undefined);
  }
});

Deno.test("known named destructuring reaches Core without a shape carrier", () => {
  const source = "const { .present } = { .present = 1 };\npresent;\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  assert_equals(checked_value(lower_duck_source(analysis))?.core, {
    tag: "program",
    statements: [
      {
        tag: "bind",
        kind: "const",
        name: "present",
        is_linear: false,
        annotation: undefined,
        value: { tag: "num", type: "i32", value: 1 },
      },
      { tag: "expr", expr: { tag: "var", name: "present" } },
    ],
  });
});

Deno.test("runtime named destructuring projects known shape fields", () => {
  const source = "let { .x, .y } = { .x = 1, .y = 2 };\nx + y;\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const lowered = lower_duck_source(analysis);
  assert_equals(diagnostics_of(lowered), []);
  assert_equals(
    checked_value(lowered)?.core.statements.map((statement) => {
      if (statement.tag === "bind") return statement.name;
      return statement.tag;
    }),
    ["x", "y", "expr"],
  );
});

Deno.test("structural binding annotations validate projected values", () => {
  const accepted = analyze_duck_source(
    parse_duck_source(
      "let { .x: Text, .nested = { .value: I32 } } = " +
        '{ .x = "hi", .nested = { .value = 1 } };\n' +
        "x;\n",
    ),
  );
  assert_equals(accepted.diagnostics, []);
  assert_equals(
    checked_value(lower_duck_source(accepted)) !== undefined,
    true,
  );

  const source = 'let { .x: I32 } = { .x = "hi" };\nx;\n';
  const mismatch = analyze_duck_source(parse_duck_source(source));
  assert_equals(mismatch.diagnostics, [{
    code: "DUCK2306",
    severity: "error",
    message: "Binding annotation expects I32, got Text",
    span: {
      start: source.indexOf('"hi"'),
      end: source.indexOf('"hi"') + '"hi"'.length,
    },
  }]);
  assert_equals(checked_value(lower_duck_source(mismatch)), undefined);

  const typed_source = "type Point = struct { .x = Text }\n" +
    "let f = (value: Point) => do let { .x: I32 } = value; x end;\n" +
    'f(Point("text"));\n';
  const typed_mismatch = analyze_duck_source(
    parse_duck_source(typed_source),
  );
  assert_equals(
    typed_mismatch.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2306" &&
      diagnostic.message === "Binding annotation expects I32, got Text"
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(typed_mismatch)), undefined);
});

Deno.test("structural alternatives select a compatible known aggregate", () => {
  for (
    const source of [
      "let [x] | [x, ..._] = [1, 2];\nx;\n",
      "let { .x } | { .x, .y = _ } = { .x = 1, .y = 2 };\nx;\n",
      "let { .x, .y = _ } | { .x } = { .x = 1, .y = 2 };\nx;\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics, []);
    const lowered = lower_duck_source(analysis);
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered) !== undefined, true);
  }
});

Deno.test("array rest patterns project known shape entries", () => {
  for (
    const source of [
      "let [x, ...rest] = { .x = 1, .y = 2 };\nx;\n",
      "let [x, ..._] = { .x = 1, .y = 2 };\nx;\n",
      "let [x] | [x, ..._] = { .x = 1, .y = 2 };\nx;\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics, []);
    const lowered = lower_duck_source(analysis);
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered) !== undefined, true);
  }
});

Deno.test("typed array rest patterns lower with their declared shape", () => {
  for (
    const source of [
      "let f = (value: [I32, I32]) => do " +
      "let [x, ...rest] = value; x end;\nf([1, 2]);\n",
      "let f = (value: [I32, I32]) => do " +
      "let [x, ..._] = value; x end;\nf([1, 2]);\n",
      "let f = (value: [[I32, I32]]) => do " +
      "let [[x, ...rest]] = value; x end;\nf([[1, 2]]);\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics, []);
    const lowered = lower_duck_source(analysis);
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered) !== undefined, true);
  }
});

Deno.test("semantic indexes expose structural binders with exact origins", () => {
  for (
    const [source, names] of [
      ["let [left, right] = pair;\n", ["left", "right"]],
      ["let #Some value = option;\n", ["value"]],
      ["let x | x = value;\n", ["x"]],
      ['let "${capture}" = text;\n', ["capture"]],
    ] as const
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals([...analysis.symbols.keys()], [...names]);
    for (const name of names) {
      const value = analysis.symbols.get(name)?.[0];
      if (value === undefined) {
        throw new Error("Expected a semantic identity for " + name);
      }
      const start = source.indexOf(name);
      assert_equals(analysis.origins.get(value), {
        source_node: analysis.origins.get(value)?.source_node,
        start,
        end: start + name.length,
      });
    }
  }
});

Deno.test("semantic origins exclude binder annotations", () => {
  for (
    const source of [
      "let x: I32 = 1;\nx;\n",
      "let { .x: I32 } = { .x = 1 };\nx;\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics, []);
    const value = analysis.symbols.get("x")?.[0];
    if (value === undefined) {
      throw new Error("Expected an exact origin for annotated binder x");
    }
    const start = source.indexOf("x");
    assert_equals(analysis.origins.get(value), {
      source_node: analysis.origins.get(value)?.source_node,
      start,
      end: start + 1,
    });
  }
});

Deno.test("unusable shorthand keywords never enter the semantic index", () => {
  for (
    const source of [
      "let { .true } = value;\n",
      "let { .false: I32 } = value;\n",
      "let { .let } = value;\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics.length > 0, true);
    assert_equals([...analysis.symbols.keys()], []);
  }
});
