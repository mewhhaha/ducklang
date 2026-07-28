import { assert_equals } from "../assert.ts";
import { parse_duck_source } from "./baba_parser.ts";
import { checked_value, diagnostics_of } from "./checked.ts";
import { lower_baba_source } from "./baba_lower.ts";
import { parse_source } from "./parser.ts";

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
    "choice\n";
  const aggregate_lowered = lower_baba_source(
    parse_duck_source(aggregate_source),
  );
  assert_equals(diagnostics_of(aggregate_lowered), []);
  assert_equals(
    checked_value(aggregate_lowered),
    parse_source(aggregate_source),
  );
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
