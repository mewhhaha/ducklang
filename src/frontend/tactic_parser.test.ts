import { assert_equals } from "../assert.ts";
import { parse_duck_source } from "./baba_parser.ts";

Deno.test("tactic keywords reject identifier continuations", () => {
  for (
    const body of [
      "constructorassumptionassumption",
      "leftexact evidence",
      "rightexact evidence",
      "exacttrue_intro",
      "applyevidence",
      "casesevidence",
      "rewriteequality",
      "decidedecide",
      "simpsimp",
      "omegaomega",
      "introintro",
    ]
  ) {
    const parsed = parse_duck_source(
      "type prove = (evidence: Proof True) -> Proof True or True\n" +
        `let prove = evidence => by { ${body} };\n` +
        "42\n",
    );

    assert_equals(parsed.diagnostics.length > 0, true);
  }
});
