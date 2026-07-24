import { elaborate_front_let_else } from "./let_else.ts";
import { parse_source } from "./parser.ts";
import { source_facts } from "./source_facts.ts";

Deno.test("let-else elaboration preserves an unchanged source and its facts", () => {
  const source = parse_source("let value = 40;\nvalue + 2\n");
  const facts = source_facts(source);
  const elaborated = elaborate_front_let_else(source);

  if (elaborated !== source) {
    throw new Error("Let-else elaboration replaced an unchanged source");
  }

  if (source_facts(elaborated) !== facts) {
    throw new Error("Let-else elaboration discarded reusable source facts");
  }
});
