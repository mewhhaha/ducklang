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

Deno.test("callable control flow flattens transient argument packs", () => {
  const source = "type select = (left: I32, right: I32) -> I32\n" +
    "let select = (left, right) => right;\n" +
    "type invoke = (left: I32, right: I32) -> I32\n" +
    "let invoke = (left, right) => select (left, right);\n" +
    "invoke (1, 2)\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(analysis.diagnostics, []);
  const select = analysis.symbols.get("select")?.[0];
  const invoke = analysis.symbols.get("invoke")?.[0];
  if (select === undefined || invoke === undefined) {
    throw new Error("Expected callable semantic identities.");
  }
  const callable = analysis.callable_control_flow.get(invoke);
  if (callable === undefined) {
    throw new Error("Expected invoke callable control flow.");
  }
  const [left, right] = callable.parameters;
  if (left === undefined || right === undefined) {
    throw new Error("Expected invoke parameter semantic identities.");
  }
  const call = callable.control_flow.blocks.flatMap((block) => block.nodes)
    .find((node) => node.operation.tag === "call");
  assert_equals(call?.inputs, [select, left, right]);
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

Deno.test("prefix signatures predeclare uncalled callable types", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type identity = (value: I32) -> (result: I32)\n" +
      "ensures result = value\n" +
      "let identity = value => value;\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 1);
  const identity = analysis.symbols.get("identity")?.[0];
  if (identity === undefined) {
    throw new Error("Expected the predeclared callable identity.");
  }
  assert_equals(analysis.types.get(identity), {
    tag: "function",
    params: [{ tag: "scalar", name: "I32" }],
    effects: [],
    result: { tag: "scalar", name: "I32" },
  });
});

Deno.test("named callables reject competing inline annotations", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type identity = (value: I32) -> (result: I32)\n" +
      "let identity: I32 -> I32 = value => value;\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("cannot combine")
    ),
    true,
  );
});

Deno.test("polymorphic prefix signatures retain quantified representations", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type identity = forall (a: Type). (value: a) -> (result: a)\n" +
      "ensures result = value\n" +
      "let identity = value => value;\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 1);
  const identity = analysis.symbols.get("identity")?.[0];
  if (identity === undefined) {
    throw new Error("Expected the polymorphic callable identity.");
  }
  assert_equals(analysis.types.get(identity), {
    tag: "forall",
    quantified_variables: [0],
    body: {
      tag: "function",
      params: [{ tag: "variable", id: 0, hint: "unknown" }],
      effects: [],
      result: { tag: "variable", id: 0, hint: "unknown" },
    },
  });
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

Deno.test("checked refinement signatures erase to their base representation", () => {
  const refined_source = "type identity = " +
    "(value: {refined: I32 | refined = refined}) -> " +
    "(result: {answer: I32 | answer = value})\n" +
    "let identity = value => value;\n" +
    "identity 42\n";
  const plain_source = "let identity = value => value;\n" +
    "identity 42\n";
  const refined = analyze_duck_source(parse_duck_source(refined_source));
  const plain = analyze_duck_source(parse_duck_source(plain_source));
  assert_equals(refined.diagnostics, []);
  assert_equals(refined.proofs.size, 2);
  const refined_program = checked_value(lower_duck_source(refined));
  const plain_program = checked_value(lower_duck_source(plain));
  if (refined_program === undefined || plain_program === undefined) {
    throw new Error("Expected refined and plain programs to lower.");
  }
  assert_equals(refined_program.core, plain_program.core);
  assert_equals(
    JSON.stringify(refined_program.core).includes("refinement"),
    false,
  );

  const reflexive = analyze_duck_source(parse_duck_source(
    "type identity = (value: I32) -> " +
      "{answer: I32 | answer = answer}\n" +
      "let identity = value => value;\n" +
      "identity 42\n",
  ));
  assert_equals(reflexive.diagnostics, []);
  assert_equals(reflexive.proofs.size, 1);

  const unproved = analyze_duck_source(parse_duck_source(
    "type identity = (value: I32) -> {answer: I32 | answer = 0}\n" +
      "let identity = value => value;\n" +
      "identity 42\n",
  ));
  assert_equals(
    unproved.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("does not match the inferred")
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(unproved)), undefined);

  const unchecked_parameter = analyze_duck_source(parse_duck_source(
    "type divide = " +
      "(value: {nonzero: I32 | nonzero != 0}) -> I32\n" +
      "let divide = value => value;\n" +
      "divide 0\n",
  ));
  assert_equals(
    unchecked_parameter.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "disproved: call to divide cannot prove parameter refinement",
      )
    ),
    true,
  );
  assert_equals(
    checked_value(lower_duck_source(unchecked_parameter)),
    undefined,
  );

  const captured_result = analyze_duck_source(parse_duck_source(
    "type f = (result: I32) -> {answer: I32 | answer = result}\n" +
      "let f = ignored => 0;\n" +
      "f 42\n",
  ));
  assert_equals(
    captured_result.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes(
        "cannot use reserved result as a parameter binder",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(captured_result)), undefined);
});

Deno.test("direct proof declarations are kernel checked and erased", () => {
  const proof_source =
    "type reflexive = (value: I32) -> Proof value = value\n" +
    "let reflexive = actual => by refl;\n" +
    "42\n";
  const proof_analysis = analyze_duck_source(
    parse_duck_source(proof_source),
  );
  const plain_analysis = analyze_duck_source(parse_duck_source("42\n"));
  assert_equals(proof_analysis.diagnostics, []);
  assert_equals(proof_analysis.symbols.has("reflexive"), false);
  assert_equals([...proof_analysis.proofs.keys()], [
    "root:reflexive:proof",
  ]);
  const checked_certificate = [...proof_analysis.proofs.values()][0];
  if (checked_certificate === undefined) {
    throw new Error("Expected a checked proof certificate.");
  }
  assert_equals(checked_certificate.certificate.safety, { tag: "safe" });
  assert_equals(
    check_certificate(
      checked_certificate.certificate,
      checked_certificate.certificate.proposition,
      {
        environment: checked_certificate.environment,
        term_context: checked_certificate.term_context,
        require_safe: true,
      },
    ),
    checked_certificate.certificate,
  );
  const proof_program = checked_value(lower_duck_source(proof_analysis));
  const plain_program = checked_value(lower_duck_source(plain_analysis));
  if (proof_program === undefined || plain_program === undefined) {
    throw new Error("Expected proof and plain programs to lower.");
  }
  assert_equals(proof_program.core, plain_program.core);
  assert_equals(JSON.stringify(proof_program.core).includes("proof"), false);

  const polymorphic = analyze_duck_source(parse_duck_source(
    "type reflexive = " +
      "forall (a: Type). (value: a) -> Proof value = value\n" +
      "let reflexive = actual => by refl;\n42\n",
  ));
  assert_equals(polymorphic.diagnostics, []);
  assert_equals(polymorphic.proofs.size, 1);
});

Deno.test("direct proof hypotheses alpha rename and compose", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type both = " +
      "(left: Proof True, right: Proof True) -> Proof True and True\n" +
      "let both = (first, second) => by and_intro(first, second,);\n" +
      "42\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 1);
  assert_equals(
    checked_value(lower_duck_source(analysis))?.core.statements,
    [{ tag: "expr", expr: { tag: "num", type: "i32", value: 42 } }],
  );
});

Deno.test("runtime callables erase explicit proof parameters from Core", () => {
  const proved = analyze_duck_source(parse_duck_source(
    "type identity = " +
      "(value: I32, evidence: Proof value = value) -> I32\n" +
      "let identity = (actual, evidence) => actual;\n" +
      "identity 42\n",
  ));
  const plain = analyze_duck_source(parse_duck_source(
    "type identity = (value: I32) -> I32\n" +
      "let identity = actual => actual;\n" +
      "identity 42\n",
  ));
  assert_equals(proved.diagnostics, []);
  assert_equals(plain.diagnostics, []);
  assert_equals(proved.proofs.size, 1);
  assert_equals(
    checked_value(lower_duck_source(proved))?.core,
    checked_value(lower_duck_source(plain))?.core,
  );
});

Deno.test("closed machine literals discharge nonzero call obligations", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value != 0) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "consume 1\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 1);
  assert_equals(
    checked_value(lower_duck_source(analysis))?.core.statements.length,
    2,
  );
});

Deno.test("closed machine literals discharge ordered call obligations", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(left: I32, right: I32, evidence: Proof left < right) -> I32\n" +
      "let consume = (actual_left, actual_right, evidence) => actual_left;\n" +
      "consume (1, 2)\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 1);
  assert_equals(
    checked_value(lower_duck_source(analysis))?.core.statements.length,
    2,
  );
});

Deno.test("proof-only runtime callables erase to zero parameters", () => {
  const constant = analyze_duck_source(parse_duck_source(
    "type constant = (evidence: Proof True) -> I32\n" +
      "let constant = evidence => 42;\n" +
      "constant()\n",
  ));
  assert_equals(constant.diagnostics, []);
  assert_equals(
    checked_value(lower_duck_source(constant))?.core.statements.length,
    2,
  );
});

Deno.test("explicit proof parameters propagate exact contextual evidence", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value != 0) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type forward = " +
      "(value: I32, evidence: Proof value != 0) -> I32\n" +
      "let forward = (actual, evidence) => consume actual;\n" +
      "42\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 1);
  const program = checked_value(lower_duck_source(analysis));
  if (program === undefined) {
    throw new Error("Expected contextual proof evidence to reach Core.");
  }
  assert_equals(
    JSON.stringify(program.core).includes("evidence"),
    false,
  );
});

Deno.test("true comparison branches establish call evidence", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value != 0) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32) -> I32\n" +
      "let guarded = actual => " +
      "if actual != 0 then consume actual else 0 end;\n" +
      "guarded 1\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 1);
  assert_equals(
    [...analysis.proofs.values()][0]?.semantic_certificate?.tag,
    "machine_fact",
  );
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("false comparison branches establish call evidence", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value != 0) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32) -> I32\n" +
      "let guarded = actual => " +
      "if actual == 0 then 0 else consume actual end;\n" +
      "guarded 1\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 1);
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("remainder branches establish exact expression evidence", () => {
  for (
    const [value_type, divisor, expected] of [
      ["I32", "4i32", "0i32"],
      ["U32", "4u32", "0u32"],
      ["I64", "4i64", "0i64"],
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(
      "type consume = " +
        `(value: ${value_type}, evidence: Proof ` +
        `value % ${divisor} = ${expected}) -> ${value_type}\n` +
        "let consume = (actual, evidence) => actual;\n" +
        `type guarded = (value: ${value_type}) -> ${value_type}\n` +
        "let guarded = actual => " +
        `if actual % ${divisor} == ${expected} ` +
        `then consume actual else ${expected} end;\n` +
        `guarded ${divisor}\n`,
    ));
    assert_equals(analysis.diagnostics, []);
    assert_equals(
      [...analysis.proofs.values()][0]?.semantic_certificate?.tag,
      "remainder_fact",
    );
    assert_equals(
      checked_value(lower_duck_source(analysis)) !== undefined,
      true,
    );
  }
});

Deno.test("bitwise branches establish certified machine facts", () => {
  const odd = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value != 2i32) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32) -> I32\n" +
      "let guarded = actual => do\n" +
      "  let masked = @bit_and(actual, 1i32);\n" +
      "  if masked == 1i32 then consume actual else 0 end\n" +
      "end;\n" +
      "guarded 3\n",
  ));
  assert_equals(odd.diagnostics, []);
  assert_equals(
    [...odd.proofs.values()][0]?.semantic_certificate?.tag,
    "machine_fact",
  );
  assert_equals(checked_value(lower_duck_source(odd)) !== undefined, true);

  const exact = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value = 2i32) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32) -> I32\n" +
      "let guarded = actual => " +
      "if @bit_xor(actual, 1i32) == 3i32 " +
      "then consume actual else 0 end;\n" +
      "guarded 2\n",
  ));
  assert_equals(exact.diagnostics, []);
  assert_equals(
    [...exact.proofs.values()][0]?.semantic_certificate?.tag,
    "machine_fact",
  );
  assert_equals(checked_value(lower_duck_source(exact)) !== undefined, true);

  const mixed_phi = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value != 2i32) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32, alternate: I32, choose: Bool) -> I32\n" +
      "let guarded = (actual, alternate, choose) => do\n" +
      "  let masked = if choose then @bit_and(actual, 1i32) " +
      "else alternate end;\n" +
      "  if masked == 1i32 then consume actual else 0 end\n" +
      "end;\n" +
      "guarded (3, 1, false)\n",
  ));
  assert_equals(
    mixed_phi.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2604"),
    true,
  );

  const loop_alias = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value != 2i32) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type run = (value: I32) -> I32\n" +
      "let run = actual => do\n" +
      "  for index in 0..3 do\n" +
      "    let masked = @bit_and(actual, 1i32);\n" +
      "    if masked == 1i32 then consume actual else index end;\n" +
      "  end;\n" +
      "  0\n" +
      "end;\n" +
      "run 3\n",
  ));
  assert_equals(
    loop_alias.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2604"),
    true,
  );
});

Deno.test("remainder branches establish transparent modular facts", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type multiple_of_four = (value: I32) -> Prop\n" +
      "fact multiple_of_four = value => value % 4i32 = 0i32;\n" +
      "type consume = " +
      "(value: I32, evidence: Proof multiple_of_four(value)) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32) -> I32\n" +
      "let guarded = actual => " +
      "if actual % 4i32 == 0i32 then consume actual else 0 end;\n" +
      "guarded 8\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(
    [...analysis.proofs.values()][0]?.semantic_certificate?.tag,
    "remainder_fact",
  );
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("remainder branches establish zero-residue divisibility facts", () => {
  for (
    const [value_type, premise_divisor, goal_divisor, zero, argument] of [
      ["I32", "4i32", "2i32", "0i32", "(-8i32)"],
      ["U32", "6u32", "3u32", "0u32", "12u32"],
      ["I64", "10i64", "5i64", "0i64", "(-20i64)"],
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(
      "type consume = " +
        `(value: ${value_type}, evidence: Proof ` +
        `value % ${goal_divisor} = ${zero}) -> ${value_type}\n` +
        "let consume = (actual, evidence) => actual;\n" +
        `type guarded = (value: ${value_type}) -> ${value_type}\n` +
        "let guarded = actual => " +
        `if actual % ${premise_divisor} == ${zero} ` +
        `then consume actual else ${zero} end;\n` +
        `guarded ${argument}\n`,
    ));
    assert_equals(analysis.diagnostics, []);
    assert_equals(
      [...analysis.proofs.values()][0]?.semantic_certificate?.tag,
      "remainder_divisibility",
    );
    assert_equals(
      checked_value(lower_duck_source(analysis)) !== undefined,
      true,
    );
  }
});

Deno.test("remainder divisibility recognizes reversed logical equality", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof 0i32 = value % 2i32) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32) -> I32\n" +
      "let guarded = actual => " +
      "if actual % 4i32 == 0i32 then consume actual else 0 end;\n" +
      "guarded (-8i32)\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(
    [...analysis.proofs.values()][0]?.semantic_certificate?.tag,
    "remainder_divisibility",
  );
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("remainder divisibility establishes transparent modular facts", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type even = (value: I32) -> Prop\n" +
      "fact even = value => value % 2i32 = 0i32;\n" +
      "type consume = " +
      "(value: I32, evidence: Proof even(value)) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32) -> I32\n" +
      "let guarded = actual => " +
      "if actual % 4i32 != 0i32 then 0 else consume actual end;\n" +
      "guarded 8\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(
    [...analysis.proofs.values()][0]?.semantic_certificate?.tag,
    "remainder_divisibility",
  );
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("remainder divisibility rejects unsupported modular implications", () => {
  for (
    const [condition, requirement] of [
      ["actual % 3i32 == 0i32", "value % 2i32 = 0i32"],
      ["actual % 4i32 == 1i32", "value % 2i32 = 0i32"],
      ["actual % 4i32 == -1i32", "value % 2i32 = 0i32"],
      ["actual % 4i32 != 0i32", "value % 2i32 = 0i32"],
      ["actual % 4i32 == 0i32", "value % 2i32 = 1i32"],
      ["actual % 4i32 == 0i32", "value % -2i32 = 0i32"],
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(
      "type consume = " +
        `(value: I32, evidence: Proof ${requirement}) -> I32\n` +
        "let consume = (actual, evidence) => actual;\n" +
        "type guarded = (value: I32) -> I32\n" +
        `let guarded = actual => if ${condition} ` +
        "then consume actual else 0 end;\n" +
        "guarded 8\n",
    ));
    assert_equals(
      analysis.diagnostics.some((diagnostic) =>
        diagnostic.code === "DUCK2604" &&
        diagnostic.message.includes(
          "unknown: call to consume cannot prove proof parameter evidence",
        )
      ),
      true,
    );
    assert_equals(checked_value(lower_duck_source(analysis)), undefined);
  }
});

Deno.test("remainder divisibility stays bound to the dividend identity", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value % 2i32 = 0i32) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (left: I32, right: I32) -> I32\n" +
      "let guarded = (left, right) => " +
      "if left % 4i32 == 0i32 then consume right else 0 end;\n" +
      "guarded (8, 3)\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("remainder divisibility rejects calls repeated by loops", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value % 2i32 = 0i32) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32) -> I32\n" +
      "let guarded = actual => do\n" +
      "  for index in 0..3 do\n" +
      "    if actual % 4i32 == 0i32 then consume actual else index end;\n" +
      "  end;\n" +
      "  0\n" +
      "end;\n" +
      "guarded 8\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("remainder divisibility rejects alternate remainder identities across joins", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value % 2i32 = 0i32) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32, choose: Bool) -> I32\n" +
      "let guarded = (actual, choose) => do\n" +
      "  let remainder = if choose then actual % 4i32 " +
      "else actual % 4i32 end;\n" +
      "  if remainder == 0i32 then consume actual else 0 end\n" +
      "end;\n" +
      "guarded (8, true)\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("remainder divisibility returns unknown after its path budget", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value % 2i32 = 0i32) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = " +
      "(value: I32, a: Bool, b: Bool, c: Bool, d: Bool, e: Bool) -> I32\n" +
      "let guarded = (actual, a, b, c, d, e) => " +
      "if actual % 4i32 != 0i32 then 0 else do\n" +
      "  let one = if a then 1 else 2 end;\n" +
      "  let two = if b then 1 else 2 end;\n" +
      "  let three = if c then 1 else 2 end;\n" +
      "  let four = if d then 1 else 2 end;\n" +
      "  let five = if e then 1 else 2 end;\n" +
      "  consume actual + one - one + two - two + three - three + " +
      "four - four + five - five\n" +
      "end end;\n" +
      "guarded (8, true, true, true, true, true)\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("remainder evidence stays bound to its divisor and result", () => {
  for (
    const condition of [
      "actual % 3i32 == 0i32",
      "actual % 4i32 == 1i32",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(
      "type consume = " +
        "(value: I32, evidence: Proof value % 4i32 = 0i32) -> I32\n" +
        "let consume = (actual, evidence) => actual;\n" +
        "type guarded = (value: I32) -> I32\n" +
        `let guarded = actual => if ${condition} ` +
        "then consume actual else 0 end;\n" +
        "guarded 8\n",
    ));
    assert_equals(
      analysis.diagnostics.some((diagnostic) =>
        diagnostic.code === "DUCK2604" &&
        diagnostic.message.includes(
          "unknown: call to consume cannot prove proof parameter evidence",
        )
      ),
      true,
    );
    assert_equals(checked_value(lower_duck_source(analysis)), undefined);
  }
});

Deno.test("remainder evidence follows exact equality branch polarity", () => {
  for (
    const [condition, then_branch, else_branch] of [
      [
        "0i32 == actual % 4i32",
        "consume actual",
        "0",
      ],
      [
        "actual % 4i32 != 0i32",
        "0",
        "consume actual",
      ],
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(
      "type consume = " +
        "(value: I32, evidence: Proof value % 4i32 = 0i32) -> I32\n" +
        "let consume = (actual, evidence) => actual;\n" +
        "type guarded = (value: I32) -> I32\n" +
        `let guarded = actual => if ${condition} then ` +
        `${then_branch} else ${else_branch} end;\n` +
        "guarded 8\n",
    ));
    assert_equals(analysis.diagnostics, []);
    assert_equals(
      [...analysis.proofs.values()][0]?.semantic_certificate?.tag,
      "remainder_fact",
    );
    assert_equals(
      checked_value(lower_duck_source(analysis)) !== undefined,
      true,
    );
  }
});

Deno.test("remainder evidence stays bound to its dividend identity", () => {
  const changed_dividend = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value % 4i32 = 0i32) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (left: I32, right: I32) -> I32\n" +
      "let guarded = (left, right) => " +
      "if left % 4i32 == 0i32 then consume right else 0 end;\n" +
      "guarded (8, 3)\n",
  ));
  assert_equals(
    changed_dividend.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(changed_dividend)), undefined);

  const alias = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value % 4i32 = 0i32) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32) -> I32\n" +
      "let guarded = actual => do\n" +
      "  let alias = actual;\n" +
      "  if actual % 4i32 == 0i32 then consume alias else 0 end\n" +
      "end;\n" +
      "guarded 8\n",
  ));
  assert_equals(
    alias.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(alias)), undefined);
});

Deno.test("duplicate exact remainder computations preserve evidence", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value % 4i32 = 0i32) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32) -> I32\n" +
      "let guarded = actual => " +
      "if actual % 4i32 == 0i32 then do\n" +
      "  let duplicate = actual % 4i32;\n" +
      "  consume actual + duplicate\n" +
      "end else 0 end;\n" +
      "guarded 8\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(
    [...analysis.proofs.values()][0]?.semantic_certificate?.tag,
    "remainder_fact",
  );
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("remainder certificates reject calls repeated by loops", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value % 4i32 = 0i32) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32) -> I32\n" +
      "let guarded = actual => do\n" +
      "  for index in 0..3 do\n" +
      "    if actual % 4i32 == 0i32 then consume actual else index end;\n" +
      "  end;\n" +
      "  0\n" +
      "end;\n" +
      "guarded 8\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("bounded offsets establish ordered result evidence", () => {
  for (
    const [value_type, requirement, body, argument] of [
      [
        "I32",
        "value <= 10i32",
        "if actual < 10i32 then do " +
        "let next = actual + 1i32; consume next end else 0 end",
        "9i32",
      ],
      [
        "U32",
        "value <= 10u32",
        "if actual >= 10u32 then 0u32 else do " +
        "let next = actual + 1u32; consume next end end",
        "9u32",
      ],
      [
        "I64",
        "value < 10i64",
        "if actual < 9i64 then do " +
        "let next = actual - (-1i64); consume next end else 0i64 end",
        "8i64",
      ],
      [
        "I32",
        "9i32 < value",
        "if 10i32 < actual then do " +
        "let next = actual - 1i32; consume next end else 0 end",
        "11i32",
      ],
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(
      "type consume = " +
        `(value: ${value_type}, evidence: Proof ${requirement}) -> ` +
        `${value_type}\n` +
        "let consume = (actual, evidence) => actual;\n" +
        `type guarded = (value: ${value_type}) -> ${value_type}\n` +
        `let guarded = actual => ${body};\n` +
        `guarded ${argument}\n`,
    ));
    assert_equals(analysis.diagnostics, []);
    assert_equals(
      [...analysis.proofs.values()][0]?.semantic_certificate?.tag,
      "bounded_offset",
    );
    assert_equals(
      checked_value(lower_duck_source(analysis)) !== undefined,
      true,
    );
  }
});

Deno.test("bounded offsets establish transparent ordered facts", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type at_most_ten = (value: I32) -> Prop\n" +
      "fact at_most_ten = value => value <= 10i32;\n" +
      "type consume = " +
      "(value: I32, evidence: Proof at_most_ten(value)) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32) -> I32\n" +
      "let guarded = actual => if actual < 10i32 then do\n" +
      "  let next = actual + 1i32;\n" +
      "  consume next\n" +
      "end else 0 end;\n" +
      "guarded 9i32\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(
    [...analysis.proofs.values()][0]?.semantic_certificate?.tag,
    "bounded_offset",
  );
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("bounded offsets reject operations outside the one-hop boundary", () => {
  for (
    const body of [
      "do let next = actual + 1i32; " +
      "if actual < 10i32 then consume next else 0 end end",
      "if choose then do let next = actual + 1i32; " +
      "consume next end else 0 end",
      "if actual < 10i32 then do let next = 1i32 + actual; " +
      "consume next end else 0 end",
      "if actual < 9i32 then do let next = actual + 1i32 + 1i32; " +
      "consume next end else 0 end",
      "if actual < 10i32 then do let next = actual + 1i32; " +
      "let alias = next; consume alias end else 0 end",
      "if actual < 10i32 then do " +
      "let next = if choose then actual + 1i32 else actual + 1i32 end; " +
      "consume next end else 0 end",
      "do let alias = actual; if alias < 10i32 then do " +
      "let next = actual + 1i32; consume next end else 0 end end",
      "do let alias = if choose then actual else actual end; " +
      "if alias < 10i32 then do let next = actual + 1i32; " +
      "consume next end else 0 end end",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(
      "type consume = " +
        "(value: I32, evidence: Proof value <= 10i32) -> I32\n" +
        "let consume = (actual, evidence) => actual;\n" +
        "type guarded = (value: I32, choose: Bool) -> I32\n" +
        `let guarded = (actual, choose) => ${body};\n` +
        "guarded (9i32, true)\n",
    ));
    assert_equals(
      analysis.diagnostics.some((diagnostic) =>
        diagnostic.code === "DUCK2604" &&
        diagnostic.message.includes(
          "unknown: call to consume cannot prove proof parameter evidence",
        )
      ),
      true,
    );
    assert_equals(checked_value(lower_duck_source(analysis)), undefined);
  }
});

Deno.test("bounded offsets drop facts when arithmetic may wrap", () => {
  for (
    const [value_type, requirement, condition, expression, zero, argument] of [
      [
        "I32",
        "value <= 2147483647i32",
        "actual <= 2147483647i32",
        "actual + 1i32",
        "0i32",
        "2147483647i32",
      ],
      [
        "U32",
        "0u32 <= value",
        "0u32 <= actual",
        "actual - 1u32",
        "0u32",
        "0u32",
      ],
      [
        "I64",
        "value <= 9223372036854775807i64",
        "actual <= 9223372036854775807i64",
        "actual + 1i64",
        "0i64",
        "9223372036854775807i64",
      ],
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(
      "type consume = " +
        `(value: ${value_type}, evidence: Proof ${requirement}) -> ` +
        `${value_type}\n` +
        "let consume = (actual, evidence) => actual;\n" +
        `type guarded = (value: ${value_type}) -> ${value_type}\n` +
        `let guarded = actual => if ${condition} then do ` +
        `let next = ${expression}; consume next end else ${zero} end;\n` +
        `guarded ${argument}\n`,
    ));
    assert_equals(
      analysis.diagnostics.some((diagnostic) =>
        diagnostic.code === "DUCK2604" &&
        diagnostic.message.includes(
          "unknown: call to consume cannot prove proof parameter evidence",
        )
      ),
      true,
    );
    assert_equals(checked_value(lower_duck_source(analysis)), undefined);
  }
});

Deno.test("bounded offset certificates reject calls repeated by loops", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value <= 10i32) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32) -> I32\n" +
      "let guarded = actual => do\n" +
      "  for index in 0..3 do\n" +
      "    if actual < 10i32 then do\n" +
      "      let next = actual + 1i32;\n" +
      "      consume next\n" +
      "    end else index end;\n" +
      "  end;\n" +
      "  0\n" +
      "end;\n" +
      "guarded 9i32\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("bounded offset inference returns unknown after its path budget", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value <= 10i32) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = " +
      "(value: I32, a: Bool, b: Bool, c: Bool, d: Bool, e: Bool) -> I32\n" +
      "let guarded = (actual, a, b, c, d, e) => " +
      "if actual >= 10i32 then 0 else do\n" +
      "  let one = if a then 1 else 2 end;\n" +
      "  let two = if b then 1 else 2 end;\n" +
      "  let three = if c then 1 else 2 end;\n" +
      "  let four = if d then 1 else 2 end;\n" +
      "  let five = if e then 1 else 2 end;\n" +
      "  let next = actual + 1i32;\n" +
      "  consume next + one - one + two - two + three - three + " +
      "four - four + five - five\n" +
      "end end;\n" +
      "guarded (9, true, true, true, true, true)\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("ordered comparison branches establish call evidence", () => {
  for (
    const [requirement, condition, then_branch, else_branch] of [
      ["value < 10", "actual < 10", "consume actual", "0"],
      ["value < 10", "actual >= 10", "0", "consume actual"],
      ["10 <= value", "actual >= 10", "consume actual", "0"],
      ["10 <= value", "actual < 10", "0", "consume actual"],
      ["10 < value", "actual > 10", "consume actual", "0"],
      ["value <= 10", "actual > 10", "0", "consume actual"],
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(
      "type consume = " +
        `(value: I32, evidence: Proof ${requirement}) -> I32\n` +
        "let consume = (actual, evidence) => actual;\n" +
        "type guarded = (value: I32) -> I32\n" +
        `let guarded = actual => if ${condition} then ` +
        `${then_branch} else ${else_branch} end;\n` +
        "guarded 5\n",
    ));
    assert_equals(analysis.diagnostics, []);
    assert_equals(analysis.proofs.size, 1);
    assert_equals(
      checked_value(lower_duck_source(analysis)) !== undefined,
      true,
    );
  }
});

Deno.test("ordered value comparisons establish exact branch evidence", () => {
  const branch_cases = [
    {
      condition: "a < b",
      true_requirement: "left < right",
      false_requirement: "right <= left",
    },
    {
      condition: "a <= b",
      true_requirement: "left <= right",
      false_requirement: "right < left",
    },
    {
      condition: "a > b",
      true_requirement: "right < left",
      false_requirement: "left <= right",
    },
    {
      condition: "a >= b",
      true_requirement: "right <= left",
      false_requirement: "left < right",
    },
  ];
  for (const value_type of ["I32", "U32"]) {
    for (const branch_case of branch_cases) {
      for (
        const [requirement, then_branch, else_branch] of [
          [branch_case.true_requirement, "consume (a, b)", "a"],
          [branch_case.false_requirement, "a", "consume (a, b)"],
        ]
      ) {
        let literal_suffix = "";
        if (value_type === "U32") literal_suffix = "u32";
        const analysis = analyze_duck_source(parse_duck_source(
          "type consume = " +
            `(left: ${value_type}, right: ${value_type}, ` +
            `evidence: Proof ${requirement}) -> ${value_type}\n` +
            "let consume = (a, b, evidence) => a;\n" +
            "type guarded = " +
            `(left: ${value_type}, right: ${value_type}) -> ${value_type}\n` +
            "let guarded = (a, b) => " +
            `if ${branch_case.condition} then ${then_branch} ` +
            `else ${else_branch} end;\n` +
            `guarded (5${literal_suffix}, 10${literal_suffix})\n`,
        ));
        assert_equals(analysis.diagnostics, []);
        assert_equals(analysis.proofs.size, 1);
        assert_equals(
          checked_value(lower_duck_source(analysis)) !== undefined,
          true,
        );
      }
    }
  }
});

Deno.test("ordered value comparison evidence rejects opposite branches", () => {
  const branch_cases = [
    {
      condition: "a < b",
      true_requirement: "right <= left",
      false_requirement: "left < right",
    },
    {
      condition: "a <= b",
      true_requirement: "right < left",
      false_requirement: "left <= right",
    },
    {
      condition: "a > b",
      true_requirement: "left <= right",
      false_requirement: "right < left",
    },
    {
      condition: "a >= b",
      true_requirement: "left < right",
      false_requirement: "right <= left",
    },
  ];
  for (const value_type of ["I32", "U32"]) {
    for (const branch_case of branch_cases) {
      for (
        const [requirement, then_branch, else_branch] of [
          [branch_case.true_requirement, "consume (a, b)", "a"],
          [branch_case.false_requirement, "a", "consume (a, b)"],
        ]
      ) {
        const analysis = analyze_duck_source(parse_duck_source(
          "type consume = " +
            `(left: ${value_type}, right: ${value_type}, ` +
            `evidence: Proof ${requirement}) -> ${value_type}\n` +
            "let consume = (a, b, evidence) => a;\n" +
            "type guarded = " +
            `(left: ${value_type}, right: ${value_type}) -> ${value_type}\n` +
            "let guarded = (a, b) => " +
            `if ${branch_case.condition} then ${then_branch} ` +
            `else ${else_branch} end;\n` +
            "42\n",
        ));
        assert_equals(
          analysis.diagnostics.some((diagnostic) =>
            diagnostic.code === "DUCK2604"
          ),
          true,
        );
        assert_equals(checked_value(lower_duck_source(analysis)), undefined);
      }
    }
  }
});

Deno.test("ordered comparison evidence respects branch polarity", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value < 10) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type wrong = (value: I32) -> I32\n" +
      "let wrong = actual => " +
      "if actual < 10 then 0 else consume actual end;\n" +
      "42\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("false greater-than branches do not reverse operands", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof 10 <= value) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type wrong = (value: I32) -> I32\n" +
      "let wrong = actual => " +
      "if actual > 10 then 0 else consume actual end;\n" +
      "wrong 5\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("short-circuit conjunctions retain every required branch fact", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume_left = " +
      "(value: I32, evidence: Proof value != 0) -> I32\n" +
      "let consume_left = (actual, evidence) => actual;\n" +
      "type consume_right = " +
      "(value: I32, evidence: Proof value < 10) -> I32\n" +
      "let consume_right = (actual, evidence) => actual;\n" +
      "type guarded = (left: I32, right: I32) -> I32\n" +
      "let guarded = (left, right) => " +
      "if left != 0 && right < 10 then " +
      "consume_left left + consume_right right else 0 end;\n" +
      "guarded (5, 7)\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 2);
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("FactGraph proves weaker bounds from short-circuit branches", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value < 20) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32, ready: I32) -> I32\n" +
      "let guarded = (actual, ready) => " +
      "if actual < 10 && ready != 0 then consume actual else 0 end;\n" +
      "guarded (5, 1)\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 1);
  assert_equals(
    [...analysis.proofs.values()][0]?.semantic_certificate?.tag,
    "machine_fact",
  );
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("short-circuit ordered facts preserve every machine polarity", () => {
  for (const value_type of ["I32", "U32"]) {
    let suffix = "";
    if (value_type === "U32") suffix = "u32";
    const bound = "10" + suffix;
    for (
      const [condition, true_requirement, false_requirement] of [
        [`actual < ${bound}`, `value < ${bound}`, `${bound} <= value`],
        [`actual <= ${bound}`, `value <= ${bound}`, `${bound} < value`],
        [`actual > ${bound}`, `${bound} < value`, `value <= ${bound}`],
        [`actual >= ${bound}`, `${bound} <= value`, `value < ${bound}`],
      ]
    ) {
      for (
        const [requirement, body] of [
          [
            true_requirement,
            `if ${condition} && ready != 0 then consume actual else actual end`,
          ],
          [
            false_requirement,
            `if ${condition} || ready != 0 then actual else consume actual end`,
          ],
        ]
      ) {
        const analysis = analyze_duck_source(parse_duck_source(
          "type consume = " +
            `(value: ${value_type}, evidence: Proof ${requirement}) -> ` +
            `${value_type}\n` +
            "let consume = (actual, evidence) => actual;\n" +
            `type guarded = (value: ${value_type}, ready: I32) -> ` +
            `${value_type}\n` +
            `let guarded = (actual, ready) => ${body};\n` +
            `guarded (5${suffix}, 1)\n`,
        ));
        assert_equals(analysis.diagnostics, []);
        assert_equals(analysis.proofs.size, 1);
        assert_equals(
          checked_value(lower_duck_source(analysis)) !== undefined,
          true,
        );
      }
    }
  }
});

Deno.test("false disjunction branches retain both negative facts", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value = 0) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (left: I32, right: I32) -> I32\n" +
      "let guarded = (left, right) => " +
      "if left != 0 || right != 0 then 1 else consume left end;\n" +
      "guarded (0, 0)\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 1);
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("true disjunction branches do not choose one sufficient fact", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value != 0) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type wrong = (left: I32, right: I32) -> I32\n" +
      "let wrong = (left, right) => " +
      "if left != 0 || right != 0 then consume left else 0 end;\n" +
      "42\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2604"),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("false conjunction branches do not choose one failed fact", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value = 0) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type wrong = (left: I32, right: I32) -> I32\n" +
      "let wrong = (left, right) => " +
      "if left != 0 && right != 0 then 1 else consume left end;\n" +
      "42\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2604"),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("statically unreachable calls do not require proof evidence", () => {
  for (
    const body of [
      "if false then consume actual else 0 end",
      "if 1 < 0 && actual < 10 then consume actual else 0 end",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(
      "type consume = " +
        "(value: I32, evidence: Proof value != 0) -> I32\n" +
        "let consume = (actual, evidence) => actual;\n" +
        "type unreachable = (value: I32) -> I32\n" +
        `let unreachable = actual => ${body};\n` +
        "unreachable 0\n",
    ));
    assert_equals(analysis.diagnostics, []);
    assert_equals(analysis.proofs.size, 0);
    assert_equals(
      checked_value(lower_duck_source(analysis)) !== undefined,
      true,
    );
  }
});

Deno.test("branch joins retain facts from every live predecessor", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value < 20) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type joined = (value: I32, ready: I32) -> I32\n" +
      "let joined = (actual, ready) => do\n" +
      "if ready != 0 then\n" +
      "if actual >= 20 then return 0; end;\n" +
      "else\n" +
      "if actual >= 10 then return 0; end;\n" +
      "end;\n" +
      "consume actual\n" +
      "end;\n" +
      "joined (15, 1)\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 1);
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("loop calls cannot reuse facts from only their first visit", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value = 0) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type run = () -> I32\n" +
      "let run = () => do\n" +
      "for index in 0..3 do consume index; end;\n" +
      "0\n" +
      "end;\n" +
      "run ()\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(analysis.proofs.size, 0);
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("range guards establish bounds on every loop visit", () => {
  for (
    const [range, requirement] of [
      ["0..3", "value < 3"],
      ["0..=3", "value <= 3"],
      ["3..0 by -1", "0 < value"],
      ["3..=0 by -1", "0 <= value"],
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(
      "type consume = " +
        `(value: I32, evidence: Proof ${requirement}) -> I32\n` +
        "let consume = (actual, evidence) => actual;\n" +
        "type run = () -> I32\n" +
        "let run = () => do\n" +
        `for index in ${range} do consume index; end;\n` +
        "0\n" +
        "end;\n" +
        "run ()\n",
    ));
    assert_equals(analysis.diagnostics, []);
    assert_equals(analysis.proofs.size, 1);
    assert_equals(
      [...analysis.proofs.values()][0]?.semantic_certificate?.tag,
      "machine_fact",
    );
    assert_equals(
      checked_value(lower_duck_source(analysis)) !== undefined,
      true,
    );
  }
});

Deno.test("short-circuit facts stay bound to their original ValueId", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value < 20) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type wrong = (value: I32, ready: I32) -> I32\n" +
      "let wrong = (actual, ready) => " +
      "if actual < 10 && ready != 0 then do " +
      "actual = 100; consume actual end else 0 end;\n" +
      "42\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2604"),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("comparison evidence does not cross branch joins", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value != 0) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type unguarded = (value: I32) -> I32\n" +
      "let unguarded = actual => do\n" +
      "if actual != 0 then actual else 1 end;\n" +
      "consume actual\n" +
      "end;\n" +
      "42\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("comparison evidence stays bound to its ValueId", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value != 0) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type changed = (value: I32) -> I32\n" +
      "let changed = actual => if actual != 0 then do\n" +
      "actual = 0;\n" +
      "consume actual\n" +
      "end else 0 end;\n" +
      "42\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("shadowed values cannot reuse contextual proof evidence", () => {
  const shadowed = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value != 0) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type forward = " +
      "(value: I32, evidence: Proof value != 0) -> I32\n" +
      "let forward = (actual, evidence) => do\n" +
      "let actual = 0;\n" +
      "consume actual\n" +
      "end;\n" +
      "42\n",
  ));
  assert_equals(
    shadowed.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(shadowed)), undefined);
});

Deno.test("erased proof evidence cannot become runtime data", () => {
  const used = analyze_duck_source(parse_duck_source(
    "type expose = " +
      "(value: I32, evidence: Proof value = value) -> I32\n" +
      "let expose = (actual, evidence) => evidence;\n" +
      "expose 42\n",
  ));
  assert_equals(
    used.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2605" &&
      diagnostic.message.includes(
        "Erased proof evidence evidence cannot be used as runtime data",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(used)), undefined);
});

Deno.test("assignment targets cannot reference erased proof evidence", () => {
  for (const operator of ["=", ":="]) {
    const assigned = analyze_duck_source(parse_duck_source(
      "type expose = (value: I32, evidence: Proof True) -> I32\n" +
        "let expose = (actual, evidence) => do\n" +
        `evidence ${operator} true;\n` +
        "actual\n" +
        "end;\n" +
        "expose 42\n",
    ));
    assert_equals(
      assigned.diagnostics.some((diagnostic) =>
        diagnostic.code === "DUCK2605" &&
        diagnostic.message.includes(
          "Erased proof evidence evidence cannot be used as runtime data",
        )
      ),
      true,
    );
    assert_equals(checked_value(lower_duck_source(assigned)), undefined);
  }
});

Deno.test("shadowed proof parameter names remain runtime values", () => {
  const shadowed = analyze_duck_source(parse_duck_source(
    "type expose = (value: I32, evidence: Proof True) -> I32\n" +
      "let expose = (actual, evidence) => do\n" +
      "let evidence = actual;\n" +
      "evidence\n" +
      "end;\n" +
      "42\n",
  ));
  assert_equals(
    shadowed.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2605" &&
      diagnostic.message.includes("Erased proof evidence")
    ),
    false,
  );
});

Deno.test("proof arguments cannot be supplied as runtime values", () => {
  const supplied = analyze_duck_source(parse_duck_source(
    "type expose = (evidence: Proof True) -> I32\n" +
      "let expose = evidence => 42;\n" +
      "expose true\n",
  ));
  assert_equals(
    supplied.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2605" &&
      diagnostic.message.includes(
        "erased signature accepts 0; proof arguments are implicit",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(supplied)), undefined);
});

Deno.test("proof-requiring callables cannot escape unchecked", () => {
  const escaped = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(value: I32, evidence: Proof value = value) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "let callback = consume;\n" +
      "callback\n",
  ));
  assert_equals(
    escaped.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "cannot be used as a runtime value without higher-order contract checking",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(escaped)), undefined);
});

Deno.test("custom operators reject proof-requiring targets", () => {
  for (const operands of ["1 === 1", "1 === 2"]) {
    const analysis = analyze_duck_source(parse_duck_source(
      "type consume = " +
        "(left: I32, right: I32, evidence: Proof left = right) -> I32\n" +
        "let consume = (left, right, evidence) => left;\n" +
        "infixl 60 === = consume\n" +
        operands + "\n",
    ));
    assert_equals(
      analysis.diagnostics.some((diagnostic) =>
        diagnostic.code === "DUCK2604" &&
        diagnostic.message.includes(
          "cannot be a custom fixity target until operator applications support contract checking",
        )
      ),
      true,
    );
    assert_equals(checked_value(lower_duck_source(analysis)), undefined);
  }
});

Deno.test("custom operators reject aliased proof-requiring targets", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type consume = " +
      "(left: I32, right: I32, evidence: Proof left = right) -> I32\n" +
      "let consume = (left, right, evidence) => left;\n" +
      "let alias = consume;\n" +
      "infixl 60 === = alias\n" +
      "1 === 1\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "cannot be a custom fixity target until operator applications support contract checking",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("direct proof eliminators produce checked kernel terms", () => {
  for (
    const source of [
      "type symmetric = " +
      "(left: I32, right: I32, equality: Proof right = left) -> " +
      "Proof left = right\n" +
      "let symmetric = (a, b, evidence) => by symm(evidence);\n42\n",
      "type chain = " +
      "(a: I32, b: I32, c: I32, first: Proof a = b, second: Proof b = c) -> " +
      "Proof a = c\n" +
      "let chain = (x, y, z, left, right) => by trans(left, right);\n42\n",
      "type project = (pair: Proof True and False) -> Proof True\n" +
      "let project = evidence => by and_left(evidence);\n42\n",
      "type apply_implication = " +
      "(function: Proof True implies False, argument: Proof True) -> " +
      "Proof False\n" +
      "let apply_implication = (f, value) => " +
      "by implies_apply(f, value);\n42\n",
      "type left_nested = " +
      "(value: I32, evidence: Proof True) -> Proof value = value\n" +
      "let left_nested = (value, evidence) => " +
      "by and_left(and_intro(refl, evidence));\n42\n",
      "type applied_refl = " +
      "(value: I32, function: Proof value = value implies True) -> " +
      "Proof True\n" +
      "let applied_refl = (value, function) => " +
      "by implies_apply(function, refl);\n42\n",
      "type left_identity = " +
      "(left: I32, right: I32, equality: Proof left = right) -> " +
      "Proof left = right\n" +
      "let left_identity = (left, right, equality) => " +
      "by trans(refl, equality);\n42\n",
      "type right_identity = " +
      "(left: I32, right: I32, equality: Proof left = right) -> " +
      "Proof left = right\n" +
      "let right_identity = (left, right, equality) => " +
      "by trans(equality, refl);\n42\n",
      "type literal_refl = () -> Proof 0 = 0i32\n" +
      "let literal_refl = () => by refl;\n42\n",
      "type predicate = (value: I32) -> Prop\n" +
      "opaque fact predicate = value => True;\n" +
      "type parenthesized = " +
      "(value: I32, evidence: Proof predicate(value)) -> " +
      "Proof predicate((value))\n" +
      "let parenthesized = (value, evidence) => by evidence;\n42\n",
      "type predicate = (value: I32) -> Prop\n" +
      "opaque fact predicate = value => True;\n" +
      "type numeric_atom = " +
      "(evidence: Proof predicate(0)) -> Proof predicate(0i32)\n" +
      "let numeric_atom = evidence => by evidence;\n42\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics, []);
    assert_equals(analysis.proofs.size, 1);
    assert_equals(
      checked_value(lower_duck_source(analysis)) !== undefined,
      true,
    );
  }
});

Deno.test("direct propositional proof terms produce checked kernel terms", () => {
  for (
    const source of [
      "type implication_identity = () -> Proof True implies True\n" +
      "let implication_identity = () => by evidence => evidence;\n42\n",
      "type not_false = () -> Proof not False\n" +
      "let not_false = () => by impossible => impossible;\n42\n",
      "type choose_left = " +
      "(evidence: Proof True) -> Proof True or False\n" +
      "let choose_left = value => by or_left(value);\n42\n",
      "type choose_right = " +
      "(evidence: Proof True) -> Proof False or True\n" +
      "let choose_right = value => by or_right(value);\n42\n",
      "type explosion = (evidence: Proof False) -> Proof True\n" +
      "let explosion = impossible => by false_elim(impossible);\n42\n",
      "type merge = (choice: Proof True or True) -> Proof True\n" +
      "let merge = choice => " +
      "by or_cases(choice, left => left, right => right,);\n42\n",
      "type retain_outer = " +
      "(outer: Proof True) -> Proof True implies True\n" +
      "let retain_outer = retained => by inner => retained;\n42\n",
      "type retain_case_outer = " +
      "(choice: Proof False or False, outer: Proof True) -> Proof True\n" +
      "let retain_case_outer = (choice, retained) => " +
      "by or_cases(choice, left => retained, right => retained);\n42\n",
      "type nested_implication = " +
      "() -> Proof True implies True implies True\n" +
      "let nested_implication = () => by first => second => first;\n42\n",
      "type shadow_implication = " +
      "(outer: Proof False) -> Proof True implies True\n" +
      "let shadow_implication = retained => by retained => retained;\n42\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics, []);
    assert_equals(analysis.proofs.size, 1);
    assert_equals(
      checked_value(lower_duck_source(analysis)) !== undefined,
      true,
    );
  }
});

Deno.test("invalid direct propositional proof terms fail before Core", () => {
  for (
    const [source, message] of [
      [
        "type bad = () -> Proof True\n" +
        "let bad = () => by evidence => evidence;\n42\n",
        "Proof lambda requires an implication, negation, or universal goal",
      ],
      [
        "type bad = (evidence: Proof True) -> Proof True\n" +
        "let bad = evidence => by or_left(evidence);\n42\n",
        "Disjunction introduction requires a disjunction goal",
      ],
      [
        "type bad = (evidence: Proof True) -> Proof True\n" +
        "let bad = evidence => " +
        "by or_cases(evidence, left => left, right => right);\n42\n",
        "or_cases requires a disjunction proof",
      ],
      [
        "type bad = (choice: Proof True or False) -> Proof True\n" +
        "let bad = choice => " +
        "by or_cases(choice, left => left, right => right);\n42\n",
        "Proof establishes False, not True",
      ],
      [
        "type bad = (evidence: Proof True) -> Proof False\n" +
        "let bad = evidence => by false_elim(evidence);\n42\n",
        "False elimination requires a proof of False",
      ],
      [
        "type bad = (choice: Proof True or True) -> Proof True\n" +
        "let bad = choice => " +
        "by or_cases(choice, left => left, right => left);\n42\n",
        "Unknown proof evidence left",
      ],
    ] as const
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(
      analysis.diagnostics.some((diagnostic) =>
        diagnostic.code === "DUCK2605" &&
        diagnostic.message.includes(message)
      ),
      true,
    );
    assert_equals(checked_value(lower_duck_source(analysis)), undefined);
  }
});

Deno.test("direct quantified proof terms produce checked kernel terms", () => {
  for (
    const source of [
      "type all_reflexive = " +
      "() -> Proof forall (value: I32). value = value\n" +
      "let all_reflexive = () => by value => refl;\n42\n",
      "type specialize = " +
      "(universal: Proof forall (value: I32). value = value, value: I32) -> " +
      "Proof value = value\n" +
      "let specialize = (all, actual) => " +
      "by forall_apply(all, actual);\n42\n",
      "type positional_specialize = " +
      "(left: I32, right: I32, " +
      "universal: Proof forall (value: I32). value = value) -> " +
      "Proof left = left\n" +
      "let positional_specialize = (right, actual, all) => " +
      "by forall_apply(all, right);\n42\n",
      "type specialize_literal = " +
      "(universal: Proof forall (value: I32). value = value) -> " +
      "Proof 0 = 0i32\n" +
      "let specialize_literal = all => by forall_apply(all, 0);\n42\n",
      "type witness = " +
      "(value: I32) -> Proof exists (found: I32). found = value\n" +
      "let witness = actual => by exists_intro(actual, refl);\n42\n",
      "type literal_witness = " +
      "() -> Proof exists (found: I32). found = 0\n" +
      "let literal_witness = () => by exists_intro(0i32, refl);\n42\n",
      "type unpack = " +
      "(existence: Proof exists (value: I32). True) -> Proof True\n" +
      "let unpack = package => " +
      "by exists_elim(package, witness, evidence => evidence);\n42\n",
      "type repack = " +
      "(package: Proof exists (value: I32). value = value) -> " +
      "Proof exists (copy: I32). copy = copy\n" +
      "let repack = package => " +
      "by exists_elim(" +
      "package, witness, evidence => exists_intro(witness, evidence));\n" +
      "42\n",
      "type retain_universal = " +
      "(outer: I32, evidence: Proof outer = outer) -> " +
      "Proof forall (inner: I32). outer = outer\n" +
      "let retain_universal = (outer, retained) => " +
      "by inner => retained;\n42\n",
      "type retain_existential = " +
      "(package: Proof exists (value: I32). True, " +
      "outer: I32, evidence: Proof outer = outer) -> Proof outer = outer\n" +
      "let retain_existential = (package, outer, retained) => " +
      "by exists_elim(package, witness, opened => retained);\n42\n",
      "type nested_universal = " +
      "() -> Proof forall (left: I32). forall (right: I32). left = left\n" +
      "let nested_universal = () => by left => right => refl;\n42\n",
      "type specialize_exists = " +
      "(universal: Proof forall (value: I32). " +
      "exists (witness: I32). value = value, actual: I32) -> " +
      "Proof exists (witness: I32). actual = actual\n" +
      "let specialize_exists = (universal, actual) => " +
      "by forall_apply(universal, actual);\n42\n",
      "type eliminate_under_universal = " +
      "(package: Proof exists (value: I32). True) -> " +
      "Proof forall (other: I32). True\n" +
      "let eliminate_under_universal = package => " +
      "by exists_elim(package, witness, evidence => other => evidence);\n" +
      "42\n",
      "type shadow_universal = " +
      "(outer: I32) -> Proof forall (outer: I32). outer = outer\n" +
      "let shadow_universal = actual => by actual => refl;\n42\n",
      "type predicate = (value: I32) -> Prop\n" +
      "opaque fact predicate = value => True;\n" +
      "type retain_quantified_predicate = " +
      "(universal: Proof forall (value: I32). predicate(value)) -> " +
      "Proof True\n" +
      "let retain_quantified_predicate = universal => by true_intro;\n42\n",
      "type predicate = (value: I32) -> Prop\n" +
      "opaque fact predicate = value => True;\n" +
      "type specialize_predicate = " +
      "(actual: I32, universal: Proof forall (value: I32). predicate(value)) -> " +
      "Proof predicate(actual)\n" +
      "let specialize_predicate = (actual, universal) => " +
      "by forall_apply(universal, actual);\n42\n",
      "type predicate = (value: I32) -> Prop\n" +
      "opaque fact predicate = value => True;\n" +
      "type witness_predicate = " +
      "(actual: I32, evidence: Proof predicate(actual)) -> " +
      "Proof exists (found: I32). predicate(found)\n" +
      "let witness_predicate = (actual, evidence) => " +
      "by exists_intro(actual, evidence);\n42\n",
      "type predicate = (value: I32) -> Prop\n" +
      "opaque fact predicate = value => True;\n" +
      "type preserve_predicate_witness = " +
      "(package: Proof exists (value: I32). predicate(value)) -> " +
      "Proof exists (copy: I32). predicate(copy)\n" +
      "let preserve_predicate_witness = package => " +
      "by exists_elim(package, witness, evidence => " +
      "exists_intro(witness, evidence));\n42\n",
      "type ordered_identity = () -> " +
      "Proof forall (value: I32). value < value implies value < value\n" +
      "let ordered_identity = () => by value => evidence => evidence;\n42\n",
      "type held_identity = () -> " +
      "Proof forall (value: Bool). value implies value\n" +
      "let held_identity = () => by value => evidence => evidence;\n42\n",
      "type type_test_identity = () -> " +
      "Proof forall (value: I32). (value is I32) implies (value is I32)\n" +
      "let type_test_identity = () => by value => evidence => evidence;\n42\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics, []);
    assert_equals(analysis.proofs.size, 1);
    assert_equals(
      checked_value(lower_duck_source(analysis)) !== undefined,
      true,
    );
  }
});

Deno.test("direct equality transformations produce checked kernel terms", () => {
  for (
    const source of [
      "type mapped = " +
      "(left: I32, right: I32, equality: Proof left = right) -> " +
      "Proof left = right\n" +
      "let mapped = (left, right, equality) => " +
      "by congr(value => value, equality);\n42\n",
      "type constant_map = " +
      "(left: I32, right: I32, equality: Proof left = right) -> " +
      "Proof true = true\n" +
      "let constant_map = (left, right, equality) => " +
      "by congr(value => true, equality);\n42\n",
      "type substitute_reflexivity = " +
      "(left: I32, right: I32, equality: Proof left = right, " +
      "evidence: Proof left = left) -> Proof right = right\n" +
      "let substitute_reflexivity = (left, right, equality, evidence) => " +
      "by transport(equality, value => value = value, evidence);\n42\n",
      "type predicate = (value: I32) -> Prop\n" +
      "opaque fact predicate = value => True;\n" +
      "type substitute = " +
      "(left: I32, right: I32, equality: Proof left = right, " +
      "evidence: Proof predicate(left)) -> Proof predicate(right)\n" +
      "let substitute = (left, right, equality, evidence) => " +
      "by transport(equality, value => predicate(value), evidence);\n42\n",
      "type predicate = (value: I32) -> Prop\n" +
      "opaque fact predicate = value => True;\n" +
      "type shadowed_substitute = " +
      "(left: I32, right: I32, equality: Proof left = right, " +
      "evidence: Proof predicate(left)) -> Proof predicate(right)\n" +
      "let shadowed_substitute = (actual_left, actual_right, same, known) => " +
      "by transport(same, actual_left => predicate(actual_left), known);\n" +
      "42\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(analysis.diagnostics, []);
    assert_equals(analysis.proofs.size, 1);
    assert_equals(
      checked_value(lower_duck_source(analysis)) !== undefined,
      true,
    );
  }
});

Deno.test("invalid equality transformations fail before Core", () => {
  for (
    const [source, message] of [
      [
        "type bad = (evidence: Proof True) -> Proof True\n" +
        "let bad = evidence => by congr(value => value, evidence);\n42\n",
        "congr requires an equality proof",
      ],
      [
        "type bad = (evidence: Proof True) -> Proof True\n" +
        "let bad = evidence => " +
        "by transport(evidence, value => True, evidence);\n42\n",
        "transport requires an equality proof",
      ],
      [
        "type bad = " +
        "(left: I32, right: I32, equality: Proof left = right) -> " +
        "Proof left = right\n" +
        "let bad = (left, right, equality) => " +
        "by congr(value => value + 1, equality);\n42\n",
        "Unsupported congruence function value + 1",
      ],
      [
        "type predicate = (value: I32) -> Prop\n" +
        "opaque fact predicate = value => True;\n" +
        "type bad = " +
        "(left: I32, right: I32, equality: Proof left = right, " +
        "evidence: Proof predicate(right)) -> Proof predicate(right)\n" +
        "let bad = (left, right, equality, evidence) => " +
        "by transport(equality, value => predicate(value), evidence);\n42\n",
        "Proof establishes fact:root:predicate(#1), not fact:root:predicate(#0)",
      ],
      [
        "type predicate = (value: I32) -> Prop\n" +
        "opaque fact predicate = value => True;\n" +
        "type bad = " +
        "(left: I32, right: I32, equality: Proof left = right, " +
        "evidence: Proof predicate(left)) -> Proof predicate(right)\n" +
        "let bad = (left, right, equality, evidence) => " +
        "by transport(equality, value => predicate(missing), evidence);\n42\n",
        "refers to unbound logical value missing",
      ],
      [
        "type bad = " +
        "(left: I32, right: I32, equality: Proof left = right, " +
        "evidence: Proof left + 0 = left + 0) -> " +
        "Proof right + 0 = right + 0\n" +
        "let bad = (left, right, equality, evidence) => " +
        "by transport(" +
        "equality, value => value + 0 = value + 0, evidence);\n42\n",
        "transport motive requires structured kernel terms",
      ],
    ] as const
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(
      analysis.diagnostics.some((diagnostic) =>
        diagnostic.code === "DUCK2605" &&
        diagnostic.message.includes(message)
      ),
      true,
    );
    assert_equals(checked_value(lower_duck_source(analysis)), undefined);
  }
});

Deno.test("quantified predicate certificates retain structured arguments", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type predicate = (value: I32) -> Prop\n" +
      "opaque fact predicate = value => True;\n" +
      "type predicate_identity = () -> " +
      "Proof forall (value: I32). predicate(value) implies predicate(value)\n" +
      "let predicate_identity = () => by value => evidence => evidence;\n" +
      "42\n",
  ));
  assert_equals(analysis.diagnostics, []);
  const checked = analysis.proofs.get("root:predicate_identity:proof");
  if (checked === undefined) {
    throw new Error("Expected a quantified predicate certificate.");
  }
  const predicate = {
    tag: "atom" as const,
    name: "fact:root:predicate",
    arguments: [{ tag: "var" as const, index: 0 }],
  };
  assert_equals(checked.certificate.proposition, {
    tag: "forall",
    domain: { tag: "constant", name: "I32" },
    body: {
      tag: "implies",
      premise: predicate,
      conclusion: predicate,
    },
  });
});

Deno.test("invalid direct quantified proof terms fail before Core", () => {
  for (
    const [source, message] of [
      [
        "type bad = " +
        "(evidence: Proof True, value: I32) -> Proof value = value\n" +
        "let bad = (evidence, value) => " +
        "by forall_apply(evidence, value);\n42\n",
        "forall_apply requires a universal proof",
      ],
      [
        "type bad = () -> Proof True\n" +
        "let bad = () => by exists_intro(0, true_intro);\n42\n",
        "exists_intro requires an existential goal",
      ],
      [
        "type bad = (evidence: Proof True) -> Proof True\n" +
        "let bad = evidence => " +
        "by exists_elim(evidence, witness, opened => opened);\n42\n",
        "exists_elim requires an existential proof",
      ],
      [
        "type bad = " +
        "(universal: Proof forall (value: I32). True) -> Proof True\n" +
        "let bad = universal => by forall_apply(universal, missing);\n42\n",
        "Unsupported universal argument missing",
      ],
      [
        "type bad = " +
        "(universal: Proof forall (value: I32). True, text: Text) -> " +
        "Proof True\n" +
        "let bad = (universal, text) => " +
        "by forall_apply(universal, text);\n42\n",
        "universal argument text has type Text, expected I32",
      ],
      [
        "type bad = " +
        "(text: Text) -> Proof exists (value: I32). True\n" +
        "let bad = text => by exists_intro(text, true_intro);\n42\n",
        "existential witness text has type Text, expected I32",
      ],
      [
        "type bad = " +
        "(package: Proof exists (value: I32). False) -> Proof True\n" +
        "let bad = package => " +
        "by exists_elim(package, witness, impossible => witness);\n42\n",
        "Unknown proof evidence witness",
      ],
      [
        "type bad = " +
        "(package: Proof exists (value: I32). False) -> Proof True\n" +
        "let bad = package => " +
        "by exists_elim(package, witness, impossible => missing);\n42\n",
        "Unknown proof evidence missing",
      ],
      [
        "type bad = " +
        "(package: Proof exists (value: I32). False) -> Proof False\n" +
        "let bad = package => " +
        "by exists_elim(package, witness, impossible => true_intro);\n42\n",
        "Proof establishes True, not False",
      ],
      [
        "type predicate = (value: I32) -> Prop\n" +
        "opaque fact predicate = value => True;\n" +
        "type bad = " +
        "(outer: I32, evidence: Proof predicate(outer)) -> " +
        "Proof forall (inner: I32). predicate(inner)\n" +
        "let bad = (outer, evidence) => by inner => evidence;\n42\n",
        "Proof establishes fact:root:predicate(#1), not fact:root:predicate(#0)",
      ],
      [
        "type predicate = (value: I32) -> Prop\n" +
        "opaque fact predicate = value => True;\n" +
        "type bad = " +
        "() -> Proof forall (value: I32). predicate(value + 1)\n" +
        "let bad = () => by value => true_intro;\n42\n",
        "cannot quantify over holds until every referenced logical term has a structured kernel representation",
      ],
      [
        "type bad = " +
        "() -> Proof forall (value: I32). value + 0 = value\n" +
        "let bad = () => by value => refl;\n42\n",
        "cannot quantify over equal until every referenced logical term has a structured kernel representation",
      ],
    ] as const
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(
      analysis.diagnostics.some((diagnostic) =>
        diagnostic.code === "DUCK2605" &&
        diagnostic.message.includes(message)
      ),
      true,
    );
    assert_equals(checked_value(lower_duck_source(analysis)), undefined);
  }
});

Deno.test("incomplete quantified proofs preserve unaffected semantics", () => {
  for (
    const source of [
      "let broken = () => by forall_apply(proof, );\n" +
      "let kept = 42;\nkept\n",
      "let broken = () => by exists_intro(value, );\n" +
      "let kept = 42;\nkept\n",
      "let broken = () => " +
      "by exists_elim(package, witness, evidence => );\n" +
      "let kept = 42;\nkept\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(
      analysis.diagnostics.some((diagnostic) =>
        diagnostic.message.includes("Baba parser rejected MISSING")
      ),
      true,
    );
    assert_equals(analysis.symbols.has("kept"), true);
    assert_equals(checked_value(lower_duck_source(analysis)), undefined);
  }
});

Deno.test("invalid direct proof declarations fail before Core", () => {
  for (
    const [source, message] of [
      [
        "type bad = () -> Proof False\n" +
        "let bad = () => by true_intro;\n42\n",
        "Proof establishes True, not False",
      ],
      [
        "type bad = () -> Proof True\n" +
        "let bad = () => by missing;\n42\n",
        "Unknown proof evidence missing",
      ],
      [
        "type bad = () -> Proof True\n" +
        "let bad = () => true;\n42\n",
        "must use a direct by proof term body",
      ],
      [
        "type bad = () -> Proof True\n" +
        "ensures False\n" +
        "let bad = () => by true_intro;\n42\n",
        "must express its guarantee in the Proof result",
      ],
      [
        "type bad = () -> Proof True\n" +
        "let bad = () => by true_intro\n" +
        "and runtime = () => 42;\n42\n",
        "cannot yet erase from a mutual binding group",
      ],
      [
        "type bad = () -> Proof True\n" +
        "@[test]\n" +
        "let bad = () => by true_intro;\n42\n",
        "cannot carry runtime binding attributes",
      ],
    ] as const
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(
      analysis.diagnostics.some((diagnostic) =>
        diagnostic.code === "DUCK2605" &&
        diagnostic.message.includes(message)
      ),
      true,
    );
    assert_equals(checked_value(lower_duck_source(analysis)), undefined);
  }
});

Deno.test("unsafe proof assumptions retain provenance and erase before Core", () => {
  const source = "type admitted = () -> Proof False\n" +
    "unsafe let admitted = () => by unsafe { assume False };\n" +
    "42\n";
  const analysis = analyze_duck_source(parse_duck_source(source));

  assert_equals(analysis.diagnostics, []);
  const checked = analysis.proofs.get("root:admitted:proof");
  if (checked === undefined) {
    throw new Error("Expected an unsafe proof certificate.");
  }
  assert_equals(checked.certificate.safety, {
    tag: "unsafe",
    origins: [{
      tag: "source",
      start: source.indexOf("unsafe {"),
      end: source.indexOf("unsafe {") + "unsafe { assume False }".length,
    }],
  });
  assert_equals(checked_value(lower_duck_source(analysis))?.core, {
    tag: "program",
    statements: [{
      tag: "expr",
      expr: { tag: "num", type: "i32", value: 42 },
    }],
  });
});

Deno.test("unsafe proof assumptions require explicit unsafe declarations", () => {
  for (
    const [source, code, message] of [
      [
        "type bad = () -> Proof False\n" +
        "let bad = () => by unsafe { assume False };\n42\n",
        "DUCK2606",
        "requires an unsafe proof declaration",
      ],
      [
        "unsafe let runtime = () => 42;\nruntime()\n",
        "DUCK2606",
        "requires a matching prefix signature with a Proof result",
      ],
      [
        "type bad = () -> Proof True\n" +
        "unsafe let bad = () => by true_intro;\n42\n",
        "DUCK2605",
        "does not depend on unsafe evidence",
      ],
      [
        "type bad = () -> Proof True\n" +
        "unsafe let bad = () => by unsafe { assume False };\n42\n",
        "DUCK2605",
        "Proof establishes False, not True",
      ],
      [
        "type bad = () -> Proof True\n" +
        "unsafe let bad = () => by unsafe { assume missing };\n42\n",
        "DUCK2605",
        "unbound logical value missing",
      ],
    ] as const
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(
      analysis.diagnostics.some((diagnostic) =>
        diagnostic.code === code &&
        diagnostic.message.includes(message)
      ),
      true,
    );
    assert_equals(checked_value(lower_duck_source(analysis)), undefined);
  }
});

Deno.test("proof declarations reject conflicting inline annotations", () => {
  for (
    const [source, message] of [
      [
        "type bad = (value: I32) -> Proof True\n" +
        "let bad = (value: Text) => by true_intro;\n42\n",
        "parameter value has type I32, but its inline annotation is Text",
      ],
      [
        "type bad = () -> Proof True\n" +
        "let bad: I32 = () => by true_intro;\n42\n",
        "cannot combine a prefix signature with an inline annotation",
      ],
    ] as const
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(
      analysis.diagnostics.some((diagnostic) =>
        diagnostic.code === "DUCK2602" &&
        diagnostic.message.includes(message)
      ),
      true,
    );
    assert_equals(checked_value(lower_duck_source(analysis)), undefined);
  }
});

Deno.test("incomplete Proof recovery preserves unaffected semantics", () => {
  for (
    const source of [
      "type broken = () -> Proof\nlet kept = 42;\nkept\n",
      "type broken = () -> Proof   \nlet kept = 42;\nkept\n",
      "type broken = () -> Proof // missing\nlet kept = 42;\nkept\n",
    ]
  ) {
    const analysis = analyze_duck_source(parse_duck_source(source));
    assert_equals(
      analysis.diagnostics.some((diagnostic) =>
        diagnostic.message.includes("Proof requires a proposition")
      ),
      true,
    );
    assert_equals(analysis.symbols.has("kept"), true);
    assert_equals(checked_value(lower_duck_source(analysis)), undefined);
  }
});

Deno.test("rejected mutual proofs preserve runtime peer symbols", () => {
  const source = "type proof = () -> Proof True\n" +
    "let rec proof = () => by true_intro\n" +
    "and runtime = () => 42;\n42\n";
  const analysis = analyze_duck_source(parse_duck_source(source));

  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2605" &&
      diagnostic.message.includes("requires a checked totality derivation")
    ),
    true,
  );
  assert_equals(analysis.symbols.has("runtime"), true);
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("a by body without a proof result is rejected", () => {
  const source = "type bad = () -> I32\n" +
    "let bad = () => by refl;\n42\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2605" &&
      diagnostic.message.includes(
        "requires a matching prefix signature with a Proof result",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("orphan proof bodies do not erase enclosing runtime bindings", () => {
  const source = "let outer = () => do\n" +
    "  let orphan = () => by refl;\n" +
    "  42\n" +
    "end;\n" +
    "outer()\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2605" &&
      diagnostic.message.includes(
        "requires a matching prefix signature with a Proof result",
      )
    ),
    true,
  );
  assert_equals(analysis.symbols.has("outer"), true);
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);

  const direct = analyze_duck_source(
    parse_duck_source("let orphan = by refl;\n42\n"),
  );
  assert_equals(
    direct.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2605"),
    true,
  );
  assert_equals(checked_value(lower_duck_source(direct)), undefined);
});

Deno.test("proof atoms preserve literal contents during kernel checking", () => {
  const source = "type text_property = (value: Text) -> Prop\n" +
    "opaque fact text_property = value => True;\n" +
    "type bad = " +
    '(evidence: Proof text_property("a b")) -> Proof text_property("ab")\n' +
    "let bad = proof => by proof;\n42\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2605" &&
      diagnostic.message.includes("Proof establishes") &&
      diagnostic.message.includes('literal:Text:"a b"') &&
      diagnostic.message.includes('literal:Text:"ab"')
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("structured predicate atoms preserve quantified variable identity", () => {
  const source = "type predicate = (value: I32) -> Prop\n" +
    "opaque fact predicate = value => True;\n" +
    "type bad = " +
    "(outer: I32, evidence: Proof " +
    "forall (x: I32). predicate(outer)) -> " +
    "Proof forall (outer: I32). predicate(outer)\n" +
    "let bad = (value, proof) => by proof;\n42\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2605" &&
      diagnostic.message.includes(
        "Proof establishes (forall I32. fact:root:predicate(#1)), not (forall I32. fact:root:predicate(#0))",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
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

Deno.test("requirements are enforced at direct and aliased calls", () => {
  const called = analyze_duck_source(parse_duck_source(
    "type f = (value: I32) -> (result: I32)\n" +
      "requires False\n" +
      "let f = value => value;\n" +
      "f 1\n",
  ));
  assert_equals(
    called.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "disproved: call to f cannot prove requires False",
      )
    ),
    true,
  );

  const uncalled = analyze_duck_source(parse_duck_source(
    "type f = (value: I32) -> (result: I32)\n" +
      "requires False\n" +
      "let f = value => value;\n",
  ));
  assert_equals(uncalled.diagnostics, []);

  const alias = analyze_duck_source(parse_duck_source(
    "type f = (value: I32) -> (result: I32)\n" +
      "requires False\n" +
      "let f = value => value;\n" +
      "let alias = f;\n" +
      "alias 1\n",
  ));
  assert_equals(
    alias.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "disproved: call to f cannot prove requires False",
      )
    ),
    true,
  );
});

Deno.test("requirements reject unbound names before tautology checking", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type f = (value: I32) -> (result: I32)\n" +
      "requires missing = missing\n" +
      "let f = value => value;\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("unbound logical value missing")
    ),
    true,
  );
});

Deno.test("malformed contract clauses report one syntax root cause", () => {
  const source = "type f = (value: I32) -> (result: I32)\n" +
    "requires\n" +
    "let f = value => value;\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(
    analysis.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      span: diagnostic.span,
    })),
    [{
      code: "DUCK1001",
      message: "Contract clause requires a proposition before the next clause",
      span: {
        start: source.indexOf("requires") + "requires".length,
        end: source.indexOf("requires") + "requires".length,
      },
    }],
  );
});

Deno.test("malformed decreases clauses report one syntax root cause", () => {
  const source = "type f = (value: I32) -> (result: I32)\n" +
    "decreases\n" +
    "let f = value => value;\n";
  const analysis = analyze_duck_source(parse_duck_source(source));
  assert_equals(
    analysis.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      span: diagnostic.span,
    })),
    [{
      code: "DUCK1001",
      message: "Contract clause requires a metric before the next clause",
      span: {
        start: source.indexOf("decreases") + "decreases".length,
        end: source.indexOf("decreases") + "decreases".length,
      },
    }],
  );
});

Deno.test("fact definitions check arity and free logical values", () => {
  const unbound = analyze_duck_source(parse_duck_source(
    "type lie = (value: I32) -> Prop\n" +
      "fact lie = value => missing = missing;\n" +
      "42\n",
  ));
  assert_equals(
    unbound.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("unbound logical value missing")
    ),
    true,
  );

  const arity = analyze_duck_source(parse_duck_source(
    "type lie = (first: I32, second: I32) -> Prop\n" +
      "fact lie = value => False;\n" +
      "42\n",
  ));
  assert_equals(
    arity.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2602"),
    true,
  );
});

Deno.test("transparent facts unfold into contextual call obligations", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type nonzero = (value: I32) -> Prop\n" +
      "fact nonzero = candidate => candidate != 0;\n" +
      "type consume = " +
      "(value: I32, evidence: Proof nonzero(value)) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32) -> I32\n" +
      "let guarded = actual => " +
      "if actual != 0 then consume actual else 0 end;\n" +
      "guarded 7\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 1);
  assert_equals(
    [...analysis.proofs.values()][0]?.semantic_certificate?.tag,
    "machine_fact",
  );
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("opaque facts do not unfold into contextual call obligations", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type nonzero = (value: I32) -> Prop\n" +
      "opaque fact nonzero = candidate => candidate != 0;\n" +
      "type consume = " +
      "(value: I32, evidence: Proof nonzero(value)) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32) -> I32\n" +
      "let guarded = actual => " +
      "if actual != 0 then consume actual else 0 end;\n" +
      "guarded 7\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("opaque predicate evidence follows value-preserving aliases", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type p = (value: I32) -> Prop\n" +
      "opaque fact p = value => True;\n" +
      "type consume = (value: I32, evidence: Proof p(value)) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type forward = (value: I32, evidence: Proof p(value)) -> I32\n" +
      "let forward = (actual, evidence) => do\n" +
      "  let alias = actual;\n" +
      "  consume alias\n" +
      "end;\n" +
      "42\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(
    [...analysis.proofs.values()][0]?.semantic_certificate?.tag,
    "predicate_alias",
  );
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("opaque predicate evidence stays bound to ordered arguments", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type p = (left: I32, right: I32) -> Prop\n" +
      "opaque fact p = (left, right) => True;\n" +
      "type consume = " +
      "(left: I32, right: I32, evidence: Proof p(left, right)) -> I32\n" +
      "let consume = (left, right, evidence) => left;\n" +
      "type forward = " +
      "(left: I32, right: I32, evidence: Proof p(left, right)) -> I32\n" +
      "let forward = (left, right, evidence) => consume (right, left);\n" +
      "42\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("opaque predicate evidence does not cross mixed alias joins", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type p = (value: I32) -> Prop\n" +
      "opaque fact p = value => True;\n" +
      "type consume = (value: I32, evidence: Proof p(value)) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type forward = (value: I32, evidence: Proof p(value)) -> I32\n" +
      "let forward = (actual, evidence) => do\n" +
      "  let alias = if actual == 0 then actual else 0 end;\n" +
      "  consume alias\n" +
      "end;\n" +
      "42\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("opaque predicate evidence survives joins of proven aliases", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type p = (value: I32) -> Prop\n" +
      "opaque fact p = value => True;\n" +
      "type consume = (value: I32, evidence: Proof p(value)) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type forward = " +
      "(value: I32, choose_left: Bool, evidence: Proof p(value)) -> I32\n" +
      "let forward = (actual, choose_left, evidence) => do\n" +
      "  let alias = if choose_left then actual else actual end;\n" +
      "  consume alias\n" +
      "end;\n" +
      "42\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(
    [...analysis.proofs.values()][0]?.semantic_certificate?.tag,
    "predicate_alias",
  );
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("opaque predicate evidence does not cross rebinding", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type p = (value: I32) -> Prop\n" +
      "opaque fact p = value => True;\n" +
      "type consume = (value: I32, evidence: Proof p(value)) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type forward = (value: I32, evidence: Proof p(value)) -> I32\n" +
      "let forward = (actual, evidence) => do\n" +
      "  let actual = 0;\n" +
      "  consume actual\n" +
      "end;\n" +
      "42\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("captured opaque evidence keeps its lexical predicate identity", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type p = (value: I32) -> Prop\n" +
      "opaque fact p = value => True;\n" +
      "type consume = (value: I32, evidence: Proof p(value)) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type forward = (value: I32, evidence: Proof p(value)) -> I32\n" +
      "let forward = (actual, evidence) => do\n" +
      "  type p = (value: I32) -> Prop\n" +
      "  opaque fact p = value => False;\n" +
      "  let alias = actual;\n" +
      "  consume alias\n" +
      "end;\n" +
      "42\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(
    [...analysis.proofs.values()][0]?.semantic_certificate?.tag,
    "predicate_alias",
  );
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("transparent aliases retain lexical opaque predicate identities", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type p = (value: I32) -> Prop\n" +
      "opaque fact p = value => True;\n" +
      "do\n" +
      "  type q = (value: I32) -> Prop\n" +
      "  fact q = value => p(value);\n" +
      "  type forward = " +
      "(value: I32, evidence: Proof p(value)) -> I32\n" +
      "  type p = (value: I32) -> Prop\n" +
      "  opaque fact p = value => False;\n" +
      "  type consume = " +
      "(value: I32, evidence: Proof q(value)) -> I32\n" +
      "  let consume = (actual, evidence) => actual;\n" +
      "  let forward = (actual, evidence) => do\n" +
      "    let alias = actual;\n" +
      "    consume alias\n" +
      "  end;\n" +
      "  42\n" +
      "end\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(
    [...analysis.proofs.values()][0]?.semantic_certificate?.tag,
    "predicate_alias",
  );
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("shadowed opaque facts cannot satisfy outer contracts", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type p = (value: I32) -> Prop\n" +
      "opaque fact p = value => True;\n" +
      "type consume = (value: I32, evidence: Proof p(value)) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "do\n" +
      "  type p = (value: I32) -> Prop\n" +
      "  opaque fact p = value => False;\n" +
      "  type forward = " +
      "(value: I32, evidence: Proof p(value)) -> I32\n" +
      "  let forward = (actual, evidence) => consume actual;\n" +
      "  42\n" +
      "end\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "unknown: call to consume cannot prove proof parameter evidence",
      )
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("transparent fact bodies retain lexical predicate identities", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type p = (value: I32) -> Prop\n" +
      "opaque fact p = value => True;\n" +
      "type q = (value: I32) -> Prop\n" +
      "fact q = value => p(value);\n" +
      "do\n" +
      "  type p = (value: I32) -> Prop\n" +
      "  opaque fact p = value => False;\n" +
      "  type invalid = " +
      "(value: I32, evidence: Proof p(value)) -> Proof q(value)\n" +
      "  let invalid = (actual, evidence) => by evidence;\n" +
      "  42\n" +
      "end\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2605" &&
      diagnostic.message.includes("Proof establishes")
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("direct proofs use transparent fact definitions", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type nonzero = (value: I32) -> Prop\n" +
      "fact nonzero = candidate => candidate != 0;\n" +
      "type preserve = " +
      "(value: I32, evidence: Proof value != 0) -> Proof nonzero(value)\n" +
      "let preserve = (actual, evidence) => by evidence;\n" +
      "42\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 1);
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("proof bodies see transparent facts defined after their signature", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type reflexive = (value: I32) -> Prop\n" +
      "type prove = () -> Proof reflexive(1)\n" +
      "fact reflexive = value => value = value;\n" +
      "let prove = () => by refl;\n" +
      "42\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 1);
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("polymorphic transparent facts infer type substitutions", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type all_reflexive = forall (a: Type). (value: a) -> Prop\n" +
      "fact all_reflexive = value => " +
      "forall (other: a). other = other;\n" +
      "type prove = (value: I32) -> Proof all_reflexive(value)\n" +
      "let prove = actual => by other => refl;\n" +
      "42\n",
  ));
  assert_equals(analysis.diagnostics, []);
  const checked = analysis.proofs.get("root:prove:proof");
  if (checked === undefined) {
    throw new Error("Expected a polymorphic transparent fact certificate.");
  }
  assert_equals(checked.certificate.proposition, {
    tag: "forall",
    domain: { tag: "constant", name: "I32" },
    body: {
      tag: "equal",
      type: { tag: "constant", name: "I32" },
      left: { tag: "var", index: 0 },
      right: { tag: "var", index: 0 },
    },
  });
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("polymorphic transparent facts refine contextual calls", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type reflexive = forall (a: Type). (value: a) -> Prop\n" +
      "fact reflexive = value => value = value;\n" +
      "type consume = " +
      "(value: I32, evidence: Proof reflexive(value)) -> I32\n" +
      "let consume = (actual, evidence) => actual;\n" +
      "type guarded = (value: I32) -> I32\n" +
      "let guarded = actual => " +
      "if actual == actual then consume actual else 0 end;\n" +
      "guarded 7\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 1);
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("polymorphic fact unfolding rejects undetermined type arguments", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type always = forall (a: Type). () -> Prop\n" +
      "fact always = () => True;\n" +
      "type invalid = () -> Proof always()\n" +
      "let invalid = () => by true_intro;\n" +
      "42\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2605" &&
      diagnostic.message.includes("Proof establishes True")
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("term binders do not shadow polymorphic fact type substitutions", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type typed = forall (a: Type). (value: a) -> Prop\n" +
      "fact typed = value => forall (a: I32). value is a;\n" +
      "type prove = " +
      "(value: I32, evidence: Proof forall (a: I32). value is I32) " +
      "-> Proof typed(value)\n" +
      "let prove = (actual, evidence) => by evidence;\n" +
      "42\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 1);
  assert_equals(checked_value(lower_duck_source(analysis)) !== undefined, true);
});

Deno.test("transparent fact substitution avoids quantified capture", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type relates = (outer: I32) -> Prop\n" +
      "fact relates = outer => " +
      "forall (inner: I32). outer = inner;\n" +
      "type invalid = (inner: I32) -> Proof relates(inner)\n" +
      "let invalid = inner => by witness => refl;\n" +
      "42\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2605" &&
      diagnostic.message.includes("Reflexivity term does not match")
    ),
    true,
  );
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("fact definitions require well-formed propositions", () => {
  const runtime_value = analyze_duck_source(parse_duck_source(
    "type lie = (value: I32) -> Prop\n" +
      "fact lie = value => value;\n" +
      "42\n",
  ));
  assert_equals(
    runtime_value.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("value: I32 as a proposition")
    ),
    true,
  );

  const predicate_arity = analyze_duck_source(parse_duck_source(
    "type predicate = (left: I32, right: I32) -> Prop\n" +
      "fact predicate = (left, right) => left = right;\n" +
      "type lie = (value: I32) -> Prop\n" +
      "fact lie = value => predicate(value);\n" +
      "42\n",
  ));
  assert_equals(
    predicate_arity.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("expects 2 arguments but received 1")
    ),
    true,
  );

  const unknown_quantifier_type = analyze_duck_source(parse_duck_source(
    "type lie = (value: I32) -> Prop\n" +
      "fact lie = value => forall (x: Bogus). x = x;\n" +
      "42\n",
  ));
  assert_equals(
    unknown_quantifier_type.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("unknown logical type Bogus")
    ),
    true,
  );

  const zero_divisor = analyze_duck_source(parse_duck_source(
    "type lie = (value: I32) -> Prop\n" +
      "fact lie = value => value % 0 = 0;\n" +
      "42\n",
  ));
  assert_equals(
    zero_divisor.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("cannot prove 0 is nonzero")
    ),
    true,
  );

  const unsupported_index = analyze_duck_source(parse_duck_source(
    "type lie = (value: I32) -> Prop\n" +
      "fact lie = value => value[0] = value;\n" +
      "42\n",
  ));
  assert_equals(
    unsupported_index.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("unsupported logical term value[0]")
    ),
    true,
  );
});

Deno.test("fact totality checks every partial operation structurally", () => {
  const nested_zero = analyze_duck_source(parse_duck_source(
    "type lie = (value: I32) -> Prop\n" +
      "fact lie = value => value / 0 + value = value;\n" +
      "42\n",
  ));
  assert_equals(
    nested_zero.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("cannot prove 0 is nonzero")
    ),
    true,
  );

  const first_unguarded = analyze_duck_source(parse_duck_source(
    "type lie = (value: I32, first: I32, second: I32) -> Prop\n" +
      "fact lie = (value, first, second) =>\n" +
      "  second != 0 and value / first / second = value;\n" +
      "42\n",
  ));
  assert_equals(
    first_unguarded.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("cannot prove first is nonzero")
    ),
    true,
  );

  const expression_guard = analyze_duck_source(parse_duck_source(
    "type lie = (value: I32, divisor: I32) -> Prop\n" +
      "fact lie = (value, divisor) =>\n" +
      "  divisor + 1 != 0 and value / divisor = value;\n" +
      "42\n",
  ));
  assert_equals(
    expression_guard.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("cannot prove divisor is nonzero")
    ),
    true,
  );

  const shadowed_guard = analyze_duck_source(parse_duck_source(
    "type lie = (value: I32, divisor: I32) -> Prop\n" +
      "fact lie = (value, divisor) => divisor != 0 and\n" +
      "  (forall (divisor: I32). value / divisor = value);\n" +
      "42\n",
  ));
  assert_equals(
    shadowed_guard.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("cannot prove divisor is nonzero")
    ),
    true,
  );

  const signed_overflow = analyze_duck_source(parse_duck_source(
    "type lie = (value: I32, divisor: I32) -> Prop\n" +
      "fact lie = (value, divisor) =>\n" +
      "  divisor != 0 and value / divisor = value;\n" +
      "42\n",
  ));
  assert_equals(
    signed_overflow.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("cannot rule out signed division overflow")
    ),
    true,
  );

  const guarded = analyze_duck_source(parse_duck_source(
    "type multiple_of = (value: I32, divisor: I32) -> Prop\n" +
      "fact multiple_of = (value, divisor) =>\n" +
      "  divisor != 0 and value % divisor = 0;\n" +
      "42\n",
  ));
  assert_equals(guarded.diagnostics, []);

  const literal_guards = analyze_duck_source(parse_duck_source(
    "type p = (value: I32) -> Prop\n" +
      "fact p = value => value % 1i32 = 0i32;\n" +
      "type q = (value: I64) -> Prop\n" +
      "fact q = value => value / 2i64 = value;\n" +
      "type r = (value: U32) -> Prop\n" +
      "fact r = value => value / 1u32 = value;\n" +
      "42\n",
  ));
  assert_equals(literal_guards.diagnostics, []);

  const typed_variable_guard = analyze_duck_source(parse_duck_source(
    "type p = (value: I64, divisor: I64) -> Prop\n" +
      "fact p = (value, divisor) =>\n" +
      "  divisor != 0i64 and value % divisor = 0i64;\n" +
      "42\n",
  ));
  assert_equals(typed_variable_guard.diagnostics, []);
});

Deno.test("fact terms use structural operator typing", () => {
  const chained_comparison = analyze_duck_source(parse_duck_source(
    "type lie = (a: I32, b: I32, c: I32) -> Prop\n" +
      "fact lie = (a, b, c) => a < b < c;\n" +
      "42\n",
  ));
  assert_equals(
    chained_comparison.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("unsupported logical term")
    ),
    true,
  );

  const address = analyze_duck_source(parse_duck_source(
    "type lie = (value: I32) -> Prop\n" +
      "fact lie = value => &value = value;\n" +
      "42\n",
  ));
  assert_equals(
    address.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("unsupported logical term &value")
    ),
    true,
  );

  const mixed = analyze_duck_source(parse_duck_source(
    "type lie = (value: I32) -> Prop\n" +
      'fact lie = value => "a" + value + "b" = "anything";\n' +
      "42\n",
  ));
  assert_equals(
    mixed.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes('unsupported logical term "a" + value')
    ),
    true,
  );
});

Deno.test("logical binders shadow fact names", () => {
  const parameter = analyze_duck_source(parse_duck_source(
    "type q = (value: I32) -> Prop\n" +
      "fact q = value => value = value;\n" +
      "type p = (q: I32) -> Prop\n" +
      "fact p = q => q(1);\n" +
      "42\n",
  ));
  assert_equals(
    parameter.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("unsupported logical term q(1)")
    ),
    true,
  );

  const quantified = analyze_duck_source(parse_duck_source(
    "type q = (value: I32) -> Prop\n" +
      "fact q = value => value = value;\n" +
      "type p = (value: I32) -> Prop\n" +
      "fact p = value => forall (q: I32). q(1);\n" +
      "42\n",
  ));
  assert_equals(
    quantified.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("unsupported logical term q(1)")
    ),
    true,
  );
});

Deno.test("logical numbers preserve suffixes and ranges", () => {
  const suffix = analyze_duck_source(parse_duck_source(
    "type p = (value: I32) -> Prop\n" +
      "fact p = value => value = 1i64;\n" +
      "42\n",
  ));
  assert_equals(
    suffix.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("compares I32 with I64")
    ),
    true,
  );

  const oversized = analyze_duck_source(parse_duck_source(
    "type p = (value: I32) -> Prop\n" +
      "fact p = value => value / 4294967296 = value;\n" +
      "42\n",
  ));
  assert_equals(
    oversized.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("out-of-range I32 logical number")
    ),
    true,
  );

  const matching = analyze_duck_source(parse_duck_source(
    "type p = (value: I32) -> Prop\n" +
      "fact p = value => value = 1i32;\n" +
      "42\n",
  ));
  assert_equals(matching.diagnostics, []);

  const positive_i32_minimum_magnitude = analyze_duck_source(
    parse_duck_source(
      "type p = (value: I32) -> Prop\n" +
        "fact p = value => value = 2147483648i32;\n" +
        "42\n",
    ),
  );
  assert_equals(
    positive_i32_minimum_magnitude.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("out-of-range I32 logical number")
    ),
    true,
  );

  const positive_i64_minimum_magnitude = analyze_duck_source(
    parse_duck_source(
      "type p = (value: I64) -> Prop\n" +
        "fact p = value => value = 9223372036854775808i64;\n" +
        "42\n",
    ),
  );
  assert_equals(
    positive_i64_minimum_magnitude.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("out-of-range I64 logical number")
    ),
    true,
  );

  const negative_minimums = analyze_duck_source(parse_duck_source(
    "type p = (value: I32) -> Prop\n" +
      "fact p = value => value = -2147483648i32;\n" +
      "type q = (value: I64) -> Prop\n" +
      "fact q = value => value = -9223372036854775808i64;\n" +
      "42\n",
  ));
  assert_equals(negative_minimums.diagnostics, []);

  const absurd_width = analyze_duck_source(parse_duck_source(
    "type p = (value: I32) -> Prop\n" +
      "fact p = value => value = 1i9007199254740991;\n" +
      "42\n",
  ));
  assert_equals(
    absurd_width.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("unsupported logical integer width")
    ),
    true,
  );
});

Deno.test("fact signatures reject unknown parameter types", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type lie = (value: Bogus) -> Prop\n" +
      "fact lie = value => value = value;\n" +
      "42\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("unknown parameter type Bogus")
    ),
    true,
  );

  for (
    const malformed of [
      "I32 :| Bogus",
      "I32 :& Bogus",
      "I32 :- Bogus",
      "Maybe Bogus",
      "Maybe I32 Text",
    ]
  ) {
    const malformed_analysis = analyze_duck_source(parse_duck_source(
      "type Maybe a = | #None | #Some a\n" +
        `type p = (value: ${malformed}) -> Prop\n` +
        "fact p = value => value = value;\n" +
        "42\n",
    ));
    assert_equals(
      malformed_analysis.diagnostics.some((diagnostic) =>
        diagnostic.code === "DUCK2602" &&
        diagnostic.message.includes(`unknown parameter type ${malformed}`)
      ),
      true,
    );
    assert_equals(
      checked_value(lower_duck_source(malformed_analysis)),
      undefined,
    );
  }
});

Deno.test("fact signatures accept resolved structural parameter types", () => {
  for (const type of ["[I32]", "(I32, I32)", "1", '"a"']) {
    const analysis = analyze_duck_source(parse_duck_source(
      `type p = (value: ${type}) -> Prop\n` +
        "fact p = value => value = value;\n" +
        "42\n",
    ));
    assert_equals(analysis.diagnostics, []);
    assert_equals(
      checked_value(lower_duck_source(analysis)) !== undefined,
      true,
    );
  }

  const refined_numbers = analyze_duck_source(parse_duck_source(
    "type p = (value: 1) -> Prop\n" +
      "fact p = value => value = 1 and value < 2 and value + 1 = 2;\n" +
      "42\n",
  ));
  assert_equals(refined_numbers.diagnostics, []);

  const finite_numbers = analyze_duck_source(parse_duck_source(
    "type p = (value: 1 :| 2) -> Prop\n" +
      "fact p = value => value < 3 and value + 1 = 2;\n" +
      "42\n",
  ));
  assert_equals(finite_numbers.diagnostics, []);

  const refined_text = analyze_duck_source(parse_duck_source(
    'type p = (value: "a") -> Prop\n' +
      'fact p = value => value = "a";\n' +
      "42\n",
  ));
  assert_equals(refined_text.diagnostics, []);

  const weakening = analyze_duck_source(parse_duck_source(
    "type q = (value: I32) -> Prop\n" +
      "fact q = value => value = value;\n" +
      "type p = (value: 1) -> Prop\n" +
      "fact p = value => q(value);\n" +
      "type r = () -> Prop\n" +
      "fact r = () => p(1);\n" +
      "42\n",
  ));
  assert_equals(weakening.diagnostics, []);

  const strengthening = analyze_duck_source(parse_duck_source(
    "type p = (value: 1) -> Prop\n" +
      "fact p = value => value = value;\n" +
      "type q = (value: I32) -> Prop\n" +
      "fact q = value => p(value);\n" +
      "42\n",
  ));
  assert_equals(
    strengthening.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("requires 1 but received I32")
    ),
    true,
  );

  const alpha_equivalent = analyze_duck_source(parse_duck_source(
    "type q = forall (a: Type). (value: a) -> Prop\n" +
      "type p = forall (b: Type). (value: b) -> Prop\n" +
      "fact q = value => value = value;\n" +
      "fact p = value => q(value);\n" +
      "42\n",
  ));
  assert_equals(alpha_equivalent.diagnostics, []);

  const applied_alpha_equivalent = analyze_duck_source(parse_duck_source(
    "type Box a = a\n" +
      "type q = forall (a: Type). (value: Box a) -> Prop\n" +
      "type p = forall (b: Type). (value: Box b) -> Prop\n" +
      "fact q = value => value = value;\n" +
      "fact p = value => q(value);\n" +
      "42\n",
  ));
  assert_equals(applied_alpha_equivalent.diagnostics, []);

  const concrete_instantiation = analyze_duck_source(parse_duck_source(
    "type Alias = I32\n" +
      "type q = forall (a: Type). (left: a, right: a) -> Prop\n" +
      "fact q = (left, right) => left = right;\n" +
      "type p = () -> Prop\n" +
      "fact p = () => q(1, 2);\n" +
      "type r = (left: Alias, right: I32) -> Prop\n" +
      "fact r = (left, right) => q(left, right);\n" +
      "42\n",
  ));
  assert_equals(concrete_instantiation.diagnostics, []);

  const incoherent_instantiation = analyze_duck_source(parse_duck_source(
    "type q = forall (a: Type). (left: a, right: a) -> Prop\n" +
      "fact q = (left, right) => left = right;\n" +
      "type p = () -> Prop\n" +
      'fact p = () => q(1, "wrong");\n' +
      "42\n",
  ));
  assert_equals(
    incoherent_instantiation.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("requires a but received Text")
    ),
    true,
  );

  const aliases_inside_applications = analyze_duck_source(parse_duck_source(
    "type Box a = a\n" +
      "type Alias = I32\n" +
      "type q = forall (a: Type). " +
      "(left: Box a, right: Box a) -> Prop\n" +
      "type p = (left: Box Alias, right: Box I32) -> Prop\n" +
      "fact q = (left, right) => left = right;\n" +
      "fact p = (left, right) => q(left, right);\n" +
      "42\n",
  ));
  assert_equals(aliases_inside_applications.diagnostics, []);

  const transparent_head = analyze_duck_source(parse_duck_source(
    "type Box a = a\n" +
      "type q = forall (a: Type). (value: Box a) -> Prop\n" +
      "fact q = value => value = value;\n" +
      "type p = () -> Prop\n" +
      "fact p = () => q(1);\n" +
      "42\n",
  ));
  assert_equals(transparent_head.diagnostics, []);

  const repeated_transparent_instantiation = analyze_duck_source(
    parse_duck_source(
      "type Box a = a\n" +
        "type q = forall (a: Type). (left: a, right: a) -> Prop\n" +
        "type p = (left: Box I32, right: I32) -> Prop\n" +
        "fact q = (left, right) => left = right;\n" +
        "fact p = (left, right) => q(left, right);\n" +
        "42\n",
    ),
  );
  assert_equals(repeated_transparent_instantiation.diagnostics, []);

  const reordered_type_sets = analyze_duck_source(parse_duck_source(
    "type q = (value: I32 :| (Text :| Bool)) -> Prop\n" +
      "type p = (value: (Bool :| I32) :| Text) -> Prop\n" +
      "type r = (value: I32 :& Text) -> Prop\n" +
      "type s = (value: Text :& I32) -> Prop\n" +
      "fact q = value => True;\n" +
      "fact p = value => q(value);\n" +
      "fact r = value => True;\n" +
      "fact s = value => r(value);\n" +
      "42\n",
  ));
  assert_equals(reordered_type_sets.diagnostics, []);

  const nested_forall = analyze_duck_source(parse_duck_source(
    "type q = (value: forall a. a -> a) -> Prop\n" +
      "type p = (value: forall b. b -> b) -> Prop\n" +
      "fact q = value => True;\n" +
      "fact p = value => q(value);\n" +
      "42\n",
  ));
  assert_equals(nested_forall.diagnostics, []);

  const regrouped_forall = analyze_duck_source(parse_duck_source(
    "type q = (value: forall a b. a -> b) -> Prop\n" +
      "type p = (value: forall x. forall y. x -> y) -> Prop\n" +
      "fact q = value => True;\n" +
      "fact p = value => q(value);\n" +
      "42\n",
  ));
  assert_equals(regrouped_forall.diagnostics, []);

  const captured_forall = analyze_duck_source(parse_duck_source(
    "type q = (value: forall a. forall b. a -> b) -> Prop\n" +
      "type p = (value: forall x. forall x. x -> x) -> Prop\n" +
      "fact q = value => True;\n" +
      "fact p = value => q(value);\n" +
      "42\n",
  ));
  assert_equals(
    captured_forall.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("Fact q argument 1")
    ),
    true,
  );

  const escaping_forall = analyze_duck_source(parse_duck_source(
    "type q = forall (a: Type). (value: forall x. a -> x) -> Prop\n" +
      "type p = (value: forall y. y -> y) -> Prop\n" +
      "fact q = value => True;\n" +
      "fact p = value => q(value);\n" +
      "42\n",
  ));
  assert_equals(
    escaping_forall.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("Fact q argument 1")
    ),
    true,
  );

  const scoped_forall_instantiation = analyze_duck_source(parse_duck_source(
    "type q = forall (a: Type). (value: forall x. a -> x) -> Prop\n" +
      "type p = forall (b: Type). (value: forall y. b -> y) -> Prop\n" +
      "fact q = value => True;\n" +
      "fact p = value => q(value);\n" +
      "42\n",
  ));
  assert_equals(scoped_forall_instantiation.diagnostics, []);

  const refined_bool = analyze_duck_source(parse_duck_source(
    "type p = (value: true) -> Prop\n" +
      "fact p = value => value;\n" +
      "42\n",
  ));
  assert_equals(refined_bool.diagnostics, []);

  const runtime_booleans = analyze_duck_source(parse_duck_source(
    "type p = (value: I32) -> Prop\n" +
      "fact p = value => value == value;\n" +
      "type q = () -> Prop\n" +
      "fact q = () => true && true;\n" +
      "42\n",
  ));
  assert_equals(runtime_booleans.diagnostics, []);
});

Deno.test("fact propositions resolve aliases in quantified types", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type Alias = I32\n" +
      "type p = (value: I32) -> Prop\n" +
      "fact p = value => forall (other: Alias). other + 1 = other;\n" +
      "42\n",
  ));
  assert_equals(analysis.diagnostics, []);

  const generic = analyze_duck_source(parse_duck_source(
    "type Box a = a\n" +
      "type p = forall (a: Type). (value: Box a) -> Prop\n" +
      "fact p = value => value = value;\n" +
      "42\n",
  ));
  assert_equals(generic.diagnostics, []);

  const concrete_generic = analyze_duck_source(parse_duck_source(
    "type Box a = a\n" +
      "type q = (value: Box I32) -> Prop\n" +
      "fact q = value => value = 1;\n" +
      "type p = (value: I32) -> Prop\n" +
      "fact p = value => q(value);\n" +
      "42\n",
  ));
  assert_equals(concrete_generic.diagnostics, []);

  const malformed_quantifier = analyze_duck_source(parse_duck_source(
    "type p = (value: I32) -> Prop\n" +
      "fact p = value => forall (other: I32 :| Bogus). True;\n" +
      "42\n",
  ));
  assert_equals(
    malformed_quantifier.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("unknown logical type")
    ),
    true,
  );
});

Deno.test("recursive facts require a checked totality derivation", () => {
  const direct = analyze_duck_source(parse_duck_source(
    "type lie = (value: I32) -> Prop\n" +
      "fact lie = value => lie(value);\n" +
      "42\n",
  ));
  assert_equals(
    direct.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("recursive without a checked totality")
    ),
    true,
  );

  const mutual = analyze_duck_source(parse_duck_source(
    "type first = (value: I32) -> Prop\n" +
      "fact first = value => second(value);\n" +
      "type second = (value: I32) -> Prop\n" +
      "fact second = value => first(value);\n" +
      "42\n",
  ));
  assert_equals(
    mutual.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("unbound logical value second")
    ),
    true,
  );
});

Deno.test("decreases clauses require well-formed integer metrics", () => {
  const missing = analyze_duck_source(parse_duck_source(
    "type f = (value: I32) -> (result: I32)\n" +
      "decreases missing\n" +
      "let f = value => value;\n",
  ));
  assert_equals(
    missing.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("unsupported logical term missing")
    ),
    true,
  );

  const partial = analyze_duck_source(parse_duck_source(
    "type f = (value: I32) -> (result: I32)\n" +
      "decreases value / 0\n" +
      "let f = value => value;\n",
  ));
  assert_equals(
    partial.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("cannot prove 0 is nonzero")
    ),
    true,
  );

  const valid = analyze_duck_source(parse_duck_source(
    "type f = (value: I32) -> (result: I32)\n" +
      "decreases value\n" +
      "let f = value => value;\n",
  ));
  assert_equals(valid.diagnostics, []);

  const floating = analyze_duck_source(parse_duck_source(
    "type f = (value: I32) -> (result: I32)\n" +
      "decreases 1.5f32\n" +
      "let f = value => value;\n",
  ));
  assert_equals(
    floating.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("non-integer decreases metric")
    ),
    true,
  );

  const recursive = analyze_duck_source(parse_duck_source(
    "type f = (value: I32) -> (result: I32)\n" +
      "decreases value\n" +
      "let rec f = value => f value;\n",
  ));
  assert_equals(
    recursive.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes(
        "recursive decreases obligations that are not yet checked",
      )
    ),
    true,
  );
});

Deno.test("prefix signatures reject duplicate logical binders", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type f = (value: I32, value: I32) -> (result: I32)\n" +
      "ensures result = value\n" +
      "let f = (left, right) => left;\n" +
      "f(1, 2)\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("repeats logical binder value")
    ),
    true,
  );
  assert_equals(analysis.proofs.size, 0);

  const callable = analyze_duck_source(parse_duck_source(
    "type f = (left: I32, right: I32) -> (result: I32)\n" +
      "ensures result = left\n" +
      "let f = (x, x) => x;\n" +
      "f(1, 2)\n",
  ));
  assert_equals(
    callable.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("repeats parameter x")
    ),
    true,
  );
  assert_equals(callable.proofs.size, 0);

  const duplicate_type = analyze_duck_source(parse_duck_source(
    "type f = forall (a: Type) (a: Type). " +
      "(value: a) -> (result: a)\n" +
      "let f = value => value;\n",
  ));
  assert_equals(
    duplicate_type.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("repeats logical binder a")
    ),
    true,
  );

  const camel_type = analyze_duck_source(parse_duck_source(
    "type f = forall (camelCase: Type). " +
      "(value: camelCase) -> (result: camelCase)\n" +
      "let f = value => value;\n",
  ));
  assert_equals(
    camel_type.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("must use snake_case")
    ),
    true,
  );
});

Deno.test("prefix signatures reject unsupported structural and mutual predeclarations", () => {
  const structural = analyze_duck_source(parse_duck_source(
    "type left = (value: I32) -> (result: I32)\n" +
      'let [left] = [value => "wrong"];\n' +
      "left 1\n",
  ));
  assert_equals(
    structural.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("structural or mutual definition")
    ),
    true,
  );

  const mutual = analyze_duck_source(parse_duck_source(
    "type first = (value: I32) -> (result: I32)\n" +
      "type second = (value: I32) -> (result: I32)\n" +
      "let rec first = value => first value\n" +
      'and second = value => "wrong";\n' +
      "first 1\n",
  ));
  assert_equals(
    mutual.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("structural or mutual definition")
    ),
    true,
  );
});

Deno.test("prefix signatures check direct callable body representations", () => {
  const result = analyze_duck_source(parse_duck_source(
    "type f = (value: I32) -> (result: I32)\n" +
      'let f = value => "wrong";\n' +
      "f 1\n",
  ));
  assert_equals(
    result.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("declares result I32") &&
      diagnostic.message.includes("body has Text")
    ),
    true,
  );

  const parameter = analyze_duck_source(parse_duck_source(
    "type f = (value: Text) -> (result: Text)\n" +
      "let f = value => value + 1;\n" +
      'f "a"\n',
  ));
  assert_equals(
    parameter.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("unsupported logical term value + 1")
    ),
    true,
  );

  const unsuffixed = analyze_duck_source(parse_duck_source(
    "type f = (value: I64) -> (result: I64)\n" +
      "let f = value => 1;\n" +
      "f 1i64\n",
  ));
  assert_equals(
    unsuffixed.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("declares result I64") &&
      diagnostic.message.includes("body has I32")
    ),
    true,
  );

  const inline_parameter = analyze_duck_source(parse_duck_source(
    "type f = (value: I32) -> (result: I32)\n" +
      "ensures result = value\n" +
      "let f = (value: Text) => value;\n" +
      "f 1\n",
  ));
  assert_equals(
    inline_parameter.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes(
        "parameter value declares Text but its prefix signature requires I32",
      )
    ),
    true,
  );
  assert_equals(inline_parameter.proofs.size, 0);
});

Deno.test("prefix callable types compare semantic spelling and aliases", () => {
  const compact_inline = analyze_duck_source(parse_duck_source(
    "type f = (value: [I32, I32]) -> (result: [I32, I32])\n" +
      "let f = (value: [I32,I32]) => value;\n",
  ));
  assert_equals(compact_inline.diagnostics, []);

  const compact_signature = analyze_duck_source(parse_duck_source(
    "type f = (value: [I32,I32]) -> (result: [I32, I32])\n" +
      "ensures result = value\n" +
      "let f = value => value;\n",
  ));
  assert_equals(compact_signature.diagnostics, []);
  assert_equals(compact_signature.proofs.size, 1);

  const alias = analyze_duck_source(parse_duck_source(
    "type Identity = I32\n" +
      "type f = (value: Identity) -> (result: Identity)\n" +
      "ensures result = value\n" +
      "let f = (value: I32) => value;\n" +
      "f 1\n",
  ));
  assert_equals(alias.diagnostics, []);
  assert_equals(alias.proofs.size, 1);

  const fact_alias = analyze_duck_source(parse_duck_source(
    "type Identity = I32\n" +
      "type p = (value: Identity) -> Prop\n" +
      "fact p = value => value = value;\n" +
      "42\n",
  ));
  assert_equals(fact_alias.diagnostics, []);

  const generic_alias = analyze_duck_source(parse_duck_source(
    "type Box a = a\n" +
      "type f = (value: Box I32) -> (result: Box I32)\n" +
      "let f = (value: I32) => value;\n" +
      "f 1\n",
  ));
  assert_equals(generic_alias.diagnostics, []);

  const generic_result = analyze_duck_source(parse_duck_source(
    "type Box a = a\n" +
      "type f = () -> (result: Box I32)\n" +
      "let f = () => 1;\n" +
      "f()\n",
  ));
  assert_equals(generic_result.diagnostics, []);

  const generic_identity = analyze_duck_source(parse_duck_source(
    "type Box a = a\n" +
      "type f = (value: Box I32) -> (result: I32)\n" +
      "ensures result = value\n" +
      "let f = value => value;\n" +
      "f 1\n",
  ));
  assert_equals(generic_identity.diagnostics, []);
  assert_equals(generic_identity.proofs.size, 1);

  const distinct_application = analyze_duck_source(parse_duck_source(
    "type Box a = a\n" +
      "type BoxI32 = Text\n" +
      "type f = (value: Box I32) -> (result: Box I32)\n" +
      "let f = (value: BoxI32) => value;\n" +
      'f "oops"\n',
  ));
  assert_equals(
    distinct_application.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes(
        "declares BoxI32 but its prefix signature requires Box I32",
      )
    ),
    true,
  );

  const singleton = analyze_duck_source(parse_duck_source(
    "type f = (value: 1) -> (result: 1)\n" +
      "let f = (value: 1) => value;\n" +
      "type one = () -> (result: 1)\n" +
      "let one = () => 1;\n" +
      "f(one())\n",
  ));
  assert_equals(singleton.diagnostics, []);

  const wrong_singleton_parameter = analyze_duck_source(parse_duck_source(
    "type f = (value: 1) -> (result: 1)\n" +
      "let f = (value: 2) => value;\n" +
      "f 1\n",
  ));
  assert_equals(
    wrong_singleton_parameter.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("declares 2") &&
      diagnostic.message.includes("requires 1")
    ),
    true,
  );

  const wrong_singleton_result = analyze_duck_source(parse_duck_source(
    'type text = () -> (result: "a")\n' +
      'let text = () => "b";\n' +
      "text()\n",
  ));
  assert_equals(
    wrong_singleton_result.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes('declares result "a"')
    ),
    true,
  );
});

Deno.test("logical numerals retain their source value type", () => {
  const equality = analyze_duck_source(parse_duck_source(
    "type p = (value: I64) -> Prop\n" +
      "fact p = value => value = 1;\n",
  ));
  assert_equals(
    equality.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("compares I64 with I32")
    ),
    true,
  );

  const fact_call = analyze_duck_source(parse_duck_source(
    "type p = (value: I64) -> Prop\n" +
      "fact p = value => True;\n" +
      "type q = () -> Prop\n" +
      "fact q = () => p(1);\n",
  ));
  assert_equals(
    fact_call.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("requires I64 but received I32")
    ),
    true,
  );
});

Deno.test("identity certificates require a direct callable definition", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type f = (value: I32) -> (result: I32)\n" +
      "ensures result = value\n" +
      "let f = if false then value => value else value => 0 end;\n" +
      "f 42\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("requires a direct callable definition")
    ),
    true,
  );
  assert_equals(analysis.proofs.size, 0);
  assert_equals(checked_value(lower_duck_source(analysis)), undefined);
});

Deno.test("fact signatures are not visible before their declaration", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type p = (value: I32) -> Prop\n" +
      "fact p = value => q(value);\n" +
      "type q = (value: I32) -> Prop\n" +
      "fact q = value => value = value;\n" +
      "42\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2604" &&
      diagnostic.message.includes("unbound logical value q")
    ),
    true,
  );

  const predeclared = analyze_duck_source(parse_duck_source(
    "type p = (value: I32) -> Prop\n" +
      "type q = (value: I32) -> Prop\n" +
      "fact p = value => q(value);\n" +
      "fact q = value => True;\n" +
      "42\n",
  ));
  assert_equals(predeclared.diagnostics, []);
});

Deno.test("contract equality certificates use heterogeneous parameter indices", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type f = (left: I32, right: Text) -> (result: I32)\n" +
      "ensures result = left\n" +
      "let f = (left, right) => left;\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 1);
});

Deno.test("prefix signatures reject non-type erased binders", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type f = forall (n: I32). (value: I32) -> (result: I32)\n" +
      "ensures result = value\n" +
      "let f = value => value;\n",
  ));
  assert_equals(
    analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "DUCK2602" &&
      diagnostic.message.includes("cannot erase dependent binder")
    ),
    true,
  );
});

Deno.test("identity contracts accept aggregate representations", () => {
  const analysis = analyze_duck_source(parse_duck_source(
    "type f = (value: [I32]) -> (result: [I32])\n" +
      "ensures result = value\n" +
      "let f = value => value;\n",
  ));
  assert_equals(analysis.diagnostics, []);
  assert_equals(analysis.proofs.size, 1);
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
    mismatched.diagnostics.some((diagnostic) => diagnostic.code === "DUCK2310"),
    true,
  );
  assert_equals(mismatched.proofs.size, 1);
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
