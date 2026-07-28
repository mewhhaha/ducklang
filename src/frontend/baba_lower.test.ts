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
    if (!expression_source.startsWith("let value = do\n")) {
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
      "let f = const value => value;\n",
      "let f = !value => value;\n",
      "let f = value: I32 => value;\n",
      "let value = -1u8;\n",
      "let value = -1u64;\n",
      "let value = -(1u8);\n",
      "let value = -((1u64));\n",
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
      "let value: Bool = 1;\n",
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
