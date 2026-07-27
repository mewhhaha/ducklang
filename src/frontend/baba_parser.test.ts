import { assert_equals } from "../assert.ts";
import { parse_duck_source } from "./baba_parser.ts";

Deno.test("Baba parser preserves source tokens and CST spans", () => {
  const parsed = parse_duck_source("stored 1;\n");

  assert_equals(parsed.diagnostics, []);
  assert_equals(parsed.tokens, [
    { text: "stored", start: 0, end: 6 },
    { text: "1", start: 7, end: 8 },
    { text: ";", start: 8, end: 9 },
  ]);
  if (!parsed.cst.tree.includes("application_expression")) {
    throw new Error("Baba CST did not contain the application expression");
  }
});
