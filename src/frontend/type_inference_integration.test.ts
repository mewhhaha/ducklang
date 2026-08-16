import { assert_equals } from "../assert.ts";
import { Source } from "../frontend.ts";
import { source_facts } from "./source_facts.ts";

Deno.test("source analysis applies exact inferred call constraints to facts", () => {
  const analysis = Source.analyze(`
type X = struct { .x = I32 }
let choose = (value: X) => value;
choose [.y = 1]
`);
  const facts = source_facts(analysis.source);
  const call = facts.expressions.find((expression) => expression.tag === "app");

  if (call === undefined) {
    throw new Error("Missing analyzed call expression");
  }

  assert_equals(
    analysis.diagnostics.map((diagnostic) => {
      return { code: diagnostic.code, message: diagnostic.message };
    }),
    [{
      code: "DUCK2307",
      message:
        "Call to choose argument 1 for parameter value expects X, got struct",
    }],
  );
  assert_equals(facts.editor_type_of.get(call)?.name, "unknown");
});

Deno.test("source analysis reports unresolved explicit annotation variables", () => {
  const unresolved = Source.analyze("let value: missing = 1;");

  assert_equals(
    unresolved.diagnostics.map((diagnostic) => {
      return { code: diagnostic.code, message: diagnostic.message };
    }),
    [{
      code: "DUCK2311",
      message:
        "binding value: unresolved inference variables ?0(missing) in ?0(missing)",
    }],
  );

  const generic = Source.analyze(`
let identity = value => value;
identity(true)
identity(1)
`);

  assert_equals(generic.diagnostics, []);
});
