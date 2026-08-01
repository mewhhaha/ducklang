import { assert_equals } from "../assert.ts";
import { Source } from "../frontend.ts";
import type { SourceDiagnostic } from "./semantic_diagnostic.ts";

function linear_diagnostics(text: string): SourceDiagnostic[] {
  return Source.analyze(text).diagnostics.filter((diagnostic) => {
    return diagnostic.code.startsWith("DUCK22");
  });
}

Deno.test("linear scalar ownership example remains valid", async () => {
  const text = await Deno.readTextFile(
    "examples/ownership_modules/01_linear_scalar.duck",
  );

  assert_equals(Source.analyze(text).diagnostics, []);
});

Deno.test("linear consumption without rebinding reports the consumed expression", () => {
  const diagnostics = linear_diagnostics("let !x = 1;\n!x\n42");

  assert_equals(diagnostics, [{
    code: "DUCK2203",
    severity: "error",
    message: "Linear value x is consumed but not rebound",
    span: { start: 12, end: 14 },
    related: [{
      message: "First consumed here",
      span: { start: 12, end: 14 },
    }, {
      message: "Linear value declared here",
      span: { start: 0, end: 11 },
    }],
  }]);
});

Deno.test("linear branch mismatch reports the complete conditional", () => {
  const diagnostics = linear_diagnostics(
    "let main = (!x, flag) => if flag then !x else 0 end;\nmain(1, 1)",
  );

  assert_equals(diagnostics, [{
    code: "DUCK2205",
    severity: "error",
    message: "Linear branches must consume the same values",
    span: { start: 25, end: 51 },
    related: [{
      message: "First consumed here",
      span: { start: 38, end: 40 },
    }, {
      message: "Linear value declared here",
      span: { start: 12, end: 14 },
    }],
  }]);
});

Deno.test("linear fallthrough mismatch reports the branch statement", () => {
  const diagnostics = linear_diagnostics(
    "let bad = (!x) => do\n  if true then\n    !x\n  end\n  x\nend;\nbad(41)",
  );

  assert_equals(diagnostics, [{
    code: "DUCK2205",
    severity: "error",
    message: "Linear loop if fallthrough changes carried values",
    span: { start: 23, end: 48 },
    related: [{
      message: "First consumed here",
      span: { start: 40, end: 42 },
    }, {
      message: "Linear value declared here",
      span: { start: 11, end: 13 },
    }],
  }]);
});

Deno.test("linear closure reuse reports both calls and its declaration", () => {
  const diagnostics = linear_diagnostics(
    "let !x = 1;\nlet take = () => !x + 1;\nx = take()\nx = take()\nx",
  );

  assert_equals(diagnostics, [{
    code: "DUCK2206",
    severity: "error",
    message: "Linear closure take was already consumed",
    span: { start: 52, end: 58 },
    related: [{
      message: "Linear closure first consumed here",
      span: { start: 41, end: 47 },
    }, {
      message: "Linear closure declared here",
      span: { start: 12, end: 36 },
    }],
  }]);
});

Deno.test("static conditions select linear closures for Bool and I32 literals", () => {
  const static_linear_closures = [
    `let main = (!x) => do
  let consume = if true then () => !x  else  () => 0 end;
  consume()
end;
main(1)`,
    `let main = (!x) => do
  let consume = if false then () => 0  else  () => !x end;
  consume()
end;
main(1)`,
    `let main = (!x) => do
  let consume = if true then () => !x  else  () => 0 end;
  consume()
end;
main(1)`,
    `let main = (!x) => do
  let consume = if false then () => 0  else  () => !x end;
  consume()
end;
main(1)`,
  ];

  for (const source of static_linear_closures) {
    assert_equals(linear_diagnostics(source), []);
  }
});

Deno.test("linear diagnostics retain spans through synthesized closure branches", () => {
  const diagnostics = linear_diagnostics(
    `let main = (!x, flag) => do
  let f = if flag then
    () => !x
   else
    () => 0
  end;
  f()
end;
main(1, 1)`,
  );

  assert_equals(diagnostics, [{
    code: "DUCK2205",
    severity: "error",
    message: "Linear branches must consume the same values",
    span: { start: 38, end: 89 },
    related: [{
      message: "First consumed here",
      span: { start: 61, end: 63 },
    }, {
      message: "Linear value declared here",
      span: { start: 12, end: 14 },
    }],
  }]);
});

Deno.test("linear loop state mismatch reports the loop and moved declaration", () => {
  const diagnostics = linear_diagnostics(
    "let main = (!x) => do\n  for i in 0..2 do\n    let !y = !x;\n  end\n  !x\nend;\nmain(1)",
  );

  assert_equals(diagnostics, [{
    code: "DUCK2205",
    severity: "error",
    message: "Linear loop fallthrough changes carried values",
    span: { start: 24, end: 63 },
    related: [{
      message: "First consumed here",
      span: { start: 54, end: 56 },
    }, {
      message: "Linear value declared here",
      span: { start: 12, end: 14 },
    }],
  }]);
});

Deno.test("linear case loop arms validate terminal and fallthrough paths", () => {
  const valid = linear_diagnostics(`
let main = (!x, flag) => do
  for i in 0..2 do
    case flag of
      1 => do x = !x + 1; break; end,
      _ => do x = !x + 1 end;
  end
  x
end;
main(40, 1)
`);

  assert_equals(valid, []);

  const invalid = linear_diagnostics(`
let main = (!x, flag) => do
  for i in 0..2 do
    case flag of
      1 => do !x; break; end,
      _ => do x = !x + 1 end;
  end
  x
end;
main(40, 1)
`);

  assert_equals(invalid.map((diagnostic) => diagnostic.message), [
    "Linear value x is consumed but not rebound",
  ]);
});

Deno.test("linear rebind without consumption reports the assignment", () => {
  const diagnostics = linear_diagnostics("let !x = 1;\nx = 2\n!x");

  assert_equals(diagnostics, [{
    code: "DUCK2207",
    severity: "error",
    message: "Linear value x was rebound without being consumed",
    span: { start: 12, end: 17 },
    related: [{
      message: "Linear value declared here",
      span: { start: 0, end: 11 },
    }],
  }]);
});

Deno.test("implicit linear use reports the exact variable reference", () => {
  const diagnostics = linear_diagnostics("let !x = 1;\nx + 1");

  assert_equals(diagnostics, [{
    code: "DUCK2204",
    severity: "error",
    message: "Linear value x used without explicit consumption",
    span: { start: 12, end: 13 },
    related: [{
      message: "Linear value declared here",
      span: { start: 0, end: 11 },
    }],
  }]);
});

Deno.test("recursive linear closure validation reports the recursive call", () => {
  const diagnostics = linear_diagnostics(
    `let main = (!x) => do
  let recurse = () => recurse();
  recurse()
  !x
end;
main(1)`,
  );

  assert_equals(diagnostics, [{
    code: "DUCK2290",
    severity: "error",
    message: "Cannot validate recursive linear closure call yet: recurse",
    span: { start: 44, end: 53 },
  }]);
});

Deno.test("record patterns preserve linear validation", () => {
  const diagnostics = linear_diagnostics(
    "let !x = 1;\nlet { .a, .b } = pair;\n!x",
  );

  assert_equals(diagnostics, []);
});
