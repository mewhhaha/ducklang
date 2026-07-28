import { assert_equals } from "../assert.ts";
import { analyze_duck_source, lower_duck_source } from "../semantic_program.ts";
import { lower_baba_type_declaration } from "./baba_declaration_lower.ts";
import { lower_baba_source } from "./baba_lower.ts";
import type { BabaCstNode } from "./baba_parser.ts";
import { parse_duck_source } from "./baba_parser.ts";
import { checked_value, diagnostics_of } from "./checked.ts";
import { parse_source } from "./parser.ts";

Deno.test("Baba lowers type declarations without the handwritten parser", () => {
  for (
    const source of [
      "type Option = | #Some I32 | #None\n",
      "type Choice = | #One I32 :& I64 | #Two I32 :& I64\n",
      "type Narrow = #Value I32 :& I64\n",
      "type Result error value = | #Ok value | #Err error\n",
      "type Pair = [I32, I64]\n",
      "type Row width = (I32; width)\n",
      "type Person = struct { .name = Text, .age = I32 }\n",
      "type Box value = struct { .value = value }\n",
      "type Id = newtype I32\n",
      "type Pair = newtype (I32, I64)\n",
      "type Pair = packed [I32, I64]\n",
      "type Node = | #Branch Node | #Leaf I32\n",
      "type Size = [I32; Size]\n",
      "type Size = (I32; Size)\n",
      "type Size = struct { .values = [I32; Size] }\n",
      "type Intish = I32 :| I64\n",
      'type Token = "Token"\n',
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(source));
  }
});

Deno.test("Baba keeps declarations and runtime statements in source order indexes", () => {
  const source = "type Option = | #Some I32 | #None\n" +
    "let choice = #Some 42;\n" +
    "choice\n";
  const lowered = lower_baba_source(parse_duck_source(source));
  assert_equals(diagnostics_of(lowered), []);
  assert_equals(checked_value(lowered), parse_source(source));
});

Deno.test("bundled type declarations match the legacy declaration oracle", () => {
  let compared = 0;
  let attributed = 0;
  for (const path of duck_files("examples")) {
    const source = Deno.readTextFileSync(path);
    const parsed = parse_duck_source(source);
    for (
      const node of nodes_of_kind(
        parsed.cst.root,
        "type_declaration_statement",
      )
    ) {
      if (
        node.children.some((child) => child.kind === "attribute_group")
      ) {
        attributed += 1;
        const declaration_source = source.slice(node.start, node.end) + "\n";
        const lowered = lower_baba_source(
          parse_duck_source(declaration_source),
        );
        assert_equals(
          diagnostics_of(lowered),
          [],
        );
        assert_equals(checked_value(lowered), parse_source(declaration_source));
        compared += 1;
        continue;
      }
      const declaration_source = source.slice(node.start, node.end) + "\n";
      const declaration_node = nodes_of_kind(
        parse_duck_source(declaration_source).cst.root,
        "type_declaration_statement",
      )[0];
      if (declaration_node === undefined) {
        throw new Error("Expected isolated declaration from " + path);
      }
      const lowered = lower_baba_type_declaration(
        declaration_node,
        declaration_source,
      );
      assert_equals(diagnostics_of(lowered), []);
      assert_equals(
        checked_value(lowered),
        parse_source(declaration_source).declarations?.[0],
      );
      compared += 1;
    }
  }
  assert_equals(compared > 60, true);
  assert_equals(attributed, 2);
});

Deno.test("bundled effect and record declarations match the legacy oracle", () => {
  for (
    const source of [
      "effect Async { suspending wait: () => I32 }\n",
      "effect Owned {\n" +
      "  move: (freeze Text, &Text, U8) => freeze Text\n" +
      "}\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(source));
  }
  let effects = 0;
  let records = 0;
  for (const directory of ["examples", "src/frontend"]) {
    for (const path of duck_files(directory)) {
      const source = Deno.readTextFileSync(path);
      const parsed = parse_duck_source(source);
      for (
        const kind of [
          "declare_effect_statement",
          "effect_statement",
          "declare_record_statement",
        ]
      ) {
        for (const node of nodes_of_kind(parsed.cst.root, kind)) {
          const declaration_source = source.slice(node.start, node.end) + "\n";
          const lowered = lower_baba_source(
            parse_duck_source(declaration_source),
          );
          assert_equals(diagnostics_of(lowered), []);
          assert_equals(
            checked_value(lowered),
            parse_source(declaration_source),
          );
          if (kind === "declare_record_statement") {
            records += 1;
          } else {
            effects += 1;
          }
        }
      }
    }
  }
  assert_equals(effects > 20, true);
  assert_equals(records > 10, true);
});

Deno.test("Baba preserves effect ownership contracts and scalar integer layouts", () => {
  const source = "declare effect Host {\n" +
    "  frozen: (#Text) => #Text\n" +
    "  scalar_alias: (scalar element) => scalar element\n" +
    "  integer: (U8) => U64\n" +
    "}\n";
  const lowered = lower_baba_source(parse_duck_source(source));
  assert_equals(diagnostics_of(lowered), []);
  const declaration = checked_value(lowered)?.declarations?.[0];
  if (declaration?.tag !== "effect") {
    throw new Error("Expected a directly lowered host effect declaration.");
  }
  assert_equals(declaration.operations, [
    {
      name: "frozen",
      type_params: [],
      params: [{
        type_name: "Text",
        ownership: "frozen_shareable",
      }],
      result: {
        type_name: "Text",
        ownership: "frozen_shareable",
      },
    },
    {
      name: "scalar_alias",
      type_params: [],
      params: [{
        type_name: "element",
        ownership: "scalar",
      }],
      result: {
        type_name: "element",
        ownership: "scalar",
      },
    },
    {
      name: "integer",
      type_params: [],
      params: [{
        type_name: "U8",
        ownership: "scalar",
      }],
      result: {
        type_name: "U64",
        ownership: "scalar",
      },
    },
  ]);
});

Deno.test("Baba reports invalid effect ownership combinations", () => {
  for (
    const source of [
      "declare effect Host { op: () => &Text }\n",
      "declare effect Host { op: () => # &Text }\n",
      "declare effect Host { op: (& freeze Text) => Text }\n",
      "declare effect Host { op: (# &Text) => Text }\n",
      "declare effect Host { op: (scalar &Text) => Text }\n",
      "declare effect Host { op: (# (&Text)) => Text }\n",
      "declare effect Host { op: (& (freeze Text)) => Text }\n",
      "declare effect Host { op: () => # (&Text) }\n",
      "declare effect Host { op: () => scalar (&Text) }\n",
      "declare effect Host { op: (freeze (&Text)) => Text }\n",
      "declare effect Host { op: () => freeze (&Text) }\n",
      "declare effect Host { op: (freeze (freeze Text)) => Text }\n",
      "declare effect Host { op: (# &I32) => I32 }\n",
      "declare effect Host { op: () => # &I32 }\n",
      "declare effect Host { op: (& freeze I32) => I32 }\n",
      "declare effect Host { op: (scalar scalar I32) => Unit }\n",
      "declare effect Host { op: (# scalar Text) => Unit }\n",
      "declare effect Host { op: (& scalar Text) => Unit }\n",
      "declare effect Host { op: () => scalar scalar I32 }\n",
      "declare effect Host { op: () => # scalar Text }\n",
      "declare effect Host { op: () => & scalar Text }\n",
      "declare effect Host { op: () => & freeze Text }\n",
      "declare effect Host { op: ((scalar I32)) => Unit }\n",
      "declare effect Host { op: (((scalar I32))) => Unit }\n",
      "declare effect Host { op: () => (scalar I32) }\n",
      "declare effect Host { op: () => ((scalar I32)) }\n",
    ]
  ) {
    const parsed = parse_duck_source(source);
    assert_equals(parsed.diagnostics, []);
    const diagnostics = diagnostics_of(lower_baba_source(parsed));
    assert_equals(
      diagnostics.length > 0,
      true,
      "Expected an ownership diagnostic for " + source,
    );
    assert_equals(
      diagnostics.every((diagnostic) =>
        diagnostic.message.includes("ownership")
      ),
      true,
    );
    const starts = diagnostics.map((diagnostic) => diagnostic.span.start);
    assert_equals(starts, [...starts].sort((left, right) => left - right));
  }
});

Deno.test("effect ownership mismatches stop before Core and ABI lowering", () => {
  for (
    const source of [
      "declare effect Host { op: (scalar Text) => Text }\n",
      "declare effect Host { op: (#I32) => I32 }\n",
      "declare effect Host { op: (&I32) => I32 }\n",
      "declare effect Host { op: () => scalar Text }\n",
      "declare effect Host { op: () => #I32 }\n",
      "declare effect Host { op: () => freeze I32 }\n",
      "declare Foo { value: I32 }\n" +
      "declare effect Host { op: (scalar Foo) => Foo }\n",
      "declare effect Host { op: (scalar [I32; 2]) => Unit }\n",
      "type Rich = Text\n" +
      "declare effect Host { op: (scalar Rich) => Rich }\n",
      "type Small = I32\n" +
      "declare effect Host { op: (#Small) => Small }\n",
      "type Box a = struct { .value = a }\n" +
      "declare effect Host { op: (scalar Box I32) => Unit }\n",
      "type Scalar a = I32\n" +
      "declare effect Host { op: (# Scalar Text) => Unit }\n",
      "type Rich a = Text\n" +
      "declare effect Host { op: (scalar Rich I32) => Unit }\n",
      "type Box a = struct { .value = a }\n" +
      "type IntBox = Box I32\n" +
      "declare effect Host { op: (scalar IntBox) => Unit }\n",
      "type Identity a = a\n" +
      "declare effect Host { op: (# Identity I32) => Unit }\n",
      "type Identity a = a\n" +
      "declare effect Host { op: (scalar Identity Text) => Unit }\n",
      "type Identity a = a\n" +
      "declare effect Host { op: () => # Identity I32 }\n",
      "type Identity a = a\n" +
      "declare effect Host { op: () => scalar Identity Text }\n",
      "type Identity a = a\n" +
      "type Wrapped a = Identity a\n" +
      "declare effect Host { op: (# Wrapped I32) => Unit }\n",
    ]
  ) {
    const parsed = parse_duck_source(source);
    assert_equals(parsed.diagnostics, []);
    const analysis = analyze_duck_source(parsed);
    assert_equals(analysis.diagnostics.length, 1);
    assert_equals(
      analysis.diagnostics[0]?.message.includes("ownership requires"),
      true,
    );
    const lowered = lower_duck_source(analysis);
    assert_equals(checked_value(lowered), undefined);
    assert_equals(diagnostics_of(lowered).length, 1);
  }
});

Deno.test("effect type context keeps the first duplicate declaration", () => {
  const scalar_first = "type Foo = I32\n" +
    "declare effect Host { op: (#Foo) => Unit }\n" +
    "type Foo = Text\n";
  const scalar_diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source(scalar_first)),
  );
  assert_equals(scalar_diagnostics.length, 2);
  assert_equals(
    scalar_diagnostics[0]?.message.includes("heap ownership requires"),
    true,
  );
  assert_equals(
    scalar_diagnostics[1]?.message.includes("Duplicate declaration"),
    true,
  );

  const valid_record_first = "declare Foo { value: I32 }\n" +
    "declare effect Host { op: (Foo) => Unit }\n" +
    "declare Foo { value: I65 }\n";
  const record_diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source(valid_record_first)),
  );
  assert_equals(record_diagnostics.length, 1);
  assert_equals(
    record_diagnostics[0]?.message.includes("Duplicate declaration"),
    true,
  );

  for (
    const rejected_later_declaration of [
      "type Foo = I32\n",
      "declare Foo { value: I65 }\n",
    ]
  ) {
    const effect_first = "effect Foo { op: () => I32 }\n" +
      "declare effect Host { use: (#Foo) => Unit }\n" +
      rejected_later_declaration;
    const effect_first_diagnostics = diagnostics_of(
      lower_baba_source(parse_duck_source(effect_first)),
    );
    assert_equals(effect_first_diagnostics.length, 1);
    assert_equals(
      effect_first_diagnostics[0]?.message.includes("Duplicate declaration"),
      true,
    );
  }
});

Deno.test("Init fields reject definite non-host effects at the source boundary", () => {
  for (
    const source of [
      "declare Init { bad: I32 }\n0\n",
      "effect Local { op: () => I32 }\n" +
      "declare Init { local: Local }\n0\n",
      "type Init = struct { .bad = I32 }\n0\n",
      "effect Local { op: () => I32 }\n" +
      "type Init = struct { .local = Local }\n0\n",
    ]
  ) {
    const parsed = parse_duck_source(source);
    assert_equals(parsed.diagnostics, []);
    const analysis = analyze_duck_source(parsed);
    assert_equals(analysis.diagnostics.length, 1);
    let expected_start = source.indexOf("I32", source.indexOf("Init"));
    if (source.includes("Local")) expected_start = source.lastIndexOf("Local");
    assert_equals(
      analysis.diagnostics[0]?.span.start,
      expected_start,
    );
    assert_equals(checked_value(lower_duck_source(analysis)), undefined);
  }
});

Deno.test("Init field diagnostics remain in source order", () => {
  for (
    const source of [
      "declare Init { badOne: I32, badTwo: I32 }\n",
      "type Init = struct { .badOne = I32, .badTwo = I32 }\n",
    ]
  ) {
    const diagnostics = diagnostics_of(
      lower_baba_source(parse_duck_source(source)),
    );
    assert_equals(diagnostics.length, 4);
    const starts = diagnostics.map((diagnostic) => diagnostic.span.start);
    assert_equals(starts, [...starts].sort((left, right) => left - right));
  }
});

Deno.test("effect ownership checks accumulate with later lowering errors", () => {
  const source = "declare Foo { value: I32 }\n" +
    "declare effect Host { op: (scalar Foo) => Foo }\n" +
    "let x = 256u8;\n";
  const diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source(source)),
  );
  assert_equals(
    diagnostics.map((diagnostic) => diagnostic.span.start),
    [
      source.indexOf("scalar"),
      source.indexOf("256u8"),
    ],
  );
});

Deno.test("effect integer classification is total for oversized widths", () => {
  const alias = "type Huge = I9007199254740992\n";
  const alias_lowered = lower_baba_source(parse_duck_source(alias));
  assert_equals(diagnostics_of(alias_lowered).length, 1);
  assert_equals(checked_value(alias_lowered), undefined);

  const effect = "declare effect Host { op: (I9007199254740992) => Unit }\n";
  const diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source(effect)),
  );
  assert_equals(diagnostics.length, 1);
  assert_equals(
    diagnostics[0]?.message.includes("width is too large"),
    true,
  );
});

Deno.test("ordinary oversized integer annotations remain diagnostics", () => {
  for (
    const source of [
      "let x: I9007199254740992 = 1;\n",
      "type Huge = I9007199254740992\nlet x: Huge = 1;\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics.length > 0, true);
    assert_equals(
      analysis.diagnostics.some((diagnostic) =>
        diagnostic.message.includes("width is too large")
      ),
      true,
    );
  }
});

Deno.test("host effect ABI failures remain source diagnostics", () => {
  for (
    const source of [
      "declare effect Host { op: ([I65; 2]) => Unit }\n",
      "declare Bad { value: I65 }\n" +
      "declare effect Host { op: (Bad) => Unit }\n",
      "declare effect Host { op: ([I32, I32]) => Unit }\n",
      "declare effect Host { op: ((I32, I32)) => Unit }\n",
      "declare effect Host { op: ((I32) -> I32) => Unit }\n",
      "declare effect Host { op: (F32x4) => Unit }\n",
      "declare effect Host { op: (Resume) => Unit }\n",
      "declare effect Host { op: (Type) => Unit }\n",
      "declare effect Host { op: (I32 I32) => Unit }\n",
      "declare effect Host { op: (Text I32) => Unit }\n",
      "declare Foo { value: I32 }\n" +
      "declare effect Host { op: (Foo I32) => Unit }\n",
      "type Box a = struct { .value = a }\n" +
      "declare effect Host { op: (Box) => Unit }\n",
      "declare Node { next: Node }\n" +
      "declare effect Host { op: (Node) => Unit }\n",
      "type Identity a = a\n" +
      "declare effect Host { op: (Identity I65) => Unit }\n",
    ]
  ) {
    const parsed = parse_duck_source(source);
    assert_equals(parsed.diagnostics, []);
    const diagnostics = diagnostics_of(lower_baba_source(parsed));
    assert_equals(
      diagnostics.length > 0,
      true,
      "Expected a host ABI diagnostic for " + source,
    );
  }
  const nested_integer = "declare effect Host { op: ([I65; 2]) => Unit }\n";
  const nested_diagnostic = diagnostics_of(
    lower_baba_source(parse_duck_source(nested_integer)),
  )[0];
  assert_equals(nested_diagnostic?.span.start, nested_integer.indexOf("I65"));

  const recursive = "declare Node { next: Node }\n" +
    "declare effect Host { op: (Node) => Unit }\n";
  const recursive_diagnostic = diagnostics_of(
    lower_baba_source(parse_duck_source(recursive)),
  )[0];
  assert_equals(
    recursive_diagnostic?.span.start,
    recursive.lastIndexOf("Node"),
  );
  assert_equals(recursive_diagnostic?.related?.length, 1);
});

Deno.test("host ABI validates only instantiated generic representations", () => {
  for (
    const source of [
      "type Const a = I32\n" +
      "declare effect Host { op: (Const I65) => Unit }\n",
      "type Phantom a = struct { .value = I32 }\n" +
      "declare effect Host { op: (Phantom I65) => Unit }\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered) !== undefined, true);
  }
});

Deno.test("declared host ABI failures use the later exposure as primary", () => {
  const source = "declare Bad { value: I65 }\n" +
    "let x = 256u8;\n" +
    "declare effect Host { op: (Bad) => Unit }\n";
  const diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source(source)),
  );
  assert_equals(
    diagnostics.map((diagnostic) => diagnostic.span.start),
    [
      source.indexOf("256u8"),
      source.lastIndexOf("Bad"),
    ],
  );
  assert_equals(
    diagnostics[1]?.related?.[0]?.span.start,
    source.indexOf("I65"),
  );
  for (
    const recursive_source of [
      "declare B { next: B }\n" +
      "declare A { b: B }\n" +
      "let x = 256u8;\n" +
      "declare effect Host { op: (A) => Unit }\n",
      "declare A { b: B }\n" +
      "declare B { a: A }\n" +
      "let x = 256u8;\n" +
      "declare effect Host { op: (A) => Unit }\n",
    ]
  ) {
    const recursive_diagnostics = diagnostics_of(
      lower_baba_source(parse_duck_source(recursive_source)),
    );
    assert_equals(
      recursive_diagnostics.map((diagnostic) => diagnostic.span.start),
      [
        recursive_source.indexOf("256u8"),
        recursive_source.lastIndexOf("A"),
      ],
    );
    const related = recursive_diagnostics[1]?.related;
    if (related === undefined) {
      throw new Error("Expected recursive ABI evidence spans.");
    }
    assert_equals(related.length > 0, true);
  }
});

Deno.test("integer-shaped declaration name checks are total", () => {
  for (
    const source of [
      "declare effect I9007199254740992 { op: () => Unit }\n",
      "declare I9007199254740992 { value: I32 }\n",
      "type I9007199254740992 = I32\n",
    ]
  ) {
    const diagnostics = diagnostics_of(
      lower_baba_source(parse_duck_source(source)),
    );
    assert_equals(diagnostics.length, 1);
    assert_equals(
      diagnostics[0]?.message.includes("conflicts with builtin type"),
      true,
    );
  }
});

Deno.test("Baba diagnoses duplicate host and Duck effect operations", () => {
  for (
    const source of [
      "declare effect Host { op: () => I32, op: () => I32 }\n",
      "effect State { op: () => I32, op: () => I32 }\n",
    ]
  ) {
    const diagnostics = diagnostics_of(
      lower_baba_source(parse_duck_source(source)),
    );
    assert_equals(diagnostics.length, 1);
    assert_equals(
      diagnostics[0]?.message.includes("Duplicate effect operation"),
      true,
    );
    assert_equals(diagnostics[0]?.related?.length, 1);
    assert_equals(
      diagnostics[0]?.related?.[0]?.span.start,
      source.indexOf("op:"),
    );
  }
});

Deno.test("Baba rejects invalid type declaration names and duplicates", () => {
  for (
    const [source, expected] of [
      ["type I32 = I32\n", "conflicts with builtin type"],
      ["type Box Value = Value\n", "must use snake_case"],
      ["type Box value value = value\n", "Duplicate type parameter"],
      ["type Choice = | #One | #One\n", "Duplicate sum case"],
      ["type Choice = | #One I32\n", "Single-case sums omit the leading"],
      ["type Choice = #One | #Two\n", "Multiple-case sums require a leading"],
      [
        "type Pair = (I32, I64)\n",
        "Product types use `[...]`",
      ],
      ["type Empty = ()\n", "Product types use `[...]`"],
      [
        "type Function = (I32, I64) -> I32\n",
        "Product types use `[...]`",
      ],
      ["type Function = () -> I32\n", "Product types use `[...]`"],
      [
        "type Pair = struct { .value = I32, .value = I64 }\n",
        "Duplicate product member",
      ],
      ["type A = I32\ntype A = I64\n", "Duplicate declaration name"],
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
});

Deno.test("Baba accumulates independent declaration member errors", () => {
  for (
    const source of [
      "type Box Value = 256u8\n",
      "type Pair = [256u8, 512u8]\n",
      "type Choice = | #First 256u8 | #Second 512u8\n",
      "type Shape = struct { .first = 256u8, .second = 512u8 }\n",
    ]
  ) {
    const diagnostics = diagnostics_of(
      lower_baba_source(parse_duck_source(source)),
    );
    assert_equals(
      diagnostics.length,
      2,
      "Expected two independent diagnostics for " + source,
    );
    const starts = diagnostics.map((diagnostic) => diagnostic.span.start);
    assert_equals(starts, [...starts].sort((left, right) => left - right));
  }
});

Deno.test("Baba validates effect and record declaration boundaries", () => {
  for (
    const [source, count] of [
      [
        "declare I32 {\n" +
        "  camelCase: I32\n" +
        "  camelCase: I64\n" +
        "}\n",
        4,
      ],
      [
        "effect State Value Value {\n" +
        "  camelCase: forall Other Other.(256u8) => &Text\n" +
        "}\n",
        9,
      ],
      [
        "declare effect Host {\n" +
        "  op: forall value.() => value\n" +
        "}\n",
        1,
      ],
      [
        "type Thing = I32\n" +
        "declare Thing {}\n",
        1,
      ],
    ] as const
  ) {
    const parsed = parse_duck_source(source);
    assert_equals(parsed.diagnostics, []);
    const diagnostics = diagnostics_of(lower_baba_source(parsed));
    assert_equals(diagnostics.length, count);
    const starts = diagnostics.map((diagnostic) => diagnostic.span.start);
    assert_equals(starts, [...starts].sort((left, right) => left - right));
  }
});

Deno.test("Baba keeps duplicate declaration diagnostics in source order", () => {
  for (
    const [source, expected_starts, duplicate_index, first_name_span] of [
      [
        "declare A { badName: I32 }\n" +
        "declare A { otherBad: I64 }\n",
        [12, 35, 39],
        1,
        { start: 8, end: 9 },
      ],
      [
        "@[512u8]\ntype First = I32\n" +
        "@[1024u8]\ntype First = I64\n",
        [2, 28, 41],
        2,
        { start: 14, end: 19 },
      ],
    ] as const
  ) {
    const diagnostics = diagnostics_of(
      lower_baba_source(parse_duck_source(source)),
    );
    assert_equals(
      diagnostics.map((diagnostic) => diagnostic.span.start),
      expected_starts,
    );
    assert_equals(
      diagnostics[duplicate_index]?.related?.[0]?.span,
      first_name_span,
    );
  }
});

Deno.test("Baba keeps host forall diagnostics in source order", () => {
  const source = "declare effect Host { op: forall bad bad.() => I32 }\n";
  const diagnostics = diagnostics_of(
    lower_baba_source(parse_duck_source(source)),
  );
  assert_equals(diagnostics.length, 2);
  assert_equals(
    diagnostics.map((diagnostic) => diagnostic.span.start),
    [
      source.indexOf("forall"),
      source.lastIndexOf("bad"),
    ],
  );
});

Deno.test("Baba rejects reserved names in declaration binders", () => {
  for (
    const [source, expected_starts] of [
      ["type Box class = class\n", [9]],
      [
        "effect State class { class: forall inherits.(class) => class }\n",
        [13, 21, 35],
      ],
    ] as const
  ) {
    const diagnostics = diagnostics_of(
      lower_baba_source(parse_duck_source(source)),
    );
    assert_equals(
      diagnostics.map((diagnostic) => diagnostic.span.start),
      expected_starts,
    );
    assert_equals(
      diagnostics.every((diagnostic) =>
        diagnostic.message.includes("reserved for unsupported")
      ),
      true,
    );
  }
});

function nodes_of_kind(
  node: BabaCstNode | undefined,
  kind: string,
): BabaCstNode[] {
  if (node === undefined) return [];
  const nodes: BabaCstNode[] = [];
  if (node.kind === kind) nodes.push(node);
  for (const child of node.children) {
    nodes.push(...nodes_of_kind(child, kind));
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
