import { assert_equals } from "../assert.ts";
import {
  semantic_machine_certificate,
  semantic_predicate_certificate,
  semantic_remainder_certificate,
  semantic_unreachable_certificate,
  type SemanticMachineRequirement,
  type SemanticRemainderRequirement,
  verify_semantic_machine_certificate,
  verify_semantic_predicate_certificate,
  verify_semantic_remainder_certificate,
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
const u32_type = { tag: "scalar", name: "U32" } as const;
const bool_type = { tag: "scalar", name: "Bool" } as const;

Deno.test("semantic predicate certificates verify only value-preserving aliases", () => {
  const builder = new SemanticCfgBuilder("predicate-certificate");
  const entry = builder.add_block(origin);
  const value = "predicate-parameter" as ValueId;
  builder.add_parameter(value, i32_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const alias = builder.add_node(
    entry,
    origin,
    { start: 2, end: 12 },
    { tag: "primitive", name: "bind:alias" },
    [value],
    [i32_type],
  )[0];
  if (alias === undefined) throw new Error("Expected predicate alias.");
  const replacement = builder.add_node(
    entry,
    origin,
    { start: 13, end: 14 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  if (replacement === undefined) throw new Error("Expected replacement.");
  const call_span = { start: 15, end: 28 };
  const result = builder.add_node(
    entry,
    origin,
    call_span,
    { tag: "call", function_name: "consume" },
    [alias],
    [i32_type],
  )[0];
  if (result === undefined) throw new Error("Expected predicate call.");
  builder.terminate(entry, { tag: "return", value: result });
  const control_flow = builder.finish();
  const premise = {
    predicate: "fact:root:p",
    arguments: [value],
  };
  const conclusion = {
    predicate: "fact:root:p",
    arguments: [alias],
  };
  const certificate = semantic_predicate_certificate(
    call_span,
    premise,
    conclusion,
  );
  assert_equals(
    verify_semantic_predicate_certificate(
      certificate,
      control_flow,
      call_span,
      [premise],
      conclusion,
    ),
    true,
  );
  assert_equals(Object.isFrozen(certificate), true);
  assert_equals(Object.isFrozen(certificate.premise.arguments), true);
  assert_equals(
    verify_semantic_predicate_certificate(
      certificate,
      control_flow,
      call_span,
      [],
      conclusion,
    ),
    false,
  );

  const invalid_conclusion = {
    predicate: "fact:root:p",
    arguments: [replacement],
  };
  const invalid = semantic_predicate_certificate(
    call_span,
    premise,
    invalid_conclusion,
  );
  assert_equals(
    verify_semantic_predicate_certificate(
      invalid,
      control_flow,
      call_span,
      [premise],
      invalid_conclusion,
    ),
    false,
  );

  const missing = "missing-predicate-value" as ValueId;
  const forged_conclusion = {
    predicate: "fact:root:p",
    arguments: [missing],
  };
  const forged = semantic_predicate_certificate(
    call_span,
    premise,
    forged_conclusion,
  );
  assert_equals(
    verify_semantic_predicate_certificate(
      forged,
      control_flow,
      call_span,
      [premise],
      forged_conclusion,
    ),
    false,
  );
});

Deno.test("semantic predicate certificates reject representation-changing aliases", () => {
  const builder = new SemanticCfgBuilder("predicate-representation");
  const entry = builder.add_block(origin);
  const value = "predicate-i32-parameter" as ValueId;
  builder.add_parameter(value, i32_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const changed = builder.add_node(
    entry,
    origin,
    { start: 2, end: 12 },
    { tag: "primitive", name: "bind:changed" },
    [value],
    [u32_type],
  )[0];
  if (changed === undefined) throw new Error("Expected changed alias.");
  const call_span = { start: 13, end: 26 };
  const result = builder.add_node(
    entry,
    origin,
    call_span,
    { tag: "call", function_name: "consume" },
    [changed],
    [u32_type],
  )[0];
  if (result === undefined) throw new Error("Expected changed call.");
  builder.terminate(entry, { tag: "return", value: result });
  const control_flow = builder.finish();
  const premise = {
    predicate: "fact:root:p",
    arguments: [value],
  };
  const conclusion = {
    predicate: "fact:root:p",
    arguments: [changed],
  };
  const certificate = semantic_predicate_certificate(
    call_span,
    premise,
    conclusion,
  );
  assert_equals(
    verify_semantic_predicate_certificate(
      certificate,
      control_flow,
      call_span,
      [premise],
      conclusion,
    ),
    false,
  );
});

Deno.test("semantic remainder certificates verify exact machine operations", () => {
  const builder = new SemanticCfgBuilder("remainder-certificate");
  const entry = builder.add_block(origin);
  const when_true = builder.add_block("remainder-true:1:2:0" as never);
  const when_false = builder.add_block("remainder-false:2:3:0" as never);
  const value = "remainder-parameter" as ValueId;
  builder.add_parameter(value, i32_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const divisor = builder.add_node(
    entry,
    origin,
    { start: 2, end: 3 },
    { tag: "constant", value: 4 },
    [],
    [i32_type],
  )[0];
  if (divisor === undefined) throw new Error("Expected remainder divisor.");
  const remainder = builder.add_node(
    entry,
    origin,
    { start: 0, end: 3 },
    { tag: "primitive", name: "i32.rem_s" },
    [value, divisor],
    [i32_type],
  )[0];
  if (remainder === undefined) throw new Error("Expected remainder.");
  const zero = builder.add_node(
    entry,
    origin,
    { start: 4, end: 5 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  if (zero === undefined) throw new Error("Expected remainder comparison.");
  const condition = builder.add_node(
    entry,
    origin,
    { start: 0, end: 5 },
    { tag: "primitive", name: "i32.eq" },
    [remainder, zero],
    [bool_type],
  )[0];
  if (condition === undefined) throw new Error("Expected remainder branch.");
  builder.connect(entry, when_true);
  builder.connect(entry, when_false);
  builder.terminate(entry, {
    tag: "branch",
    condition,
    when_true,
    when_false,
  });
  const call_span = { start: 6, end: 19 };
  const result = builder.add_node(
    when_true,
    "remainder-true:1:2:0" as never,
    call_span,
    { tag: "call", function_name: "consume" },
    [value],
    [i32_type],
  )[0];
  if (result === undefined) throw new Error("Expected remainder call.");
  builder.terminate(when_true, { tag: "return", value: result });
  builder.terminate(when_false, { tag: "return", value: zero });
  const control_flow = builder.finish();
  const requirement: SemanticRemainderRequirement = {
    dividend: value,
    divisor,
    remainder,
    expected: 0n,
  };
  const certificate = semantic_remainder_certificate(
    call_span,
    requirement,
  );
  assert_equals(
    verify_semantic_remainder_certificate(
      certificate,
      control_flow,
      call_span,
      requirement,
    ),
    true,
  );
  assert_equals(Object.isFrozen(certificate), true);
  assert_equals(Object.isFrozen(certificate.requirement), true);

  const wrong_expected = { ...requirement, expected: 1n };
  const invalid = semantic_remainder_certificate(
    call_span,
    wrong_expected,
  );
  assert_equals(
    verify_semantic_remainder_certificate(
      invalid,
      control_flow,
      call_span,
      wrong_expected,
    ),
    false,
  );

  const wrapping_expected = {
    ...requirement,
    expected: 4_294_967_296n,
  };
  const wrapping = semantic_remainder_certificate(
    call_span,
    wrapping_expected,
  );
  assert_equals(
    verify_semantic_remainder_certificate(
      wrapping,
      control_flow,
      call_span,
      wrapping_expected,
    ),
    false,
  );
});

Deno.test("semantic remainder certificates reject traps and primitive mismatches", () => {
  for (
    const [primitive, divisor_value] of [
      ["i32.rem_s", 0],
      ["i32.rem_u", 4],
    ] as const
  ) {
    const builder = new SemanticCfgBuilder(
      "invalid-remainder-" + primitive + "-" + divisor_value.toString(),
    );
    const entry = builder.add_block(origin);
    const when_true = builder.add_block(
      "invalid-remainder-true:1:2:0" as never,
    );
    const when_false = builder.add_block(
      "invalid-remainder-false:2:3:0" as never,
    );
    const value = (
      "invalid-remainder-parameter-" + primitive
    ) as ValueId;
    builder.add_parameter(value, i32_type, {
      source_node: origin,
      start: 0,
      end: 1,
    });
    const divisor = builder.add_node(
      entry,
      origin,
      { start: 2, end: 3 },
      { tag: "constant", value: divisor_value },
      [],
      [i32_type],
    )[0];
    if (divisor === undefined) throw new Error("Expected invalid divisor.");
    const remainder = builder.add_node(
      entry,
      origin,
      { start: 0, end: 3 },
      { tag: "primitive", name: primitive },
      [value, divisor],
      [i32_type],
    )[0];
    if (remainder === undefined) throw new Error("Expected invalid remainder.");
    const zero = builder.add_node(
      entry,
      origin,
      { start: 4, end: 5 },
      { tag: "constant", value: 0 },
      [],
      [i32_type],
    )[0];
    if (zero === undefined) throw new Error("Expected invalid comparison.");
    const condition = builder.add_node(
      entry,
      origin,
      { start: 0, end: 5 },
      { tag: "primitive", name: "i32.eq" },
      [remainder, zero],
      [bool_type],
    )[0];
    if (condition === undefined) throw new Error("Expected invalid branch.");
    builder.connect(entry, when_true);
    builder.connect(entry, when_false);
    builder.terminate(entry, {
      tag: "branch",
      condition,
      when_true,
      when_false,
    });
    const call_span = { start: 6, end: 19 };
    const result = builder.add_node(
      when_true,
      "invalid-remainder-true:1:2:0" as never,
      call_span,
      { tag: "call", function_name: "consume" },
      [value],
      [i32_type],
    )[0];
    if (result === undefined) throw new Error("Expected invalid call.");
    builder.terminate(when_true, { tag: "return", value: result });
    builder.terminate(when_false, { tag: "return", value: zero });
    const control_flow = builder.finish();
    const requirement: SemanticRemainderRequirement = {
      dividend: value,
      divisor,
      remainder,
      expected: 0n,
    };
    const certificate = semantic_remainder_certificate(
      call_span,
      requirement,
    );
    assert_equals(
      verify_semantic_remainder_certificate(
        certificate,
        control_flow,
        call_span,
        requirement,
      ),
      false,
    );
  }
});

Deno.test("semantic remainder certificates reject ambiguous producer outputs", () => {
  for (const ambiguous of ["divisor", "remainder", "comparison"]) {
    const builder = new SemanticCfgBuilder(
      "ambiguous-remainder-" + ambiguous,
    );
    const entry = builder.add_block(origin);
    const when_true = builder.add_block(
      "ambiguous-remainder-true:1:2:0" as never,
    );
    const when_false = builder.add_block(
      "ambiguous-remainder-false:2:3:0" as never,
    );
    const value = ("ambiguous-remainder-" + ambiguous) as ValueId;
    builder.add_parameter(value, i32_type, {
      source_node: origin,
      start: 0,
      end: 1,
    });
    let divisor_types = [i32_type];
    if (ambiguous === "divisor") divisor_types = [i32_type, i32_type];
    const divisor_outputs = builder.add_node(
      entry,
      origin,
      { start: 2, end: 3 },
      { tag: "constant", value: 4 },
      [],
      divisor_types,
    );
    let divisor = divisor_outputs[0];
    if (ambiguous === "divisor") divisor = divisor_outputs[1];
    if (divisor === undefined) throw new Error("Expected ambiguous divisor.");
    let remainder_types = [i32_type];
    if (ambiguous === "remainder") {
      remainder_types = [i32_type, i32_type];
    }
    const remainder_outputs = builder.add_node(
      entry,
      origin,
      { start: 0, end: 3 },
      { tag: "primitive", name: "i32.rem_s" },
      [value, divisor],
      remainder_types,
    );
    let remainder = remainder_outputs[0];
    if (ambiguous === "remainder") remainder = remainder_outputs[1];
    if (remainder === undefined) {
      throw new Error("Expected ambiguous remainder.");
    }
    const zero = builder.add_node(
      entry,
      origin,
      { start: 4, end: 5 },
      { tag: "constant", value: 0 },
      [],
      [i32_type],
    )[0];
    if (zero === undefined) throw new Error("Expected ambiguous comparison.");
    let comparison_types = [bool_type];
    if (ambiguous === "comparison") {
      comparison_types = [bool_type, bool_type];
    }
    const comparison_outputs = builder.add_node(
      entry,
      origin,
      { start: 0, end: 5 },
      { tag: "primitive", name: "i32.eq" },
      [remainder, zero],
      comparison_types,
    );
    let condition = comparison_outputs[0];
    if (ambiguous === "comparison") condition = comparison_outputs[1];
    if (condition === undefined) throw new Error("Expected ambiguous branch.");
    builder.connect(entry, when_true);
    builder.connect(entry, when_false);
    builder.terminate(entry, {
      tag: "branch",
      condition,
      when_true,
      when_false,
    });
    const call_span = { start: 6, end: 19 };
    const result = builder.add_node(
      when_true,
      "ambiguous-remainder-true:1:2:0" as never,
      call_span,
      { tag: "call", function_name: "consume" },
      [value],
      [i32_type],
    )[0];
    if (result === undefined) throw new Error("Expected ambiguous call.");
    builder.terminate(when_true, { tag: "return", value: result });
    builder.terminate(when_false, { tag: "return", value: zero });
    const control_flow = builder.finish();
    const requirement: SemanticRemainderRequirement = {
      dividend: value,
      divisor,
      remainder,
      expected: 0n,
    };
    const certificate = semantic_remainder_certificate(
      call_span,
      requirement,
    );
    assert_equals(
      verify_semantic_remainder_certificate(
        certificate,
        control_flow,
        call_span,
        requirement,
      ),
      false,
    );
  }
});

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

Deno.test("semantic machine certificates preserve path facts through numeric phis", () => {
  for (const alternate of [10, 30]) {
    const builder = new SemanticCfgBuilder(
      "numeric-phi-certificate-" + alternate.toString(),
    );
    const entry = builder.add_block(origin);
    const when_true = builder.add_block("fact-true:1:2:0" as never);
    const when_false = builder.add_block("fact-false:2:3:0" as never);
    const joined = builder.add_block("fact-join:3:4:0" as never);
    const ready = ("numeric-phi-ready-" + alternate.toString()) as ValueId;
    builder.add_parameter(ready, bool_type, {
      source_node: origin,
      start: 0,
      end: 1,
    });
    builder.connect(entry, when_true);
    builder.connect(entry, when_false);
    builder.terminate(entry, {
      tag: "branch",
      condition: ready,
      when_true,
      when_false,
    });
    const consequent = builder.add_node(
      when_true,
      "fact-true:1:2:0" as never,
      { start: 2, end: 3 },
      { tag: "constant", value: 5 },
      [],
      [i32_type],
    )[0];
    const alternative = builder.add_node(
      when_false,
      "fact-false:2:3:0" as never,
      { start: 4, end: 6 },
      { tag: "constant", value: alternate },
      [],
      [i32_type],
    )[0];
    if (consequent === undefined || alternative === undefined) {
      throw new Error("Expected phi inputs.");
    }
    builder.connect(when_true, joined);
    builder.connect(when_false, joined);
    builder.terminate(when_true, { tag: "jump", target: joined });
    builder.terminate(when_false, { tag: "jump", target: joined });
    const selected = builder.add_phi(
      joined,
      "fact-join:3:4:0" as never,
      { start: 2, end: 6 },
      new Map([
        [when_true, consequent],
        [when_false, alternative],
      ]),
      i32_type,
    );
    const call_span = { start: 7, end: 14 };
    const result = builder.add_node(
      joined,
      "fact-join:3:4:0" as never,
      call_span,
      { tag: "call", function_name: "consume" },
      [selected],
      [i32_type],
    )[0];
    if (result === undefined) throw new Error("Expected call result.");
    builder.terminate(joined, { tag: "return", value: result });
    const control_flow = builder.finish();
    const requirement: SemanticMachineRequirement = {
      tag: "fact",
      proposition: { tag: "less_than", value: selected, bound: 20n },
    };
    const certificate = infer_semantic_machine_certificate(
      control_flow,
      call_span,
      requirement,
    );
    assert_equals(certificate !== undefined, alternate < 20);
    const forged = semantic_machine_certificate(call_span, requirement);
    assert_equals(
      verify_semantic_machine_certificate(
        forged,
        control_flow,
        call_span,
        requirement,
      ),
      alternate < 20,
    );
  }
});

Deno.test("semantic unreachable certificates normalize wrapping comparison constants", () => {
  const builder = new SemanticCfgBuilder("wrapping-constant-certificate");
  const entry = builder.add_block(origin);
  const when_true = builder.add_block("fact-true:1:2:0" as never);
  const when_false = builder.add_block("fact-false:2:3:0" as never);
  const value = "wrapping-constant-parameter" as ValueId;
  builder.add_parameter(value, u32_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const wrapped_zero = builder.add_node(
    entry,
    origin,
    { start: 2, end: 12 },
    { tag: "constant", value: 4294967296n },
    [],
    [u32_type],
  )[0];
  if (wrapped_zero === undefined) throw new Error("Expected wrapped zero.");
  const condition = builder.add_node(
    entry,
    origin,
    { start: 0, end: 12 },
    { tag: "primitive", name: "i32.eq" },
    [value, wrapped_zero],
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
  const call_span = { start: 13, end: 20 };
  const call = builder.add_node(
    when_true,
    "fact-true:1:2:0" as never,
    call_span,
    { tag: "call", function_name: "consume" },
    [value],
    [u32_type],
  )[0];
  if (call === undefined) throw new Error("Expected call result.");
  builder.terminate(when_true, { tag: "return", value: call });
  const fallback = builder.add_node(
    when_false,
    "fact-false:2:3:0" as never,
    { start: 21, end: 22 },
    { tag: "constant", value: 0 },
    [],
    [u32_type],
  )[0];
  builder.terminate(when_false, { tag: "return", value: fallback });
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

Deno.test("semantic machine certificates reject calls repeated by a loop", () => {
  const builder = new SemanticCfgBuilder("repeated-call-certificate");
  const entry = builder.add_block(origin);
  const header = builder.add_block("loop-header:1:2:0" as never);
  const body = builder.add_block("loop-body:2:3:0" as never);
  const latch = builder.add_block("loop-latch:3:4:0" as never);
  const exit = builder.add_block("loop-exit:4:5:0" as never);
  const ready = "repeated-call-ready" as ValueId;
  builder.add_parameter(ready, bool_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const initial = builder.add_node(
    entry,
    origin,
    { start: 2, end: 3 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  if (initial === undefined) throw new Error("Expected initial loop value.");
  builder.connect(entry, header);
  builder.terminate(entry, { tag: "jump", target: header });
  const current = builder.add_phi(
    header,
    "loop-header:1:2:0" as never,
    { start: 2, end: 3 },
    new Map([[entry, initial]]),
    i32_type,
  );
  builder.connect(header, body);
  builder.connect(header, exit);
  builder.terminate(header, {
    tag: "branch",
    condition: ready,
    when_true: body,
    when_false: exit,
  });
  const call_span = { start: 4, end: 11 };
  const call = builder.add_node(
    body,
    "loop-body:2:3:0" as never,
    call_span,
    { tag: "call", function_name: "consume" },
    [current],
    [i32_type],
  )[0];
  if (call === undefined) throw new Error("Expected repeated call result.");
  builder.connect(body, latch);
  builder.terminate(body, { tag: "jump", target: latch });
  const next = builder.add_node(
    latch,
    "loop-latch:3:4:0" as never,
    { start: 12, end: 13 },
    { tag: "constant", value: 1 },
    [],
    [i32_type],
  )[0];
  if (next === undefined) throw new Error("Expected next loop value.");
  builder.connect(latch, header);
  builder.add_phi_input(current, latch, next);
  builder.terminate(latch, { tag: "jump", target: header });
  const fallback = builder.add_node(
    exit,
    "loop-exit:4:5:0" as never,
    { start: 14, end: 15 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  builder.terminate(exit, { tag: "return", value: fallback });
  const control_flow = builder.finish();
  const requirement: SemanticMachineRequirement = {
    tag: "fact",
    proposition: { tag: "equal", value: current, expected: 0n },
  };
  assert_equals(
    infer_semantic_machine_certificate(
      control_flow,
      call_span,
      requirement,
    ),
    undefined,
  );
  assert_equals(
    verify_semantic_machine_certificate(
      semantic_machine_certificate(call_span, requirement),
      control_flow,
      call_span,
      requirement,
    ),
    false,
  );
});

Deno.test("semantic machine certificates ignore guards after a repeated call", () => {
  const builder = new SemanticCfgBuilder("post-call-loop-guard");
  const entry = builder.add_block(origin);
  const body = builder.add_block("loop-body:1:2:0" as never);
  const exit = builder.add_block("loop-exit:2:3:0" as never);
  const current = "post-call-loop-current" as ValueId;
  builder.add_parameter(current, i32_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const end = builder.add_node(
    entry,
    origin,
    { start: 2, end: 3 },
    { tag: "constant", value: 3 },
    [],
    [i32_type],
  )[0];
  const step = builder.add_node(
    entry,
    origin,
    { start: 4, end: 5 },
    { tag: "constant", value: 1 },
    [],
    [i32_type],
  )[0];
  if (end === undefined || step === undefined) {
    throw new Error("Expected range constants.");
  }
  builder.connect(entry, body);
  builder.terminate(entry, { tag: "jump", target: body });
  const call_span = { start: 6, end: 13 };
  const call = builder.add_node(
    body,
    "loop-body:1:2:0" as never,
    call_span,
    { tag: "call", function_name: "consume" },
    [current],
    [i32_type],
  )[0];
  if (call === undefined) throw new Error("Expected repeated call result.");
  const condition = builder.add_node(
    body,
    "loop-body:1:2:0" as never,
    { start: 14, end: 20 },
    { tag: "primitive", name: "range-has-next:exclusive" },
    [current, end, step],
    [bool_type],
  )[0];
  if (condition === undefined) throw new Error("Expected range condition.");
  builder.connect(body, body);
  builder.connect(body, exit);
  builder.terminate(body, {
    tag: "branch",
    condition,
    when_true: body,
    when_false: exit,
  });
  const fallback = builder.add_node(
    exit,
    "loop-exit:2:3:0" as never,
    { start: 21, end: 22 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  builder.terminate(exit, { tag: "return", value: fallback });
  const control_flow = builder.finish();
  const requirement: SemanticMachineRequirement = {
    tag: "fact",
    proposition: { tag: "less_than", value: current, bound: 3n },
  };
  assert_equals(
    infer_semantic_machine_certificate(
      control_flow,
      call_span,
      requirement,
    ),
    undefined,
  );
  assert_equals(
    verify_semantic_machine_certificate(
      semantic_machine_certificate(call_span, requirement),
      control_flow,
      call_span,
      requirement,
    ),
    false,
  );
});
