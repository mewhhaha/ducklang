import { assert_equals } from "../assert.ts";
import type { FrontExpr } from "./ast.ts";
import { parse_duck_source } from "./baba_parser.ts";
import { lower_baba_source } from "./baba_lower.ts";
import { checked_value, diagnostics_of } from "./checked.ts";
import { parse_source } from "./parser.ts";
import { source_span } from "./syntax.ts";

Deno.test("Baba lowers canonical prelude operators with legacy semantics", () => {
  for (
    const source of [
      "let value = input |> transform;\n",
      'let value = "a" <> "b";\n',
      "let value = record <& { .x = 1 };\n",
      "let value = 3 &&& 1;\n",
      "let value = 42 :> Meter;\n",
      "let value = wrapped :< I32;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(source));
  }
});

Deno.test("Baba lowers source fixities independent of declaration order", () => {
  for (
    const source of [
      "infixl 60 +++ = Add.add\n" +
      "let value = 1 +++ 2 +++ 3;\n",
      "prefix 80 ^^ = Invert.invert\n" +
      "let value = ^^ false;\n",
      "let value = 1 %% 2 %% 3;\n" +
      "infixr 10 %% = combine\n",
      "infixl 10 %% = combine\n" +
      "infixl 10 %% = combine\n" +
      "let value = 1 %% 2;\n",
      "prefix 10 ^^ = wrap\n" +
      "let value = 1 + ^^ 2 + 3;\n",
      "prefix 70 ^^ = wrap\n" +
      "let value = ^^ 2 * 3;\n",
      "prefix 71 ^^ = wrap\n" +
      "let value = ^^ 2 * 3;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(source));
  }
});

Deno.test("Baba custom prefix and infix precedence matches the parity oracle", () => {
  const prefix_precedences = [0, 10, 59, 60, 61, 70, 71, 100];
  const infix_precedences = [10, 60, 70];
  const expressions = [
    "^^ 1 %% 2",
    "1 %% ^^ 2 %% 3",
    "^^ ^^ 1 %% 2",
    "1 + ^^ 2 * 3 + 4",
    "(^^ 1) + 2",
  ];
  for (const prefix_precedence of prefix_precedences) {
    for (const infix_precedence of infix_precedences) {
      for (const expression of expressions) {
        const source = "prefix " + prefix_precedence.toString() +
          " ^^ = wrap\n" +
          "infixl " + infix_precedence.toString() + " %% = combine\n" +
          "let value = " + expression + ";\n";
        const lowered = lower_baba_source(parse_duck_source(source));
        assert_equals(diagnostics_of(lowered), []);
        assert_equals(checked_value(lowered), parse_source(source));
      }
    }
  }
});

Deno.test("Baba reconciles custom fixities with type-operator precedence", () => {
  for (
    const source of [
      "infixl 20 +++ = convert\n" +
      "let value = 1 +++ 2 is I32;\n",
      "infixl 90 +++ = convert\n" +
      "let value = 1 +++ 2 as I32;\n",
      "prefix 81 ^^ = convert\n" +
      "let value = ^^ 1 as I32;\n",
      "prefix 90 ^^ = convert\n" +
      "let value = ^^ 1 as I32;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(source));
  }
});

Deno.test("Baba diagnoses chained type operators instead of changing their meaning", () => {
  for (
    const source of [
      "let value = 1 as I32 as I64;\n",
      "let value = 1 is I32 is Bool;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(
      diagnostics_of(lowered).map((diagnostic) => diagnostic.message),
      ["Chained type operators require parentheses."],
    );
  }
});

Deno.test("Baba source declarations override canonical operator targets", () => {
  for (
    const source of [
      "infixr 5 + = combine\n" +
      "let value = 1 + 2 + 3;\n",
      "prefix 80 ! = invert\n" +
      "let flag = 1;\n" +
      "let value = !flag;\n",
      "prefix 80 ! = @syntax.negate\n" +
      "let flag = 1;\n" +
      "let value = !flag;\n",
      "prefix 80 ! = @syntax.not\n" +
      "let flag = 1;\n" +
      "let value = !flag;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(source));
  }
});

Deno.test("Baba preserves prefix scope through conditions and built-in unary layers", () => {
  for (
    const source of [
      "prefix 15 ^^ = wrap\n" +
      "if ^^ 1 + 2 then true else false end\n",
      "infixr 20 $$ = combine\n" +
      "prefix 15 ^^ = wrap\n" +
      "if 1 $$ ^^ 2 + 3 then true else false end\n",
      "prefix 10 ^^ = wrap\n" +
      "let value = - ^^ 1 + 2;\n",
      "prefix 10 ^^ = wrap\n" +
      "let value = & ^^ 1 + 2;\n",
      "prefix 10 ^^ = wrap\n" +
      "let value = freeze ^^ 1 + 2;\n",
      "prefix 10 ^^ = wrap\n" +
      "let value = comptime ^^ 1 + 2;\n",
      "prefix 70 ^^ = wrap\n" +
      "let value = perform ^^ 1 + 2;\n",
      "prefix 10 ! = wrap\n" +
      "let input = 1;\n" +
      "let value = !input + 2;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(source));
  }
});

Deno.test("Baba expands dynamic prefix spans to include their semantic operands", () => {
  const source = "infixr 20 $$ = combine\n" +
    "prefix 10 ^^ = wrap\n" +
    "let value = 1 $$ ^^ 2 + 3;\n";
  const lowered = checked_value(
    lower_baba_source(parse_duck_source(source)),
  );
  if (lowered === undefined) {
    throw new Error("Expected dynamic prefix source to lower.");
  }
  const statement = lowered.statements[0];
  if (
    statement?.tag !== "bind" || statement.value.tag !== "app" ||
    statement.value.args?.[1]?.tag !== "app"
  ) {
    throw new Error("Expected a nested prefix application.");
  }
  assert_equals(source_span(statement.value.args[1]), {
    start: source.lastIndexOf("^^"),
    end: source.indexOf("3") + 1,
  });
});

Deno.test("Baba prefix spans follow regrouped type operands", () => {
  for (const precedence of [10, 90]) {
    const source = "prefix " + precedence.toString() + " ^^ = convert\n" +
      "let value = ^^ 1 as I32;\n";
    const lowered = checked_value(
      lower_baba_source(parse_duck_source(source)),
    );
    if (lowered === undefined) {
      throw new Error("Expected prefix and type operator source to lower.");
    }
    const statement = lowered.statements[0];
    if (statement?.tag !== "bind") {
      throw new Error("Expected a prefix and type operator binding.");
    }
    let prefix: FrontExpr;
    if (
      statement.value.tag === "as" &&
      statement.value.value.tag === "app"
    ) {
      prefix = statement.value.value;
    } else if (statement.value.tag === "app") {
      prefix = statement.value;
    } else {
      throw new Error("Expected a regrouped prefix application.");
    }
    let end = source.indexOf(" as I32");
    if (precedence === 10) end = source.indexOf(";");
    assert_equals(source_span(prefix), {
      start: source.lastIndexOf("^^"),
      end,
    });
  }
});

Deno.test("Baba keeps newline-separated prefix expressions as separate statements", () => {
  for (
    const body of [
      "1\n+++ 2\n",
      "1\n+++ 2 + 3\n",
      "1\n+++ 2\n+++ 3\n",
    ]
  ) {
    const source = "prefix 80 +++ = wrap\n" + body;
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(source));
  }
});

Deno.test("Baba preserves fixity attributes and their declaration span", () => {
  const source = "@[test, example(1)]\n" +
    "infixl 60 +++ = combine\n" +
    "let value = 1 +++ 2;\n";
  const lowered = checked_value(
    lower_baba_source(parse_duck_source(source)),
  );
  if (lowered === undefined) {
    throw new Error("Expected attributed fixity source to lower.");
  }
  assert_equals(lowered, parse_source(source));
  const declaration = lowered.declarations?.[0];
  if (declaration === undefined) {
    throw new Error("Expected an attributed fixity declaration.");
  }
  assert_equals(source_span(declaration), {
    start: 0,
    end: source.indexOf("\nlet value"),
  });
});

Deno.test("Baba classifies operator calls through effect-instance aliases", () => {
  const prefix = "declare effect Input {\n" +
    "  combine: (I32, I32) => I32\n" +
    "}\n" +
    "const input = Input;\n";
  for (
    const body of [
      "infixl 60 +++ = input.combine\n" +
      "result <- 1 +++ 2\n",
      "infixl 10 +++ = input.combine\n" +
      "result <- 1 +++ 2 * 3\n",
      "infixl 90 +++ = input.combine\n" +
      "result <- 1 * 2 +++ 3\n",
      "infixl 90 +++ = input.combine\n" +
      "result <- 1 +++ 2 + 3 +++ 4\n",
    ]
  ) {
    const source = prefix + body + "result\n";
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(source));
  }
});

Deno.test("Baba keeps unsigned-negation diagnostics through binary reduction", () => {
  for (
    const source of [
      "let value = -1u8 + 2u8;\n",
      "prefix 80 ^^ = @syntax.negate\n" +
      "let value = ^^ 1u8 + 2u8;\n",
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(
      diagnostics_of(lowered).map((diagnostic) => diagnostic.message),
      ["Unsigned U8 literal cannot be negated."],
    );
  }
});

Deno.test("Baba diagnoses invalid and conflicting fixity declarations", () => {
  const invalid_precedence = diagnostics_of(lower_baba_source(
    parse_duck_source(
      "infixl 101 %% = combine\n" +
        "let value = 1 %% 2;\n",
    ),
  ));
  assert_equals(
    invalid_precedence.map((diagnostic) => diagnostic.message),
    ["Fixity precedence must be an integer from 0 to 100, got 101"],
  );
  for (const precedence of ["0x10", "60.5"]) {
    const invalid_spelling = diagnostics_of(lower_baba_source(
      parse_duck_source(
        "prefix " + precedence + " ^^ = wrap\n" +
          "let value = ^^ 1;\n",
      ),
    ));
    assert_equals(
      invalid_spelling.map((diagnostic) => diagnostic.message),
      ["Fixity precedence must be an integer from 0 to 100"],
    );
  }

  const duplicate = diagnostics_of(lower_baba_source(parse_duck_source(
    "infixl 10 %% = left\n" +
      "infixr 20 %% = right\n",
  )));
  assert_equals(duplicate.length, 1);
  assert_equals(
    duplicate[0]?.message,
    "Duplicate infix operator declaration: %%",
  );
  assert_equals(duplicate[0]?.related, [{
    message: "First operator declaration is here.",
    span: { start: 10, end: 12 },
  }]);

  const malformed = diagnostics_of(lower_baba_source(parse_duck_source(
    "infixl 60 +++ =\n",
  )));
  assert_equals(
    malformed.map((diagnostic) => diagnostic.message),
    ["Malformed fixity declaration."],
  );

  for (
    const source of [
      "infixl 60 +++ = @syntax.unknown\nlet value = 1 +++ 2;\n",
      "infixl 60 +++ = @syntax.not\nlet value = 1 +++ 2;\n",
      "prefix 80 ^^ = @syntax.add\nlet value = ^^ 1 + 2;\n",
      "prefix 80 ^^ = @syntax.unknown\nlet value = ^^ 1 + 2;\n",
    ]
  ) {
    const diagnostics = diagnostics_of(
      lower_baba_source(parse_duck_source(source)),
    );
    assert_equals(diagnostics.length, 1);
    assert_equals(
      diagnostics[0]?.message.startsWith("Invalid "),
      true,
    );
  }
});

Deno.test("Baba diagnoses undeclared and conflicting infix operators", () => {
  const undeclared = diagnostics_of(lower_baba_source(parse_duck_source(
    "let value = 1 ?? 2;\n",
  )));
  assert_equals(
    undeclared.map((diagnostic) => diagnostic.message),
    ["Undeclared infix operator: ??"],
  );

  const conflicting = diagnostics_of(lower_baba_source(parse_duck_source(
    "infixl 10 %% = left\n" +
      "infixr 10 @@ = right\n" +
      "let value = 1 %% 2 @@ 3;\n",
  )));
  assert_equals(
    conflicting.map((diagnostic) => diagnostic.message),
    ["Conflicting associativity at precedence 10: %% and @@"],
  );
});

Deno.test("Baba rejects invalid unary operator recovery without recursion", () => {
  for (
    const source of [
      "+ 1\n",
      "* 1\n",
      "&& 1\n",
      "|> 1\n",
      "??? 1\n",
      "prefix 20 ^^ = wrap\n" +
      "infixl 40 +++ = combine\n" +
      "+++ 1\n",
      "prefix 20 ^^ = wrap\n" +
      "infixl 40 +++ = combine\n" +
      "^^ +++ 1\n",
      "prefix 20 ^^ = wrap\n" +
      "infixl 40 +++ = combine\n" +
      "1 +++ +++ 2\n",
    ]
  ) {
    const diagnostics = diagnostics_of(
      lower_baba_source(parse_duck_source(source)),
    );
    assert_equals(diagnostics.length > 0, true);
  }
});
