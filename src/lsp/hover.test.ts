import { assert_equals, assert_includes } from "../assert.ts";
import { build_binding_index } from "../frontend/binding_index.ts";
import { parse_source_with_diagnostics } from "../frontend/parser.ts";
import { hover, signature_help } from "./hover.ts";

function analyzed(text: string) {
  const parsed = parse_source_with_diagnostics(text);
  return { parsed, index: build_binding_index(parsed, 1) };
}

Deno.test("hover shows folded const closure captures", () => {
  const text = "const make_adder = n => {\n  x => x + n\n}\n\n" +
    "const add_three = comptime make_adder(3)\n\n" +
    "let value = add_three(29)\n";
  const { parsed, index } = analyzed(text);
  const result = hover(
    parsed.source,
    parsed.syntax,
    index,
    text.lastIndexOf("add_three"),
    "utf-16",
  );

  assert_equals(result, {
    contents: {
      kind: "markdown",
      value: "**const closure** `add_three`\n\n" +
        "```ix\n(x) => x + n\n```\n\n" +
        "captures:\n- `n = 3`\n\n" +
        "latent effects: `<pure>`\n\n" +
        "ownership: `compile_time_static`",
    },
    range: {
      start: { line: 6, character: 12 },
      end: { line: 6, character: 21 },
    },
  });
});

Deno.test("hover names linear consume status and points", () => {
  const unused = "let !token = 1\n42\n";
  const unused_analysis = analyzed(unused);
  const unused_hover = hover(
    unused_analysis.parsed.source,
    unused_analysis.parsed.syntax,
    unused_analysis.index,
    unused.indexOf("token"),
    "utf-16",
  );

  if (unused_hover === undefined) {
    throw new Error("Missing unused linear hover");
  }

  assert_includes(
    unused_hover.contents.value,
    "consume status: not yet consumed",
  );

  const consumed = "let !token = 1\n!token\n";
  const consumed_analysis = analyzed(consumed);
  const consumed_hover = hover(
    consumed_analysis.parsed.source,
    consumed_analysis.parsed.syntax,
    consumed_analysis.index,
    consumed.indexOf("token"),
    "utf-16",
  );

  if (consumed_hover === undefined) {
    throw new Error("Missing consumed linear hover");
  }

  assert_includes(
    consumed_hover.contents.value,
    "consume point: line 2, column 2",
  );
});

Deno.test("hover shows declaration docs and complete layout facts", () => {
  const text = "// Point documentation.\n" +
    "type Point = [.x = I32, .wide = I64]\n";
  const { parsed, index } = analyzed(text);
  const result = hover(
    parsed.source,
    parsed.syntax,
    index,
    text.lastIndexOf("Point"),
    "utf-16",
  );

  if (result === undefined) {
    throw new Error("Missing type hover");
  }

  assert_equals(
    result.contents.value,
    "**type** `Point`\n\n" +
      "Point documentation.\n\n" +
      "```ix\ntype Point = [.x = I32, .wide = I64]\n```\n\n" +
      "layout — size: `16`, align: `8`, field offsets: `x @ 0`, `wide @ 8`",
  );
});

Deno.test("hover shows inferred latent effect rows", () => {
  const text = "effect Counter { get: () => I32 }\n" +
    "let run: () -> <Counter> I32 = () => {\n" +
    "  value <- Counter.get()\n  value\n}\n";
  const { parsed, index } = analyzed(text);
  const result = hover(
    parsed.source,
    parsed.syntax,
    index,
    text.indexOf("run"),
    "utf-16",
  );

  if (result === undefined) {
    throw new Error("Missing effectful closure hover");
  }

  assert_includes(result.contents.value, "latent effects: `<Counter.get>`");
});

Deno.test("hover exposes frozen, scratch, and borrow provenance", () => {
  const text = 'let frozen = freeze "value"\n' +
    "let temporary = scratch { 1 }\n" +
    "let view = &frozen\n";
  const { parsed, index } = analyzed(text);

  for (
    const expected of [
      { name: "frozen", ownership: "frozen_shareable" },
      { name: "temporary", ownership: "scratch_backed" },
      { name: "view", ownership: "borrow_view" },
    ]
  ) {
    const result = hover(
      parsed.source,
      parsed.syntax,
      index,
      text.indexOf(expected.name),
      "utf-16",
    );

    if (result === undefined) {
      throw new Error("Missing wrapper hover for " + expected.name);
    }

    assert_includes(result.contents.value, expected.ownership);
  }
});

Deno.test("signature help tracks const parameters in an incomplete call", () => {
  const text = "// Apply a const callback.\n" +
    "let apply_const = (x, const f) => f(x)\n" +
    "const double = x => x * 2\n" +
    "apply_const(21, ";
  const { parsed, index } = analyzed(text);
  assert_equals(
    signature_help(parsed.source, parsed.syntax, index, text.length),
    {
      signatures: [{
        label: "apply_const(x, const f) <pure>",
        parameters: [{ label: "x" }, { label: "const f" }],
        activeParameter: 1,
        documentation: {
          kind: "markdown",
          value: "Apply a const callback.",
        },
      }],
      activeSignature: 0,
      activeParameter: 1,
    },
  );
});

Deno.test("signature help follows nested calls and effect operations", () => {
  const text = "// Read documentation.\n" +
    "declare effect Io { read: (Text, I32) => I32 }\n" +
    "let wrap = (value, count) => value\n" +
    'wrap(1, Io.read("x", ';
  const { parsed, index } = analyzed(text);
  assert_equals(
    signature_help(parsed.source, parsed.syntax, index, text.length),
    {
      signatures: [{
        label: "Io.read(Text, I32) => I32",
        parameters: [{ label: "Text" }, { label: "I32" }],
        activeParameter: 1,
        documentation: {
          kind: "markdown",
          value: "Read documentation.",
        },
      }],
      activeSignature: 0,
      activeParameter: 1,
    },
  );
});
