import { assert_equals } from "../assert.ts";
import { Source } from "../frontend.ts";

Deno.test("Source.analyze follows transitive imports and reports the root edge", () => {
  const sources = new Map<string, string>([
    [
      "file:///dep.ix",
      'import hidden from "./missing.ix"\nconst selected = 1\nselected',
    ],
  ]);
  const analysis = Source.analyze(
    'import selected from "./dep.ix"\nselected',
    {
      uri: "file:///main.ix",
      resolve_import: (uri) => sources.get(uri),
    },
  );

  assert_equals(analysis.diagnostics, [{
    code: "IX2502",
    severity: "error",
    message: "Import dependency does not exist: ./missing.ix",
    span: { start: 0, end: 31 },
    uri: "file:///main.ix",
  }]);
});

Deno.test("Source.analyze diagnoses import cycles without recursion", () => {
  const sources = new Map<string, string>([
    [
      "file:///dep.ix",
      'import selected from "./main.ix"\nconst selected = 1\nselected',
    ],
    [
      "file:///main.ix",
      'import selected from "./dep.ix"\nselected',
    ],
  ]);
  const text = sources.get("file:///main.ix");

  if (text === undefined) {
    throw new Error("Missing main source fixture");
  }

  const analysis = Source.analyze(text, {
    uri: "file:///main.ix",
    resolve_import: (uri) => sources.get(uri),
  });
  const diagnostic = analysis.diagnostics[0];

  if (diagnostic === undefined) {
    throw new Error("Missing circular import diagnostic");
  }

  assert_equals(diagnostic.code, "IX2504");
  assert_equals(diagnostic.span, { start: 0, end: 31 });
});

Deno.test("Source.analyze diagnoses malformed import URLs", () => {
  const analysis = Source.analyze('import item from "http://["', {
    uri: "file:///main.ix",
    resolve_import: () => undefined,
  });

  assert_equals(analysis.diagnostics, [{
    code: "IX2505",
    severity: "error",
    message: "Invalid import URI: http://[",
    span: { start: 0, end: 27 },
    uri: "file:///main.ix",
  }]);
});
