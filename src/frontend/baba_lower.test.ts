import { assert_equals } from "../assert.ts";
import { parse_duck_source } from "./baba_parser.ts";
import { checked_value, diagnostics_of } from "./checked.ts";
import { lower_baba_source } from "./baba_lower.ts";
import { parse_source } from "./parser.ts";
import { has_source_span, source_span, source_span_origin } from "./syntax.ts";

Deno.test("Baba lowers bindings and expressions without the handwritten parser", () => {
  const lowered = lower_baba_source(parse_duck_source(
    "let value = 1;\n" +
      "value + 2\n",
  ));
  assert_equals(diagnostics_of(lowered), []);
  assert_equals(checked_value(lowered), {
    tag: "program",
    statements: [
      {
        tag: "bind",
        kind: "let",
        pattern: {
          tag: "binding",
          name: "value",
          mode: "default",
          annotation: undefined,
        },
        name: "value",
        is_recursive: false,
        is_linear: false,
        annotation: undefined,
        value: { tag: "num", type: "i32", value: 1 },
      },
      {
        tag: "expr",
        expr: {
          tag: "prim",
          prim: "i32.add",
          left: { tag: "var", name: "value" },
          right: { tag: "num", type: "i32", value: 2 },
        },
      },
    ],
  });
});

Deno.test("Baba distinguishes logical not calls from linear calls", () => {
  for (
    const source of [
      "let invalid = !predicate(value);\n",
      "let invalid = !predicate(value)(other);\n",
      "let invalid = !predicate value other;\n",
      "let invalid = !predicate (value);\n",
      "let invalid = !predicate ();\n",
      "let invoke = (!callback) => !callback(value);\n",
      "let invoke = (!callback) => !callback(value)(other);\n",
      "let invoke = (!callback) => do\n" +
      "  let callback = predicate;\n" +
      "  !callback(value)\n" +
      "end;\n",
      "let invoke = (!callback) => do\n" +
      "  let (callback, value) = pair;\n" +
      "  !callback(value)\n" +
      "end;\n",
      "let invoke = (!callback) => do\n" +
      "  let !later = !callback;\n" +
      "  !later(value)\n" +
      "end;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(source));
  }
});

Deno.test("Baba distinguishes intrinsic fields from import metadata fields", () => {
  for (
    const source of [
      "@type .extend(Type, value)\n",
      "const mode = import .meta.mode;\nmode\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(source));
  }
});

Deno.test("Baba lowers structural binding patterns directly", () => {
  for (
    const source of [
      "let [head, tail] = value;\n",
      "let [head, ...tail] = value;\n",
      "let (head, tail) = value;\n",
      "let (head, ...tail) = value;\n",
      "let {} = value;\n",
      "const { .x, .y = renamed } = value;\n",
      "let { .x: I32, .y = #Some nested } = value;\n",
      "let #None = value;\n",
      "let #Some (left, right) = value;\n",
      "let [true, false] = value;\n",
      "let #Some true = value;\n",
      "let #Other false = value;\n",
      "let #Some nested = value else do return 0; end;\n",
      "let 1 = value;\n",
      "let #(constant) = value;\n",
      "let #Some nested | #Other nested = value;\n",
      "let !token = 1;\n",
      'let "pre${middle}post" = value;\n',
      'const { .length } = import "duck:prelude/runtime" ();\n',
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(
      diagnostics_of(lowered),
      [],
      "Expected direct structural binding lowering for " + source,
    );
    const lowered_source = checked_value(lowered);
    if (lowered_source === undefined) {
      throw new Error("Expected a directly lowered binding pattern.");
    }
    assert_equals(lowered_source, parse_source(source));
    assert_equals(all_source_nodes_have_spans(lowered_source), true);
  }
});

Deno.test("Baba diagnoses invalid structural binding patterns", () => {
  for (
    const [source, message] of [
      ["let [left, right]: I32 = value;\n", "require a single name"],
      ["let { .camelCase } = value;\n", "must use snake_case"],
      ["let { .value, .value } = source;\n", "Duplicate pattern field"],
      [
        "let #Some left | #Other right = value;\n",
        "must bind the same names",
      ],
      ["let ![value] = source;\n", "does not support array_pattern"],
      ["let Some = value;\n", "must use snake_case"],
      ["let #Some () = value;\n", "omits `()`"],
      [
        'let "${first}${second}" = value;\n',
        "at most one capture",
      ],
      ['let "${camelCase}" = value;\n', "must use snake_case"],
      ['let "${class}" = value;\n', "reserved for unsupported"],
      ['let "pre${true}post" = value;\n', "reserved syntax"],
      ['let "pre${false}post" = value;\n', "reserved syntax"],
      ['let "pre${let}post" = value;\n', "reserved syntax"],
      ['let "pre${requires}post" = value;\n', "reserved syntax"],
      ['let "pre${end}post" = value;\n', "reserved syntax"],
      ["let { .class } = value;\n", "reserved for unsupported"],
      ["let { .class: I32 } = value;\n", "reserved for unsupported"],
      ["let { .true } = value;\n", "reserved syntax"],
      ["let { .false: I32 } = value;\n", "reserved syntax"],
      ["let { .let } = value;\n", "reserved syntax"],
      ["let f = requires => requires;\n", "reserved syntax"],
      ["let f = class => class;\n", "reserved for unsupported"],
      ["requires <- call()\n", "reserved syntax"],
      ["let [] = value;\n", "Empty array binding"],
      ["let [x, x] = value;\n", "Duplicate pattern binding"],
      ["let { .a = x, .b = x } = value;\n", "Duplicate pattern binding"],
      ["let [x, ...x] = value;\n", "Duplicate pattern binding"],
      [
        "let #Some x = value else do 0 end;\n",
        "Let-else branch must return",
      ],
    ] as const
  ) {
    const parsed = parse_duck_source(source);
    assert_equals(parsed.diagnostics, []);
    const diagnostics = diagnostics_of(lower_baba_source(parsed));
    assert_equals(diagnostics.length, 1);
    assert_equals(diagnostics[0]?.message.includes(message), true);
  }
});

Deno.test("Baba keeps let-else diagnostics in source order", () => {
  const source = "const #Some x = v else do 0 end;\n";
  const diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source(source)),
  );
  assert_equals(
    diagnostics.map((diagnostic) => ({
      message: diagnostic.message,
      span: diagnostic.span,
    })),
    [
      {
        message: "Only let bindings support else branches",
        span: {
          start: source.indexOf("else"),
          end: source.indexOf("else") + "else".length,
        },
      },
      {
        message: "Let-else branch must return, break, continue, or trap",
        span: {
          start: source.indexOf("do"),
          end: source.indexOf("end") + "end".length,
        },
      },
    ],
  );
});

Deno.test("Baba assigns stable identities to binding alternatives", () => {
  const source = "let x | x = value;\nlet [next] = value;\n";
  const lowered = lower_baba_source(parse_duck_source(source));
  assert_equals(diagnostics_of(lowered), []);
  const statements = checked_value(lowered)?.statements;
  const alternative = statements?.[0];
  const aggregate = statements?.[1];
  if (
    alternative === undefined || alternative.tag !== "bind" ||
    aggregate === undefined || aggregate.tag !== "bind"
  ) {
    throw new Error("Expected two directly lowered binding statements.");
  }
  assert_equals(alternative.name, "@no_demand_0");
  assert_equals(alternative.pattern?.tag, "or");
  assert_equals(aggregate.name, "@no_demand_1");
});

Deno.test("Baba compares alternative binding signatures by name", () => {
  for (
    const source of [
      "let (x, y) | (y, x) = value;\n",
      "let { .a = x, .b = y } | { .a = y, .b = x } = value;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
  }
});

Deno.test("Baba reports duplicate pattern bindings at both occurrences", () => {
  for (
    const source of [
      'let (x, "${x}") = value;\n',
      'let ("${x}", x) = value;\n',
    ]
  ) {
    const diagnostic = diagnostics_of(
      lower_baba_source(parse_duck_source(source)),
    )[0];
    const occurrences = [
      source.indexOf("x"),
      source.lastIndexOf("x"),
    ];
    assert_equals(diagnostic?.span, {
      start: occurrences[1],
      end: occurrences[1] + 1,
    });
    assert_equals(diagnostic?.related?.[0]?.span, {
      start: occurrences[0],
      end: occurrences[0] + 1,
    });
  }
});

Deno.test("Baba keeps independent pattern diagnostics in source order", () => {
  const source = "let (x, x) | (x, y) = value;\n";
  const diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source(source)),
  );
  assert_equals(
    diagnostics.map((diagnostic) => ({
      message: diagnostic.message,
      span: diagnostic.span,
    })),
    [
      {
        message: "Duplicate pattern binding: x",
        span: {
          start: source.indexOf("x", source.indexOf("x") + 1),
          end: source.indexOf("x", source.indexOf("x") + 1) + 1,
        },
      },
      {
        message: "Pattern alternatives must bind the same names, modes, and " +
          "annotations: expected x:default:|x:default:, got " +
          "x:default:|y:default:",
        span: {
          start: source.indexOf("(x, y)"),
          end: source.indexOf("(x, y)") + "(x, y)".length,
        },
      },
    ],
  );
});

Deno.test("Baba rejects patterns beyond its deterministic nesting limit", () => {
  const allowed_depth = 127;
  const allowed = "let " + "[".repeat(allowed_depth) + "x" +
    "]".repeat(allowed_depth) + " = value;\n";
  assert_equals(
    diagnostics_of(lower_baba_source(parse_duck_source(allowed))),
    [],
  );

  const rejected_depth = 128;
  const rejected = "let " + "[".repeat(rejected_depth) + "x" +
    "]".repeat(rejected_depth) + " = value;\n";
  const diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source(rejected)),
  );
  assert_equals(diagnostics.length, 1);
  assert_equals(diagnostics[0]?.message.includes("maximum of 128"), true);
});

Deno.test("Baba reports text capture names at their identifier spans", () => {
  const source = 'let "${camelCase}" = value;\n';
  const diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source(source)),
  );
  assert_equals(diagnostics.length, 1);
  const start = source.indexOf("camelCase");
  assert_equals(diagnostics[0]?.span, {
    start,
    end: start + "camelCase".length,
  });
});

Deno.test("Baba preserves nested type patterns in structural bindings", () => {
  for (
    const [source, expected_pattern] of [
      [
        "let { .x = struct { .a = I32 } } = value;\n",
        {
          tag: "product",
          entries: [{
            label: "x",
            pattern: {
              tag: "type",
              pattern: {
                kind: "struct",
                fields: [{ name: "a", type_name: "I32" }],
                open: false,
              },
            },
          }],
        },
      ],
      [
        "let (union { .Some = I32, .. }, x) = value;\n",
        {
          tag: "product",
          entries: [
            {
              pattern: {
                tag: "type",
                pattern: {
                  kind: "union",
                  fields: [{ name: "Some", type_name: "I32" }],
                  open: true,
                },
              },
            },
            {
              pattern: {
                tag: "binding",
                name: "x",
                mode: "default",
                annotation: undefined,
              },
            },
          ],
          rest: undefined,
          value_pack: true,
        },
      ],
    ] as const
  ) {
    const parsed = parse_duck_source(source);
    assert_equals(parsed.diagnostics, []);
    const lowered = lower_baba_source(parsed);
    assert_equals(diagnostics_of(lowered), []);
    const lowered_source = checked_value(lowered);
    if (lowered_source === undefined) {
      throw new Error("Expected a directly lowered nested type pattern.");
    }
    const statement = lowered_source.statements[0];
    if (statement === undefined || statement.tag !== "bind") {
      throw new Error("Expected a structural binding statement.");
    }
    if (statement.pattern === undefined) {
      throw new Error("Expected a structural binding pattern.");
    }
    assert_equals(statement.pattern, expected_pattern);
    assert_equals(all_source_nodes_have_spans(statement.pattern), true);
  }
});

Deno.test("Baba preserves concrete spans for structural product entries", () => {
  for (
    const source of [
      "let [left, right] = value;\n",
      "let (left, right) = value;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    const lowered_source = checked_value(lowered);
    const statement = lowered_source?.statements[0];
    if (statement === undefined || statement.tag !== "bind") {
      throw new Error("Expected a structural binding statement.");
    }
    if (statement.pattern === undefined) {
      throw new Error("Expected a structural binding pattern.");
    }
    if (statement.pattern.tag !== "product") {
      throw new Error("Expected a structural product pattern.");
    }
    const first_entry = statement.pattern.entries[0];
    if (first_entry === undefined) {
      throw new Error("Expected the first structural product entry.");
    }
    const start = source.indexOf("left");
    assert_equals(source_span_origin(first_entry), "concrete");
    assert_equals(source_span(first_entry), {
      start,
      end: start + "left".length,
    });
  }
});

Deno.test("Baba lowers module headers and export returns directly", () => {
  for (
    const text of [
      "module () where\nreturn {};\n",
      "module (!init: Init) where\nreturn { .init };\n",
      "module (first, const second: I64) where\nreturn {};\n",
      "module (_, const other: I64) where\nlet _ = 1;\nreturn {};\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(text));
    assert_equals(diagnostics_of(lowered), []);
    const source = checked_value(lowered);
    if (source === undefined) {
      throw new Error("Expected directly lowered Baba module.");
    }
    const legacy = parse_source(text);
    assert_equals(source, legacy);
    assert_equals(all_source_nodes_have_spans(source), true);
  }
});

Deno.test("Baba accumulates module parameter and return diagnostics", () => {
  const text = "module (camelCase: 256u8, Other: 512u8) where\n" +
    "return { .result = 1024u8 };\n";
  const diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source(text)),
  );
  assert_equals(diagnostics.length, 5);
  const starts = diagnostics.map((diagnostic) => diagnostic.span.start);
  assert_equals(starts, [...starts].sort((left, right) => left - right));
});

Deno.test("Baba rejects reserved module and effect result bindings", () => {
  for (
    const [text, start] of [
      ["module (class) where\nreturn {};\n", 8],
      ["class <- State.class()\n", 0],
      ["inherits <- State.inherits()\n", 0],
    ] as const
  ) {
    const diagnostics = diagnostics_of(
      lower_baba_source(parse_duck_source(text)),
    );
    assert_equals(diagnostics.length, 1);
    assert_equals(diagnostics[0]?.span.start, start);
    assert_equals(
      diagnostics[0]?.message.includes("reserved for unsupported"),
      true,
    );
  }
});

Deno.test("every bundled Baba module header lowers directly", () => {
  let headers = 0;
  for (const path of duck_files("examples")) {
    const text = Deno.readTextFileSync(path);
    const parsed = parse_duck_source(text);
    for (const node of source_nodes_of_kind(parsed.cst.root, "module_header")) {
      headers += 1;
      const module_source = text.slice(node.start, node.end) +
        "\nreturn {};\n";
      const lowered = lower_baba_source(parse_duck_source(module_source));
      assert_equals(diagnostics_of(lowered), []);
      assert_equals(checked_value(lowered), parse_source(module_source));
    }
  }
  assert_equals(headers > 20, true);
});

Deno.test("Baba lowers direct and propagated effect bindings", () => {
  for (
    const text of [
      "value <- effect()\n",
      "_ <- effect()\n",
      "value <- Io.read()\n",
      "_ <- Io.print(1)\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(text));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(text));
  }
  const aliased = "effect E { op: () => I32 }\n" +
    "const effect_instance = E;\n" +
    "value <- effect_instance.op()\n";
  const lowered_alias = lower_baba_source(parse_duck_source(aliased));
  assert_equals(diagnostics_of(lowered_alias), []);
  assert_equals(checked_value(lowered_alias), parse_source(aliased));
  const forward_alias = "const e = E;\n" +
    "value <- e.op()\n" +
    "effect E { op: () => I32 }\n";
  const lowered_forward_alias = lower_baba_source(
    parse_duck_source(forward_alias),
  );
  assert_equals(diagnostics_of(lowered_forward_alias), []);
  assert_equals(
    checked_value(lowered_forward_alias)?.statements.at(-1)?.tag,
    "state_bind",
  );
  for (
    const parenthesized of [
      "effect E { op: () => I32 }\n" +
      "const e = (E);\n" +
      "value <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "const e = E;\n" +
      "value <- (e.op())\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(parenthesized));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered)?.statements.at(-1)?.tag, "state_bind");
  }
  const unit_binding = lower_baba_source(
    parse_duck_source("() <- Io.read()\n"),
  );
  assert_equals(diagnostics_of(unit_binding), []);
  const unit_source = checked_value(unit_binding);
  assert_equals(unit_source?.statements[0]?.tag, "state_bind");
  if (unit_source?.statements[0]?.tag === "state_bind") {
    assert_equals(unit_source.statements[0].value_name, undefined);
  }
});

Deno.test("Baba propagates effect instances through lexical bindings", () => {
  for (
    const source of [
      "effect E { op: () => I32 }\n" +
      "let e = E;\n" +
      "out <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "let [e] = [E];\n" +
      "out <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "const [e] = [E];\n" +
      "out <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "const (e, other) = (E, value);\n" +
      "out <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "const { .e } = { .e = E };\n" +
      "out <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "const e = E;\n" +
      "const [e] = [e];\n" +
      "out <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "const e = E;\n" +
      "const e = e;\n" +
      "out <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "const pair = [E];\n" +
      "const [e] = pair;\n" +
      "out <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "const shape = { .effect = E };\n" +
      "const { .effect = e } = shape;\n" +
      "out <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "const nested = [[E]];\n" +
      "const [inner] = nested;\n" +
      "const [e] = inner;\n" +
      "out <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "const nested = { .inner = { .effect = E } };\n" +
      "const { .inner } = nested;\n" +
      "const { .effect = e } = inner;\n" +
      "out <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "const e = E;\n" +
      "const pair = [e];\n" +
      "let e = 0;\n" +
      "const [x] = pair;\n" +
      "out <- x.op()\n",
      "effect E { op: () => I32 }\n" +
      "const [e] | [e, ..._] = [E];\n" +
      "out <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "const { .e } | { .e, .other = _ } = { .e = E };\n" +
      "out <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "const [head, ...tail] = [0, E];\n" +
      "const [e] = tail;\n" +
      "out <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "const (head, ...tail) = (0, E);\n" +
      "const [e] = tail;\n" +
      "out <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "const #Some e | e = #Some E;\n" +
      "out <- e.op()\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered)?.statements.at(-1)?.tag, "state_bind");
  }

  const overwritten = "effect E { op: () => I32 }\n" +
    "const e = E;\n" +
    "const [e] = [ordinary];\n" +
    "out <- e.op()\n";
  const lowered = lower_baba_source(parse_duck_source(overwritten));
  assert_equals(diagnostics_of(lowered), []);
  assert_equals(checked_value(lowered)?.statements.at(-1)?.tag, "bind");

  const captured_ordinary_value = "effect E { op: () => I32 }\n" +
    "const e = 0;\n" +
    "const pair = [e];\n" +
    "const e = E;\n" +
    "const [x] = pair;\n" +
    "out <- x.op()\n";
  const captured_ordinary_source = checked_value(
    lower_baba_source(parse_duck_source(captured_ordinary_value)),
  );
  assert_equals(captured_ordinary_source?.statements.at(-1)?.tag, "bind");
});

Deno.test("Baba snapshots shared const aggregates without expanding their DAG", () => {
  let source = "effect E { op: () => I32 }\nconst a0 = [E];\n";
  for (let depth = 1; depth <= 24; depth += 1) {
    const previous = "a" + (depth - 1).toString();
    source += "const a" + depth.toString() + " = [" + previous + ", " +
      previous + "];\n";
  }
  source += "const [left, right] = a24;\n";
  const lowered = lower_baba_source(parse_duck_source(source));
  assert_equals(diagnostics_of(lowered), []);
  assert_equals(checked_value(lowered) !== undefined, true);
});

Deno.test("Baba classifies only outer effect operation calls as state bindings", () => {
  for (
    const text of [
      "value <- consume(Host.field)\n",
      "value <- Host.field\n",
      "const resource = Host(init); value <- wrap(resource.method())\n",
      "const ordinary = SomeValue; value <- ordinary.method()\n",
      "effect E { op: () => I32 }\n" +
      "const e = E; value <- e.child.op()\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(text));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(text));
    const statement = checked_value(lowered)?.statements.at(-1);
    assert_equals(statement?.tag, "bind");
    if (statement?.tag === "bind") {
      assert_equals(statement.effectful, true);
    }
  }
});

Deno.test("Baba effect aliases follow lexical shadowing", () => {
  const conditional = "effect E { op: () => I32 }\n" +
    "const e = E;\n" +
    "if true then\n" +
    "  let e = 0;\n" +
    "  value <- e.op()\n" +
    "else\n" +
    "  0\n" +
    "end;\n";
  const conditional_source = checked_value(
    lower_baba_source(parse_duck_source(conditional)),
  );
  const conditional_statement = conditional_source?.statements.at(-1);
  if (
    conditional_statement?.tag !== "expr" ||
    conditional_statement.expr.tag !== "if" ||
    conditional_statement.expr.then_branch.tag !== "block"
  ) {
    throw new Error("Expected a directly lowered conditional expression.");
  }
  assert_equals(
    conditional_statement.expr.then_branch.statements[1]?.tag,
    "bind",
  );

  const pattern_conditional = "effect E { op: () => I32 }\n" +
    "const e = E;\n" +
    "const ordinary = 0;\n" +
    "if let #Some e = option then\n" +
    "  e = ordinary;\n" +
    "  value <- e.op()\n" +
    "end;\n" +
    "next <- e.op()\n";
  const pattern_source = checked_value(
    lower_baba_source(parse_duck_source(pattern_conditional)),
  );
  const pattern_statement = pattern_source?.statements[2];
  if (pattern_statement?.tag !== "if_let_stmt") {
    throw new Error("Expected an if-let effect shadow.");
  }
  assert_equals(pattern_statement.body[1]?.tag, "bind");
  assert_equals(pattern_source?.statements[3]?.tag, "state_bind");

  const lambda = "effect E { op: () => I32 }\n" +
    "const e = E;\n" +
    "let run = (e) => do value <- e.op() end;\n";
  const lambda_source = checked_value(
    lower_baba_source(parse_duck_source(lambda)),
  );
  const lambda_statement = lambda_source?.statements.at(-1);
  if (
    lambda_statement?.tag !== "bind" ||
    lambda_statement.value.tag !== "lam" ||
    lambda_statement.value.body.tag !== "block"
  ) {
    throw new Error("Expected a directly lowered block lambda.");
  }
  assert_equals(lambda_statement.value.body.statements[0]?.tag, "bind");

  const effect_result_shadow = "effect E { op: () => I32 }\n" +
    "const e = E;\n" +
    "e <- e.op()\n" +
    "next <- e.op()\n";
  const shadowed_source = checked_value(
    lower_baba_source(parse_duck_source(effect_result_shadow)),
  );
  assert_equals(shadowed_source?.statements[1]?.tag, "state_bind");
  assert_equals(shadowed_source?.statements[2]?.tag, "bind");

  const aggregate_effect_result_shadow = "effect E { op: () => I32 }\n" +
    "const e = [E];\n" +
    "e <- ordinary()\n" +
    "const [x] = e;\n" +
    "out <- x.op()\n";
  const aggregate_shadow_source = checked_value(
    lower_baba_source(parse_duck_source(aggregate_effect_result_shadow)),
  );
  assert_equals(aggregate_shadow_source?.statements.at(-1)?.tag, "bind");

  const aggregate_nested_assignment = "effect E { op: () => I32 }\n" +
    "let pair = [E];\n" +
    "do pair = [0]; end;\n" +
    "let [e] = pair;\n" +
    "out <- e.op()\n";
  const nested_aggregate_source = checked_value(
    lower_baba_source(parse_duck_source(aggregate_nested_assignment)),
  );
  assert_equals(nested_aggregate_source?.statements.at(-1)?.tag, "bind");

  for (
    const indexed_assignment of [
      "effect E { op: () => I32 }\n" +
      "let pair = [E];\n" +
      "pair[0] = 0;\n" +
      "let [e] = pair;\n" +
      "out <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "let pair = [E];\n" +
      "do pair[0] = 0; end;\n" +
      "let [e] = pair;\n" +
      "out <- e.op()\n",
    ]
  ) {
    const indexed_assignment_source = checked_value(
      lower_baba_source(parse_duck_source(indexed_assignment)),
    );
    assert_equals(
      indexed_assignment_source?.statements.at(-1)?.tag,
      "bind",
    );
  }

  for (
    const assignment_source of [
      "effect E { op: () => I32 }\n" +
      "let e = 0;\n" +
      "e = E;\n" +
      "value <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "let e = E;\n" +
      "e = E;\n" +
      "value <- e.op()\n",
    ]
  ) {
    const assigned_source = checked_value(
      lower_baba_source(parse_duck_source(assignment_source)),
    );
    assert_equals(assigned_source?.statements.at(-1)?.tag, "state_bind");
  }
  const invalidated_assignment = "effect E { op: () => I32 }\n" +
    "let e = E;\n" +
    "e = 0;\n" +
    "value <- e.op()\n";
  const invalidated_source = checked_value(
    lower_baba_source(parse_duck_source(invalidated_assignment)),
  );
  assert_equals(invalidated_source?.statements.at(-1)?.tag, "bind");

  const destructuring_shadow = "effect E { op: () => I32 }\n" +
    "const e = E;\n" +
    "let [e, other] = pair;\n" +
    "value <- e.op()\n";
  const destructured_source = checked_value(
    lower_baba_source(parse_duck_source(destructuring_shadow)),
  );
  assert_equals(destructured_source?.statements.at(-1)?.tag, "bind");

  for (
    const nested_assignment of [
      "effect E { op: () => I32 }\n" +
      "let e = E;\n" +
      "if true then e = 0 else e = 0 end;\n" +
      "value <- e.op()\n",
      "effect E { op: () => I32 }\n" +
      "let e = E;\n" +
      "do e = 0; end;\n" +
      "value <- e.op()\n",
    ]
  ) {
    const nested_assignment_source = checked_value(
      lower_baba_source(parse_duck_source(nested_assignment)),
    );
    assert_equals(
      nested_assignment_source?.statements.at(-1)?.tag,
      "bind",
    );
  }
});

Deno.test("Baba does not classify ordinary applied constructors as effects", () => {
  for (
    const source of [
      "type Box = newtype I32\n" +
      "const box = Box(1);\n" +
      "value <- box.method()\n",
      "declare Point { x: I32 }\n" +
      "const point = Point(1);\n" +
      "value <- point.method()\n",
      "const box = Box(1);\n" +
      "value <- box.method()\n" +
      "type Box = newtype I32\n",
      "const point = Point(1);\n" +
      "value <- point.method()\n" +
      "declare Point { x: I32 }\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered)?.statements.at(-1)?.tag, "bind");
  }
});

Deno.test("Baba accumulates effect binding name and value diagnostics", () => {
  const diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source("camelCase <- 256u8\n")),
  );
  assert_equals(diagnostics.length, 2);
  const starts = diagnostics.map((diagnostic) => diagnostic.span.start);
  assert_equals(starts, [...starts].sort((left, right) => left - right));
});

Deno.test("Baba lowers lambda parameters positionally", () => {
  const lowered = lower_baba_source(parse_duck_source(
    "let choose = (left, right) => right;\n",
  ));
  assert_equals(diagnostics_of(lowered), []);
  const source = checked_value(lowered);
  const statement = source?.statements[0];
  if (statement === undefined || statement.tag !== "bind") {
    throw new Error("Expected Baba binding statement.");
  }
  assert_equals(statement.value, {
    tag: "lam",
    pattern: {
      tag: "product",
      entries: [
        {
          pattern: {
            tag: "binding",
            name: "left",
            mode: "default",
            annotation: undefined,
          },
        },
        {
          pattern: {
            tag: "binding",
            name: "right",
            mode: "default",
            annotation: undefined,
          },
        },
      ],
      rest: undefined,
      value_pack: true,
    },
    params: [
      {
        name: "left",
        is_const: false,
        is_linear: false,
        annotation: undefined,
      },
      {
        name: "right",
        is_const: false,
        is_linear: false,
        annotation: undefined,
      },
    ],
    body: { tag: "var", name: "right" },
  });
});

Deno.test("Baba keeps nested lambda parameters in their own scope", () => {
  const lowered = lower_baba_source(parse_duck_source(
    "let outer = left => right => left;\n",
  ));
  assert_equals(diagnostics_of(lowered), []);
  const source = checked_value(lowered);
  const statement = source?.statements[0];
  if (statement === undefined || statement.tag !== "bind") {
    throw new Error("Expected Baba binding statement.");
  }
  assert_equals(statement.value, {
    tag: "lam",
    pattern: {
      tag: "binding",
      name: "left",
      mode: "default",
      annotation: undefined,
    },
    params: [{
      name: "left",
      is_const: false,
      is_linear: false,
      annotation: undefined,
    }],
    body: {
      tag: "lam",
      pattern: {
        tag: "binding",
        name: "right",
        mode: "default",
        annotation: undefined,
      },
      params: [{
        name: "right",
        is_const: false,
        is_linear: false,
        annotation: undefined,
      }],
      body: { tag: "var", name: "left" },
    },
  });
});

Deno.test("Baba lowers multi-argument calls as value packs", () => {
  const lowered = lower_baba_source(parse_duck_source("choose(1, 2)\n"));
  assert_equals(diagnostics_of(lowered), []);
  const source = checked_value(lowered);
  const statement = source?.statements[0];
  if (statement === undefined || statement.tag !== "expr") {
    throw new Error("Expected Baba expression statement.");
  }
  assert_equals(statement.expr, {
    tag: "app",
    func: { tag: "var", name: "choose" },
    arg: {
      tag: "product",
      entries: [
        { value: { tag: "num", type: "i32", value: 1 } },
        { value: { tag: "num", type: "i32", value: 2 } },
      ],
      value_pack: true,
    },
    args: [
      { tag: "num", type: "i32", value: 1 },
      { tag: "num", type: "i32", value: 2 },
    ],
  });
});

Deno.test("Baba preserves statement breaks and trailing-comma call packs", () => {
  for (
    const source of [
      "f(1)\n()\n",
      "f 1\n()\n",
      "a + f 2\n()\n",
      "!f\n()\n",
      "do\n  value\n  [0]\nend\n",
      "do\n  value\n  []\nend\n",
      "do\n  value\n  [1, 2]\nend\n",
      "do\n  value\n  [0; 4]\nend\n",
      "do\n  value\n  [1, ...values]\nend\n",
      "do\n  value\n  [...values, 1]\nend\n",
      "if predicate(value,) then 1 else 0 end\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(source));
  }
});

Deno.test("Baba lowers template literals and repeated arrays", () => {
  for (
    const source of [
      "`text`\n",
      "`left {value} right`\n",
      "`escaped {{ brace }} and \\\\ slash`\n",
      "let rendered = `value: {value}`;\n",
      "[0; 4]\n",
      "let values = [value; length];\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(source));
  }
});

Deno.test("Baba lowers include, scratch, and argument-hole postfix forms", () => {
  for (
    const source of [
      'let config = include "./config.json";\n',
      "let total = scratch do 1 end;\n",
      "let increment = add (_, 1);\n",
      "let combine = add(_, _);\n",
      "let combine = add (1, _);\n",
      "let combine = add ((1, _));\n",
      "let combine = add [1, _];\n",
      "let combine = add [.left = 1, .right = _];\n",
      "let unapplied = _;\n",
      "let wrapped = #Some _;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    const lowered_source = checked_value(lowered);
    assert_equals(lowered_source, parse_source(source));
    if (lowered_source === undefined) {
      throw new Error("Expected a directly lowered postfix expression.");
    }
    assert_equals(all_source_nodes_have_spans(lowered_source), true);
    assert_source_spans_equal(lowered_source, parse_source(source));
  }

  const holes = checked_value(lower_baba_source(parse_duck_source(
    "let combine = add [1, _];\n",
  )));
  const statement = holes?.statements[0];
  if (
    statement?.tag !== "bind" || statement.value.tag !== "lam" ||
    statement.value.body.tag !== "app" ||
    statement.value.body.arg?.tag !== "product"
  ) {
    throw new Error("Expected an argument hole to produce a lambda.");
  }
  assert_equals(source_span_origin(statement.value), "concrete");
  assert_equals(source_span_origin(statement.value.body), "derived");
  assert_equals(source_span(statement.value.body.arg), {
    start: "let combine = add ".length,
    end: "let combine = add [1, _]".length,
  });
  assert_equals(source_span_origin(statement.value.body.arg), "concrete");
});

Deno.test("Baba rejects argument holes inside nested calls", () => {
  const source = "let invalid = outer (inner _, _);\n";
  const diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source(source)),
  );
  assert_equals(diagnostics, [{
    code: "DUCK1001",
    message:
      "A hole cannot appear inside a nested call; write the lambda instead",
    severity: "error",
    span: {
      start: source.indexOf("_"),
      end: source.indexOf("_") + 1,
    },
  }]);

  for (
    const nested_source of [
      "let invalid = outer({ .x = inner _ }, _);\n",
      "let invalid = outer(inner _.field, _);\n",
      "let invalid = outer({ .x = _ });\n",
    ]
  ) {
    const nested_diagnostics = diagnostics_of(
      lower_baba_source(parse_duck_source(nested_source)),
    );
    assert_equals(
      nested_diagnostics.map((diagnostic) => diagnostic.message),
      ["A hole cannot appear inside a nested call; write the lambda instead"],
    );
    assert_equals(nested_diagnostics[0]?.span, {
      start: nested_source.indexOf("_"),
      end: nested_source.indexOf("_") + 1,
    });
  }

  const lambda_parameter = lower_baba_source(parse_duck_source(
    "let valid = outer((_ => 1), _);\n",
  ));
  assert_equals(diagnostics_of(lambda_parameter), []);
});

Deno.test("Baba accumulates nested-hole and argument diagnostics", () => {
  const source = "let invalid = outer([.camelCase = inner _, .value = _]);\n";
  const diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source(source)),
  );
  assert_equals(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Product label must use snake_case: camelCase",
      "A hole cannot appear inside a nested call; write the lambda instead",
    ],
  );
  assert_equals(diagnostics.map((diagnostic) => diagnostic.span), [
    {
      start: source.indexOf("camelCase"),
      end: source.indexOf("camelCase") + "camelCase".length,
    },
    {
      start: source.indexOf("_"),
      end: source.indexOf("_") + 1,
    },
  ]);
});

Deno.test("Baba lowers recursive and open binding forms directly", () => {
  const sources = [
    Deno.readTextFileSync("examples/functions/04_recursive_fibonacci.duck"),
    Deno.readTextFileSync("examples/functions/05_tail_recursive_gcd.duck"),
    Deno.readTextFileSync("examples/functions/11_mutual_recursion.duck"),
    Deno.readTextFileSync("examples/compile_time/15_open_imports.duck"),
    "let recursive = rec [left, right] => left;\n",
    "let recursive = rec _ => 0;\n",
    "let recursive = rec [_, _] => 0;\n",
    "let recursive = rec (_) => 0;\n",
    "let recursive = rec (const _) => 0;\n",
    "let recursive = rec (_,) => 0;\n",
    "let recursive = rec (const _,) => 0;\n",
    "let recursive = rec (value,) => value;\n",
    "let recursive = rec (const value,) => value;\n",
    "let unit = rec () => rec();\n",
    "let unary = rec value => rec(value);\n",
    "let pair = rec (x, y) => rec(x, y);\n",
    "let grouped = rec (x, y) => rec((x, y));\n",
    "let nested = rec (x, y) => rec(((x, y)));\n",
    "let trailing = rec (x, y) => rec((x,));\n",
    "let rec even = value => value\n" +
    "and odd: I32 -> I32 = value => value;\n",
    "const value = open;\n",
    "let value = and;\n",
  ];
  for (const source of sources) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    const lowered_source = checked_value(lowered);
    assert_equals(lowered_source, parse_source(source));
    if (lowered_source === undefined) {
      throw new Error("Expected a directly lowered recursive binding.");
    }
    assert_equals(all_source_nodes_have_spans(lowered_source), true);
  }
});

Deno.test("Baba diagnoses invalid recursive and open binding forms", () => {
  for (
    const [source, message] of [
      [
        "let rec f = value => value else do return 0; end;\n",
        "Recursive bindings do not support else branches",
      ],
      [
        "let f = do 0; end\nand g = do 1; end;\n",
        "Mutually recursive bindings require let rec",
      ],
      [
        "let rec f = value => do value; end\n" +
        "and f = value => do value; end;\n",
        "Duplicate mutually recursive binding: f",
      ],
      [
        "let f = rec (const ...values) => values;\n",
        "Recursive functions do not support variadic parameters",
      ],
      [
        "let f = rec (_: I32) => 0;\n",
        "Wildcard parameters cannot have type annotations",
      ],
      [
        "let f = rec (_, _: I32) => 0;\n",
        "Wildcard parameters cannot have type annotations",
      ],
      [
        "let f = rec [_: I32] => 0;\n",
        "Wildcard parameters cannot have type annotations",
      ],
      [
        "let rec _ = rec value => value;\n",
        "Recursive bindings require a single name",
      ],
      [
        "let rec [f] = [value => f(value)]\n" +
        "and g = value => g(value);\n",
        "Recursive bindings require a single name",
      ],
      [
        'const open value = import "duck:x" ();\n',
        "Open imports require a named product pattern",
      ],
      [
        "const open { .value } = 0;\n",
        "Open bindings require a direct module import invocation",
      ],
    ] as const
  ) {
    const parsed = parse_duck_source(source);
    assert_equals(parsed.diagnostics, []);
    const diagnostics = diagnostics_of(lower_baba_source(parsed));
    assert_equals(diagnostics.length, 1);
    assert_equals(diagnostics[0]?.message, message);
  }
});

Deno.test("Baba keeps recursive binding diagnostics in source order", () => {
  const diagnostics = diagnostics_of(lower_baba_source(parse_duck_source(
    "let Bad = do 0; end\n" +
      "and alsoBad = do 1; end;\n",
  )));
  assert_equals(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter must use snake_case: Bad",
      "Mutually recursive bindings require let rec",
      "Mutually recursive binding must use snake_case: alsoBad",
    ],
  );
});

Deno.test("Baba recursive closures preserve outer effect identities", () => {
  for (
    const parameter of [
      "e",
      "[e]",
      "value",
    ]
  ) {
    const source = "effect E { op: () => I32 }\n" +
      "const e = E;\n" +
      "let f = rec " + parameter + " => do e = 0; end;\n" +
      "next <- e.op()\n";
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    const program = checked_value(lowered);
    assert_equals(program, parse_source(source));
    assert_equals(program?.statements[2]?.tag, "state_bind");
  }
});

Deno.test("Baba mutual members shadow outer effect identities", () => {
  const source = "effect E { op: () => I32 }\n" +
    "const g = E;\n" +
    "let rec f = value => value\n" +
    "and g = value => value;\n" +
    "next <- g.op()\n";
  const lowered = lower_baba_source(parse_duck_source(source));
  assert_equals(diagnostics_of(lowered), []);
  const program = checked_value(lowered);
  assert_equals(program?.statements[2]?.tag, "bind");
});

Deno.test("Baba recursive group names shadow effects inside every body", () => {
  for (
    const [binding, member_index] of [
      ["let rec f = value => do out <- f.op() end;\n", 0],
      [
        "let rec f = value => do out <- g.op() end\n" +
        "and g = value => value;\n",
        0,
      ],
      [
        "let rec f = value => value\n" +
        "and g = value => do out <- f.op() end;\n",
        1,
      ],
    ] as const
  ) {
    const source = "effect E { op: () => I32 }\n" +
      "const f = E;\n" +
      "const g = E;\n" +
      binding;
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    const program = checked_value(lowered);
    const group = program?.statements[2];
    if (group === undefined || group.tag !== "bind") {
      throw new Error("Expected a recursive binding group.");
    }
    let member = group;
    if (member_index === 1) {
      const mutual = group.mutual?.[0];
      if (mutual === undefined) {
        throw new Error("Expected a mutual recursive member.");
      }
      member = {
        tag: "bind",
        kind: group.kind,
        ...mutual,
      };
    }
    if (member.value.tag !== "lam" || member.value.body.tag !== "block") {
      throw new Error("Expected a recursive function block.");
    }
    assert_equals(member.value.body.statements[0]?.tag, "bind");
  }
});

Deno.test("Baba preserves built-in qualified field semantics", () => {
  for (
    const text of [
      "let value = Bytes.empty;\n",
      "Bytes.generate(4)\n",
      'Utf8.encode("x")\n',
      "Utf8.decode(bytes)\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(text));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(text));
  }
  const bytes = checked_value(
    lower_baba_source(parse_duck_source("Bytes.empty\n")),
  );
  assert_equals(bytes?.statements[0], {
    tag: "expr",
    expr: { tag: "text", value: "", encoding: "bytes" },
  });
});

Deno.test("Baba lowers assignments and nested function blocks", () => {
  const lowered = lower_baba_source(parse_duck_source(
    "let combine = (left, right) => do\n" +
      "  let doubled = left * 2;\n" +
      "  doubled + right\n" +
      "end;\n" +
      "let result = combine(20, 1);\n" +
      "result = result + 1\n" +
      "result\n",
  ));
  assert_equals(diagnostics_of(lowered), []);
  const source = checked_value(lowered);
  const combine = source?.statements[0];
  const assignment = source?.statements[2];
  if (combine === undefined || combine.tag !== "bind") {
    throw new Error("Expected Baba function binding.");
  }
  if (assignment === undefined || assignment.tag !== "assign") {
    throw new Error("Expected Baba assignment.");
  }
  assert_equals(combine.value.tag, "lam");
  if (combine.value.tag !== "lam") {
    throw new Error("Expected Baba lambda.");
  }
  assert_equals(combine.value.body, {
    tag: "block",
    statements: [
      {
        tag: "bind",
        kind: "let",
        pattern: {
          tag: "binding",
          name: "doubled",
          mode: "default",
          annotation: undefined,
        },
        name: "doubled",
        is_recursive: false,
        is_linear: false,
        annotation: undefined,
        value: {
          tag: "prim",
          prim: "i32.mul",
          left: { tag: "var", name: "left" },
          right: { tag: "num", type: "i32", value: 2 },
        },
      },
      {
        tag: "expr",
        expr: {
          tag: "prim",
          prim: "i32.add",
          left: { tag: "var", name: "doubled" },
          right: { tag: "var", name: "right" },
        },
      },
    ],
  });
  assert_equals(assignment, {
    tag: "assign",
    name: "result",
    mode: "same",
    value: {
      tag: "prim",
      prim: "i32.add",
      left: { tag: "var", name: "result" },
      right: { tag: "num", type: "i32", value: 1 },
    },
  });
});

Deno.test("Baba lowers indexed assignments directly", () => {
  for (
    const text of [
      "let pair = [20, 0];\n" +
      "let index = 1;\n" +
      "pair[index] = 22\n",
      "let write = (buffer, offset, byte) => do\n" +
      "  buffer[offset + 1] = byte;\n" +
      "  buffer\n" +
      "end;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(text));
    assert_equals(diagnostics_of(lowered), []);
    const source = checked_value(lowered);
    if (source === undefined) {
      throw new Error("Expected a directly lowered indexed assignment.");
    }
    const legacy_source = parse_source(text);
    assert_equals(source, legacy_source);
    assert_equals(all_source_nodes_have_spans(source), true);
    assert_source_spans_equal(source, legacy_source);
  }

  const lowered = checked_value(lower_baba_source(parse_duck_source(
    "pair[index] = 22\n",
  )));
  assert_equals(lowered?.statements[0], {
    tag: "index_assign",
    name: "pair",
    index: { tag: "var", name: "index" },
    value: { tag: "num", type: "i32", value: 22 },
  });

  for (const name of ["infix", "infixl", "infixr", "prefix"]) {
    const text = "let " + name + " = [0];\n" +
      name + "[0] = 1;\n";
    const contextual = lower_baba_source(parse_duck_source(text));
    assert_equals(diagnostics_of(contextual), []);
    const source = checked_value(contextual);
    if (source === undefined) {
      throw new Error("Expected a contextual indexed assignment.");
    }
    const legacy_source = parse_source(text);
    assert_equals(source, legacy_source);
    assert_equals(all_source_nodes_have_spans(source), true);
    assert_source_spans_equal(source, legacy_source);
  }
});

Deno.test("Baba lowers array spreads directly", () => {
  for (
    const text of [
      "[1, 2, ...rest]\n",
      "[...rest, 1, 2]\n",
      "let prepend = (head, tail) => [head, ...tail];\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(text));
    assert_equals(diagnostics_of(lowered), []);
    const source = checked_value(lowered);
    if (source === undefined) {
      throw new Error("Expected a directly lowered array spread.");
    }
    const legacy_source = parse_source(text);
    assert_equals(source, legacy_source);
    assert_equals(all_source_nodes_have_spans(source), true);
    assert_source_spans_equal(source, legacy_source);
  }

  const spread_only = checked_value(lower_baba_source(parse_duck_source(
    "[...rest]\n",
  )));
  assert_equals(spread_only?.statements[0], {
    tag: "expr",
    expr: {
      tag: "array",
      items: [],
      rest: { tag: "var", name: "rest" },
    },
  });

  for (
    const text of [
      "[256u8, ...512u8]\n",
      "[...256u8, 512u8]\n",
    ]
  ) {
    const diagnostics = diagnostics_of(
      lower_baba_source(parse_duck_source(text)),
    );
    assert_equals(diagnostics.length, 2);
    const starts = diagnostics.map((diagnostic) => diagnostic.span.start);
    assert_equals(starts, [...starts].sort((left, right) => left - right));
  }
});

Deno.test("Baba lowers attribute groups directly", () => {
  const source = "@[first]\n" +
    "@[\n" +
    "  second(1),\n" +
    "  #slow,\n" +
    "]\n" +
    "const answer = 42;\n" +
    "@[derive(I32)]\n" +
    "type Answer = I32\n" +
    "@[host]\n" +
    "declare effect Input { read: () => I32 }\n" +
    "@[runtime]\n" +
    "effect Local { get: () => I32 }\n" +
    "@[layout]\n" +
    "declare Record { value: I32 }\n";
  const lowered = lower_baba_source(parse_duck_source(source));
  assert_equals(diagnostics_of(lowered), []);
  const lowered_source = checked_value(lowered);
  if (lowered_source === undefined) {
    throw new Error("Expected attributed source to lower directly.");
  }
  const legacy_source = parse_source(source);
  assert_equals(lowered_source, legacy_source);
  assert_equals(all_source_nodes_have_spans(lowered_source), true);
  assert_source_spans_equal(lowered_source, legacy_source);
  const binding = lowered_source.statements[0];
  if (binding?.tag !== "bind") {
    throw new Error("Expected an attributed const binding.");
  }
  assert_equals(binding.kind, "const");
  assert_equals(binding.attribute_groups?.[1]?.multiline, true);

  const invalid_source = "@[512u8]\n" +
    "const BadName = 1024u8;\n";
  const diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source(invalid_source)),
  );
  assert_equals(diagnostics.length, 3);
  const starts = diagnostics.map((diagnostic) => diagnostic.span.start);
  assert_equals(starts, [...starts].sort((left, right) => left - right));
});

Deno.test("Baba lowers Duck, extension, and module declarations directly", () => {
  const source = "@[derive]\n" +
    "duck Read Self {\n" +
    "  type Value\n" +
    "  .read = Self -> Value\n" +
    "}\n" +
    "@[implement]\n" +
    "extend I32 Element {\n" +
    "  type Value = Element,\n" +
    "  .read = (value: I32) => value,\n" +
    "}\n" +
    "@[local]\n" +
    "module sample = capability => do\n" +
    "  { .read = () => capability }\n" +
    "end\n";
  const lowered = lower_baba_source(parse_duck_source(source));
  assert_equals(diagnostics_of(lowered), []);
  const lowered_source = checked_value(lowered);
  if (lowered_source === undefined) {
    throw new Error("Expected attributed declarations to lower directly.");
  }
  const legacy_source = parse_source(source);
  assert_equals(lowered_source, legacy_source);
  assert_equals(all_source_nodes_have_spans(lowered_source), true);
  const duck = lowered_source.declarations?.[0];
  const extension = lowered_source.declarations?.[1];
  const module_binding = lowered_source.statements[0];
  if (
    duck?.tag !== "duck" || extension?.tag !== "extend" ||
    module_binding?.tag !== "bind"
  ) {
    throw new Error("Expected Duck, extension, and module declarations.");
  }
  const duck_attribute = duck.attribute_groups?.[0];
  const extension_attribute = extension.attribute_groups?.[0];
  const module_attribute = module_binding.attribute_groups?.[0];
  const duck_member = duck.members[0];
  if (
    duck_attribute === undefined || extension_attribute === undefined ||
    module_attribute === undefined || duck_member === undefined
  ) {
    throw new Error("Expected exact attributed declaration members.");
  }
  assert_equals(source_span(duck_attribute), {
    start: source.indexOf("@[derive]"),
    end: source.indexOf("@[derive]") + "@[derive]".length,
  });
  const duck_member_type = "Self -> Value";
  assert_equals(source_span(duck_member.type_expr), {
    start: source.indexOf(duck_member_type),
    end: source.indexOf(duck_member_type) + duck_member_type.length,
  });
  assert_equals(source_span(extension_attribute), {
    start: source.indexOf("@[implement]"),
    end: source.indexOf("@[implement]") + "@[implement]".length,
  });
  assert_equals(source_span(module_attribute), {
    start: source.indexOf("@[local]"),
    end: source.indexOf("@[local]") + "@[local]".length,
  });

  const invalid_source = "@[512u8]\n" +
    "module BadName = 1024u8\n" +
    "duck Bad left left { type lower .badName = I32 }\n" +
    "extend Box param param { type lower = I32, .badName = 1 }\n";
  const diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source(invalid_source)),
  );
  assert_equals(diagnostics.length > 8, true);
  const starts = diagnostics.map((diagnostic) => diagnostic.span.start);
  assert_equals(starts, [...starts].sort((left, right) => left - right));
});

Deno.test("Baba lowers effect handlers with state directly", () => {
  const text = "const run = initial => do\n" +
    "  let current = initial;\n" +
    "  handler State {\n" +
    "    get: (!resume) => !resume current,\n" +
    "    put: (value, !resume) => do\n" +
    "      current = value\n" +
    "      !resume(())\n" +
    "    end,\n" +
    "    return: value => value,\n" +
    "  }\n" +
    "end;\n";
  const lowered = lower_baba_source(parse_duck_source(text));
  assert_equals(diagnostics_of(lowered), []);
  const source = checked_value(lowered);
  if (source === undefined) {
    throw new Error("Expected an effect handler to lower directly.");
  }
  assert_equals(source, parse_source(text));
  assert_equals(all_source_nodes_have_spans(source), true);
});

Deno.test("Baba lowers type checks and explicit handlers directly", () => {
  for (
    const text of [
      "let struct { .name = Text, ..} = Player;\n",
      "let union { .Some = I32, ..} = Optional;\n",
      "try run() with counter\n",
      "let result = try calculate();\n",
      "let output = try do\n  ()\nend with collect 4;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(text));
    assert_equals(diagnostics_of(lowered), []);
    const source = checked_value(lowered);
    if (source === undefined) {
      throw new Error("Expected a type check or handler to lower directly.");
    }
    const legacy = parse_source(text);
    assert_equals(source, legacy);
    assert_equals(all_source_nodes_have_spans(source), true);
    assert_source_spans_equal(source, legacy);
  }

  const implicit_text = "try calculate()\n";
  const implicit = checked_value(
    lower_baba_source(parse_duck_source(implicit_text)),
  );
  const statement = implicit?.statements[0];
  if (
    statement === undefined || statement.tag !== "expr" ||
    statement.expr.tag !== "try_with"
  ) {
    throw new Error("Expected an implicit default-handler expression.");
  }
  assert_equals(statement.expr.infer_default_handlers, true);
  assert_equals(source_span(statement.expr.handler), {
    start: 0,
    end: "try calculate()".length,
  });
  assert_equals(source_span_origin(statement.expr.handler), "derived");
});

Deno.test("Baba lowers duplicated resumptions directly", () => {
  const text = "let (!left, !right) = dup !resume;\n";
  const lowered = lower_baba_source(parse_duck_source(text));
  assert_equals(diagnostics_of(lowered), []);
  assert_equals(checked_value(lowered), parse_source(text));

  const invalid = "let (!camelCase, !Other) = dup !resume;\n";
  const diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source(invalid)),
  );
  assert_equals(
    diagnostics.map((diagnostic) => diagnostic.span.start),
    [invalid.indexOf("camelCase"), invalid.indexOf("Other")],
  );
  assert_equals(
    diagnostics.every((diagnostic) =>
      diagnostic.message.startsWith(
        "Duplicated resumption must use snake_case:",
      )
    ),
    true,
  );
});

Deno.test("Baba rejects invalid handler clause names at the clause", () => {
  const text = "effect State { bad_name: () => Unit }\n" +
    "const run = handler State {\n" +
    "  badName: (!resume) => !resume(()),\n" +
    "  return: value => value,\n" +
    "};\n";
  const diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source(text)),
  );
  assert_equals(diagnostics, [{
    code: "DUCK1001",
    severity: "error",
    message: "Handler clause must use snake_case: badName",
    span: {
      start: text.indexOf("badName"),
      end: text.indexOf("badName") + "badName".length,
    },
  }]);
});

Deno.test("Baba preserves parenthesized Wasm calls as applications", () => {
  for (
    const text of [
      "@wasm.add_i32 (1, 2)\n",
      "@wasm.add_i32 ()\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(text));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(text));
  }

  const intrinsic = "@wasm.add_i32 [1, 2]\n";
  const lowered_intrinsic = lower_baba_source(parse_duck_source(intrinsic));
  assert_equals(diagnostics_of(lowered_intrinsic), []);
  assert_equals(checked_value(lowered_intrinsic), parse_source(intrinsic));
});

Deno.test("bundled array spreads match the legacy parity oracle", async () => {
  for (
    const path of [
      "../../examples/compile_time/13_derived_nested_equality.duck",
      "prelude_types.duck",
    ]
  ) {
    const text = await Deno.readTextFile(new URL(path, import.meta.url));
    const lowered = lower_baba_source(parse_duck_source(text));
    assert_equals(diagnostics_of(lowered), []);
    const source = checked_value(lowered);
    if (source === undefined) {
      throw new Error("Expected bundled array spreads to lower directly.");
    }
    assert_equals(source, parse_source(text));
    assert_equals(all_source_nodes_have_spans(source), true);
  }
});

Deno.test("bundled attributes match the legacy parity oracle", async () => {
  for (
    const path of [
      "../../examples/compile_time/16_attributes_and_import_meta.duck",
      "../../examples/compile_time/23_derived_sequence.duck",
      "../../examples/compile_time/25_source_derive_attribute.duck",
      "../../examples/testing/01_inline_tests.duck",
    ]
  ) {
    const text = await Deno.readTextFile(new URL(path, import.meta.url));
    const lowered = lower_baba_source(parse_duck_source(text));
    assert_equals(diagnostics_of(lowered), []);
    const source = checked_value(lowered);
    if (source === undefined) {
      throw new Error("Expected bundled attributes to lower directly.");
    }
    assert_equals(source, parse_source(text));
    assert_equals(all_source_nodes_have_spans(source), true);
  }
});

Deno.test("bundled Duck and extension declarations match the legacy oracle", async () => {
  for (
    const path of [
      "../../examples/compile_time/18_ducks_and_operators.duck",
      "../../examples/compile_time/22_generic_extension.duck",
      "../../examples/ownership_modules/07_local_module_binding.duck",
      "prelude.duck",
      "prelude_effects.duck",
      "prelude_effect_defaults.duck",
      "prelude_iterators.duck",
    ]
  ) {
    const text = await Deno.readTextFile(new URL(path, import.meta.url));
    const lowered = lower_baba_source(parse_duck_source(text));
    assert_equals(diagnostics_of(lowered), []);
    const source = checked_value(lowered);
    if (source === undefined) {
      throw new Error("Expected bundled declarations to lower directly.");
    }
    assert_equals(source, parse_source(text));
    assert_equals(all_source_nodes_have_spans(source), true);
  }
});

Deno.test("bundled type checks and effect handlers match the legacy oracle", async () => {
  for (
    const path of [
      "../../examples/compile_time/21_type_patterns.duck",
      "../../examples/handlers/01_local_counter.duck",
      "../../examples/handlers/02_inferred_option_do.duck",
      "../../examples/handlers/03_composed_default_handlers.duck",
      "../../examples/handlers/04_output_builder.duck",
      "../../examples/handlers/05_effects_in_collection_loop.duck",
      "../../examples/handlers/06_effects_in_cursor_loop.duck",
      "../../examples/handlers/07_effectful_loop_continue.duck",
    ]
  ) {
    const text = await Deno.readTextFile(new URL(path, import.meta.url));
    const lowered = lower_baba_source(parse_duck_source(text));
    assert_equals(diagnostics_of(lowered), []);
    const source = checked_value(lowered);
    if (source === undefined) {
      throw new Error("Expected bundled type checks and handlers to lower.");
    }
    assert_equals(source, parse_source(text));
    assert_equals(all_source_nodes_have_spans(source), true);
  }
});

Deno.test("Baba treats fixity words as contextual binding names", () => {
  for (const name of ["infix", "infixl", "infixr", "prefix"]) {
    const source = "let " + name + " = 1;\n" +
      name + " = 2;\n" +
      "let copied = " + name + ";\n";
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    const lowered_source = checked_value(lowered);
    assert_equals(lowered_source, parse_source(source));
    if (lowered_source === undefined) {
      throw new Error("Expected a contextual fixity binding.");
    }
    assert_equals(all_source_nodes_have_spans(lowered_source), true);
    assert_source_spans_equal(lowered_source, parse_source(source));
  }

  for (
    const source of [
      "let prefix = 1;\nlet copied = prefix;\n",
      "let read = prefix => prefix;\n",
      "let read = (text, prefix) => prefix;\n",
      "case value of #Some prefix => prefix, _ => 0;\n",
      "let #Some prefix = value else do return 0; end;\n" +
      "let copied = prefix;\n",
      "effect E { op: () => I32 }\n" +
      "prefix <- E.op();\n" +
      "let copied = prefix;\n",
      "prefix 80 ^^ = wrap\nlet invert = value => ^^ value;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    const lowered_source = checked_value(lowered);
    assert_equals(lowered_source, parse_source(source));
    if (lowered_source === undefined) {
      throw new Error("Expected a contextual prefix binding.");
    }
    assert_equals(all_source_nodes_have_spans(lowered_source), true);
    if (
      !source.startsWith("case") &&
      !source.includes("else do") &&
      !source.includes("<-")
    ) {
      assert_source_spans_equal(lowered_source, parse_source(source));
    }
  }
});

Deno.test("Baba matches the legacy parity oracle for foundational control flow", () => {
  for (
    const path of [
      "examples/basics/01_arithmetic_and_shadowing.duck",
      "examples/basics/04_comparisons_and_logic.duck",
      "examples/basics/06_functions_and_blocks.duck",
      "examples/basics/07_early_return.duck",
      "examples/basics/10_else_if.duck",
      "examples/basics/13_loop_keyword.duck",
    ]
  ) {
    const text = Deno.readTextFileSync(path);
    const lowered = lower_baba_source(parse_duck_source(text));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(text));
  }

  const aggregate_source = 'let dependency = import "duck:example";\n' +
    "let values = [1, 2];\n" +
    "let choice = #Some (values[0]);\n" +
    "let empty = #None;\n" +
    "choice\n";
  const aggregate_lowered = lower_baba_source(
    parse_duck_source(aggregate_source),
  );
  assert_equals(diagnostics_of(aggregate_lowered), []);
  assert_equals(
    checked_value(aggregate_lowered),
    parse_source(aggregate_source),
  );

  for (
    const top_level_return_source of [
      "return;\n",
      "value <- effect()\nreturn 1;\n",
      "value <- effect()\nreturn { .value };\n",
    ]
  ) {
    const top_level_return_lowered = lower_baba_source(
      parse_duck_source(top_level_return_source),
    );
    assert_equals(diagnostics_of(top_level_return_lowered), []);
    const top_level_return = checked_value(top_level_return_lowered);
    const legacy_top_level_return = parse_source(top_level_return_source);
    assert_equals(top_level_return, legacy_top_level_return);
    if (top_level_return === undefined) {
      throw new Error("Expected a top-level return statement.");
    }
    assert_source_spans_equal(top_level_return, legacy_top_level_return);
  }

  for (
    const expression_source of [
      "let value = a && b && c;\n",
      "let value = if false then\n" +
      "  0\n" +
      "else true then\n" +
      "  1\n" +
      "end;\n",
      "let value = do\n" +
      "  if true then\n" +
      "    if false then\n" +
      "      1\n" +
      "    end\n" +
      "  end\n" +
      "end;\n",
      "if -1 < 0 then\n" +
      "  1\n" +
      "end;\n",
      "if &value then\n" +
      "  1\n" +
      "end;\n",
      "if freeze value then\n" +
      "  1\n" +
      "end;\n",
      "if comptime value then\n" +
      "  1\n" +
      "end;\n",
      "let value = -a + b;\n",
      "let value = !(a) && !(b);\n",
      "let value = 40i64 + 2i64;\n",
      "let value = 40u64 + 2u64;\n",
      "let value = 40f64 + 2f64;\n",
      "let value = 40f64 % 2f64;\n",
      "let value = -1i8;\n",
      "let value = -1i64;\n",
      "let value = -1f64;\n",
      "let value = -(1i64 + 2i64);\n",
      "let value = -(1f32 + 2f32);\n",
      "let value = -(1f64 + 2f64);\n",
      "let f = (first, second) => first + second;\n",
      "let value: I64 = 1i64;\n",
      "let f = (value: I32, const width: U8) => value;\n",
      "let f = !value => value;\n",
      "let f: (I32, I64) -> I64 = (left, right) => right;\n",
      "let _ = 1;\nlet f = _ => 2;\n",
      "let f = const _ => 2;\n",
      "let f = (_, const _) => 1;\n",
      "let value = f();\n",
      "let value = f(());\n",
      "let value = !resume(());\n",
      "let stop = () => do\n  return;\nend;\n",
      "let _ = 1;\r\n// ignored\r\nlet f = _ => 2;\r\n",
      "let value = 1;\rlet f = _ => 2;\n",
      "let value = object.field.other;\n",
      "let value = Io.read();\n",
      "if object.end == 1 then\n  1\nend;\n",
      "let value = { .io = !init.io, .name };\n",
      "let value = [.length = 1, .other = 2];\n",
      "let value = #answer;\n",
      "let value = 'w';\n",
    ]
  ) {
    const expression_lowered = lower_baba_source(
      parse_duck_source(expression_source),
    );
    assert_equals(diagnostics_of(expression_lowered), []);
    const source = checked_value(expression_lowered);
    const legacy = parse_source(expression_source);
    assert_equals(source, legacy);
    if (source === undefined) {
      throw new Error("Expected Baba parity source.");
    }
    assert_equals(all_source_nodes_have_spans(source), true);
    if (
      !expression_source.startsWith("let value = do\n") &&
      !expression_source.startsWith("let f:") &&
      !expression_source.includes("else true then") &&
      !expression_source.includes("object.field.other") &&
      !expression_source.includes("Io.read") &&
      !expression_source.includes("{ .io =") &&
      !expression_source.includes("[.length =")
    ) {
      assert_source_spans_equal(source, legacy);
    }
    if (expression_source.includes("else true then")) {
      const statement = source.statements[0];
      if (
        statement?.tag !== "bind" || statement.value.tag !== "if" ||
        statement.value.else_branch.tag !== "if"
      ) {
        throw new Error("Expected a chained conditional binding.");
      }
      assert_equals(source_span(statement.value.else_branch), {
        start: expression_source.indexOf("else true"),
        end: expression_source.indexOf("end;"),
      });
    }
  }
});

Deno.test("Baba rejects return values after a line break", () => {
  for (
    const source of [
      "return\n1;\n",
      "return\n{ .value = 1 };\n",
      "return\n;\n",
      "return // stop here\n1;\n",
      "return // stop here\r\n1;\r\n",
      "return 1\n;\n",
      "return { .value = 1 }\n;\n",
      "return 1 // stop here\n;\n",
      "let stop = () => do\n  return\n  1;\nend;\n",
      "let stop = () => do\n  return // stop here\n  1;\nend;\n",
      "let stop = () => do\n  return 1\n  ;\nend;\n",
    ]
  ) {
    const parsed = parse_duck_source(source);
    assert_equals(parsed.diagnostics, []);
    const diagnostics = diagnostics_of(lower_baba_source(parsed));
    const return_start = source.indexOf("return");
    const line_break = source.indexOf("\n", return_start);
    assert_equals(diagnostics, [{
      code: "DUCK1001",
      message: "Expected `;` after `return`",
      severity: "error",
      span: { start: line_break, end: line_break + 1 },
    }]);
  }
});

Deno.test("Baba requires a terminator after return values", () => {
  for (
    const source of [
      "return 1\n",
      "return { .value = 1 }\n",
      "return 1 // stop here\n",
      "let stop = () => do\n  return 1\nend;\n",
    ]
  ) {
    const diagnostics = parse_duck_source(source).diagnostics;
    assert_equals(
      diagnostics.map((diagnostic) => diagnostic.message),
      ["Baba parser rejected MISSING"],
    );
    const diagnostic = diagnostics[0];
    if (diagnostic === undefined) {
      throw new Error("Expected a missing return terminator.");
    }
    const line_break = source.indexOf("\n", source.indexOf("return"));
    assert_equals(diagnostic.span.start >= line_break, true);
    assert_equals(diagnostic.span.end, diagnostic.span.start);
  }
});

Deno.test("Baba lowers conditional patterns and condition-only expressions", () => {
  for (
    const source of [
      "if let #Some value = current then value else 0 end;\n",
      "if let #None = current then 1 end;\n",
      "if let #Bool true = current then 1 else 0 end;\n",
      "if let #Bool false = current then return 1; end;\n",
      "let _ = 1;\n" +
      "if let #Some _ = current then 1 else 0 end;\n",
      "if let 0 = current then 1 else 2 end;\n",
      "if let true = current then 1 else 0 end;\n",
      'if let "yes" = current then 1 else 0 end;\n',
      "if let 'a' = current then 1 else 0 end;\n",
      "if let [head, tail] = current then head else tail end;\n",
      "if (let #Some value = current) then value else 0 end;\n",
      "if ready then one else let #Some value = current then value " +
      "else 0 end;\n",
      "if ready then one else let [value] = current then value " +
      "else 0 end;\n",
      "if predicate value then 1 else 0 end;\n",
      "if (ready) then 1 else 0 end;\n",
      "if perform ready then 1 else 0 end;\n",
      "if object.flag(thing[0]) is Bool then import.meta " +
      "else perform fallback end;\n",
      "let value = perform function argument;\n",
      "let value = perform ();\n",
      "let value = perform (left, right);\n",
      "let value = current is I32;\n",
      "let value = current as I32;\n",
      "let value = do\n" +
      "  if let #Some item = current then\n" +
      "    item\n" +
      "  end\n" +
      "end;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    const lowered_source = checked_value(lowered);
    const legacy_source = parse_source(source);
    assert_equals(lowered_source, legacy_source);
    if (lowered_source === undefined) {
      throw new Error("Expected a directly lowered conditional source.");
    }
    assert_equals(all_source_nodes_have_spans(lowered_source), true);
    const literal_conditional = source.startsWith("if let 0") ||
      source.startsWith("if let true") ||
      source.startsWith('if let "yes"') ||
      source.startsWith("if let 'a'");
    if (
      !literal_conditional &&
      !source.includes("let [") &&
      !source.includes("else let") &&
      !source.includes("object.flag") &&
      !source.includes("current is I32") &&
      !source.includes("current as I32") &&
      !source.startsWith("let value = do")
    ) {
      assert_source_spans_equal(lowered_source, legacy_source);
    } else if (literal_conditional) {
      const statement = lowered_source.statements[0];
      if (
        statement?.tag !== "expr" || statement.expr.tag !== "if" ||
        statement.expr.cond.tag !== "prim"
      ) {
        throw new Error("Expected a literal-pattern conditional.");
      }
      const literal_start = "if let ".length;
      const literal_end = source.indexOf(" = current");
      assert_equals(source_span(statement.expr.cond.right), {
        start: literal_start,
        end: literal_end,
      });
      assert_equals(source_span(statement.expr.cond), {
        start: source.indexOf("let"),
        end: source.indexOf("current") + "current".length,
      });
    } else if (source.startsWith("if let [")) {
      const statement = lowered_source.statements[0];
      if (
        statement?.tag !== "expr" || statement.expr.tag !== "match" ||
        statement.expr.arms[0]?.pattern.tag !== "product"
      ) {
        throw new Error("Expected a structural-pattern conditional.");
      }
      const entry = statement.expr.arms[0].pattern.entries[0];
      if (entry === undefined) {
        throw new Error("Structural conditional lost its first pattern.");
      }
      assert_equals(source_span(entry), {
        start: source.indexOf("head"),
        end: source.indexOf("head") + "head".length,
      });
    } else if (source.includes("object.flag")) {
      const statement = lowered_source.statements[0];
      if (
        statement?.tag !== "expr" || statement.expr.tag !== "if" ||
        statement.expr.cond.tag !== "is" ||
        statement.expr.cond.value.tag !== "app"
      ) {
        throw new Error("Expected a condition-only call expression.");
      }
      assert_equals(source_span(statement.expr.cond.value.func), {
        start: source.indexOf("object.flag"),
        end: source.indexOf("object.flag") + "object.flag".length,
      });
    } else if (source.startsWith("let value = do")) {
      const statement = lowered_source.statements[0];
      if (
        statement?.tag !== "bind" || statement.value.tag !== "block"
      ) {
        throw new Error("Expected a block containing an if-let result.");
      }
      const conditional = statement.value.statements[0];
      if (conditional === undefined) {
        throw new Error("Conditional block lost its result statement.");
      }
      assert_equals(source_span(conditional), {
        start: source.indexOf("if let"),
        end: source.indexOf("  end\n") + "  end".length,
      });
    }
    if (source.includes("else let")) {
      const statement = lowered_source.statements[0];
      if (
        statement?.tag !== "expr" || statement.expr.tag !== "if" ||
        (statement.expr.else_branch.tag !== "match" &&
          statement.expr.else_branch.tag !== "if_let")
      ) {
        throw new Error("Expected a pattern chained conditional.");
      }
      assert_equals(source_span(statement.expr.else_branch), {
        start: source.indexOf("else let"),
        end: source.lastIndexOf("0") + 1,
      });
    }
    if (
      source.includes("current is I32") ||
      source.includes("current as I32")
    ) {
      const statement = lowered_source.statements[0];
      if (
        statement?.tag !== "bind" ||
        (statement.value.tag !== "is" && statement.value.tag !== "as")
      ) {
        throw new Error("Expected a source type operator.");
      }
      assert_equals(source_span(statement.value.type_expr), {
        start: source.indexOf("I32"),
        end: source.indexOf("I32") + "I32".length,
      });
    }
  }
});

Deno.test("Baba lowers case expressions and case functions directly", () => {
  for (
    const source of [
      "case of of _ => 1;\n",
      "case choice of #Some value if value > 0 => value, #None => 0;\n",
      "case value of 0 | #(expected) => 1, _ => do\n" +
      "  let result = 2;\n" +
      "  result\n" +
      "end;\n",
      "case (left, right) of (first, second) => first;\n",
      "case choice of #Some value => #Outer #Middle #None, " +
      "_ => consume #Fallback;\n",
      "case choice of _ => #Outer function_value argument;\n",
      "case choice of _ => #Outer #None ();\n",
      "let inspect = value => case value of " +
      "#Present payload => payload;\n",
      "let choose = case => of\n" +
      "  (#None, value) => value,\n" +
      "  (#Some left, right) => left;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    const lowered_source = checked_value(lowered);
    assert_equals(lowered_source, parse_source(source));
    if (lowered_source === undefined) {
      throw new Error("Expected a directly lowered case source.");
    }
    assert_equals(all_source_nodes_have_spans(lowered_source), true);
  }
});

Deno.test("Baba validates case patterns and accumulates arm diagnostics", () => {
  const duplicate_source = "case value of (x, x) => x;\n";
  const duplicate = diagnostics_of(
    lower_baba_source(parse_duck_source(duplicate_source)),
  );
  assert_equals(duplicate.map((diagnostic) => diagnostic.message), [
    "Duplicate pattern binding: x",
  ]);
  assert_equals(duplicate[0]?.span, {
    start: duplicate_source.lastIndexOf("x)"),
    end: duplicate_source.lastIndexOf("x)") + 1,
  });
  assert_equals(duplicate[0]?.related, [{
    message: "First pattern binding is here.",
    span: {
      start: duplicate_source.indexOf("x,"),
      end: duplicate_source.indexOf("x,") + 1,
    },
  }]);

  const independent_source = "case => of (left, right) => -1u8, #None => 0;\n";
  const independent = diagnostics_of(
    lower_baba_source(parse_duck_source(independent_source)),
  );
  assert_equals(independent.map((diagnostic) => diagnostic.message), [
    "Unsigned U8 literal cannot be negated.",
    "`case => of` arms must match the same argument count",
  ]);

  const ordered_source = "case => of #None => 0, (left, right) => -1u8;\n";
  const ordered = diagnostics_of(
    lower_baba_source(parse_duck_source(ordered_source)),
  );
  assert_equals(ordered.map((diagnostic) => diagnostic.message), [
    "`case => of` arms must match the same argument count",
    "Unsigned U8 literal cannot be negated.",
  ]);

  for (
    const [source, message] of [
      [
        "case value of _ => #Outer ();\n",
        "Nullary union constructor #Outer omits `()`",
      ],
      [
        "case value of _ => #Outer();\n",
        "Union constructor application uses #Outer value",
      ],
      [
        "case value of _ => #Outer #None();\n",
        "Union constructor application uses #None value",
      ],
      [
        "case value of _ => #Some(value);\n",
        "Union constructor application uses #Some value",
      ],
      [
        "case value of _ => #Outer #Some(value);\n",
        "Union constructor application uses #Some value",
      ],
    ] as const
  ) {
    assert_equals(
      diagnostics_of(
        lower_baba_source(parse_duck_source(source)),
      ).map((diagnostic) => diagnostic.message),
      [message],
    );
  }
});

Deno.test("Baba diagnoses inconsistent case-function arity at the arm", () => {
  const source = "case => of (left, right) => left, #Some value => value;\n";
  const diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source(source)),
  );
  assert_equals(diagnostics, [{
    code: "DUCK1001",
    message: "`case => of` arms must match the same argument count",
    severity: "error",
    span: {
      start: source.indexOf("#Some value => value"),
      end: source.indexOf("#Some value => value") +
        "#Some value => value".length,
    },
  }]);
});

Deno.test("Baba keeps case-function desugaring derived", () => {
  const source = checked_value(lower_baba_source(parse_duck_source(
    "case => of (left, right) => left;\n",
  )));
  const statement = source?.statements[0];
  if (
    statement?.tag !== "expr" || statement.expr.tag !== "lam" ||
    statement.expr.body.tag !== "match"
  ) {
    throw new Error("Expected a directly lowered case function.");
  }
  assert_equals(source_span_origin(statement.expr), "concrete");
  assert_equals(source_span_origin(statement.expr.body), "derived");
});

Deno.test("case-pattern bindings shadow tracked effect instances", () => {
  const source = "effect E { op: () => I32 }\n" +
    "const e = E;\n" +
    "case choice of e => do\n" +
    "  value <- e.op()\n" +
    "end;\n";
  const lowered = lower_baba_source(parse_duck_source(source));
  assert_equals(diagnostics_of(lowered), []);
  const statement = checked_value(lowered)?.statements[1];
  if (
    statement?.tag !== "expr" || statement.expr.tag !== "match" ||
    statement.expr.arms[0]?.body.tag !== "block"
  ) {
    throw new Error("Expected a case arm with a block body.");
  }
  assert_equals(statement.expr.arms[0].body.statements[0]?.tag, "bind");
});

Deno.test("Baba rejects negation outside a signed literal width", () => {
  for (
    const example of [
      {
        source: "let value = -(-128i8);\n",
        message: "Integer literal 128 is out of range for I8",
      },
      {
        source: "let value = -(-32768i16);\n",
        message: "Integer literal 32768 is out of range for I16",
      },
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(example.source));
    assert_equals(
      diagnostics_of(lowered)[0]?.message,
      example.message,
    );
    assert_equals(checked_value(lowered), undefined);
  }
});

Deno.test("Baba rejects accepted syntax before its semantics are lowered", () => {
  for (
    const source of [
      "let value = -1u8;\n",
      "let value = -1u64;\n",
      "let value = -(1u8);\n",
      "let value = -((1u64));\n",
      "let f = !_ => 1;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered).length > 0, true);
    assert_equals(checked_value(lowered), undefined);
  }
});

Deno.test("Baba rejects conflicting non-associative operators", () => {
  for (
    const source of [
      "let value = 1 == 2 == 3;\n",
      "let value = 1 == 2 + 3 == 4;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(
      diagnostics_of(lowered)[0]?.message,
      "Conflicting associativity at precedence 40: == and ==",
    );
    assert_equals(checked_value(lowered), undefined);
  }
});

Deno.test("Baba recovery preserves valid statements inside an enclosing block", () => {
  const lowered = lower_baba_source(parse_duck_source(
    "let f = do\n" +
      "  let broken = ;\n" +
      "  let good = 1;\n" +
      "  good\n" +
      "end;\n",
  ));
  assert_equals(diagnostics_of(lowered), []);
  const source = checked_value(lowered);
  const binding = source?.statements[0];
  if (binding === undefined || binding.tag !== "bind") {
    throw new Error("Expected recovered Baba binding.");
  }
  assert_equals(binding.value, {
    tag: "block",
    statements: [
      {
        tag: "bind",
        kind: "let",
        pattern: {
          tag: "binding",
          name: "good",
          mode: "default",
          annotation: undefined,
        },
        name: "good",
        is_recursive: false,
        is_linear: false,
        annotation: undefined,
        value: { tag: "num", type: "i32", value: 1 },
      },
      { tag: "expr", expr: { tag: "var", name: "good" } },
    ],
  });
});

Deno.test("Baba lowers range and collection loops directly", () => {
  for (
    const source of [
      "for value in values do value; end\n",
      "for index, value in values do value; end\n",
      "for value in 0..10 by 2 do value; end\n",
      "for value in 1..=4 do value; end\n",
      "for 0..count do 0; end\n",
      "for #Some value in values do value; end\n",
      "for #Some value | #Other value in values do value; end\n",
      "for index, #Some value in values do value; end\n",
      "for #Some[left] in values do left; end\n",
      "for #Some[value] | #Other[value] in values do value; end\n",
      "for #Some(left, right) in values do left; end\n",
      "for #Some#Other value in values do value; end\n",
      "let _ = 0;\n" +
      "for _ in values do\n" +
      "  let _ = 1;\n" +
      "  0;\n" +
      "end\n",
      "let _ = 0;\n" +
      "for [left, right] in values do\n" +
      "  let _ = left;\n" +
      "  right;\n" +
      "end\n",
      "for _, _ in values do\n" +
      "  let _ = 0;\n" +
      "  0;\n" +
      "end\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    const lowered_source = checked_value(lowered);
    assert_equals(lowered_source, parse_source(source));
    if (lowered_source === undefined) {
      throw new Error("Expected a directly lowered loop.");
    }
    assert_equals(all_source_nodes_have_spans(lowered_source), true);
  }

  const indexed_range = checked_value(
    lower_baba_source(parse_duck_source(
      "for #Some[left]..finish do left; end\n",
    )),
  );
  const indexed_range_statement = indexed_range?.statements[0];
  if (indexed_range_statement?.tag !== "for_range") {
    throw new Error("Expected an indexed anonymous range.");
  }
  assert_equals(indexed_range_statement.start.tag, "index");

  const source = "for value in 1..=4 do value; end\n";
  const lowered = checked_value(
    lower_baba_source(parse_duck_source(source)),
  );
  const statement = lowered?.statements[0];
  if (statement?.tag !== "for_range") {
    throw new Error("Expected an inclusive Baba range.");
  }
  assert_equals(source_span(statement), {
    start: 0,
    end: source.trimEnd().length,
  });
  assert_equals(source_span(statement.start), {
    start: source.indexOf("1"),
    end: source.indexOf("1") + 1,
  });
  assert_equals(source_span(statement.step), {
    start: source.indexOf("..=") + "..=".length,
    end: source.indexOf("..=") + "..=".length,
  });
  assert_equals(source_span_origin(statement.step), "derived");
});

Deno.test("every bundled loop example lowers directly", () => {
  for (const path of duck_files("examples/loops")) {
    const source = Deno.readTextFileSync(path);
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(
      diagnostics_of(lowered),
      [],
      "Expected direct loop lowering for " + path,
    );
    const lowered_source = checked_value(lowered);
    assert_equals(lowered_source, parse_source(source));
    if (lowered_source === undefined) {
      throw new Error("Expected a directly lowered loop example.");
    }
    assert_equals(all_source_nodes_have_spans(lowered_source), true);
  }
});

Deno.test("Baba diagnoses invalid loop headers in source order", () => {
  const range = diagnostics_of(
    lower_baba_source(parse_duck_source(
      "for index, [left] in 0..2 do 0; end\n",
    )),
  );
  assert_equals(
    range.map((diagnostic) => diagnostic.message),
    [
      "Range loops do not have item patterns",
      "Range loop index must be an unannotated binding",
    ],
  );
  assert_equals(
    range.map((diagnostic) => diagnostic.span),
    [{ start: 9, end: 10 }, { start: 11, end: 17 }],
  );

  const collection = diagnostics_of(
    lower_baba_source(parse_duck_source(
      "for [index], value in values do 0; end\n",
    )),
  );
  assert_equals(collection.length, 1);
  assert_equals(
    collection[0]?.message,
    "Loop index must be an unannotated binding",
  );
  assert_equals(collection[0]?.span, { start: 4, end: 11 });

  for (
    const [source, message] of [
      [
        "for #Some[left] in 0..2 do 0; end\n",
        "Range loop index must be an unannotated binding",
      ],
      [
        "for #Some[left], value in values do 0; end\n",
        "Loop index must be an unannotated binding",
      ],
    ] as const
  ) {
    const diagnostics = diagnostics_of(
      lower_baba_source(parse_duck_source(source)),
    );
    assert_equals(diagnostics.length, 1);
    assert_equals(diagnostics[0]?.message, message);
  }
});

Deno.test("Baba loop binders shadow outer effect identities", () => {
  const source = "effect E { op: () => I32 }\n" +
    "const e = E;\n" +
    "for e in values do\n" +
    "  e = 0;\n" +
    "  value <- e.op()\n" +
    "end\n" +
    "next <- e.op()\n";
  const lowered = lower_baba_source(parse_duck_source(source));
  assert_equals(diagnostics_of(lowered), []);
  const program = checked_value(lowered);
  const loop = program?.statements[1];
  if (loop?.tag !== "for_collection") {
    throw new Error("Expected a collection loop.");
  }
  assert_equals(loop.body[1]?.tag, "bind");
  assert_equals(program?.statements[2]?.tag, "state_bind");
});

Deno.test("Baba lowering preserves statements outside recovery regions", () => {
  const parsed = parse_duck_source(
    "let broken = ;\n" +
      "let good = 1;\n",
  );
  assert_equals(parsed.diagnostics.length, 1);
  const lowered = lower_baba_source(parsed);
  assert_equals(diagnostics_of(lowered), []);
  const source = checked_value(lowered);
  assert_equals(
    source?.statements.map((statement) => {
      if (statement.tag !== "bind") return statement.tag;
      return statement.name;
    }),
    ["good"],
  );
});

Deno.test("Baba rejects invalid binding and aggregate names", () => {
  for (
    const [source, expected] of [
      ["let camelCase = 1;\n", "Runtime binding must use snake_case"],
      ["{ .camelCase = 1 }\n", "Shape member must use snake_case"],
      ["{ .value = 1, .value = 2 }\n", "Duplicate shape member"],
      ["[.camelCase = 1]\n", "Product label must use snake_case"],
      ["let value = object.camelCase;\n", "Field must use snake_case"],
      [
        "let value = (const ..._) => 1;\n",
        "Variadic parameter requires a binding name",
      ],
      [
        "let value = const ..._ => 1;\n",
        "Variadic parameter requires a binding name",
      ],
    ]
  ) {
    const diagnostics = diagnostics_of(
      lower_baba_source(parse_duck_source(source)),
    );
    const messages = diagnostics.map((diagnostic) => diagnostic.message).join(
      "\n",
    );
    assert_equals(messages.includes(expected), true);
  }
  const field_source = "let value = object.camelCase;\n";
  const field_diagnostic = diagnostics_of(
    lower_baba_source(parse_duck_source(field_source)),
  )[0];
  const field_start = field_source.indexOf("camelCase");
  assert_equals(field_diagnostic?.span, {
    start: field_start,
    end: field_start + "camelCase".length,
  });
});

Deno.test("Baba accumulates binding and aggregate boundary errors", () => {
  for (
    const [source, count] of [
      ["let camelCase: 256u8 = 512u8;\n", 3],
      ["let value = { .camelCase = 256u8, .Other = 512u8 };\n", 4],
      ["let value = [.camelCase = 256u8, .Other = 512u8];\n", 4],
      [
        "let value = (camelCase: 256u8, Other: 512u8) => 1024u8;\n",
        5,
      ],
      ["let value = const ..._ => 256u8;\n", 2],
      ["camelCase = 512u8;\n", 2],
      ["camelCase := 512u8;\n", 2],
      ["camelCase[256u8] = 512u8;\n", 3],
      ["let value = 256u8.camelCase;\n", 2],
    ] as const
  ) {
    const diagnostics = diagnostics_of(
      lower_baba_source(parse_duck_source(source)),
    );
    assert_equals(diagnostics.length, count);
    const starts = diagnostics.map((diagnostic) => diagnostic.span.start);
    assert_equals(starts, [...starts].sort((left, right) => left - right));
  }
});

function all_source_nodes_have_spans(value: object): boolean {
  if (!has_source_span(value)) return false;
  for (const child of Object.values(value)) {
    if (child === null || typeof child !== "object") continue;
    if (Array.isArray(child)) {
      for (const entry of child) {
        if (
          entry !== null && typeof entry === "object" &&
          !all_source_nodes_have_spans(entry)
        ) {
          return false;
        }
      }
      continue;
    }
    if (!all_source_nodes_have_spans(child)) return false;
  }
  return true;
}

function assert_source_spans_equal(actual: object, expected: object): void {
  assert_equals(source_span(actual), source_span(expected));
  const actual_children = Object.values(actual).filter((child) =>
    child !== null && typeof child === "object"
  );
  const expected_children = Object.values(expected).filter((child) =>
    child !== null && typeof child === "object"
  );
  assert_equals(actual_children.length, expected_children.length);
  for (let index = 0; index < actual_children.length; index += 1) {
    const actual_child = actual_children[index];
    const expected_child = expected_children[index];
    if (actual_child === undefined || expected_child === undefined) {
      throw new Error("Expected matching source-span children.");
    }
    if (Array.isArray(actual_child) && Array.isArray(expected_child)) {
      assert_equals(actual_child.length, expected_child.length);
      for (let entry = 0; entry < actual_child.length; entry += 1) {
        const actual_entry = actual_child[entry];
        const expected_entry = expected_child[entry];
        if (
          actual_entry !== null && typeof actual_entry === "object" &&
          expected_entry !== null && typeof expected_entry === "object"
        ) {
          assert_source_spans_equal(actual_entry, expected_entry);
        }
      }
      continue;
    }
    if (!Array.isArray(actual_child) && !Array.isArray(expected_child)) {
      assert_source_spans_equal(actual_child, expected_child);
    }
  }
}

function source_nodes_of_kind(
  node: import("./baba_parser.ts").BabaCstNode | undefined,
  kind: string,
): import("./baba_parser.ts").BabaCstNode[] {
  if (node === undefined) return [];
  const nodes = [];
  if (node.kind === kind) nodes.push(node);
  for (const child of node.children) {
    nodes.push(...source_nodes_of_kind(child, kind));
  }
  return nodes;
}

function duck_files(directory: string): string[] {
  const paths: string[] = [];
  for (const entry of Deno.readDirSync(directory)) {
    const path = directory + "/" + entry.name;
    if (entry.isDirectory) {
      paths.push(...duck_files(path));
    } else if (entry.isFile && path.endsWith(".duck")) {
      paths.push(path);
    }
  }
  return paths;
}
