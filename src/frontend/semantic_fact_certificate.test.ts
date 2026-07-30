import { assert_equals } from "../assert.ts";
import {
  semantic_machine_certificate,
  semantic_unreachable_certificate,
  type SemanticMachineRequirement,
  verify_semantic_machine_certificate,
  verify_semantic_unreachable_certificate,
} from "./semantic_fact_certificate.ts";
import {
  infer_semantic_machine_certificate,
  infer_semantic_unreachable_certificate,
} from "./semantic_fact_graph.ts";
import { SemanticCfgBuilder } from "./semantic_cfg.ts";
import type { ValueId } from "./semantic_identity.ts";

const origin = "fact-certificate:0:1:0" as never;
const i32_type = { tag: "scalar", name: "I32" } as const;
const bool_type = { tag: "scalar", name: "Bool" } as const;

Deno.test("semantic machine certificates independently verify CFG bounds", () => {
  const builder = new SemanticCfgBuilder("fact-certificate");
  const entry = builder.add_block(origin);
  const when_true = builder.add_block("fact-true:1:2:0" as never);
  const when_false = builder.add_block("fact-false:2:3:0" as never);
  const value = "fact-parameter" as ValueId;
  builder.add_parameter(value, i32_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const bound = builder.add_node(
    entry,
    origin,
    { start: 2, end: 4 },
    { tag: "constant", value: 10 },
    [],
    [i32_type],
  )[0];
  if (bound === undefined) throw new Error("Expected comparison bound.");
  const condition = builder.add_node(
    entry,
    origin,
    { start: 0, end: 4 },
    { tag: "primitive", name: "i32.lt_s" },
    [value, bound],
    [bool_type],
  )[0];
  if (condition === undefined) throw new Error("Expected branch condition.");
  builder.connect(entry, when_true);
  builder.connect(entry, when_false);
  builder.terminate(entry, {
    tag: "branch",
    condition,
    when_true,
    when_false,
  });
  const call_span = { start: 5, end: 12 };
  const result = builder.add_node(
    when_true,
    "fact-true:1:2:0" as never,
    call_span,
    { tag: "call", function_name: "consume" },
    [value],
    [i32_type],
  )[0];
  if (result === undefined) throw new Error("Expected call result.");
  builder.terminate(when_true, { tag: "return", value: result });
  const fallback = builder.add_node(
    when_false,
    "fact-false:2:3:0" as never,
    { start: 13, end: 14 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  builder.terminate(when_false, { tag: "return", value: fallback });
  const control_flow = builder.finish();
  const weaker: SemanticMachineRequirement = {
    tag: "fact",
    proposition: { tag: "less_than", value, bound: 20n },
  };
  const certificate = infer_semantic_machine_certificate(
    control_flow,
    call_span,
    weaker,
  );
  if (certificate === undefined) {
    throw new Error("Expected inferred semantic machine certificate.");
  }
  assert_equals(
    verify_semantic_machine_certificate(
      certificate,
      control_flow,
      call_span,
      weaker,
    ),
    true,
  );
  assert_equals(Object.isFrozen(certificate), true);
  assert_equals(Object.isFrozen(certificate.call_span), true);
  assert_equals(Object.isFrozen(certificate.requirement), true);

  const stronger: SemanticMachineRequirement = {
    tag: "fact",
    proposition: { tag: "less_than", value, bound: 5n },
  };
  const invalid = semantic_machine_certificate(call_span, stronger);
  assert_equals(
    verify_semantic_machine_certificate(
      invalid,
      control_flow,
      call_span,
      stronger,
    ),
    false,
  );
});

Deno.test("semantic machine certificates reject comparison primitives that mismatch operand types", () => {
  for (const primitive of ["i32.lt_u", "i64.lt_s", "duck.lt_s"]) {
    const builder = new SemanticCfgBuilder(
      "fact-certificate-" + primitive,
    );
    const entry = builder.add_block(origin);
    const when_true = builder.add_block("fact-true:1:2:0" as never);
    const when_false = builder.add_block("fact-false:2:3:0" as never);
    const value = ("fact-parameter-" + primitive) as ValueId;
    builder.add_parameter(value, i32_type, {
      source_node: origin,
      start: 0,
      end: 1,
    });
    const zero = builder.add_node(
      entry,
      origin,
      { start: 2, end: 3 },
      { tag: "constant", value: 0 },
      [],
      [i32_type],
    )[0];
    if (zero === undefined) throw new Error("Expected comparison bound.");
    const condition = builder.add_node(
      entry,
      origin,
      { start: 0, end: 3 },
      { tag: "primitive", name: primitive },
      [value, zero],
      [bool_type],
    )[0];
    if (condition === undefined) throw new Error("Expected branch condition.");
    builder.connect(entry, when_true);
    builder.connect(entry, when_false);
    builder.terminate(entry, {
      tag: "branch",
      condition,
      when_true,
      when_false,
    });
    const fallback = builder.add_node(
      when_true,
      "fact-true:1:2:0" as never,
      { start: 4, end: 5 },
      { tag: "constant", value: 0 },
      [],
      [i32_type],
    )[0];
    builder.terminate(when_true, { tag: "return", value: fallback });
    const call_span = { start: 6, end: 13 };
    const result = builder.add_node(
      when_false,
      "fact-false:2:3:0" as never,
      call_span,
      { tag: "call", function_name: "consume" },
      [value],
      [i32_type],
    )[0];
    if (result === undefined) throw new Error("Expected call result.");
    builder.terminate(when_false, { tag: "return", value: result });
    const control_flow = builder.finish();
    const requirement: SemanticMachineRequirement = {
      tag: "fact",
      proposition: { tag: "greater_equal", value, bound: 0n },
    };
    assert_equals(
      infer_semantic_machine_certificate(
        control_flow,
        call_span,
        requirement,
      ),
      undefined,
    );
    const certificate = semantic_machine_certificate(call_span, requirement);
    assert_equals(
      verify_semantic_machine_certificate(
        certificate,
        control_flow,
        call_span,
        requirement,
      ),
      false,
    );
  }
});

Deno.test("semantic machine certificates reject ambiguous call spans", () => {
  const builder = new SemanticCfgBuilder("ambiguous-call-certificate");
  const entry = builder.add_block(origin);
  const when_true = builder.add_block("fact-true:1:2:0" as never);
  const when_false = builder.add_block("fact-false:2:3:0" as never);
  const value = "ambiguous-call-parameter" as ValueId;
  builder.add_parameter(value, i32_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const bound = builder.add_node(
    entry,
    origin,
    { start: 2, end: 4 },
    { tag: "constant", value: 10 },
    [],
    [i32_type],
  )[0];
  if (bound === undefined) throw new Error("Expected comparison bound.");
  const condition = builder.add_node(
    entry,
    origin,
    { start: 0, end: 4 },
    { tag: "primitive", name: "i32.lt_s" },
    [value, bound],
    [bool_type],
  )[0];
  if (condition === undefined) throw new Error("Expected branch condition.");
  builder.connect(entry, when_true);
  builder.connect(entry, when_false);
  builder.terminate(entry, {
    tag: "branch",
    condition,
    when_true,
    when_false,
  });
  const call_span = { start: 5, end: 12 };
  const safe_result = builder.add_node(
    when_true,
    "fact-true:1:2:0" as never,
    call_span,
    { tag: "call", function_name: "consume" },
    [value],
    [i32_type],
  )[0];
  if (safe_result === undefined) throw new Error("Expected safe call result.");
  builder.terminate(when_true, { tag: "return", value: safe_result });
  const unsafe_result = builder.add_node(
    when_false,
    "fact-false:2:3:0" as never,
    call_span,
    { tag: "call", function_name: "consume" },
    [value],
    [i32_type],
  )[0];
  if (unsafe_result === undefined) {
    throw new Error("Expected unsafe call result.");
  }
  builder.terminate(when_false, { tag: "return", value: unsafe_result });
  const control_flow = builder.finish();
  const requirement: SemanticMachineRequirement = {
    tag: "fact",
    proposition: { tag: "less_than", value, bound: 20n },
  };
  assert_equals(
    infer_semantic_machine_certificate(
      control_flow,
      call_span,
      requirement,
    ),
    undefined,
  );
  const certificate = semantic_machine_certificate(call_span, requirement);
  assert_equals(
    verify_semantic_machine_certificate(
      certificate,
      control_flow,
      call_span,
      requirement,
    ),
    false,
  );
});

Deno.test("semantic unreachable certificates distinguish dead and live calls", () => {
  for (const condition_value of [false, true]) {
    const builder = new SemanticCfgBuilder(
      "unreachable-certificate-" + condition_value.toString(),
    );
    const entry = builder.add_block(origin);
    const when_true = builder.add_block("fact-true:1:2:0" as never);
    const when_false = builder.add_block("fact-false:2:3:0" as never);
    const condition = builder.add_node(
      entry,
      origin,
      { start: 0, end: 1 },
      { tag: "constant", value: condition_value },
      [],
      [bool_type],
    )[0];
    if (condition === undefined) throw new Error("Expected condition.");
    builder.connect(entry, when_true);
    builder.connect(entry, when_false);
    builder.terminate(entry, {
      tag: "branch",
      condition,
      when_true,
      when_false,
    });
    const call_span = { start: 2, end: 9 };
    const call = builder.add_node(
      when_true,
      "fact-true:1:2:0" as never,
      call_span,
      { tag: "call", function_name: "consume" },
      [],
      [i32_type],
    )[0];
    if (call === undefined) throw new Error("Expected call result.");
    builder.terminate(when_true, { tag: "return", value: call });
    const fallback = builder.add_node(
      when_false,
      "fact-false:2:3:0" as never,
      { start: 10, end: 11 },
      { tag: "constant", value: 0 },
      [],
      [i32_type],
    )[0];
    builder.terminate(when_false, { tag: "return", value: fallback });
    const control_flow = builder.finish();
    const inferred = infer_semantic_unreachable_certificate(
      control_flow,
      call_span,
    );
    assert_equals(inferred !== undefined, !condition_value);
    const certificate = semantic_unreachable_certificate(call_span);
    assert_equals(
      verify_semantic_unreachable_certificate(
        certificate,
        control_flow,
        call_span,
      ),
      !condition_value,
    );
  }
});

Deno.test("semantic unreachable certificates fail closed on cycles", () => {
  const builder = new SemanticCfgBuilder("cyclic-unreachable-certificate");
  const loop = builder.add_block(origin);
  const target = builder.add_block("fact-target:1:2:0" as never);
  const condition = builder.add_node(
    loop,
    origin,
    { start: 0, end: 1 },
    { tag: "constant", value: true },
    [],
    [bool_type],
  )[0];
  if (condition === undefined) throw new Error("Expected loop condition.");
  builder.connect(loop, loop);
  builder.connect(loop, target);
  builder.terminate(loop, {
    tag: "branch",
    condition,
    when_true: loop,
    when_false: target,
  });
  const call_span = { start: 2, end: 9 };
  const call = builder.add_node(
    target,
    "fact-target:1:2:0" as never,
    call_span,
    { tag: "call", function_name: "consume" },
    [],
    [i32_type],
  )[0];
  if (call === undefined) throw new Error("Expected call result.");
  builder.terminate(target, { tag: "return", value: call });
  const control_flow = builder.finish();
  assert_equals(
    infer_semantic_unreachable_certificate(control_flow, call_span),
    undefined,
  );
  assert_equals(
    verify_semantic_unreachable_certificate(
      semantic_unreachable_certificate(call_span),
      control_flow,
      call_span,
    ),
    false,
  );
});
