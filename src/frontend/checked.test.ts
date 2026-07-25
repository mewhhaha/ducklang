import { assert_equals } from "../assert.ts";
import { all, diagnostics_of, fail, ok, ok_unit } from "./checked.ts";
import type { SourceDiagnostic } from "./semantic_diagnostic.ts";

function diagnostic(code: "DUCK2301" | "DUCK2302"): SourceDiagnostic {
  return {
    code,
    severity: "error",
    message: code + " message",
    span: { start: 0, end: 1 },
  };
}

Deno.test("checked reports nothing when every check passes", () => {
  assert_equals(diagnostics_of(all([ok_unit(), ok(1), ok("value")])), []);
});

Deno.test("checked accumulates independent failures", () => {
  const result = all([
    fail(diagnostic("DUCK2301")),
    ok_unit(),
    fail(diagnostic("DUCK2302")),
  ]);

  assert_equals(diagnostics_of(result).map((entry) => entry.code), [
    "DUCK2301",
    "DUCK2302",
  ]);
});

Deno.test("checked keeps every diagnostic from one failing check", () => {
  const result = all([fail(diagnostic("DUCK2301"), diagnostic("DUCK2302"))]);

  assert_equals(diagnostics_of(result).map((entry) => entry.code), [
    "DUCK2301",
    "DUCK2302",
  ]);
});
