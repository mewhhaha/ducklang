import { Applicative } from "@mewhhaha/typeclasses";
import { diagnostic_codes, diagnostic_sequence } from "../diagnostic.ts";
import type { Source } from "./ast.ts";
import { type Checked, diagnostics_of, fail, ok } from "./checked.ts";
import { source_diagnostic } from "./semantic_diagnostic.ts";

export function validate_resolved_array_spreads(
  source: Source,
): Checked<null> {
  const seen = new WeakSet<object>();
  let validation: Checked<null> = ok(null);

  const visit = (current: object): void => {
    if (seen.has(current)) return;
    seen.add(current);

    const expression = current as {
      tag?: unknown;
      rest?: unknown;
    };
    if (
      expression.tag === "array" && expression.rest !== null &&
      typeof expression.rest === "object"
    ) {
      validation = Applicative.lift(
        (_current: null, _spread: null) => null,
        validation,
        fail(source_diagnostic(
          diagnostic_codes.aggregate_spread_unresolved,
          "Array spread must resolve to a fixed product at compile time",
          expression.rest,
        )),
      );
    }

    for (const child of Object.values(current)) {
      if (child === null || typeof child !== "object") continue;
      if (Array.isArray(child)) {
        for (const entry of child) {
          if (entry !== null && typeof entry === "object") visit(entry);
        }
        continue;
      }
      visit(child);
    }
  };

  visit(source);
  const diagnostics = diagnostic_sequence(diagnostics_of(validation));
  if (diagnostics.length > 0) return fail(...diagnostics);
  return ok(null);
}
