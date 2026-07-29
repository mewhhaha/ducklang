import { assert_equals, assert_throws } from "../assert.ts";
import { build_binding_index } from "./binding_index.ts";
import {
  parse_baba_source,
  parse_baba_source_with_diagnostics,
} from "./source_parse.ts";
import { source_tokens } from "./tokenize.ts";

Deno.test("Baba source parsing exposes tokens, syntax, and stable node identities", () => {
  const text = 'const path = import "./dep.duck"; // dependency\npath\n';
  const first = parse_baba_source_with_diagnostics(text);
  const second = parse_baba_source_with_diagnostics(text);

  assert_equals(first.diagnostics, []);
  assert_equals(first.baba.cst.root?.id, second.baba.cst.root?.id);
  assert_equals(
    source_tokens(first.syntax, { comments: true }).map((token) => ({
      kind: token.kind,
      text: token.text,
      span: token.span,
    })),
    [
      { kind: "name", text: "const", span: { start: 0, end: 5 } },
      { kind: "name", text: "path", span: { start: 6, end: 10 } },
      { kind: "symbol", text: "=", span: { start: 11, end: 12 } },
      { kind: "name", text: "import", span: { start: 13, end: 19 } },
      {
        kind: "string",
        text: "./dep.duck",
        span: { start: 20, end: 32 },
      },
      { kind: "newline", text: "\n", span: { start: 32, end: 33 } },
      {
        kind: "comment",
        text: "// dependency",
        span: { start: 34, end: 47 },
      },
      { kind: "newline", text: "\n", span: { start: 47, end: 48 } },
      { kind: "name", text: "path", span: { start: 48, end: 52 } },
      { kind: "newline", text: "\n", span: { start: 52, end: 53 } },
      { kind: "eof", text: "", span: { start: 53, end: 53 } },
    ],
  );
});

Deno.test("Baba source recovery preserves unaffected names and exact spans", () => {
  const text = "let broken = ;\nlet good = 1;\ngood\n";
  const parsed = parse_baba_source_with_diagnostics(text);
  const index = build_binding_index(parsed);

  assert_equals(parsed.diagnostics, [{
    message: "Baba parser rejected MISSING",
    span: { start: 13, end: 13 },
  }]);
  assert_equals(
    [...index.occurrences.values()].map((occurrence) => ({
      name: occurrence.name,
      role: occurrence.role,
      span: occurrence.span,
    })),
    [{
      name: "good",
      role: "definition",
      span: { start: 19, end: 23 },
    }, {
      name: "good",
      role: "reference",
      span: { start: 29, end: 33 },
    }],
  );
});

Deno.test("strict Baba source parsing rejects semantic lowering errors", () => {
  assert_throws(
    () => parse_baba_source("let Bad = 1;\n"),
    "Parameter must use snake_case: Bad",
  );
});

Deno.test("Baba source parsing reports raw string newlines without throwing", () => {
  for (const newline of ["\n", "\r"]) {
    const parsed = parse_baba_source_with_diagnostics(
      'let value = "first' + newline + 'second";\n',
    );
    assert_equals(parsed.diagnostics.length > 0, true);
  }
});
