import { assert_equals, assert_throws } from "./assert.ts";
import { analyze_duck_source, lower_duck_source } from "./semantic_program.ts";
import { parse_duck_source } from "./frontend/baba_parser.ts";
import { checked_value, diagnostics_of } from "./frontend/checked.ts";
import { check_certificate } from "./frontend/proof_kernel.ts";

Deno.test("semantic program stages preserve Baba input and stable symbols", () => {
  const parsed = parse_duck_source("let value = 1;\n");
  const analysis = analyze_duck_source(parsed);
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.symbols.has("value"), true);
  const lowered = lower_duck_source(analysis);
  assert_equals(diagnostics_of(lowered), []);
  const inspected = lowered.map((program) => {
    assert_equals(program.core.tag, "program");
    return null;
  });
  assert_equals(diagnostics_of(inspected), []);
});

Deno.test("successful analysis exposes stable typed control flow", () => {
  const source = "let result = if true then 1 else 2 end;\nresult\n";
  const first = analyze_duck_source(parse_duck_source(source));
  const second = analyze_duck_source(parse_duck_source(source));
  assert_equals(first.diagnostics, []);
  const control_flow = first.control_flow;
  if (control_flow === undefined) {
    throw new Error("Expected successful analysis to expose control flow.");
  }
  assert_equals(second.control_flow, control_flow);
  assert_equals(control_flow.blocks.length, 4);
  const joined = control_flow.blocks[3];
  assert_equals(joined?.nodes[0]?.operation.tag, "phi");
  const result = first.symbols.get("result")?.[0];
  if (result === undefined) throw new Error("Expected result identity.");
  assert_equals(joined?.nodes[1]?.outputs, [result]);
  assert_equals(
    control_flow.values.find((value) => value.value === result)?.type,
    { tag: "scalar", name: "I32" },
  );
  assert_equals(
    control_flow.blocks.flatMap((block) => block.nodes).every((node) =>
      node.span.start >= 0 && node.span.end <= source.length
    ),
    true,
  );
  assert_equals(
    checked_value(lower_duck_source(first))?.core,
    checked_value(lower_duck_source(second))?.core,
  );
});

Deno.test("named callable control flow uses the binding identity", () => {
  const source = "let identity = (value: I32) => value;\nidentity\n";
  const first = analyze_duck_source(parse_duck_source(source));
  const second = analyze_duck_source(parse_duck_source(source));
  assert_equals(first.diagnostics, []);
  const identity = first.symbols.get("identity")?.[0];
  const parameter = first.symbols.get("value")?.[0];
  if (identity === undefined || parameter === undefined) {
    throw new Error("Expected identity and parameter semantic identities.");
  }
  const callable = first.callable_control_flow.get(identity);
  if (callable === undefined) {
    throw new Error("Expected identity callable control flow.");
  }
  assert_equals(callable.callable, identity);
  assert_equals(callable.parameters, [parameter]);
  assert_equals(callable.captures, []);
  assert_equals(callable.recursive_self, undefined);
  assert_equals(callable.recursive_group, []);
  assert_equals(Object.isFrozen(callable), true);
  assert_equals(Object.isFrozen(callable.parameters), true);
  assert_equals(Object.isFrozen(callable.captures), true);
  assert_equals(Object.isFrozen(callable.recursive_group), true);
  assert_equals(callable.control_flow.parameters, [parameter]);
  assert_equals(callable.control_flow.blocks[0]?.terminator, {
    tag: "return",
    value: parameter,
  });
  assert_equals(
    first.control_flow?.blocks.flatMap((block) => block.nodes).some((node) =>
      node.operation.tag === "construct" &&
      node.operation.constructor === "lam" &&
      node.outputs[0] === identity
    ),
    true,
  );
  assert_equals(
    [...second.callable_control_flow],
    [...first.callable_control_flow],
  );
});

Deno.test("nested callable control flow records lexical captures", () => {
  const source = "let outer = (base: I32) => do\n" +
    "  let inner = (value: I32) => base + value;\n" +
    "  inner\n" +
    "end;\n" +
    "outer\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const outer = analysis.symbols.get("outer")?.[0];
  const inner = analysis.symbols.get("inner")?.[0];
  const base = analysis.symbols.get("base")?.[0];
  const value = analysis.symbols.get("value")?.[0];
  if (
    outer === undefined || inner === undefined || base === undefined ||
    value === undefined
  ) {
    throw new Error("Expected nested callable semantic identities.");
  }
  const outer_flow = analysis.callable_control_flow.get(outer);
  const inner_flow = analysis.callable_control_flow.get(inner);
  if (outer_flow === undefined || inner_flow === undefined) {
    throw new Error("Expected both nested callable graphs.");
  }
  assert_equals(outer_flow.parameters, [base]);
  assert_equals(outer_flow.captures, []);
  assert_equals(outer_flow.recursive_group, []);
  assert_equals(inner_flow.parameters, [value]);
  assert_equals(inner_flow.captures, [base]);
  assert_equals(inner_flow.recursive_group, []);
  assert_equals(inner_flow.control_flow.parameters, [value, base]);
  assert_equals(
    outer_flow.control_flow.blocks.flatMap((block) => block.nodes).some(
      (node) =>
        node.operation.tag === "construct" &&
        node.operation.constructor === "lam" &&
        node.inputs[0] === base &&
        node.outputs[0] === inner,
    ),
    true,
  );
});

Deno.test("recursive callable control flow separates self from captures", () => {
  const source =
    "let rec countdown = (value: I32) => if value == 0 then 0 else countdown(value - 1) end;\n" +
    "countdown\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const countdown = analysis.symbols.get("countdown")?.[0];
  const value = analysis.symbols.get("value")?.[0];
  if (countdown === undefined || value === undefined) {
    throw new Error("Expected recursive callable semantic identities.");
  }
  const callable = analysis.callable_control_flow.get(countdown);
  if (callable === undefined) {
    throw new Error("Expected recursive callable control flow.");
  }
  assert_equals(callable.parameters, [value]);
  assert_equals(callable.captures, []);
  assert_equals(callable.recursive_self, countdown);
  assert_equals(callable.recursive_group, [countdown]);
  assert_equals(callable.control_flow.parameters, [value, countdown]);
  assert_equals(
    analysis.control_flow?.blocks.flatMap((block) => block.nodes).find((node) =>
      node.outputs[0] === countdown
    )?.inputs,
    [],
  );
});

Deno.test("callable captures use the live parent SSA generation", () => {
  const source = "let total = 0;\n" +
    "if true then total = 1; end\n" +
    "let get = () => total;\n" +
    "get\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const get = analysis.symbols.get("get")?.[0];
  if (get === undefined) {
    throw new Error("Expected get semantic identity.");
  }
  const parent_phi = analysis.control_flow?.blocks.flatMap((block) =>
    block.nodes
  ).find((node) => node.operation.tag === "phi");
  const current_total = parent_phi?.outputs[0];
  if (current_total === undefined) {
    throw new Error("Expected the parent assignment phi.");
  }
  const callable = analysis.callable_control_flow.get(get);
  if (callable === undefined) {
    throw new Error("Expected get callable control flow.");
  }
  assert_equals(callable.captures, [current_total]);
  assert_equals(callable.control_flow.parameters, [current_total]);
  assert_equals(callable.control_flow.blocks[0]?.terminator, {
    tag: "return",
    value: current_total,
  });
});

Deno.test("write-only callable assignments capture their predecessor", () => {
  const source = "let total = 0;\n" +
    "let set = () => do\n" +
    "  total = 1;\n" +
    "  total\n" +
    "end;\n" +
    "set\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const total = analysis.symbols.get("total")?.[0];
  const set = analysis.symbols.get("set")?.[0];
  if (total === undefined || set === undefined) {
    throw new Error("Expected total and set semantic identities.");
  }
  const callable = analysis.callable_control_flow.get(set);
  if (callable === undefined) {
    throw new Error("Expected set callable control flow.");
  }
  const assignment = callable.control_flow.blocks.flatMap((block) =>
    block.nodes
  ).find((node) =>
    node.operation.tag === "primitive" &&
    node.operation.name === "assign:same"
  );
  assert_equals(callable.captures, [total]);
  assert_equals(callable.control_flow.parameters, [total]);
  assert_equals(assignment?.inputs[0], total);
  assert_equals(
    callable.control_flow.blocks[0]?.terminator,
    { tag: "return", value: assignment?.outputs[0] },
  );
});

Deno.test("callable branch assignments return the joined capture", () => {
  const source = "let total = 0;\n" +
    "let update = (flag: Bool) => do\n" +
    "  if flag then\n" +
    "    total = total + 1;\n" +
    "  end\n" +
    "  total\n" +
    "end;\n" +
    "update\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const total = analysis.symbols.get("total")?.[0];
  const update = analysis.symbols.get("update")?.[0];
  if (total === undefined || update === undefined) {
    throw new Error("Expected total and update semantic identities.");
  }
  const callable = analysis.callable_control_flow.get(update);
  if (callable === undefined) {
    throw new Error("Expected update callable control flow.");
  }
  const nodes = callable.control_flow.blocks.flatMap((block) => block.nodes);
  const assignment = nodes.find((node) =>
    node.operation.tag === "primitive" &&
    node.operation.name === "assign:same"
  );
  const joined = nodes.find((node) => node.operation.tag === "phi");
  if (assignment === undefined || joined === undefined) {
    throw new Error("Expected assignment and join nodes in update.");
  }
  assert_equals(callable.captures, [total]);
  assert_equals(joined.inputs, [total, assignment.outputs[0]]);
  assert_equals(
    callable.control_flow.blocks.at(-1)?.terminator,
    { tag: "return", value: joined.outputs[0] },
  );
});

Deno.test("callable loops carry captured assignments through the header", () => {
  const source = "let total = 0;\n" +
    "let update = (stop: I32) => do\n" +
    "  for value in 0..stop do\n" +
    "    total = total + value;\n" +
    "  end\n" +
    "  total\n" +
    "end;\n" +
    "update\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const total = analysis.symbols.get("total")?.[0];
  const update = analysis.symbols.get("update")?.[0];
  if (total === undefined || update === undefined) {
    throw new Error("Expected total and update semantic identities.");
  }
  const callable = analysis.callable_control_flow.get(update);
  if (callable === undefined) {
    throw new Error("Expected update callable control flow.");
  }
  const nodes = callable.control_flow.blocks.flatMap((block) => block.nodes);
  const assignment = nodes.find((node) =>
    node.operation.tag === "primitive" &&
    node.operation.name === "assign:same"
  );
  if (assignment === undefined) {
    throw new Error("Expected a loop assignment for total.");
  }
  const carried = nodes.find((node) =>
    node.operation.tag === "phi" &&
    node.inputs.includes(total) &&
    node.inputs.includes(assignment.outputs[0])
  );
  if (carried === undefined) {
    throw new Error("Expected the loop header to carry total.");
  }
  assert_equals(callable.captures, [total]);
  assert_equals(
    callable.control_flow.blocks.at(-1)?.terminator,
    { tag: "return", value: carried.outputs[0] },
  );
});

Deno.test("unavailable captured callables make root flow unavailable", () => {
  for (
    const source of [
      "let base: I32 = 7;\n" +
      "let pair = (left, right) => if base == 7 then right else left end;\n" +
      "pair\n",
      "let base: I32 = 7;\n" +
      "let choose = (flag: I32) => do\n" +
      "  if flag then\n" +
      "    1;\n" +
      "  end\n" +
      "  base\n" +
      "end;\n" +
      "choose\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics, []);
    assert_equals(analysis.control_flow, undefined);
    assert_equals(analysis.callable_control_flow.size, 0);
  }
});

Deno.test("mutual callable control flow predeclares recursive peers", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    Deno.readTextFileSync("examples/functions/11_mutual_recursion.duck"),
  ));
  assert_equals(analysis.diagnostics, []);
  const even = analysis.symbols.get("even")?.[0];
  const odd = analysis.symbols.get("odd")?.[0];
  if (even === undefined || odd === undefined) {
    throw new Error("Expected mutual callable semantic identities.");
  }
  const even_flow = analysis.callable_control_flow.get(even);
  const odd_flow = analysis.callable_control_flow.get(odd);
  if (even_flow === undefined || odd_flow === undefined) {
    throw new Error("Expected both mutual callable graphs.");
  }
  assert_equals(even_flow.recursive_group, [even, odd]);
  assert_equals(odd_flow.recursive_group, [even, odd]);
  assert_equals(even_flow.captures, []);
  assert_equals(odd_flow.captures, []);
  assert_equals(even_flow.control_flow.parameters.includes(odd), true);
  assert_equals(odd_flow.control_flow.parameters.includes(even), true);
});

Deno.test("unknown callable body representations do not poison root flow", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "let pair = (left, right) => right;\npair\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.control_flow !== undefined, true);
  assert_equals(analysis.callable_control_flow.size, 0);
});

Deno.test("callable graph omissions preserve valid elaboration examples", () => {
  for (
    const path of [
      "examples/basics/07_early_return.duck",
      "examples/compile_time/20_variadic_value_packs.duck",
      "examples/compile_time/24_comptime_stack_module.duck",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(
      Deno.readTextFileSync(path),
    ));
    assert_equals(analysis.diagnostics, []);
    assert_equals(diagnostics_of(lower_duck_source(analysis)), []);
  }
});

Deno.test("semantic indexes cover lexical generations with canonical types", () => {
  const source = "let x: I32 = 1;\n" +
    "let f = (value: Bool) => do\n" +
    "  let x = 2;\n" +
    "  x = x + 1;\n" +
    "  value\n" +
    "end;\n" +
    "x = x + 1;\n";
  const first = analyze_duck_source(parse_duck_source(source));
  const second = analyze_duck_source(parse_duck_source(source));
  assert_equals(first.diagnostics, []);
  const xs = first.symbols.get("x");
  if (xs === undefined) {
    throw new Error("Expected every x binding generation");
  }
  assert_equals(xs.length, 4);
  assert_equals(new Set(xs).size, 4);
  assert_equals(xs.map((value) => first.types.get(value)), [
    { tag: "scalar", name: "I32" },
    { tag: "scalar", name: "I32" },
    { tag: "scalar", name: "I32" },
    { tag: "scalar", name: "I32" },
  ]);
  assert_equals(xs.map((value) => first.origins.get(value)?.start), [
    source.indexOf("x"),
    source.indexOf("x", source.indexOf("let f")),
    source.indexOf(
      "x =",
      source.indexOf("let x", source.indexOf("let f")) + "let x".length,
    ),
    source.lastIndexOf("x ="),
  ]);
  assert_equals(second.symbols.get("x"), xs);
  const parameter = first.symbols.get("value")?.[0];
  if (parameter === undefined) {
    throw new Error("Expected lambda parameter identity");
  }
  assert_equals(first.types.get(parameter), {
    tag: "scalar",
    name: "Bool",
  });
  const callable = first.symbols.get("f")?.[0];
  if (callable === undefined) {
    throw new Error("Expected function binding identity");
  }
  const callable_type = first.types.get(callable);
  assert_equals(callable_type, {
    tag: "function",
    params: [{ tag: "scalar", name: "Bool" }],
    effects: [],
    result: { tag: "scalar", name: "Bool" },
  });
  assert_equals(Object.isFrozen(callable_type), true);
  if (callable_type?.tag !== "function") {
    throw new Error("Expected canonical function representation");
  }
  assert_equals(Object.isFrozen(callable_type.params), true);
});

Deno.test("semantic indexes remain partial across Baba recovery", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "let = broken;\nlet kept: Bool = true;\n",
  ));
  assert_equals(analysis.diagnostics.length > 0, true);
  assert_equals([...analysis.symbols.keys()], ["kept"]);
  const kept = analysis.symbols.get("kept")?.[0];
  if (kept === undefined) {
    throw new Error("Expected recovered kept binding");
  }
  assert_equals(analysis.types.get(kept), {
    tag: "scalar",
    name: "Bool",
  });
  assert_equals(analysis.control_flow, undefined);
});

Deno.test("semantic indexes omit bindings without inferred representations", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "let broken = 1 + true;\n",
  ));
  assert_equals(analysis.diagnostics.length > 0, true);
  const broken = analysis.symbols.get("broken")?.[0];
  if (broken === undefined) {
    throw new Error("Expected the invalid binding identity.");
  }
  assert_equals(analysis.types.has(broken), false);
  assert_equals(analysis.control_flow, undefined);
});

Deno.test("semantic control flow records matches loops and ownership", () => {
  const matched = analyze_duck_source(parse_duck_source(
    "type Maybe = | #None | #Some I32\n" +
      "let current: Maybe = #Some 42;\n" +
      "case current of #Some value => value, #None => 0;\n",
  ));
  const match_operations = matched.control_flow?.blocks.flatMap((block) =>
    block.nodes.map((node) => node.operation)
  );
  assert_equals(
    match_operations?.filter((operation) =>
      operation.tag === "primitive" &&
      operation.name.startsWith("pattern:")
    ).length,
    2,
  );

  const looped = analyze_duck_source(parse_duck_source(
    "let total = 0;\n" +
      "for value in 0..3 do\n" +
      "  total = total + value;\n" +
      "end\n" +
      "total\n",
  ));
  const loop_phi = looped.control_flow?.blocks.flatMap((block) => block.nodes)
    .find((node) => node.operation.tag === "phi");
  if (loop_phi?.operation.tag !== "phi") {
    throw new Error("Expected a loop phi.");
  }
  assert_equals(loop_phi.operation.incoming.length, 2);

  const linear = analyze_duck_source(parse_duck_source(
    "let !token = 1;\n!token\n",
  ));
  assert_equals(
    linear.control_flow?.blocks.flatMap((block) => block.nodes).some((node) =>
      node.operation.tag === "ownership_transition" &&
      node.operation.transition === "consume"
    ),
    true,
  );
});

Deno.test("semantic control flow carries assignment identities across joins", () => {
  const branched = analyze_duck_source(parse_duck_source(
    "let value = 0;\n" +
      "if true then value = value + 1; end\n" +
      "value\n",
  ));
  assert_equals(branched.diagnostics, []);
  const branch_flow = branched.control_flow;
  if (branch_flow === undefined) {
    throw new Error("Expected branch control flow.");
  }
  const branch_return = branch_flow.blocks.find((block) =>
    block.terminator.tag === "return"
  );
  if (branch_return?.terminator.tag !== "return") {
    throw new Error("Expected branch return.");
  }
  const branch_phi = branch_return.nodes.find((node) =>
    node.operation.tag === "phi"
  );
  assert_equals(branch_return.terminator.value, branch_phi?.outputs[0]);
  if (branch_phi?.operation.tag !== "phi") {
    throw new Error("Expected branch assignment phi.");
  }
  assert_equals(branch_phi.operation.incoming.length, 2);

  const looped = analyze_duck_source(parse_duck_source(
    "let total = 0;\n" +
      "for value in 0..3 do\n" +
      "  total = total + value;\n" +
      "end\n" +
      "total\n",
  ));
  assert_equals(looped.diagnostics, []);
  const loop_flow = looped.control_flow;
  if (loop_flow === undefined) {
    throw new Error("Expected loop control flow.");
  }
  const assignment = looped.symbols.get("total")?.[1];
  if (assignment === undefined) {
    throw new Error("Expected loop assignment identity.");
  }
  const carried = loop_flow.blocks.flatMap((block) => block.nodes).find(
    (node) =>
      node.operation.tag === "phi" &&
      node.operation.incoming.some((input) => input.value === assignment),
  );
  if (carried?.operation.tag !== "phi") {
    throw new Error("Expected loop-carried assignment phi.");
  }
  assert_equals(carried.operation.incoming.length, 2);
  const loop_return = loop_flow.blocks.find((block) =>
    block.terminator.tag === "return"
  );
  if (loop_return?.terminator.tag !== "return") {
    throw new Error("Expected loop return.");
  }
  assert_equals(loop_return.terminator.value, carried.outputs[0]);
});

Deno.test("guard failure keeps pattern bindings out of later match arms", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type Maybe = | #None | #Some I32\n" +
      "let current: Maybe = #Some 42;\n" +
      "case current of\n" +
      "  #Some value if false => 0,\n" +
      "  _ => loop do break 1; end;\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.control_flow !== undefined, true);
});

Deno.test("semantic control flow covers existing semantic symbol boundaries", () => {
  const incomplete_paths = [
    "examples/basics/08_dynamic_condition.duck",
    "examples/ownership_modules/multi_file/score_module.duck",
  ];
  for (const path of incomplete_paths) {
    const analysis = analyze_duck_source(parse_duck_source(
      Deno.readTextFileSync(path),
    ));
    assert_equals(analysis.diagnostics, []);
    assert_equals(analysis.control_flow, undefined);
  }
  const refutable = analyze_duck_source(parse_duck_source(
    Deno.readTextFileSync(
      "examples/loops/11_refutable_collection_pattern.duck",
    ),
  ));
  assert_equals(refutable.diagnostics, []);
  assert_equals(refutable.control_flow !== undefined, true);
});

Deno.test("finite type sets pass through control flow without changing Core", () => {
  const source = "type Marker = #answer :| #other\n" +
    "let marker: Marker = #answer;\n" +
    "if marker is #answer then 1 else 0 end\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  assert_equals(
    analysis.control_flow?.blocks.flatMap((block) => block.nodes).some((node) =>
      node.operation.tag === "primitive" && node.operation.name === "is"
    ),
    true,
  );
  const program = checked_value(lower_duck_source(analysis));
  assert_equals(program?.core.statements[2]?.tag, "expr");
  const expression = program?.core.statements[2];
  if (expression?.tag !== "expr") {
    throw new Error("Expected the finite type-set expression in Core.");
  }
  assert_equals(expression.expr.tag, "if_let");
});

Deno.test("Baba reaches unchanged semantic Core without the handwritten parser", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "let value = 1;\n" +
      "value + 2\n",
  ));
  const lowered = lower_duck_source(analysis);
  assert_equals(diagnostics_of(lowered), []);
  assert_equals(checked_value(lowered)?.core, {
    tag: "program",
    statements: [
      {
        tag: "bind",
        kind: "let",
        name: "value",
        is_linear: false,
        annotation: undefined,
        value: { tag: "num", type: "i32", value: 1 },
      },
      {
        tag: "expr",
        expr: {
          tag: "prim",
          prim: "i32.add",
          args: [
            { tag: "var", name: "value" },
            { tag: "num", type: "i32", value: 2 },
          ],
          integer: undefined,
        },
      },
    ],
  });
});

Deno.test("Baba indexed assignments reach semantic Core", () => {
  const source = "let pair = [20, 0];\n" +
    "pair[1] = 22;\n" +
    "pair\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const pair = analysis.symbols.get("pair");
  if (pair === undefined) {
    throw new Error("Expected indexed aggregate identities");
  }
  assert_equals(pair.length, 2);
  assert_equals(pair[0] === pair[1], false);
  assert_equals(pair.map((value) => analysis.origins.get(value)?.start), [
    source.indexOf("pair"),
    source.indexOf("pair", source.indexOf("\n") + 1),
  ]);
  assert_equals(pair.map((value) => analysis.types.get(value)), [
    {
      tag: "product",
      fields: [
        { label: "0", type: { tag: "scalar", name: "I32" } },
        { label: "1", type: { tag: "scalar", name: "I32" } },
      ],
    },
    {
      tag: "product",
      fields: [
        { label: "0", type: { tag: "scalar", name: "I32" } },
        { label: "1", type: { tag: "scalar", name: "I32" } },
      ],
    },
  ]);
  const lowered = lower_duck_source(analysis);
  assert_equals(diagnostics_of(lowered), []);
  assert_equals(checked_value(lowered)?.core.statements[1], {
    tag: "index_assign",
    name: "pair",
    index: { tag: "num", type: "i32", value: 1 },
    value: { tag: "num", type: "i32", value: 22 },
  });
});

Deno.test("semantic indexes do not publish generated placeholder names", () => {
  const source = "let f = add(_, _);\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  assert_equals([...analysis.symbols.keys()], ["f"]);
  assert_equals(
    [...analysis.origins.values()].every((origin) =>
      source.slice(origin.start, origin.end) === "f"
    ),
    true,
  );
});

Deno.test("semantic indexes do not publish unresolved assignment targets", () => {
  for (const source of ["missing = 1;\n", "missing[0] = 1;\n"]) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.symbols.has("missing"), false);
  }
});

Deno.test("Baba compile-time array spreads reach semantic Core", () => {
  for (
    const [spread, expected] of [
      ["[3, ...[1, 2]]", [3, 1, 2]],
      ["[...[1, 2], 3]", [1, 2, 3]],
      ["[...[1, 2]]", [1, 2]],
    ] as const
  ) {
    const analysis = analyze_duck_source(parse_duck_source(
      "const values = comptime " + spread + ";\n" +
        "values\n",
    ));
    assert_equals(analysis.diagnostics, []);
    const lowered = lower_duck_source(analysis);
    assert_equals(diagnostics_of(lowered), []);
    const binding = checked_value(lowered)?.core.statements[0];
    if (binding?.tag !== "bind" || binding.value.tag !== "struct_value") {
      throw new Error("Expected an expanded array-spread Core binding.");
    }
    assert_equals(
      binding.value.fields.map((field) => {
        if (field.value.tag !== "num") {
          throw new Error("Expected a numeric array-spread field.");
        }
        return field.value.value;
      }),
      expected,
    );
  }
});

Deno.test("Baba attributes expand before semantic Core construction", () => {
  const source = "const increment = (const target) => " +
    "#Replace (target + 1);\n" +
    "@[increment]\n" +
    "const answer = 41;\n" +
    "answer\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const lowered = lower_duck_source(analysis);
  assert_equals(diagnostics_of(lowered), []);
  assert_equals(checked_value(lowered)?.core, {
    tag: "program",
    statements: [
      {
        tag: "bind",
        kind: "const",
        name: "answer",
        is_linear: false,
        annotation: undefined,
        value: { tag: "num", type: "i32", value: 42 },
      },
      {
        tag: "expr",
        expr: { tag: "var", name: "answer" },
      },
    ],
  });
});

Deno.test("array spread failures remain checked source diagnostics", () => {
  for (
    const [source, expected_operand] of [
      [
        "let tail = [1, 2];\n[3, ...tail]\n",
        "tail",
      ],
      [
        "let tail = [1, 2];\n[...tail, 3]\n",
        "tail",
      ],
      [
        "let tail = [1, 2];\n[...tail]\n",
        "tail",
      ],
      [
        "const values = comptime [3, ...1];\nvalues\n",
        "1",
      ],
      [
        "const values = comptime [...1, 3];\nvalues\n",
        "1",
      ],
      [
        "const values = comptime [...1];\nvalues\n",
        "1",
      ],
    ] as const
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics, []);
    const lowered = lower_duck_source(analysis);
    const diagnostics = diagnostics_of(lowered);
    assert_equals(diagnostics.length, 1);
    const spread_start = source.indexOf("...");
    assert_equals(diagnostics[0], {
      code: "DUCK2308",
      severity: "error",
      message: "Array spread must resolve to a fixed product at compile time",
      span: {
        start: spread_start + 3,
        end: spread_start + 3 + expected_operand.length,
      },
    });
    assert_equals(checked_value(lowered), undefined);
  }
});

Deno.test("array spread diagnostics preserve rewritten spans and accumulate", () => {
  const source = "let tail = [8, 9];\n" +
    "[0, ...[1, ...tail]];\n" +
    "const unused = comptime [...4];\n" +
    "const values = comptime [0, ...(1 + 2)];\n" +
    "values\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const lowered = lower_duck_source(analysis);
  const message =
    "Array spread must resolve to a fixed product at compile time";
  const nested_operand = "[1, ...tail]";
  const nested_start = source.indexOf(nested_operand);
  const tail_start = source.indexOf("tail", nested_start);
  const unused_start = source.indexOf("4", source.indexOf("const unused"));
  const binary_operand = "1 + 2";
  const binary_start = source.indexOf(binary_operand);
  assert_equals(diagnostics_of(lowered), [
    {
      code: "DUCK2308",
      severity: "error",
      message,
      span: {
        start: nested_start,
        end: nested_start + nested_operand.length,
      },
    },
    {
      code: "DUCK2308",
      severity: "error",
      message,
      span: { start: tail_start, end: tail_start + "tail".length },
    },
    {
      code: "DUCK2308",
      severity: "error",
      message,
      span: { start: unused_start, end: unused_start + 1 },
    },
    {
      code: "DUCK2308",
      severity: "error",
      message,
      span: {
        start: binary_start,
        end: binary_start + binary_operand.length,
      },
    },
  ]);
  assert_equals(checked_value(lowered), undefined);
});

Deno.test("array spread rewrites retain distinct call-site spans", () => {
  const source = "const scalar = () => 1;\n" +
    "const first = comptime [0, ...scalar()];\n" +
    "const second = comptime [...scalar(), 2];\n" +
    "[first, second]\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const lowered = lower_duck_source(analysis);
  const first_start = source.indexOf("scalar()");
  const second_start = source.indexOf("scalar()", first_start + 1);
  const message =
    "Array spread must resolve to a fixed product at compile time";
  assert_equals(diagnostics_of(lowered), [
    {
      code: "DUCK2308",
      severity: "error",
      message,
      span: { start: first_start, end: first_start + "scalar()".length },
    },
    {
      code: "DUCK2308",
      severity: "error",
      message,
      span: { start: second_start, end: second_start + "scalar()".length },
    },
  ]);
  assert_equals(checked_value(lowered), undefined);
});

Deno.test("array spread diagnostics deduplicate shared definition spans", () => {
  const source = "const tail = 1;\n" +
    "const bad = () => [1, ...tail];\n" +
    "const first = comptime [0, ...bad()];\n" +
    "const second = comptime [...bad(), 2];\n" +
    "[first, second]\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const lowered = lower_duck_source(analysis);
  const definition_start = source.indexOf("tail", source.indexOf("const bad"));
  const first_start = source.indexOf("bad()", source.indexOf("const first"));
  const second_start = source.indexOf("bad()", source.indexOf("const second"));
  const message =
    "Array spread must resolve to a fixed product at compile time";
  assert_equals(diagnostics_of(lowered), [
    {
      code: "DUCK2308",
      severity: "error",
      message,
      span: {
        start: definition_start,
        end: definition_start + "tail".length,
      },
    },
    {
      code: "DUCK2308",
      severity: "error",
      message,
      span: { start: first_start, end: first_start + "bad()".length },
    },
    {
      code: "DUCK2308",
      severity: "error",
      message,
      span: { start: second_start, end: second_start + "bad()".length },
    },
  ]);
  assert_equals(checked_value(lowered), undefined);
});

Deno.test("semantic program lowering preserves source diagnostics", () => {
  const parsed = parse_duck_source("let value = ;\n");
  const analysis = analyze_duck_source(parsed);
  assert_equals(analysis.diagnostics.length, 1);
  const lowered = lower_duck_source(analysis);
  assert_equals(diagnostics_of(lowered).length > 0, true);
});

Deno.test("semantic analysis orders recovery and lowering diagnostics", () => {
  const source = "const BadName = 1024u8;\n" +
    "@[broken(]\n" +
    "const good = 1;\n" +
    "const next = 2;\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(
    analysis.diagnostics.map((diagnostic) => diagnostic.span.start),
    [6, 16, 32],
  );
});

Deno.test("bundled default effect handlers reach semantic Core", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    'const {} = import "duck:prelude/effects/defaults" ();\n' +
      "0\n",
  ));
  assert_equals(analysis.diagnostics, []);
  const lowered = lower_duck_source(analysis);
  assert_equals(diagnostics_of(lowered), []);
  assert_equals(checked_value(lowered)?.core.tag, "program");
});

Deno.test("invalid handler clauses remain checked diagnostics", () => {
  const source = "effect State { bad_name: () => Unit }\n" +
    "const run = handler State {\n" +
    "  badName: (!resume) => !resume(()),\n" +
    "  return: value => value,\n" +
    "};\n" +
    "0\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics.length, 1);
  assert_equals(
    analysis.diagnostics[0]?.message,
    "Handler clause must use snake_case: badName",
  );
  const lowered = lower_duck_source(analysis);
  assert_equals(diagnostics_of(lowered), analysis.diagnostics);
  assert_equals(checked_value(lowered), undefined);
});

Deno.test("Baba parse results cannot be mutated after branding", () => {
  const parsed = parse_duck_source("let value = ;\n");
  let rejected = false;
  try {
    parsed.cst.text = "let forged = 1;\n";
  } catch (_error) {
    rejected = true;
  }
  assert_equals(rejected, true);

  rejected = false;
  const recovery = parsed.recovery_intervals[0];
  if (recovery === undefined) {
    throw new Error("Baba parser did not return its recovery interval");
  }
  try {
    recovery.skipped.end = parsed.cst.text.length;
  } catch (_error) {
    rejected = true;
  }
  assert_equals(rejected, true);

  const analysis = analyze_duck_source(parsed);
  assert_equals(
    analysis.parsed.recovery_intervals,
    parsed.recovery_intervals,
  );
  const analysis_recovery = analysis.parsed.recovery_intervals[0];
  if (analysis_recovery === undefined) {
    throw new Error("Semantic analysis lost the Baba recovery interval");
  }
  if (analysis_recovery.diagnostic !== analysis.parsed.diagnostics[0]) {
    throw new Error("Semantic analysis detached the recovery diagnostic");
  }
  assert_equals(Object.isFrozen(analysis_recovery), true);
  assert_equals(Object.isFrozen(analysis_recovery.skipped), true);
});

Deno.test("semantic analysis reports prefix-signature association diagnostics", () => {
  const parsed = parse_duck_source("type value = (x: I32) -> I32\n");
  const analysis = analyze_duck_source(parsed);
  assert_equals(
    analysis.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2601"),
    true,
  );
});

Deno.test("semantic analysis extracts and masks source prefix signatures", () => {
  const parsed = parse_duck_source(
    "type identity = (value: I32) -> (result: I32)\n" +
      "ensures result = value\n" +
      "let identity = value => value;\n" +
      "identity 1\n",
  );
  const analysis = analyze_duck_source(parsed);
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.symbols.has("identity"), true);
});

Deno.test("checked contracts erase before semantic Core construction", () => {
  const contracted_source = "type identity = (value: I32) -> (result: I32)\n" +
    "ensures result = value\n" +
    "let identity = value => value;\n" +
    "identity 42\n";
  const plain_source = "let identity = value => value;\n" +
    "identity 42\n";
  const contracted = analyze_duck_source(
    parse_duck_source(contracted_source),
  );
  const plain = analyze_duck_source(parse_duck_source(plain_source));
  assert_equals(contracted.diagnostics, []);
  assert_equals(plain.diagnostics, []);
  assert_equals(contracted.proofs.size, 1);
  const checked_certificate = [...contracted.proofs.values()][0];
  if (checked_certificate === undefined) {
    throw new Error("Expected a checked contract certificate.");
  }
  const certificate = checked_certificate.certificate;
  assert_equals(certificate.safety, { tag: "safe" });
  assert_equals(certificate.proposition, {
    tag: "equal",
    type: { tag: "constant", name: "I32" },
    left: { tag: "var", index: 0 },
    right: { tag: "var", index: 0 },
  });
  assert_equals(
    check_certificate(certificate, certificate.proposition, {
      environment: checked_certificate.environment,
      term_context: checked_certificate.term_context,
      require_safe: true,
    }),
    certificate,
  );

  const contracted_program = checked_value(lower_duck_source(contracted));
  const plain_program = checked_value(lower_duck_source(plain));
  if (contracted_program === undefined || plain_program === undefined) {
    throw new Error("Expected both identity programs to lower.");
  }
  assert_equals(contracted_program.core, plain_program.core);
  assert_equals(
    JSON.stringify(contracted_program.core).includes("proposition"),
    false,
  );
  assert_equals(
    JSON.stringify(contracted_program.core).includes("proof"),
    false,
  );
});

Deno.test("semantic program brands reject analysis and Core mutation", () => {
  const invalid = analyze_duck_source(parse_duck_source(
    "type identity = (value: I32) -> (result: I32)\n" +
      "ensures result = value\n" +
      "let identity = value => 0;\n",
  ));
  assert_throws(
    () => {
      (invalid.diagnostics as unknown[]).length = 0;
    },
    "Cannot assign to read only property",
  );
  assert_equals(checked_value(lower_duck_source(invalid)), undefined);

  const changed = analyze_duck_source(parse_duck_source(
    "let value = 42;\nvalue\n",
  ));
  const binding = changed.source.statements[0];
  if (binding === undefined || binding.tag !== "bind") {
    throw new Error("Expected a source binding.");
  }
  binding.name = "forged";
  assert_throws(
    () => lower_duck_source(changed),
    "Duck analysis source changed after semantic checking.",
  );

  const checked = analyze_duck_source(parse_duck_source("40 + 2"));
  const program = checked_value(lower_duck_source(checked));
  if (program === undefined) {
    throw new Error("Expected a checked semantic program.");
  }
  assert_throws(
    () => {
      (program.core.statements as unknown[]).length = 0;
    },
    "Cannot assign to read only property",
  );
});

Deno.test("analysis options cannot suppress source prefix signatures", () => {
  const parsed = parse_duck_source(
    "type identity = (value: I32) -> (result: I32)\n" +
      "\n",
  );
  const analysis = analyze_duck_source(parsed);
  assert_equals(
    analysis.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2601"),
    true,
  );
});

Deno.test("semantic analysis rejects an unsatisfiable literal contract", () => {
  const parsed = parse_duck_source(
    "type f = (value: I32) -> I32\n" +
      "ensures false\n" +
      "let f = value => value;\n",
  );
  const analysis = analyze_duck_source(parsed);
  assert_equals(
    analysis.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2604"),
    true,
  );
});

Deno.test("semantic analysis checks identity postconditions against lambda bodies", () => {
  const parsed = parse_duck_source(
    "type f = (value: I32) -> (result: I32)\n" +
      "ensures result = value\n" +
      "let f = value => 0;\n",
  );
  const analysis = analyze_duck_source(parsed);
  assert_equals(
    analysis.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2604"),
    true,
  );
});

Deno.test("semantic analysis alpha-renames contract parameters positionally", () => {
  const accepted = analyze_duck_source(parse_duck_source(
    "type f = (value: I32) -> (result: I32)\n" +
      "ensures result = value\n" +
      "let f = ignored => ignored;\n" +
      "f 1\n",
  ));
  assert_equals(accepted.diagnostics, []);

  const rejected = analyze_duck_source(parse_duck_source(
    "let value = 0;\n" +
      "type f = (value: I32) -> (result: I32)\n" +
      "ensures result = value\n" +
      "let f = ignored => value;\n",
  ));
  assert_equals(
    rejected.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2604"),
    true,
  );

  const multiple = analyze_duck_source(parse_duck_source(
    "type pair = (first: I32, second: I32) -> (result: I32)\n" +
      "ensures result = second\n" +
      "let pair = (left, right) => right;\n" +
      "pair(1, 2)\n",
  ));
  assert_equals(multiple.diagnostics, []);
});

Deno.test("contract certificates match the inferred callable representation", () => {
  const unknown = analyze_duck_source(parse_duck_source(
    "type f = (value: Bogus) -> (result: Bogus)\n" +
      "ensures result = value\n" +
      "let f = value => value;\n" +
      "f 1\n",
  ));
  assert_equals(
    unknown.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2604"),
    true,
  );
  assert_equals(unknown.proofs.size, 0);

  const mismatched = analyze_duck_source(parse_duck_source(
    "type f = (value: I32) -> (result: I32)\n" +
      "ensures result = value\n" +
      "let f = value => value;\n" +
      'f "oops"\n',
  ));
  assert_equals(
    mismatched.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2604"),
    true,
  );
  assert_equals(mismatched.proofs.size, 0);
});

Deno.test("semantic analysis rejects unsupported raw postconditions", () => {
  const parsed = parse_duck_source(
    "type f = (value: I32) -> I32\n" +
      "ensures false and true\n" +
      "let f = value => value;\n",
  );
  const analysis = analyze_duck_source(parsed);
  assert_equals(
    analysis.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2604"),
    true,
  );
});

Deno.test("Baba conditional patterns reach proof-erased semantic Core", () => {
  for (
    const example of [
      {
        source: "type Maybe = | #None | #Some I32\n" +
          "let current: Maybe = #Some 42;\n" +
          "let out = if let #Some value = current then value else 0 end;\n" +
          "out\n",
        expected: "if_let",
      },
      {
        source: "let current = 0;\n" +
          "let out = if let 0 = current then 42 else 0 end;\n" +
          "out\n",
        expected: "if",
      },
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(example.source));
    assert_equals(analysis.diagnostics, []);
    const program = checked_value(lower_duck_source(analysis));
    if (program === undefined) {
      throw new Error("Expected the Baba conditional to reach Core.");
    }
    const out = program.core.statements.find((statement) =>
      statement.tag === "bind" && statement.name === "out"
    );
    if (out?.tag !== "bind") {
      throw new Error("Conditional Core omitted its result binding.");
    }
    assert_equals(out.value.tag, example.expected);
  }
});

Deno.test("Baba case expressions reach proof-erased semantic Core", () => {
  const source = "type Maybe = | #None | #Some I32\n" +
    "let current: Maybe = #Some 42;\n" +
    "let out = case current of #Some value => value, #None => 0;\n" +
    "out\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const program = checked_value(lower_duck_source(analysis));
  if (program === undefined) {
    throw new Error("Expected the Baba case expression to reach Core.");
  }
  const out = program.core.statements.find((statement) =>
    statement.tag === "bind" && statement.name === "out"
  );
  if (out?.tag !== "bind") {
    throw new Error("Case Core omitted its result binding.");
  }
  if (out.value.tag !== "block") {
    throw new Error("Case Core did not elaborate its match.");
  }
  const case_statement = out.value.statements[0];
  if (case_statement?.tag !== "expr") {
    throw new Error("Case Core omitted its elaborated expression.");
  }
  assert_equals(case_statement.expr.tag, "if_let");
});

Deno.test("Baba loops reach proof-erased semantic Core", () => {
  for (
    const example of [
      {
        source: "let total = 0;\n" +
          "for value in 0..3 do\n" +
          "  total = total + value;\n" +
          "end\n" +
          "total\n",
        expected_tags: ["bind", "bind", "expr", "expr"],
      },
      {
        source: "let values = [1, 2];\n" +
          "let total = 0;\n" +
          "for value in values do\n" +
          "  total = total + value;\n" +
          "end\n" +
          "total\n",
        expected_tags: ["bind", "bind", "bind", "expr", "expr"],
      },
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(example.source));
    assert_equals(analysis.diagnostics, []);
    const program = checked_value(lower_duck_source(analysis));
    if (program === undefined) {
      throw new Error("Expected the Baba loop to reach Core.");
    }
    assert_equals(
      program.core.statements.map((statement) => statement.tag),
      example.expected_tags,
    );
  }
});

Deno.test("Baba recursion reaches proof-erased semantic Core", () => {
  for (
    const [path, expected_tags] of [
      [
        "examples/functions/04_recursive_fibonacci.duck",
        ["bind", "bind", "expr"],
      ],
      [
        "examples/functions/05_tail_recursive_gcd.duck",
        ["bind", "expr"],
      ],
      [
        "examples/functions/11_mutual_recursion.duck",
        ["bind", "expr"],
      ],
    ] as const
  ) {
    const analysis = analyze_duck_source(
      parse_duck_source(Deno.readTextFileSync(path)),
    );
    assert_equals(analysis.diagnostics, []);
    const program = checked_value(lower_duck_source(analysis));
    if (program === undefined) {
      throw new Error("Expected Baba recursion to reach Core for " + path);
    }
    assert_equals(
      program.core.statements.map((statement) => statement.tag),
      expected_tags,
    );
  }
});

Deno.test("Baba source operators reach proof-erased semantic Core", () => {
  const source = "infixl 60 +++ = add\n" +
    "let add = (left, right) => left + right;\n" +
    "let value = 20 +++ 22;\n" +
    "value\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const program = checked_value(lower_duck_source(analysis));
  if (program === undefined) {
    throw new Error("Expected a source operator to reach semantic Core.");
  }
  assert_equals(
    program.core.statements.map((statement) => statement.tag),
    ["bind", "bind", "expr"],
  );
});

Deno.test("semantic analysis preserves malformed fixity diagnostics", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "infixl 60 +++ =\n",
  ));
  assert_equals(
    analysis.diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Malformed fixity declaration.",
      "Baba parser rejected MISSING",
    ],
  );
});

Deno.test("semantic Core elaborates product destructuring before lowering", () => {
  const source = "let [left, right] = [1, 2];\nleft + right;\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const program = checked_value(lower_duck_source(analysis));
  if (program === undefined) {
    throw new Error("Expected product destructuring to reach Core.");
  }
  assert_equals(
    program.core.statements.map((statement) => {
      if (statement.tag === "bind") return statement.name;
      return statement.tag;
    }),
    ["_pattern#source0", "left", "right", "expr"],
  );
  assert_equals(program.core.statements.at(-1), {
    tag: "expr",
    expr: {
      tag: "prim",
      prim: "i32.add",
      args: [
        { tag: "var", name: "left" },
        { tag: "var", name: "right" },
      ],
      integer: undefined,
    },
  });
});

Deno.test("empty shape bindings erase from semantic Core", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "let {} = {};\n0\n",
  ));
  assert_equals(analysis.diagnostics, []);
  const program = checked_value(lower_duck_source(analysis));
  if (program === undefined) {
    throw new Error("Expected an empty shape binding to reach Core.");
  }
  assert_equals(program.core.statements, [
    {
      tag: "expr",
      expr: { tag: "num", type: "i32", value: 0 },
    },
  ]);
});

Deno.test("semantic Core preserves irrefutable union alternatives", () => {
  for (
    const source of [
      "let x | #Some x = #Some 1;\nx;\n",
      "let #Some x | x = #Some 1;\nx;\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics, []);
    const lowered = lower_duck_source(analysis);
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(
      checked_value(lowered)?.core.statements.some((statement) =>
        statement.tag === "bind" && statement.name === "x"
      ),
      true,
    );
  }
});

Deno.test("refutable plain bindings stop at checked diagnostics", () => {
  for (
    const source of [
      "let #Some value = #Some 1;\nvalue;\n",
      "let 1 = 1;\n",
      "let true = true;\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(
      analysis.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2315"),
      true,
    );
    assert_equals(checked_value(lower_duck_source(analysis)), undefined);
  }
});

Deno.test("refutable bindings with terminating fallbacks reach Core", () => {
  const source = "let #Some value = #Some 1 else do return 0; end;\n" +
    "value;\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const lowered = lower_duck_source(analysis);
  assert_equals(diagnostics_of(lowered), []);
  assert_equals(checked_value(lowered) !== undefined, true);
});

Deno.test("redundant let-else fallbacks do not create unreachable matches", () => {
  for (
    const source of [
      "let x = 1 else do return 0; end;\nx;\n",
      "let [x] = [1] else do return 0; end;\nx;\n",
      "let { .x } = { .x = 1 } else do return 0; end;\nx;\n",
      "let x | #Some x = #Some 1 else do return 0; end;\nx;\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics, []);
    const lowered = lower_duck_source(analysis);
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered) !== undefined, true);
  }
});

Deno.test("structural formation failures stop before Core", () => {
  for (
    const source of [
      "let [head, ...tail] = value;\nhead;\n",
      "let (head, ...tail) = value;\nhead;\n",
      "let [x, y] = [1];\nx;\n",
      "let [x] = [1, 2];\nx;\n",
      "let { .missing } = { .present = 1 };\nmissing;\n",
      "let { .x } = [1];\nx;\n",
      "let [x] = 1;\nx;\n",
      "let [x] = #Some 1;\nx;\n",
      "let { .x } = 1;\nx;\n",
      "let { .x } = #Some 1;\nx;\n",
      "let f = (value: I32) => do let [x] = value; x end;\nf(1);\n",
      "let f = (value: [I32, I32]) => do let [x] = value; x end;\n" +
      "f([1, 2]);\n",
      "type Point = struct { .x = I32 }\n" +
      "let f = (value: Point) => do let { .y } = value; y end;\n" +
      "f(Point(1));\n",
      "let f = (value: [[I32, I32]]) => do let [[x]] = value; x end;\n" +
      "f([[1, 2]]);\n",
      "type Inner = struct { .x = I32 }\n" +
      "type Outer = struct { .inner = Inner }\n" +
      "let f = (value: Outer) => do " +
      "let { .inner = { .y } } = value; y end;\n",
      "let value = [[1]];\n" +
      "let [[x, y], ...tail] = value;\n" +
      "x;\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(
      analysis.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2316"),
      true,
    );
    assert_equals(checked_value(lower_duck_source(analysis)), undefined);
  }
});

Deno.test("known named destructuring reaches Core without a shape carrier", () => {
  const source = "const { .present } = { .present = 1 };\npresent;\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  assert_equals(checked_value(lower_duck_source(analysis))?.core, {
    tag: "program",
    statements: [
      {
        tag: "bind",
        kind: "const",
        name: "present",
        is_linear: false,
        annotation: undefined,
        value: { tag: "num", type: "i32", value: 1 },
      },
      { tag: "expr", expr: { tag: "var", name: "present" } },
    ],
  });
});

Deno.test("runtime named destructuring projects known shape fields", () => {
  const source = "let { .x, .y } = { .x = 1, .y = 2 };\nx + y;\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const lowered = lower_duck_source(analysis);
  assert_equals(diagnostics_of(lowered), []);
  assert_equals(
    checked_value(lowered)?.core.statements.map((statement) => {
      if (statement.tag === "bind") return statement.name;
      return statement.tag;
    }),
    ["x", "y", "expr"],
  );
});

Deno.test("structural binding annotations validate projected values", () => {
  const accepted = analyze_duck_source(
    parse_duck_source(
      "let { .x: Text, .nested = { .value: I32 } } = " +
        '{ .x = "hi", .nested = { .value = 1 } };\n' +
        "x;\n",
    ),
  );
  assert_equals(accepted.diagnostics, []);
  assert_equals(
    checked_value(lower_duck_source(accepted)) !== undefined,
    true,
  );

  const source = 'let { .x: I32 } = { .x = "hi" };\nx;\n';
  const mismatch = analyze_duck_source(parse_duck_source(source));
  assert_equals(mismatch.diagnostics, [{
    code: "DUCK2306",
    severity: "error",
    message: "Binding annotation expects I32, got Text",
    span: {
      start: source.indexOf('"hi"'),
      end: source.indexOf('"hi"') + '"hi"'.length,
    },
  }]);
  assert_equals(checked_value(lower_duck_source(mismatch)), undefined);

  const typed_source = "type Point = struct { .x = Text }\n" +
    "let f = (value: Point) => do let { .x: I32 } = value; x end;\n" +
    'f(Point("text"));\n';
  const typed_mismatch = analyze_duck_source(
    parse_duck_source(typed_source),
  );
  assert_equals(
    typed_mismatch.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2306" &&
      diagnostic.message === "Binding annotation expects I32, got Text"
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(typed_mismatch)), undefined);
});

Deno.test("structural alternatives select a compatible known aggregate", () => {
  for (
    const source of [
      "let [x] | [x, ..._] = [1, 2];\nx;\n",
      "let { .x } | { .x, .y = _ } = { .x = 1, .y = 2 };\nx;\n",
      "let { .x, .y = _ } | { .x } = { .x = 1, .y = 2 };\nx;\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics, []);
    const lowered = lower_duck_source(analysis);
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered) !== undefined, true);
  }
});

Deno.test("array rest patterns project known shape entries", () => {
  for (
    const source of [
      "let [x, ...rest] = { .x = 1, .y = 2 };\nx;\n",
      "let [x, ..._] = { .x = 1, .y = 2 };\nx;\n",
      "let [x] | [x, ..._] = { .x = 1, .y = 2 };\nx;\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics, []);
    const lowered = lower_duck_source(analysis);
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered) !== undefined, true);
  }
});

Deno.test("typed array rest patterns lower with their declared shape", () => {
  for (
    const source of [
      "let f = (value: [I32, I32]) => do " +
      "let [x, ...rest] = value; x end;\nf([1, 2]);\n",
      "let f = (value: [I32, I32]) => do " +
      "let [x, ..._] = value; x end;\nf([1, 2]);\n",
      "let f = (value: [[I32, I32]]) => do " +
      "let [[x, ...rest]] = value; x end;\nf([[1, 2]]);\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics, []);
    const lowered = lower_duck_source(analysis);
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered) !== undefined, true);
  }
});

Deno.test("semantic indexes expose structural binders with exact origins", () => {
  for (
    const [source, names] of [
      ["let [left, right] = pair;\n", ["left", "right"]],
      ["let #Some value = option;\n", ["value"]],
      ["let x | x = value;\n", ["x"]],
      ['let "${capture}" = text;\n', ["capture"]],
    ] as const
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals([...analysis.symbols.keys()], [...names]);
    for (const name of names) {
      const value = analysis.symbols.get(name)?.[0];
      if (value === undefined) {
        throw new Error("Expected a semantic identity for " + name);
      }
      const start = source.indexOf(name);
      assert_equals(analysis.origins.get(value), {
        source_node: analysis.origins.get(value)?.source_node,
        start,
        end: start + name.length,
      });
    }
  }
});

Deno.test("semantic indexes expose every mutual binding with exact origins", () => {
  const source = "let rec even = value => odd(value)\n" +
    "and odd = value => even(value);\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  assert_equals([...analysis.symbols.keys()], ["even", "odd", "value"]);
  assert_equals(analysis.symbols.get("value")?.length, 2);
  for (const name of ["even", "odd"]) {
    const value = analysis.symbols.get(name)?.[0];
    if (value === undefined) {
      throw new Error("Expected a semantic identity for " + name);
    }
    const start = source.indexOf(name + " =");
    assert_equals(analysis.origins.get(value), {
      source_node: analysis.origins.get(value)?.source_node,
      start,
      end: start + name.length,
    });
  }
});

Deno.test("semantic origins exclude binder annotations", () => {
  for (
    const source of [
      "let x: I32 = 1;\nx;\n",
      "let { .x: I32 } = { .x = 1 };\nx;\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics, []);
    const value = analysis.symbols.get("x")?.[0];
    if (value === undefined) {
      throw new Error("Expected an exact origin for annotated binder x");
    }
    const start = source.indexOf("x");
    assert_equals(analysis.origins.get(value), {
      source_node: analysis.origins.get(value)?.source_node,
      start,
      end: start + 1,
    });
  }
});

Deno.test("unusable shorthand keywords never enter the semantic index", () => {
  for (
    const source of [
      "let { .true } = value;\n",
      "let { .false: I32 } = value;\n",
      "let { .let } = value;\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics.length > 0, true);
    assert_equals([...analysis.symbols.keys()], []);
  }
});
