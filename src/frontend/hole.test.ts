import { assert_equals, assert_includes } from "../assert.ts";
import { parse_source_with_diagnostics } from "./parser.ts";
import { format_source } from "./format.ts";

function diagnostics(text: string): string[] {
  return parse_source_with_diagnostics(text).diagnostics.map((entry) =>
    entry.message
  );
}

Deno.test("a hole lifts its application into a lambda", () => {
  const parsed = parse_source_with_diagnostics(
    "let add = (a: I32, b: I32) => a + b;\nlet inc = add(1, _);\ninc 41\n",
  );

  assert_equals(parsed.diagnostics, []);

  const inc = parsed.source.statements.find((statement) =>
    statement.tag === "bind" && statement.name === "inc"
  );

  if (inc === undefined || inc.tag !== "bind" || inc.value === undefined) {
    throw new Error("Missing inc binding");
  }

  assert_equals(inc.value.tag, "lam");
});

Deno.test("several holes bind left to right", () => {
  const parsed = parse_source_with_diagnostics(
    "let add = (a: I32, b: I32) => a + b;\nlet both = add(_, _);\nboth(1, 41)\n",
  );

  assert_equals(parsed.diagnostics, []);

  const both = parsed.source.statements.find((statement) =>
    statement.tag === "bind" && statement.name === "both"
  );

  if (both === undefined || both.tag !== "bind" || both.value === undefined) {
    throw new Error("Missing both binding");
  }

  if (both.value.tag !== "lam") {
    throw new Error("Expected a lambda, got " + both.value.tag);
  }

  assert_equals(both.value.params.length, 2);
});

Deno.test("a hole inside a nested call is rejected", () => {
  const messages = diagnostics(
    "let add = (a: I32, b: I32) => a + b;\nlet bad = add(add(1, _), _);\nbad(1, 2)\n",
  );

  assert_equals(messages.length > 0, true);
  const message = messages[0];
  if (message === undefined) {
    throw new Error("Missing nested hole diagnostic");
  }
  assert_includes(message, "hole cannot appear inside a nested call");
});

Deno.test("nested aggregate and postfix holes are rejected", () => {
  for (
    const text of [
      "let bad = outer({ .value = inner _ }, _);\n",
      "let bad = outer(inner _.field, _);\n",
      "let bad = outer({ .value = _ });\n",
    ]
  ) {
    const messages = diagnostics(text);
    assert_equals(messages.length, 1);
    const message = messages[0];
    if (message === undefined) {
      throw new Error("Missing nested aggregate hole diagnostic");
    }
    assert_includes(message, "hole cannot appear inside a nested call");
  }
});

Deno.test("a hole survives a format round trip", () => {
  const text =
    "let add = (a: I32, b: I32) => a + b;\nlet inc = add(1, _);\ninc 41\n";
  const once = format_source(parse_source_with_diagnostics(text).source);
  const twice = format_source(parse_source_with_diagnostics(once).source);

  assert_includes(once, "_");
  assert_equals(twice, once);
});
