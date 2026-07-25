import { Applicative, Invalid, Validation } from "@mewhhaha/typeclasses";
import type { SourceDiagnostic } from "./semantic_diagnostic.ts";

// Semantic checks return their own verdict instead of pushing into a shared
// array. `Validation` accumulates independent failures, so a statement reports
// every problem it found rather than only the first.
//
// Accumulation is orthogonal to cascade suppression: a check that cannot
// determine a type still returns `ok_unit()` and lets the poisoned value
// silence derived checks, which keeps one root cause reported once.
export const Diagnostics = Validation.with_semigroup<
  readonly SourceDiagnostic[]
>({
  concat: (left, right) => [...left, ...right],
});

export type Checked<value> = ReturnType<typeof Diagnostics.Valid<value>>;

export function ok<value>(value: value): Checked<value> {
  return Diagnostics.Valid(value);
}

export function ok_unit(): Checked<null> {
  return Diagnostics.Valid(null);
}

export function fail(...diagnostics: SourceDiagnostic[]): Checked<never> {
  return Diagnostics.Invalid(diagnostics);
}

/** Run every check, keeping all diagnostics rather than stopping at the first. */
export function all(checks: Checked<unknown>[]): Checked<null> {
  let result: Checked<null> = ok_unit();

  for (const check of checks) {
    result = Applicative.lift(
      (_carried: null, _next: unknown) => null,
      result,
      check,
    );
  }

  return result;
}

/** Boundary helper: collapse a verdict back into the diagnostic list callers expect. */
export function diagnostics_of(check: Checked<unknown>): SourceDiagnostic[] {
  const value = check.value();

  if (Invalid.is(value)) {
    return [...value[1]];
  }

  return [];
}
