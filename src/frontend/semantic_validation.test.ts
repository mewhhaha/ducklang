import { assert_equals } from "../assert.ts";
import { source_with_expanded_attributes } from "./attribute_expand.ts";
import { parse_source } from "./parser.ts";
import {
  ducklang_attributes_prelude_text,
  ducklang_effects_prelude_text,
  ducklang_functional_prelude_text,
  ducklang_prelude_text,
  ducklang_runtime_prelude_text,
  ducklang_testing_prelude_text,
} from "./prelude.ts";
import { validate_frontend_semantics } from "./semantic_validation.ts";

const failures = [
  {
    name: "03_illegal_type_change",
    diagnostic: {
      code: "DUCK2301",
      severity: "error",
      message: "Assignment changes type for value",
      span: { start: 16, end: 35 },
    },
  },
  {
    name: "04_mixed_integer_widths",
    diagnostic: {
      code: "DUCK2302",
      severity: "error",
      message: "Mixed i32 and i64 operands for operator +",
      span: { start: 0, end: 12 },
    },
  },
  {
    name: "05_invalid_condition_type",
    diagnostic: {
      code: "DUCK2303",
      severity: "error",
      message: "If condition expects Bool, got Text",
      span: { start: 3, end: 8 },
    },
  },
  {
    name: "06_missing_struct_field",
    diagnostic: {
      code: "DUCK2304",
      severity: "error",
      message: "Missing struct field: age",
      span: { start: 121, end: 129 },
    },
  },
  {
    name: "07_invalid_union_payload",
    diagnostic: {
      code: "DUCK2305",
      severity: "error",
      message: "Union case Ok expects Int, got Text",
      span: { start: 49, end: 62 },
    },
  },
];

for (const failure of failures) {
  Deno.test("semantic validation reports " + failure.name, async () => {
    const text = await Deno.readTextFile(
      "examples/failures/compile/" + failure.name + ".duck",
    );

    assert_equals(validate_frontend_semantics(parse_source(text)), [
      failure.diagnostic,
    ]);
  });
}

Deno.test("semantic validation maps fail calls to their call span", () => {
  assert_equals(
    validate_frontend_semantics(parse_source('comptime @fail("bad")')),
    [{
      code: "DUCK2102",
      severity: "error",
      message: "@fail: bad",
      span: { start: 9, end: 21 },
    }],
  );
});

Deno.test("semantic validation ignores valid route-independent expressions", () => {
  assert_equals(
    validate_frontend_semantics(
      parse_source("let value = 40i64 + 2i64;\nvalue"),
    ),
    [],
  );
});

Deno.test("semantic validation keeps nested width errors structured and singular", () => {
  assert_equals(
    validate_frontend_semantics(
      parse_source("let value = (1i32 + 2i64) + 3i64;\nvalue"),
    ),
    [{
      code: "DUCK2302",
      severity: "error",
      message: "Mixed i32 and i64 operands for operator +",
      span: { start: 13, end: 24 },
    }],
  );
});

Deno.test("semantic validation does not re-infer an invalid indexed branch", () => {
  const source = parse_source(
    "let pair=[.a=true,.b=1];\nif true then pair[input] else 0 end",
  );

  assert_equals(validate_frontend_semantics(source), [{
    code: "DUCK2304",
    severity: "error",
    message: "Mixed Bool and numeric indexed values",
    span: { start: 38, end: 49 },
  }]);
});

Deno.test("semantic validation reuses constness checks with source spans", () => {
  const source = parse_source(
    "let runtime = 1;\nconst invalid = runtime;\ninvalid",
  );
  assert_equals(validate_frontend_semantics(source), [{
    code: "DUCK2101",
    severity: "error",
    message: "Const binding captures runtime value: runtime",
    span: { start: 33, end: 40 },
  }]);
});

Deno.test("semantic validation reports non-exhaustive cases", () => {
  const source = parse_source("case 1 of 1 => 10;\n");

  assert_equals(validate_frontend_semantics(source), [{
    code: "DUCK2314",
    severity: "error",
    message: "Non-exhaustive case requires a wildcard or binding arm",
    span: { start: 0, end: 17 },
  }]);
});

Deno.test("semantic validation defers case coverage without a target type", () => {
  const source = parse_source(
    "let inspect = value => case value of #Present payload => payload;\n",
  );

  assert_equals(validate_frontend_semantics(source), []);
});

Deno.test("semantic validation recognizes exact atom case coverage", () => {
  const source = parse_source(`
let unit = case () of () => 1;
let atom = case #ready of #ready => 2;
unit + atom
`);

  assert_equals(validate_frontend_semantics(source), []);
});

Deno.test("semantic validation checks case guards and arm bodies", () => {
  const source = parse_source(
    'case true of value if 1 => if "bad" then 1 else 0 end;\n',
  );

  assert_equals(
    validate_frontend_semantics(source).map((diagnostic) => diagnostic.message),
    [
      "Case guard expects Bool, got I32",
      "If condition expects Bool, got Text",
      "Non-exhaustive case requires a wildcard or binding arm",
    ],
  );
});

Deno.test("semantic validation preserves compile-time locals in generated functions", () => {
  const source = parse_source(`
const cast = (value, const target) => @cast(value, target);
const build = (const target) => do
  let captured = target;
  let generated = value => cast(value, captured);
  generated
end;
build(I32)
`);

  assert_equals(validate_frontend_semantics(source), []);
});

Deno.test("semantic validation accepts every bundled source prelude", () => {
  for (
    const text of [
      ducklang_prelude_text,
      ducklang_attributes_prelude_text,
      ducklang_functional_prelude_text,
      ducklang_effects_prelude_text,
      ducklang_runtime_prelude_text,
      ducklang_testing_prelude_text,
    ]
  ) {
    const source = source_with_expanded_attributes(parse_source(text));
    assert_equals(validate_frontend_semantics(source), []);
  }
});

Deno.test("semantic validation reports basic binding annotations", () => {
  const source = parse_source("let value: Text = 1;\nvalue");
  assert_equals(validate_frontend_semantics(source), [{
    code: "DUCK2306",
    severity: "error",
    message: "Binding annotation expects Text, got I32",
    span: { start: 18, end: 19 },
  }]);
});

Deno.test("semantic validation reports mismatched literal singleton annotations", () => {
  const source = parse_source(`
type One = 1
const integer: One = 2;
const boolean: true = false;
const text: "GET" = "POST";
integer
`);
  const diagnostics = validate_frontend_semantics(source);

  assert_equals(diagnostics.map((diagnostic) => diagnostic.message), [
    "Binding annotation expects One, got 2",
    "Binding annotation expects true, got false",
    'Binding annotation expects "GET", got "POST"',
  ]);
});

Deno.test("semantic validation scopes gpufuck representation errors", () => {
  const integer_source = parse_source("let value: Int = 1i64;\nvalue");
  assert_equals(
    validate_frontend_semantics(integer_source, {
      scope: "gpufuck-representation",
    }),
    [],
  );

  const bool_source = parse_source("let value: Bool = 1;\nvalue");
  assert_equals(
    validate_frontend_semantics(bool_source, {
      scope: "gpufuck-representation",
    }),
    [{
      code: "DUCK2306",
      severity: "error",
      message: "Binding annotation expects Bool, got I32",
      span: { start: 18, end: 19 },
    }],
  );
});

Deno.test("semantic validation optionally reports unused binding warnings", () => {
  const source = parse_source("let value = 1;\n42");
  assert_equals(validate_frontend_semantics(source), []);
  assert_equals(validate_frontend_semantics(source, { warnings: true }), [{
    code: "DUCK2003",
    severity: "warning",
    message: "Unused runtime binding value",
    span: { start: 0, end: 14 },
  }]);
});

Deno.test("semantic warning liveness traverses compile-time value case patterns", () => {
  const source = parse_source(`
const expected = 1;
let choose = value => case value of
  #(expected) => value,
  _ => 0;
choose(1)
`);

  assert_equals(validate_frontend_semantics(source, { warnings: true }), []);
});

Deno.test("semantic validation warns when prelude intrinsics escape", () => {
  const source = parse_source('@len("duck")');
  assert_equals(validate_frontend_semantics(source, { warnings: true }), [{
    code: "DUCK2004",
    severity: "warning",
    message:
      "Raw intrinsic @len is reserved for prelude and compiler-facing source",
    span: { start: 0, end: 4 },
  }]);
  assert_equals(
    validate_frontend_semantics(source, {
      warnings: true,
      allow_intrinsics: true,
    }),
    [],
  );
});

Deno.test("panic is the bottom type of its branch", () => {
  const source = parse_source(`
let value: I32 = if true then 42 else @panic "unreachable" end;
value
`);

  assert_equals(validate_frontend_semantics(source), []);
});

Deno.test("semantic validation counts cast operands as binding uses", () => {
  const source = parse_source("let value = 1;\nvalue as I32");
  assert_equals(validate_frontend_semantics(source, { warnings: true }), []);
});

Deno.test("semantic validation counts shorthand shape members as binding uses", () => {
  const source = parse_source(
    "let shape = 1;\n" +
      "let new = 2;\n" +
      "let namespace = { .shape, .new };\n" +
      "namespace",
  );

  assert_equals(
    validate_frontend_semantics(source, { warnings: true }),
    [],
  );
});

Deno.test("semantic validation scopes lambda binders and const parameters", () => {
  const source = parse_source(
    'let flag = "outer";\n' +
      "let constant = (const x) => comptime x + 1;\n" +
      "let condition = flag => if flag then 1 else 0 end;\n" +
      "constant(41) + condition(true)",
  );
  assert_equals(validate_frontend_semantics(source), []);
});

Deno.test("semantic validation requires explicit Text to Bytes conversion", () => {
  const source = parse_source('let value: Bytes = "abc";\nlen(value)');
  assert_equals(validate_frontend_semantics(source), [{
    code: "DUCK2306",
    severity: "error",
    message: "Binding annotation expects Bytes, got Text",
    span: { start: 19, end: 24 },
  }]);
});

Deno.test("semantic validation distinguishes Bytes.empty from Text", () => {
  const bytes = parse_source("let value: Bytes = Bytes.empty;\nlen(value)");
  assert_equals(validate_frontend_semantics(bytes), []);

  const text = parse_source("let value: Text = Bytes.empty;\nlen(value)");
  const diagnostics = validate_frontend_semantics(text);
  assert_equals(diagnostics.length, 1);
  assert_equals(
    diagnostics[0]?.message,
    "Binding annotation expects Text, got Bytes",
  );
});

Deno.test("semantic validation reports one const capture cause", () => {
  const source = parse_source(
    "let runtime = 1;\nconst invalid = comptime comptime runtime;\ninvalid",
  );
  const diagnostics = validate_frontend_semantics(source);
  assert_equals(diagnostics.length, 1);
  assert_equals(diagnostics[0]?.code, "DUCK2101");
});

Deno.test("value packs remain transient when bound to a local name", () => {
  const accepted = parse_source(`
let swap = (left, right) => (right, left);
let (first, second) = swap(1, 2);
[first, second]
`);
  assert_equals(validate_frontend_semantics(accepted), []);

  const block_return = parse_source(`
let swap = (left, right) => do
  (right, left)
end;
let (first, second) = swap(1, 2);
[first, second]
`);
  assert_equals(validate_frontend_semantics(block_return), []);

  const stored = parse_source("let pair = (1, 2);\npair");
  assert_equals(validate_frontend_semantics(stored), []);
});

Deno.test("template consumers type-check chunks and interpolations", () => {
  const accepted = parse_source(`
let choose: (["value: ", ""], [I32]) -> I32 =
  (strings, values) => values[0];
choose \`value: {42}\`
`);
  assert_equals(validate_frontend_semantics(accepted), []);

  const invalid_value = parse_source(`
let choose: ([Text, Text], [Bool]) -> Bool =
  (strings, values) => values[0];
choose \`value: {42}\`
`);
  const value_diagnostics = validate_frontend_semantics(invalid_value);

  assert_equals(value_diagnostics.length, 1);
  assert_equals(
    value_diagnostics[0]?.message,
    "Call to choose argument 2 for parameter values expects [Bool], got [I32]",
  );

  const invalid_chunks = parse_source(`
let choose: (["amount: ", ""], [I32]) -> I32 =
  (strings, values) => values[0];
choose \`value: {42}\`
`);
  const chunk_diagnostics = validate_frontend_semantics(invalid_chunks);

  assert_equals(chunk_diagnostics.length, 1);
  assert_equals(
    chunk_diagnostics[0]?.message,
    'Call to choose argument 1 for parameter strings expects ["amount: ", ""], got ["value: ", ""]',
  );
});

Deno.test("calls distinguish transient packs from stored products", () => {
  const pack_call = parse_source(
    "let choose = (left, right) => left;\nchoose([1, 2])",
  );
  assert_equals(
    validate_frontend_semantics(pack_call).map((diagnostic) =>
      diagnostic.message
    ),
    ["Call requires a transient pack `(a, b)`, as in `f (a, b)`"],
  );

  const tuple_call = parse_source(
    "let choose = [left, right] => left;\nchoose(1, 2)",
  );
  assert_equals(
    validate_frontend_semantics(tuple_call).map((diagnostic) =>
      diagnostic.message
    ),
    ["Call requires a stored product `[a, b]`, as in `f [a, b]`"],
  );
});

Deno.test("semantic validation accepts declared iterator state structs", () => {
  const source = parse_source(`
type Counter = struct { .next_value = I32, .end = I32 }

extend Counter {
  type Item = I32,
  .has_next = counter => counter.next_value < counter.end,
  .next = counter => do
    let next = [
      .next_value = counter.next_value + 1,
      .end = counter.end,
    ];
    [counter.next_value, next]
  end,
}

let counter: Counter = [.next_value = 0, .end = 3];
let total = 0;
for value in counter do
  total = total + value
end
total
`);

  assert_equals(validate_frontend_semantics(source), []);
});

Deno.test("iterator evidence does not leak to a structural lookalike", () => {
  const source = parse_source(`
type Counter = struct { .next_value = I32, .done = Bool }
type Lookalike = struct { .next_value = I32, .done = Bool }

extend Counter {
  type Item = I32,
  .has_next = counter => true,
  .next = counter => [0, counter],
}

let value: Lookalike = [.next_value = 0, .done = false];
for member in value do member end
0
`);

  assert_equals(
    validate_frontend_semantics(source).map((diagnostic) => diagnostic.message),
    ["Mixed Bool and numeric indexed values"],
  );
});

Deno.test("semantic warning liveness traverses handlers and type tests", async () => {
  for (
    const path of [
      "examples/handlers/01_local_counter.duck",
      "examples/compile_time/10_extensions_and_protocols.duck",
      "examples/data/14_type_sets.duck",
    ]
  ) {
    const source = parse_source(await Deno.readTextFile(path));
    const diagnostics = validate_frontend_semantics(source, {
      warnings: true,
    });
    assert_equals(diagnostics, []);
  }
});
