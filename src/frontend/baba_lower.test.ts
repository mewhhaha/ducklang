import { assert_equals } from "../assert.ts";
import { parse_duck_source } from "./baba_parser.ts";
import { checked_value, diagnostics_of } from "./checked.ts";
import { lower_baba_source } from "./baba_lower.ts";
import { parse_source } from "./parser.ts";
import { has_source_span, source_span } from "./syntax.ts";

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
      !expression_source.includes("object.field.other") &&
      !expression_source.includes("Io.read") &&
      !expression_source.includes("{ .io =") &&
      !expression_source.includes("[.length =")
    ) {
      assert_source_spans_equal(source, legacy);
    }
  }
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
      "let values = [1, ...other];\n",
      "let value = -1u8;\n",
      "let value = -1u64;\n",
      "let value = -(1u8);\n",
      "let value = -((1u64));\n",
      "let f = !_ => 1;\n",
      "if let #Some value = option then\n" +
      "  value\n" +
      "end;\n",
      "if value then\n" +
      "  0\n" +
      "else let #Some item = option then\n" +
      "  item\n" +
      "end;\n",
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

Deno.test("Baba lowering reports unsupported accepted syntax", () => {
  const lowered = lower_baba_source(parse_duck_source(
    "for value in 0..2 do\n" +
      "  value;\n" +
      "end\n",
  ));
  const diagnostics = diagnostics_of(lowered);
  assert_equals(diagnostics.length, 1);
  assert_equals(
    diagnostics[0]?.message,
    "Baba semantic lowering does not support for_statement.",
  );
});

Deno.test("Baba lowering never erases unsupported binding semantics", () => {
  for (
    const source of [
      "let !value = 1;\n",
      "let rec identity = value => value;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered).length, 1);
    assert_equals(checked_value(lowered), undefined);
  }
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
