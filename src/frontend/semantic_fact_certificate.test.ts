import { assert_equals } from "../assert.ts";
import { normalize_machine_integer } from "./fact_graph.ts";
import {
  semantic_bounded_offset_certificate,
  semantic_index_bounds_certificate,
  semantic_integer_narrowing_certificate,
  semantic_machine_certificate,
  semantic_predicate_certificate,
  semantic_primitive_safety_certificate,
  semantic_remainder_certificate,
  semantic_remainder_divisibility_certificate,
  semantic_slice_bounds_certificate,
  semantic_type_certificate,
  semantic_unreachable_certificate,
  type SemanticBoundedOffsetRequirement,
  type SemanticIndexBoundsRequirement,
  type SemanticIntegerNarrowingRequirement,
  type SemanticMachineRequirement,
  type SemanticPrimitiveSafetyRequirement,
  type SemanticRemainderDivisibilityRequirement,
  type SemanticRemainderRequirement,
  type SemanticSliceBoundsRequirement,
  type SemanticTypeRequirement,
  verify_semantic_bounded_offset_certificate,
  verify_semantic_index_bounds_certificate,
  verify_semantic_integer_narrowing_certificate,
  verify_semantic_machine_certificate,
  verify_semantic_predicate_certificate,
  verify_semantic_primitive_disproved,
  verify_semantic_primitive_safety_certificate,
  verify_semantic_remainder_certificate,
  verify_semantic_remainder_divisibility_certificate,
  verify_semantic_slice_bounds_certificate,
  verify_semantic_type_certificate,
  verify_semantic_unreachable_certificate,
} from "./semantic_fact_certificate.ts";
import {
  infer_semantic_index_bounds_certificate,
  infer_semantic_integer_narrowing_certificate,
  infer_semantic_machine_certificate,
  infer_semantic_primitive_safety_certificate,
  infer_semantic_slice_bounds_certificate,
  infer_semantic_type_certificate,
  infer_semantic_unreachable_certificate,
  semantic_primitive_is_disproved,
} from "./semantic_fact_graph.ts";
import {
  semantic_cfg_is_well_formed,
  SemanticCfgBuilder,
} from "./semantic_cfg.ts";
import type { ValueId } from "./semantic_identity.ts";

const origin = "fact-certificate:0:1:0" as never;
const i32_type = { tag: "scalar", name: "I32" } as const;
const i64_type = { tag: "scalar", name: "I64" } as const;
const u32_type = { tag: "scalar", name: "U32" } as const;
const u64_type = { tag: "integer", signed: false, width: 64 } as const;
const bool_type = { tag: "scalar", name: "Bool" } as const;
const text_type = { tag: "scalar", name: "Text" } as const;
const pair_type = {
  tag: "product",
  fields: [
    { label: undefined, type: i32_type },
    { label: undefined, type: i32_type },
  ],
} as const;

Deno.test("semantic primitive certificates verify integer trap conditions", () => {
  const builder = new SemanticCfgBuilder("primitive-safety");
  const entry = builder.add_block(origin);
  const dividend = "primitive-dividend" as ValueId;
  builder.add_parameter(dividend, i32_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const divisor = builder.add_node(
    entry,
    origin,
    { start: 2, end: 3 },
    { tag: "constant", value: 2 },
    [],
    [i32_type],
  )[0];
  if (divisor === undefined) throw new Error("Expected primitive divisor.");
  const operation_span = { start: 0, end: 3 };
  const result = builder.add_node(
    entry,
    origin,
    operation_span,
    { tag: "primitive", name: "i32.div_s" },
    [dividend, divisor],
    [i32_type],
  )[0];
  if (result === undefined) throw new Error("Expected division result.");
  builder.terminate(entry, { tag: "return", value: result });
  const control_flow = builder.finish();
  const certificate = infer_semantic_primitive_safety_certificate(
    control_flow,
    operation_span,
    "i32.div_s",
  );
  if (certificate === undefined) {
    throw new Error("Expected primitive safety certificate.");
  }
  assert_equals(
    certificate.requirement.overflow_guard,
    "divisor_not_negative_one",
  );
  assert_equals(
    verify_semantic_primitive_safety_certificate(
      certificate,
      control_flow,
      operation_span,
      certificate.requirement,
    ),
    true,
  );
  const forged: SemanticPrimitiveSafetyRequirement = {
    ...certificate.requirement,
    divisor: "forged-divisor" as ValueId,
  };
  assert_equals(
    verify_semantic_primitive_safety_certificate(
      semantic_primitive_safety_certificate(operation_span, forged),
      control_flow,
      operation_span,
      forged,
    ),
    false,
  );

  const mismatched_builder = new SemanticCfgBuilder(
    "primitive-safety-mismatch",
  );
  const mismatched_entry = mismatched_builder.add_block(origin);
  const unsigned_dividend = "unsigned-dividend" as ValueId;
  mismatched_builder.add_parameter(unsigned_dividend, u32_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const unsigned_divisor = mismatched_builder.add_node(
    mismatched_entry,
    origin,
    { start: 2, end: 3 },
    { tag: "constant", value: 2 },
    [],
    [u32_type],
  )[0];
  if (unsigned_divisor === undefined) {
    throw new Error("Expected unsigned divisor.");
  }
  const unsigned_result = mismatched_builder.add_node(
    mismatched_entry,
    origin,
    operation_span,
    { tag: "primitive", name: "i32.div_s" },
    [unsigned_dividend, unsigned_divisor],
    [u32_type],
  )[0];
  if (unsigned_result === undefined) {
    throw new Error("Expected mismatched division result.");
  }
  mismatched_builder.terminate(mismatched_entry, {
    tag: "return",
    value: unsigned_result,
  });
  assert_equals(
    infer_semantic_primitive_safety_certificate(
      mismatched_builder.finish(),
      operation_span,
      "i32.div_s",
    ),
    undefined,
  );
});

Deno.test("semantic primitive disproof verifies inevitable traps", () => {
  const builder = new SemanticCfgBuilder("primitive-disproof");
  const entry = builder.add_block(origin);
  const dividend = builder.add_node(
    entry,
    origin,
    { start: 0, end: 2 },
    { tag: "constant", value: 84 },
    [],
    [i32_type],
  )[0];
  const divisor = builder.add_node(
    entry,
    origin,
    { start: 3, end: 4 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  if (dividend === undefined || divisor === undefined) {
    throw new Error("Expected primitive disproof operands.");
  }
  const operation_span = { start: 0, end: 4 };
  const result = builder.add_node(
    entry,
    origin,
    operation_span,
    { tag: "primitive", name: "i32.div_s" },
    [dividend, divisor],
    [i32_type],
  )[0];
  if (result === undefined) throw new Error("Expected division result.");
  builder.terminate(entry, { tag: "return", value: result });
  const control_flow = builder.finish();
  assert_equals(
    semantic_primitive_is_disproved(
      control_flow,
      operation_span,
      "i32.div_s",
    ),
    true,
  );
  assert_equals(
    verify_semantic_primitive_disproved(
      control_flow,
      operation_span,
      "i32.div_s",
    ),
    true,
  );
  assert_equals(
    verify_semantic_primitive_disproved(
      control_flow,
      operation_span,
      "i32.rem_s",
    ),
    false,
  );

  const mismatched_builder = new SemanticCfgBuilder(
    "primitive-disproof-mismatch",
  );
  const mismatched_entry = mismatched_builder.add_block(origin);
  const mismatched_dividend = mismatched_builder.add_node(
    mismatched_entry,
    origin,
    { start: 0, end: 2 },
    { tag: "constant", value: 84 },
    [],
    [i32_type],
  )[0];
  const mismatched_divisor = mismatched_builder.add_node(
    mismatched_entry,
    origin,
    { start: 3, end: 4 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  if (mismatched_dividend === undefined || mismatched_divisor === undefined) {
    throw new Error("Expected mismatched primitive operands.");
  }
  const mismatched_result = mismatched_builder.add_node(
    mismatched_entry,
    origin,
    operation_span,
    { tag: "primitive", name: "i32.div_s" },
    [mismatched_dividend, mismatched_divisor],
    [u32_type],
  )[0];
  if (mismatched_result === undefined) {
    throw new Error("Expected mismatched primitive result.");
  }
  mismatched_builder.terminate(mismatched_entry, {
    tag: "return",
    value: mismatched_result,
  });
  assert_equals(
    verify_semantic_primitive_disproved(
      mismatched_builder.finish(),
      operation_span,
      "i32.div_s",
    ),
    false,
  );
});

Deno.test("semantic narrowing certificates verify the target range", () => {
  const builder = new SemanticCfgBuilder("integer-narrowing");
  const entry = builder.add_block(origin);
  const value = builder.add_node(
    entry,
    origin,
    { start: 0, end: 2 },
    { tag: "constant", value: 42n },
    [],
    [i64_type],
  )[0];
  if (value === undefined) throw new Error("Expected narrowing input.");
  const operation_span = { start: 0, end: 24 };
  const result = builder.add_node(
    entry,
    origin,
    operation_span,
    {
      tag: "narrow_integer",
      source: { signed: true, width: 64 },
      target: { signed: true, width: 32 },
    },
    [value],
    [i32_type],
  )[0];
  if (result === undefined) throw new Error("Expected narrowing result.");
  builder.terminate(entry, { tag: "return", value: result });
  const control_flow = builder.finish();
  const requirement: SemanticIntegerNarrowingRequirement = {
    value,
    source: { signed: true, width: 64 },
    target: { signed: true, width: 32 },
  };
  const certificate = infer_semantic_integer_narrowing_certificate(
    control_flow,
    operation_span,
    requirement,
  );
  if (certificate === undefined) {
    throw new Error("Expected integer narrowing certificate.");
  }
  assert_equals(
    verify_semantic_integer_narrowing_certificate(
      certificate,
      control_flow,
      operation_span,
      requirement,
    ),
    true,
  );

  const forged: SemanticIntegerNarrowingRequirement = {
    ...requirement,
    target: { signed: false, width: 8 },
  };
  assert_equals(
    verify_semantic_integer_narrowing_certificate(
      semantic_integer_narrowing_certificate(operation_span, forged),
      control_flow,
      operation_span,
      forged,
    ),
    false,
  );

  const out_of_range_builder = new SemanticCfgBuilder(
    "integer-narrowing-out-of-range",
  );
  const out_of_range_entry = out_of_range_builder.add_block(origin);
  const out_of_range_value = out_of_range_builder.add_node(
    out_of_range_entry,
    origin,
    { start: 0, end: 10 },
    { tag: "constant", value: 2147483648n },
    [],
    [i64_type],
  )[0];
  if (out_of_range_value === undefined) {
    throw new Error("Expected out-of-range narrowing input.");
  }
  const out_of_range_result = out_of_range_builder.add_node(
    out_of_range_entry,
    origin,
    operation_span,
    {
      tag: "narrow_integer",
      source: { signed: true, width: 64 },
      target: { signed: true, width: 32 },
    },
    [out_of_range_value],
    [i32_type],
  )[0];
  if (out_of_range_result === undefined) {
    throw new Error("Expected out-of-range narrowing result.");
  }
  out_of_range_builder.terminate(out_of_range_entry, {
    tag: "return",
    value: out_of_range_result,
  });
  assert_equals(
    infer_semantic_integer_narrowing_certificate(
      out_of_range_builder.finish(),
      operation_span,
      { ...requirement, value: out_of_range_value },
    ),
    undefined,
  );
});

Deno.test("semantic slice certificates verify every bound independently", () => {
  const builder = new SemanticCfgBuilder("slice-bounds");
  const entry = builder.add_block(origin);
  const object = builder.add_node(
    entry,
    origin,
    { start: 0, end: 1 },
    { tag: "constant", value: "aéz" },
    [],
    [text_type],
  )[0];
  const start = builder.add_node(
    entry,
    origin,
    { start: 2, end: 3 },
    { tag: "constant", value: 1 },
    [],
    [i32_type],
  )[0];
  const end = builder.add_node(
    entry,
    origin,
    { start: 4, end: 5 },
    { tag: "constant", value: 3 },
    [],
    [i32_type],
  )[0];
  if (object === undefined || start === undefined || end === undefined) {
    throw new Error("Expected slice bounds.");
  }
  const operation_span = { start: 0, end: 5 };
  const result = builder.add_node(
    entry,
    origin,
    operation_span,
    { tag: "slice", length: 4 },
    [object, start, end],
    [text_type],
  )[0];
  if (result === undefined) throw new Error("Expected slice result.");
  builder.terminate(entry, { tag: "return", value: result });
  const control_flow = builder.finish();
  const requirement: SemanticSliceBoundsRequirement = {
    object,
    start,
    end,
    length: 4,
    utf8_boundaries: "static_literal",
  };
  const certificate = infer_semantic_slice_bounds_certificate(
    control_flow,
    operation_span,
    requirement,
  );
  if (certificate === undefined) {
    throw new Error("Expected slice bounds certificate.");
  }
  assert_equals(
    verify_semantic_slice_bounds_certificate(
      certificate,
      control_flow,
      operation_span,
      requirement,
    ),
    true,
  );
  const forged: SemanticSliceBoundsRequirement = {
    ...requirement,
    end: "forged-slice-end" as ValueId,
  };
  assert_equals(
    verify_semantic_slice_bounds_certificate(
      semantic_slice_bounds_certificate(operation_span, forged),
      control_flow,
      operation_span,
      forged,
    ),
    false,
  );
});

Deno.test("semantic slice certificates reject split UTF-8 code points", () => {
  const builder = new SemanticCfgBuilder("slice-utf8-boundary");
  const entry = builder.add_block(origin);
  const object = builder.add_node(
    entry,
    origin,
    { start: 0, end: 1 },
    { tag: "constant", value: "é" },
    [],
    [text_type],
  )[0];
  const start = builder.add_node(
    entry,
    origin,
    { start: 2, end: 3 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  const end = builder.add_node(
    entry,
    origin,
    { start: 4, end: 5 },
    { tag: "constant", value: 1 },
    [],
    [i32_type],
  )[0];
  if (object === undefined || start === undefined || end === undefined) {
    throw new Error("Expected UTF-8 slice bounds.");
  }
  const operation_span = { start: 0, end: 5 };
  const result = builder.add_node(
    entry,
    origin,
    operation_span,
    { tag: "slice", length: 2 },
    [object, start, end],
    [text_type],
  )[0];
  if (result === undefined) throw new Error("Expected UTF-8 slice result.");
  builder.terminate(entry, { tag: "return", value: result });
  const control_flow = builder.finish();
  const requirement: SemanticSliceBoundsRequirement = {
    object,
    start,
    end,
    length: 2,
    utf8_boundaries: "static_literal",
  };
  assert_equals(
    infer_semantic_slice_bounds_certificate(
      control_flow,
      operation_span,
      requirement,
    ),
    undefined,
  );
  assert_equals(
    verify_semantic_slice_bounds_certificate(
      semantic_slice_bounds_certificate(operation_span, requirement),
      control_flow,
      operation_span,
      requirement,
    ),
    false,
  );
});

Deno.test("semantic type certificates verify positive branch membership", () => {
  const builder = new SemanticCfgBuilder("positive-type-certificate");
  const entry = builder.add_block(origin);
  const when_true = builder.add_block("type-true:1:2:0" as never);
  const when_false = builder.add_block("type-false:2:3:0" as never);
  const marker = "type-parameter" as ValueId;
  builder.add_parameter(marker, i32_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const condition = builder.add_node(
    entry,
    origin,
    { start: 0, end: 8 },
    { tag: "type_test", type: "#answer" },
    [marker],
    [bool_type],
  )[0];
  if (condition === undefined) throw new Error("Expected semantic type test.");
  builder.connect(entry, when_true);
  builder.connect(entry, when_false);
  builder.terminate(entry, {
    tag: "branch",
    condition,
    when_true,
    when_false,
  });
  const call_span = { start: 9, end: 23 };
  const call = builder.add_node(
    when_true,
    "type-true:1:2:0" as never,
    call_span,
    { tag: "call", function_name: "consume" },
    [marker],
    [i32_type],
  )[0];
  if (call === undefined) throw new Error("Expected type-refined call.");
  builder.terminate(when_true, { tag: "return", value: call });
  const fallback = builder.add_node(
    when_false,
    "type-false:2:3:0" as never,
    { start: 24, end: 25 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  if (fallback === undefined) throw new Error("Expected type fallback.");
  builder.terminate(when_false, { tag: "return", value: fallback });
  const control_flow = builder.finish();
  const requirement: SemanticTypeRequirement = {
    value: marker,
    type: "#answer",
    expected: true,
  };
  const certificate = infer_semantic_type_certificate(
    control_flow,
    call_span,
    requirement,
  );

  assert_equals(certificate?.tag, "type_fact");
  if (certificate === undefined) {
    throw new Error("Expected inferred semantic type certificate.");
  }
  assert_equals(
    verify_semantic_type_certificate(
      certificate,
      control_flow,
      call_span,
      requirement,
    ),
    true,
  );
});

Deno.test("semantic type certificates verify negative branch membership", () => {
  const builder = new SemanticCfgBuilder("negative-type-certificate");
  const entry = builder.add_block(origin);
  const when_true = builder.add_block("negative-true:1:2:0" as never);
  const when_false = builder.add_block("negative-false:2:3:0" as never);
  const marker = "negative-type-parameter" as ValueId;
  builder.add_parameter(marker, i32_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const condition = builder.add_node(
    entry,
    origin,
    { start: 0, end: 8 },
    { tag: "type_test", type: "#answer" },
    [marker],
    [bool_type],
  )[0];
  if (condition === undefined) throw new Error("Expected semantic type test.");
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
    "negative-true:1:2:0" as never,
    { start: 9, end: 10 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  if (fallback === undefined) throw new Error("Expected type fallback.");
  builder.terminate(when_true, { tag: "return", value: fallback });
  const call_span = { start: 11, end: 25 };
  const call = builder.add_node(
    when_false,
    "negative-false:2:3:0" as never,
    call_span,
    { tag: "call", function_name: "consume" },
    [marker],
    [i32_type],
  )[0];
  if (call === undefined) throw new Error("Expected type-refined call.");
  builder.terminate(when_false, { tag: "return", value: call });
  const control_flow = builder.finish();
  const requirement: SemanticTypeRequirement = {
    value: marker,
    type: "#answer",
    expected: false,
  };
  const certificate = infer_semantic_type_certificate(
    control_flow,
    call_span,
    requirement,
  );

  assert_equals(certificate?.tag, "type_fact");
  if (certificate === undefined) {
    throw new Error("Expected inferred negative type certificate.");
  }
  assert_equals(
    verify_semantic_type_certificate(
      certificate,
      control_flow,
      call_span,
      requirement,
    ),
    true,
  );
  const forged = semantic_type_certificate(call_span, {
    ...requirement,
    expected: true,
  });
  assert_equals(
    verify_semantic_type_certificate(
      forged,
      control_flow,
      call_span,
      { ...requirement, expected: true },
    ),
    false,
  );
});

Deno.test("semantic type certificates reject representation-changing binds", () => {
  const builder = new SemanticCfgBuilder("type-bind-certificate");
  const entry = builder.add_block(origin);
  const when_true = builder.add_block("type-bind-true:1:2:0" as never);
  const when_false = builder.add_block("type-bind-false:2:3:0" as never);
  const marker = "type-bind-parameter" as ValueId;
  builder.add_parameter(marker, i32_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const condition = builder.add_node(
    entry,
    origin,
    { start: 0, end: 8 },
    { tag: "type_test", type: "I32" },
    [marker],
    [bool_type],
  )[0];
  if (condition === undefined) throw new Error("Expected semantic type test.");
  builder.connect(entry, when_true);
  builder.connect(entry, when_false);
  builder.terminate(entry, {
    tag: "branch",
    condition,
    when_true,
    when_false,
  });
  const alias = builder.add_node(
    when_true,
    "type-bind-true:1:2:0" as never,
    { start: 9, end: 14 },
    { tag: "primitive", name: "bind:alias" },
    [marker],
    [{ tag: "scalar", name: "F32" }],
  )[0];
  if (alias === undefined) throw new Error("Expected changed bind.");
  const call_span = { start: 15, end: 29 };
  const call = builder.add_node(
    when_true,
    "type-bind-true:1:2:0" as never,
    call_span,
    { tag: "call", function_name: "consume" },
    [alias],
    [i32_type],
  )[0];
  if (call === undefined) throw new Error("Expected changed bind call.");
  builder.terminate(when_true, { tag: "return", value: call });
  const fallback = builder.add_node(
    when_false,
    "type-bind-false:2:3:0" as never,
    { start: 30, end: 31 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  if (fallback === undefined) throw new Error("Expected bind fallback.");
  builder.terminate(when_false, { tag: "return", value: fallback });
  const control_flow = builder.finish();
  const requirement: SemanticTypeRequirement = {
    value: alias,
    type: "I32",
    expected: true,
  };

  assert_equals(
    infer_semantic_type_certificate(control_flow, call_span, requirement),
    undefined,
  );
  assert_equals(
    verify_semantic_type_certificate(
      semantic_type_certificate(call_span, requirement),
      control_flow,
      call_span,
      requirement,
    ),
    false,
  );
});

Deno.test("semantic type certificates reject representation-changing borrows", () => {
  const builder = new SemanticCfgBuilder("type-borrow-certificate");
  const entry = builder.add_block(origin);
  const when_true = builder.add_block("type-borrow-true:1:2:0" as never);
  const when_false = builder.add_block("type-borrow-false:2:3:0" as never);
  const marker = "type-borrow-parameter" as ValueId;
  builder.add_parameter(marker, i32_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const condition = builder.add_node(
    entry,
    origin,
    { start: 0, end: 8 },
    { tag: "type_test", type: "I32" },
    [marker],
    [bool_type],
  )[0];
  if (condition === undefined) throw new Error("Expected semantic type test.");
  builder.connect(entry, when_true);
  builder.connect(entry, when_false);
  builder.terminate(entry, {
    tag: "branch",
    condition,
    when_true,
    when_false,
  });
  const borrowed = builder.add_node(
    when_true,
    "type-borrow-true:1:2:0" as never,
    { start: 9, end: 15 },
    { tag: "ownership_transition", transition: "borrow" },
    [marker],
    [{ tag: "scalar", name: "F32" }],
  )[0];
  if (borrowed === undefined) throw new Error("Expected changed borrow.");
  const call_span = { start: 16, end: 30 };
  const call = builder.add_node(
    when_true,
    "type-borrow-true:1:2:0" as never,
    call_span,
    { tag: "call", function_name: "consume" },
    [borrowed],
    [i32_type],
  )[0];
  if (call === undefined) throw new Error("Expected changed borrow call.");
  builder.terminate(when_true, { tag: "return", value: call });
  const fallback = builder.add_node(
    when_false,
    "type-borrow-false:2:3:0" as never,
    { start: 31, end: 32 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  if (fallback === undefined) throw new Error("Expected borrow fallback.");
  builder.terminate(when_false, { tag: "return", value: fallback });
  const control_flow = builder.finish();
  const requirement: SemanticTypeRequirement = {
    value: borrowed,
    type: "I32",
    expected: true,
  };

  assert_equals(
    infer_semantic_type_certificate(control_flow, call_span, requirement),
    undefined,
  );
  assert_equals(
    verify_semantic_type_certificate(
      semantic_type_certificate(call_span, requirement),
      control_flow,
      call_span,
      requirement,
    ),
    false,
  );
});

Deno.test("semantic type certificates preserve aliased facts across borrows", () => {
  const builder = new SemanticCfgBuilder("type-aliased-borrow-certificate");
  const entry = builder.add_block(origin);
  const when_true = builder.add_block(
    "type-aliased-borrow-true:1:2:0" as never,
  );
  const when_false = builder.add_block(
    "type-aliased-borrow-false:2:3:0" as never,
  );
  const marker = "type-aliased-borrow-parameter" as ValueId;
  builder.add_parameter(marker, i32_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const condition = builder.add_node(
    entry,
    origin,
    { start: 0, end: 8 },
    { tag: "type_test", type: "I32" },
    [marker],
    [bool_type],
  )[0];
  if (condition === undefined) throw new Error("Expected semantic type test.");
  builder.connect(entry, when_true);
  builder.connect(entry, when_false);
  builder.terminate(entry, {
    tag: "branch",
    condition,
    when_true,
    when_false,
  });
  const alias = builder.add_node(
    when_true,
    "type-aliased-borrow-true:1:2:0" as never,
    { start: 9, end: 14 },
    { tag: "primitive", name: "bind:alias" },
    [marker],
    [i32_type],
  )[0];
  if (alias === undefined) throw new Error("Expected borrow source alias.");
  const borrowed = builder.add_node(
    when_true,
    "type-aliased-borrow-true:1:2:0" as never,
    { start: 15, end: 21 },
    { tag: "ownership_transition", transition: "borrow" },
    [alias],
    [i32_type],
  )[0];
  if (borrowed === undefined) throw new Error("Expected aliased borrow.");
  const call_span = { start: 22, end: 36 };
  const call = builder.add_node(
    when_true,
    "type-aliased-borrow-true:1:2:0" as never,
    call_span,
    { tag: "call", function_name: "consume" },
    [borrowed],
    [i32_type],
  )[0];
  if (call === undefined) throw new Error("Expected aliased borrow call.");
  builder.terminate(when_true, { tag: "return", value: call });
  const fallback = builder.add_node(
    when_false,
    "type-aliased-borrow-false:2:3:0" as never,
    { start: 37, end: 38 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  if (fallback === undefined) throw new Error("Expected borrow fallback.");
  builder.terminate(when_false, { tag: "return", value: fallback });
  const control_flow = builder.finish();
  const requirement: SemanticTypeRequirement = {
    value: borrowed,
    type: "I32",
    expected: true,
  };
  const certificate = infer_semantic_type_certificate(
    control_flow,
    call_span,
    requirement,
  );
  if (certificate === undefined) {
    throw new Error("Expected aliased borrow type certificate.");
  }

  assert_equals(
    verify_semantic_type_certificate(
      certificate,
      control_flow,
      call_span,
      requirement,
    ),
    true,
  );
});

Deno.test("semantic type certificates do not infer from string contents", () => {
  const builder = new SemanticCfgBuilder("type-string-certificate");
  const entry = builder.add_block(origin);
  const value = builder.add_node(
    entry,
    origin,
    { start: 0, end: 9 },
    { tag: "constant", value: "#answer" },
    [],
    [i32_type],
  )[0];
  if (value === undefined) throw new Error("Expected string constant.");
  const call_span = { start: 10, end: 24 };
  const call = builder.add_node(
    entry,
    origin,
    call_span,
    { tag: "call", function_name: "consume" },
    [value],
    [i32_type],
  )[0];
  if (call === undefined) throw new Error("Expected string call.");
  builder.terminate(entry, { tag: "return", value: call });
  const control_flow = builder.finish();
  const requirement: SemanticTypeRequirement = {
    value,
    type: "#answer",
    expected: true,
  };

  assert_equals(
    infer_semantic_type_certificate(control_flow, call_span, requirement),
    undefined,
  );
  assert_equals(
    verify_semantic_type_certificate(
      semantic_type_certificate(call_span, requirement),
      control_flow,
      call_span,
      requirement,
    ),
    false,
  );
});

Deno.test("semantic bounded offset certificates verify non-wrapping arithmetic", () => {
  const builder = new SemanticCfgBuilder("bounded-offset-certificate");
  const entry = builder.add_block(origin);
  const when_true = builder.add_block("bounded-offset-true:1:2:0" as never);
  const when_false = builder.add_block("bounded-offset-false:2:3:0" as never);
  const input = "bounded-offset-parameter" as ValueId;
  builder.add_parameter(input, i32_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const ten = builder.add_node(
    entry,
    origin,
    { start: 2, end: 4 },
    { tag: "constant", value: 10 },
    [],
    [i32_type],
  )[0];
  if (ten === undefined) throw new Error("Expected offset guard bound.");
  const condition = builder.add_node(
    entry,
    origin,
    { start: 0, end: 4 },
    { tag: "primitive", name: "i32.lt_s" },
    [input, ten],
    [bool_type],
  )[0];
  if (condition === undefined) throw new Error("Expected offset guard.");
  builder.connect(entry, when_true);
  builder.connect(entry, when_false);
  builder.terminate(entry, {
    tag: "branch",
    condition,
    when_true,
    when_false,
  });
  const offset = builder.add_node(
    when_true,
    "bounded-offset-true:1:2:0" as never,
    { start: 5, end: 6 },
    { tag: "constant", value: 1 },
    [],
    [i32_type],
  )[0];
  if (offset === undefined) throw new Error("Expected offset constant.");
  const result = builder.add_node(
    when_true,
    "bounded-offset-true:1:2:0" as never,
    { start: 0, end: 6 },
    { tag: "primitive", name: "i32.add" },
    [input, offset],
    [i32_type],
  )[0];
  if (result === undefined) throw new Error("Expected offset result.");
  const logical_result = builder.add_node(
    when_true,
    "bounded-offset-true:1:2:0" as never,
    { start: 7, end: 11 },
    { tag: "primitive", name: "bind:next" },
    [result],
    [i32_type],
  )[0];
  if (logical_result === undefined) {
    throw new Error("Expected bound offset result.");
  }
  const call_span = { start: 12, end: 24 };
  const call_result = builder.add_node(
    when_true,
    "bounded-offset-true:1:2:0" as never,
    call_span,
    { tag: "call", function_name: "consume" },
    [logical_result],
    [i32_type],
  )[0];
  if (call_result === undefined) throw new Error("Expected offset call.");
  builder.terminate(when_true, { tag: "return", value: call_result });
  const zero = builder.add_node(
    when_false,
    "bounded-offset-false:2:3:0" as never,
    { start: 25, end: 26 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  if (zero === undefined) throw new Error("Expected offset fallback.");
  builder.terminate(when_false, { tag: "return", value: zero });
  const control_flow = builder.finish();
  const requirement: SemanticBoundedOffsetRequirement = {
    operation: "add",
    input,
    offset,
    result,
    logical_result,
    goal: {
      tag: "fact",
      proposition: {
        tag: "less_equal",
        value: logical_result,
        bound: 10n,
      },
    },
  };
  const certificate = semantic_bounded_offset_certificate(
    call_span,
    requirement,
  );
  assert_equals(
    verify_semantic_bounded_offset_certificate(
      certificate,
      control_flow,
      call_span,
      requirement,
    ),
    true,
  );
  assert_equals(Object.isFrozen(certificate), true);
  assert_equals(Object.isFrozen(certificate.requirement), true);
  assert_equals(Object.isFrozen(certificate.requirement.goal), true);
  assert_equals(
    Object.isFrozen(certificate.requirement.goal.proposition),
    true,
  );
  const unsigned_control_flow = {
    ...control_flow,
    values: control_flow.values.map((entry) => {
      if (entry.type.tag !== "scalar" || entry.type.name !== "I32") {
        return entry;
      }
      return { ...entry, type: u64_type };
    }),
    blocks: control_flow.blocks.map((block) => ({
      ...block,
      nodes: block.nodes.map((node) => {
        if (node.operation.tag !== "primitive") return node;
        if (node.operation.name === "i32.lt_s") {
          return {
            ...node,
            operation: { tag: "primitive" as const, name: "i64.lt_u" },
          };
        }
        if (node.operation.name === "i32.add") {
          return {
            ...node,
            operation: { tag: "primitive" as const, name: "i64.add" },
          };
        }
        return node;
      }),
    })),
  };
  assert_equals(
    verify_semantic_bounded_offset_certificate(
      certificate,
      unsigned_control_flow,
      call_span,
      requirement,
    ),
    true,
  );
  assert_equals(
    verify_semantic_bounded_offset_certificate(
      certificate,
      { ...control_flow, parameters: [] },
      call_span,
      requirement,
    ),
    false,
  );

  for (
    const invalid_requirement of [
      { ...requirement, operation: "subtract" as const },
      {
        ...requirement,
        input: "different-offset-input" as ValueId,
      },
      {
        ...requirement,
        logical_result: "different-logical-result" as ValueId,
      },
    ]
  ) {
    const invalid_certificate = semantic_bounded_offset_certificate(
      call_span,
      invalid_requirement,
    );
    assert_equals(
      verify_semantic_bounded_offset_certificate(
        invalid_certificate,
        control_flow,
        call_span,
        invalid_requirement,
      ),
      false,
    );
  }
  const forged_operation = {
    ...requirement,
    operation: "multiply",
  } as unknown as SemanticBoundedOffsetRequirement;
  const forged_operation_certificate = semantic_bounded_offset_certificate(
    call_span,
    forged_operation,
  );
  assert_equals(
    verify_semantic_bounded_offset_certificate(
      forged_operation_certificate,
      control_flow,
      call_span,
      forged_operation,
    ),
    false,
  );
  const forged_equality = {
    ...requirement,
    goal: {
      tag: "fact",
      proposition: {
        tag: "equal",
        value: logical_result,
        expected: 10n,
      },
    },
  } as unknown as SemanticBoundedOffsetRequirement;
  const forged_equality_certificate = semantic_bounded_offset_certificate(
    call_span,
    forged_equality,
  );
  assert_equals(
    verify_semantic_bounded_offset_certificate(
      forged_equality_certificate,
      control_flow,
      call_span,
      forged_equality,
    ),
    false,
  );
  const forged_unknown_goal = {
    ...requirement,
    goal: {
      tag: "fact",
      proposition: {
        tag: "unknown-ordered-goal",
        value: logical_result,
        bound: 10n,
      },
    },
  } as unknown as SemanticBoundedOffsetRequirement;
  const forged_unknown_goal_certificate = semantic_bounded_offset_certificate(
    call_span,
    forged_unknown_goal,
  );
  assert_equals(
    verify_semantic_bounded_offset_certificate(
      forged_unknown_goal_certificate,
      control_flow,
      call_span,
      forged_unknown_goal,
    ),
    false,
  );
  const original_operation = control_flow.blocks.flatMap((block) => block.nodes)
    .find((node) => node.outputs.includes(result));
  if (original_operation === undefined) {
    throw new Error("Expected the bounded offset operation.");
  }
  const duplicate_producer_control_flow = {
    ...control_flow,
    blocks: control_flow.blocks.map((block) => {
      const nodes = block.nodes.map((node) => {
        if (node !== original_operation) return node;
        return {
          ...node,
          operation: { tag: "primitive" as const, name: "i32.mul" },
        };
      });
      if (block.id !== when_false) return { ...block, nodes };
      return { ...block, nodes: [...nodes, original_operation] };
    }),
  };
  assert_equals(
    verify_semantic_bounded_offset_certificate(
      certificate,
      duplicate_producer_control_flow,
      call_span,
      requirement,
    ),
    false,
  );
  const reordered_control_flow = {
    ...control_flow,
    blocks: control_flow.blocks.map((block) => {
      const operation_index = block.nodes.indexOf(original_operation);
      const binding_index = block.nodes.findIndex((node) =>
        node.outputs.includes(logical_result)
      );
      if (operation_index < 0 || binding_index < 0) return block;
      const nodes = [...block.nodes];
      nodes[operation_index] = block.nodes[binding_index];
      nodes[binding_index] = original_operation;
      return { ...block, nodes };
    }),
  };
  assert_equals(
    verify_semantic_bounded_offset_certificate(
      certificate,
      reordered_control_flow,
      call_span,
      requirement,
    ),
    false,
  );
  const original_offset = control_flow.blocks.flatMap((block) => block.nodes)
    .find((node) => node.outputs.includes(offset));
  if (original_offset === undefined) {
    throw new Error("Expected the bounded offset constant.");
  }
  const late_offset_control_flow = {
    ...control_flow,
    blocks: control_flow.blocks.map((block) => {
      const offset_index = block.nodes.indexOf(original_offset);
      const operation_index = block.nodes.indexOf(original_operation);
      if (offset_index < 0 || operation_index < 0) return block;
      const nodes = [...block.nodes];
      nodes[offset_index] = original_operation;
      nodes[operation_index] = original_offset;
      return { ...block, nodes };
    }),
  };
  assert_equals(
    verify_semantic_bounded_offset_certificate(
      certificate,
      late_offset_control_flow,
      call_span,
      requirement,
    ),
    false,
  );
  const original_comparison = control_flow.blocks.flatMap((block) =>
    block.nodes
  ).find((node) => node.outputs.includes(condition));
  if (original_comparison === undefined) {
    throw new Error("Expected the bounded offset comparison.");
  }
  const late_comparison_control_flow = {
    ...control_flow,
    blocks: control_flow.blocks.map((block) => {
      const nodes = block.nodes.filter((node) => node !== original_comparison);
      const operation_index = nodes.indexOf(original_operation);
      if (operation_index < 0) return { ...block, nodes };
      nodes.splice(operation_index + 1, 0, original_comparison);
      return { ...block, nodes };
    }),
  };
  assert_equals(
    verify_semantic_bounded_offset_certificate(
      certificate,
      late_comparison_control_flow,
      call_span,
      requirement,
    ),
    false,
  );
  const hidden_loop_control_flow = {
    ...control_flow,
    blocks: control_flow.blocks.map((block) => {
      if (block.id !== when_true) return block;
      return {
        ...block,
        successors: [],
        terminator: { tag: "jump" as const, target: when_true },
      };
    }),
  };
  assert_equals(
    verify_semantic_bounded_offset_certificate(
      certificate,
      hidden_loop_control_flow,
      call_span,
      requirement,
    ),
    false,
  );
  for (const ambiguous of ["offset", "operation", "comparison"]) {
    const ambiguous_control_flow = {
      ...control_flow,
      blocks: control_flow.blocks.map((block) => ({
        ...block,
        nodes: block.nodes.map((node) => {
          let selected = false;
          if (ambiguous === "offset" && node.outputs[0] === offset) {
            selected = true;
          }
          if (ambiguous === "operation" && node.outputs[0] === result) {
            selected = true;
          }
          if (ambiguous === "comparison" && node.outputs[0] === condition) {
            selected = true;
          }
          if (!selected) return node;
          return {
            ...node,
            outputs: [
              ...node.outputs,
              ("ambiguous-bounded-offset-" + ambiguous) as ValueId,
            ],
          };
        }),
      })),
    };
    assert_equals(
      verify_semantic_bounded_offset_certificate(
        certificate,
        ambiguous_control_flow,
        call_span,
        requirement,
      ),
      false,
    );
  }
  for (
    const [changed_output, changed_operation] of [
      [offset, { tag: "constant" as const, value: 4_294_967_297 }],
      [result, { tag: "primitive" as const, name: "i32.sub" }],
    ] as const
  ) {
    const forged_control_flow = {
      ...control_flow,
      blocks: control_flow.blocks.map((block) => ({
        ...block,
        nodes: block.nodes.map((node) => {
          if (node.outputs[0] !== changed_output) return node;
          return { ...node, operation: changed_operation };
        }),
      })),
    };
    assert_equals(
      verify_semantic_bounded_offset_certificate(
        certificate,
        forged_control_flow,
        call_span,
        requirement,
      ),
      false,
    );
  }
});

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

Deno.test("semantic remainder divisibility certificates verify zero residue implications", () => {
  const builder = new SemanticCfgBuilder("remainder-divisibility");
  const entry = builder.add_block(origin);
  const when_true = builder.add_block(
    "remainder-divisibility-true:1:2:0" as never,
  );
  const when_false = builder.add_block(
    "remainder-divisibility-false:2:3:0" as never,
  );
  const value = "remainder-divisibility-parameter" as ValueId;
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
  if (divisor === undefined) throw new Error("Expected divisibility divisor.");
  const remainder = builder.add_node(
    entry,
    origin,
    { start: 0, end: 3 },
    { tag: "primitive", name: "i32.rem_s" },
    [value, divisor],
    [i32_type],
  )[0];
  if (remainder === undefined) {
    throw new Error("Expected divisibility remainder.");
  }
  const zero = builder.add_node(
    entry,
    origin,
    { start: 4, end: 5 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  if (zero === undefined) throw new Error("Expected divisibility zero.");
  const condition = builder.add_node(
    entry,
    origin,
    { start: 0, end: 5 },
    { tag: "primitive", name: "i32.eq" },
    [remainder, zero],
    [bool_type],
  )[0];
  if (condition === undefined) {
    throw new Error("Expected divisibility branch.");
  }
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
    "remainder-divisibility-true:1:2:0" as never,
    call_span,
    { tag: "call", function_name: "consume" },
    [value],
    [i32_type],
  )[0];
  if (result === undefined) throw new Error("Expected divisibility call.");
  builder.terminate(when_true, { tag: "return", value: result });
  builder.terminate(when_false, { tag: "return", value: zero });
  const control_flow = builder.finish();
  const requirement: SemanticRemainderDivisibilityRequirement = {
    premise: {
      dividend: value,
      divisor,
      remainder,
      expected: 0n,
    },
    goal_divisor: 2n,
  };
  const certificate = semantic_remainder_divisibility_certificate(
    call_span,
    requirement,
  );
  assert_equals(
    verify_semantic_remainder_divisibility_certificate(
      certificate,
      control_flow,
      call_span,
      requirement,
    ),
    true,
  );
  assert_equals(Object.isFrozen(certificate), true);
  assert_equals(Object.isFrozen(certificate.requirement), true);
  assert_equals(Object.isFrozen(certificate.requirement.premise), true);

  for (
    const invalid_requirement of [
      { ...requirement, goal_divisor: 3n },
      { ...requirement, goal_divisor: 0n },
      { ...requirement, goal_divisor: -2n },
      {
        ...requirement,
        premise: {
          ...requirement.premise,
          dividend: "different-dividend" as ValueId,
        },
      },
      { ...requirement, goal_divisor: 4_294_967_298n },
    ]
  ) {
    const invalid_certificate = semantic_remainder_divisibility_certificate(
      call_span,
      invalid_requirement,
    );
    assert_equals(
      verify_semantic_remainder_divisibility_certificate(
        invalid_certificate,
        control_flow,
        call_span,
        invalid_requirement,
      ),
      false,
    );
  }
  const forged_residue = {
    ...requirement,
    premise: { ...requirement.premise, expected: 1n },
  } as unknown as SemanticRemainderDivisibilityRequirement;
  const forged_residue_certificate =
    semantic_remainder_divisibility_certificate(
      call_span,
      forged_residue,
    );
  assert_equals(
    verify_semantic_remainder_divisibility_certificate(
      forged_residue_certificate,
      control_flow,
      call_span,
      forged_residue,
    ),
    false,
  );

  for (const invalid_divisor of [0, -4, 4_294_967_300]) {
    const invalid_control_flow = {
      ...control_flow,
      blocks: control_flow.blocks.map((block) => ({
        ...block,
        nodes: block.nodes.map((node) => {
          if (node.outputs[0] !== divisor) return node;
          return {
            ...node,
            operation: {
              tag: "constant" as const,
              value: invalid_divisor,
            },
          };
        }),
      })),
    };
    assert_equals(
      verify_semantic_remainder_divisibility_certificate(
        certificate,
        invalid_control_flow,
        call_span,
        requirement,
      ),
      false,
    );
  }
});

Deno.test("zero residue divisibility is exhaustive for signed and unsigned three-bit integers", () => {
  for (const signed of [false, true]) {
    const integer = { width: 3 as const, signed };
    for (let raw_value = 0n; raw_value < 8n; raw_value += 1n) {
      const value = normalize_machine_integer(raw_value, integer);
      let maximum_divisor = 7n;
      if (signed) maximum_divisor = 3n;
      for (
        let premise_divisor = 1n;
        premise_divisor <= maximum_divisor;
        premise_divisor += 1n
      ) {
        if (value % premise_divisor !== 0n) continue;
        for (
          let goal_divisor = 1n;
          goal_divisor <= maximum_divisor;
          goal_divisor += 1n
        ) {
          if (premise_divisor % goal_divisor !== 0n) continue;
          assert_equals(value % goal_divisor, 0n);
        }
      }
    }
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

Deno.test("semantic index certificates independently verify both bounds", () => {
  const builder = new SemanticCfgBuilder("index-bounds-certificate");
  const entry = builder.add_block(origin);
  const nonnegative = builder.add_block("index-nonnegative:1:2:0" as never);
  const in_bounds = builder.add_block("index-in-bounds:2:3:0" as never);
  const fallback = builder.add_block("index-fallback:3:4:0" as never);
  const values = "index-values" as ValueId;
  const index = "index-parameter" as ValueId;
  builder.add_parameter(values, pair_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  builder.add_parameter(index, i32_type, {
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
  if (zero === undefined) throw new Error("Expected lower index bound.");
  const has_lower_bound = builder.add_node(
    entry,
    origin,
    { start: 0, end: 3 },
    { tag: "primitive", name: "i32.ge_s" },
    [index, zero],
    [bool_type],
  )[0];
  if (has_lower_bound === undefined) {
    throw new Error("Expected lower index comparison.");
  }
  builder.connect(entry, nonnegative);
  builder.connect(entry, fallback);
  builder.terminate(entry, {
    tag: "branch",
    condition: has_lower_bound,
    when_true: nonnegative,
    when_false: fallback,
  });
  const length = builder.add_node(
    nonnegative,
    "index-nonnegative:1:2:0" as never,
    { start: 4, end: 5 },
    { tag: "constant", value: 2 },
    [],
    [i32_type],
  )[0];
  if (length === undefined) throw new Error("Expected upper index bound.");
  const has_upper_bound = builder.add_node(
    nonnegative,
    "index-nonnegative:1:2:0" as never,
    { start: 4, end: 8 },
    { tag: "primitive", name: "i32.lt_s" },
    [index, length],
    [bool_type],
  )[0];
  if (has_upper_bound === undefined) {
    throw new Error("Expected upper index comparison.");
  }
  builder.connect(nonnegative, in_bounds);
  builder.connect(nonnegative, fallback);
  builder.terminate(nonnegative, {
    tag: "branch",
    condition: has_upper_bound,
    when_true: in_bounds,
    when_false: fallback,
  });
  const index_span = { start: 9, end: 22 };
  const result = builder.add_node(
    in_bounds,
    "index-in-bounds:2:3:0" as never,
    index_span,
    { tag: "index", length: 2, mode: "read" },
    [values, index],
    [i32_type],
  )[0];
  if (result === undefined) throw new Error("Expected indexed value.");
  builder.terminate(in_bounds, { tag: "return", value: result });
  builder.terminate(fallback, { tag: "return", value: zero });
  const control_flow = builder.finish();
  const requirement: SemanticIndexBoundsRequirement = { index, length: 2 };
  const certificate = infer_semantic_index_bounds_certificate(
    control_flow,
    index_span,
    requirement,
  );
  if (certificate === undefined) {
    throw new Error("Expected inferred semantic index certificate.");
  }

  assert_equals(certificate.tag, "index_bounds");
  assert_equals(
    verify_semantic_index_bounds_certificate(
      certificate,
      control_flow,
      index_span,
      requirement,
    ),
    true,
  );
  assert_equals(Object.isFrozen(certificate), true);
  assert_equals(Object.isFrozen(certificate.index_span), true);
  assert_equals(Object.isFrozen(certificate.requirement), true);

  const forged_requirement: SemanticIndexBoundsRequirement = {
    index,
    length: 1,
  };
  const forged = semantic_index_bounds_certificate(
    index_span,
    forged_requirement,
  );
  assert_equals(
    verify_semantic_index_bounds_certificate(
      forged,
      control_flow,
      index_span,
      forged_requirement,
    ),
    false,
  );

  const inverted_lower_bound = {
    ...control_flow,
    blocks: control_flow.blocks.map((block) => ({
      ...block,
      nodes: block.nodes.map((node) => {
        if (node.outputs[0] !== has_lower_bound) return node;
        return {
          ...node,
          operation: { tag: "primitive", name: "i32.lt_s" } as const,
        };
      }),
    })),
  };
  assert_equals(
    semantic_cfg_is_well_formed(inverted_lower_bound),
    true,
  );
  assert_equals(
    infer_semantic_index_bounds_certificate(
      inverted_lower_bound,
      index_span,
      requirement,
    ),
    undefined,
  );

  const forged_layout = {
    ...control_flow,
    blocks: control_flow.blocks.map((block) => ({
      ...block,
      nodes: block.nodes.map((node) => {
        if (node.span.start !== index_span.start) return node;
        return {
          ...node,
          operation: { tag: "index", length: 3, mode: "read" } as const,
        };
      }),
    })),
  };
  assert_equals(semantic_cfg_is_well_formed(forged_layout), false);
  const forged_layout_requirement: SemanticIndexBoundsRequirement = {
    index,
    length: 3,
  };
  assert_equals(
    verify_semantic_index_bounds_certificate(
      semantic_index_bounds_certificate(
        index_span,
        forged_layout_requirement,
      ),
      forged_layout,
      index_span,
      forged_layout_requirement,
    ),
    false,
  );
});

Deno.test("dynamic index certificates bind length measures to their object", () => {
  const builder = new SemanticCfgBuilder("dynamic-index-certificate");
  const entry = builder.add_block(origin);
  const nonnegative = builder.add_block("dynamic-nonnegative:1:2:0" as never);
  const in_bounds = builder.add_block("dynamic-in-bounds:2:3:0" as never);
  const fallback = builder.add_block("dynamic-fallback:3:4:0" as never);
  const value = "dynamic-value" as ValueId;
  const other = "dynamic-other" as ValueId;
  const index = "dynamic-index" as ValueId;
  builder.add_parameter(value, text_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  builder.add_parameter(other, text_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  builder.add_parameter(index, i32_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const zero = builder.add_node(
    entry,
    origin,
    { start: 0, end: 1 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  const length = builder.add_node(
    entry,
    origin,
    { start: 1, end: 2 },
    { tag: "call", function_name: "@len" },
    [value],
    [i32_type],
  )[0];
  if (zero === undefined || length === undefined) {
    throw new Error("Expected dynamic index setup values.");
  }
  const has_lower_bound = builder.add_node(
    entry,
    origin,
    { start: 2, end: 3 },
    { tag: "primitive", name: "i32.ge_s" },
    [index, zero],
    [bool_type],
  )[0];
  if (has_lower_bound === undefined) {
    throw new Error("Expected dynamic lower-bound comparison.");
  }
  builder.connect(entry, nonnegative);
  builder.connect(entry, fallback);
  builder.terminate(entry, {
    tag: "branch",
    condition: has_lower_bound,
    when_true: nonnegative,
    when_false: fallback,
  });
  const has_upper_bound = builder.add_node(
    nonnegative,
    origin,
    { start: 3, end: 4 },
    { tag: "primitive", name: "i32.lt_s" },
    [index, length],
    [bool_type],
  )[0];
  if (has_upper_bound === undefined) {
    throw new Error("Expected dynamic upper-bound comparison.");
  }
  builder.connect(nonnegative, in_bounds);
  builder.connect(nonnegative, fallback);
  builder.terminate(nonnegative, {
    tag: "branch",
    condition: has_upper_bound,
    when_true: in_bounds,
    when_false: fallback,
  });
  const index_span = { start: 4, end: 5 };
  const result = builder.add_node(
    in_bounds,
    origin,
    index_span,
    { tag: "index", length: undefined, mode: "read" },
    [value, index],
    [i32_type],
  )[0];
  if (result === undefined) throw new Error("Expected dynamic index result.");
  builder.terminate(in_bounds, { tag: "return", value: result });
  builder.terminate(fallback, { tag: "return", value: zero });
  const control_flow = builder.finish();
  const requirement: SemanticIndexBoundsRequirement = {
    index,
    length_value: length,
    object: value,
  };
  const certificate = infer_semantic_index_bounds_certificate(
    control_flow,
    index_span,
    requirement,
  );
  if (certificate === undefined) {
    throw new Error("Expected a dynamic index certificate.");
  }
  assert_equals(
    verify_semantic_index_bounds_certificate(
      certificate,
      control_flow,
      index_span,
      requirement,
    ),
    true,
  );

  const unrelated: SemanticIndexBoundsRequirement = {
    index,
    length_value: length,
    object: other,
  };
  assert_equals(
    verify_semantic_index_bounds_certificate(
      semantic_index_bounds_certificate(index_span, unrelated),
      control_flow,
      index_span,
      unrelated,
    ),
    false,
  );
  assert_equals(
    infer_semantic_index_bounds_certificate(
      control_flow,
      index_span,
      unrelated,
    ),
    undefined,
  );
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

Deno.test("semantic machine certificates independently close affine comparisons", () => {
  const builder = new SemanticCfgBuilder("difference-certificate");
  const entry = builder.add_block(origin);
  const after_first = builder.add_block("difference-first:1:2:0" as never);
  const after_second = builder.add_block("difference-second:2:3:0" as never);
  const fallback = builder.add_block("difference-fallback:3:4:0" as never);
  const left = "difference-certificate-left" as ValueId;
  const middle = "difference-certificate-middle" as ValueId;
  const right = "difference-certificate-right" as ValueId;
  for (const parameter of [left, middle, right]) {
    builder.add_parameter(parameter, i32_type, {
      source_node: origin,
      start: 0,
      end: 1,
    });
  }
  const first_condition = builder.add_node(
    entry,
    origin,
    { start: 0, end: 5 },
    { tag: "primitive", name: "i32.lt_s" },
    [left, middle],
    [bool_type],
  )[0];
  if (first_condition === undefined) {
    throw new Error("Expected first affine comparison.");
  }
  builder.connect(entry, after_first);
  builder.connect(entry, fallback);
  builder.terminate(entry, {
    tag: "branch",
    condition: first_condition,
    when_true: after_first,
    when_false: fallback,
  });
  const second_condition = builder.add_node(
    after_first,
    "difference-first:1:2:0" as never,
    { start: 6, end: 11 },
    { tag: "primitive", name: "i32.le_s" },
    [middle, right],
    [bool_type],
  )[0];
  if (second_condition === undefined) {
    throw new Error("Expected second affine comparison.");
  }
  builder.connect(after_first, after_second);
  builder.connect(after_first, fallback);
  builder.terminate(after_first, {
    tag: "branch",
    condition: second_condition,
    when_true: after_second,
    when_false: fallback,
  });
  const call_span = { start: 12, end: 20 };
  const call = builder.add_node(
    after_second,
    "difference-second:2:3:0" as never,
    call_span,
    { tag: "call", function_name: "consume" },
    [left, right],
    [i32_type],
  )[0];
  if (call === undefined) throw new Error("Expected affine call.");
  builder.terminate(after_second, { tag: "return", value: call });
  const zero = builder.add_node(
    fallback,
    "difference-fallback:3:4:0" as never,
    { start: 21, end: 22 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  builder.terminate(fallback, { tag: "return", value: zero });
  const control_flow = builder.finish();
  const requirement: SemanticMachineRequirement = {
    tag: "difference",
    left,
    right,
    maximum: -1n,
  };
  const certificate = infer_semantic_machine_certificate(
    control_flow,
    call_span,
    requirement,
  );
  if (certificate === undefined) {
    throw new Error("Expected inferred affine certificate.");
  }
  assert_equals(
    verify_semantic_machine_certificate(
      certificate,
      control_flow,
      call_span,
      requirement,
    ),
    true,
  );
  assert_equals(Object.isFrozen(certificate.requirement), true);
  const stronger: SemanticMachineRequirement = {
    tag: "difference",
    left,
    right,
    maximum: -2n,
  };
  assert_equals(
    verify_semantic_machine_certificate(
      semantic_machine_certificate(call_span, stronger),
      control_flow,
      call_span,
      stronger,
    ),
    false,
  );
  const malformed = {
    tag: "difference",
    left,
    right,
    maximum: "invalid",
  } as unknown as SemanticMachineRequirement;
  assert_equals(
    verify_semantic_machine_certificate(
      semantic_machine_certificate(call_span, malformed),
      control_flow,
      call_span,
      malformed,
    ),
    false,
  );
  const entry_block = control_flow.blocks.find((block) => block.id === entry);
  const fallback_block = control_flow.blocks.find((block) =>
    block.id === fallback
  );
  const condition_node = entry_block?.nodes.find((node) =>
    node.outputs.includes(first_condition)
  );
  if (
    entry_block === undefined || fallback_block === undefined ||
    condition_node === undefined
  ) {
    throw new Error("Expected affine certificate blocks.");
  }
  const forged = {
    ...control_flow,
    blocks: control_flow.blocks.map((block) => {
      if (block.id === entry) {
        return {
          ...block,
          nodes: block.nodes.filter((node) => node !== condition_node),
        };
      }
      if (block.id === fallback) {
        return {
          ...block,
          nodes: [condition_node, ...block.nodes],
        };
      }
      return block;
    }),
  };
  assert_equals(semantic_cfg_is_well_formed(forged), false);
  assert_equals(
    infer_semantic_machine_certificate(forged, call_span, requirement),
    undefined,
  );
  assert_equals(
    verify_semantic_machine_certificate(
      certificate,
      forged,
      call_span,
      requirement,
    ),
    false,
  );
});

Deno.test("semantic machine certificates close equality classes and transport disequality", () => {
  const builder = new SemanticCfgBuilder("equality-certificate");
  const entry = builder.add_block(origin);
  const after_first = builder.add_block("equality-first:1:2:0" as never);
  const after_second = builder.add_block("equality-second:2:3:0" as never);
  const established = builder.add_block("equality-third:3:4:0" as never);
  const fallback = builder.add_block("equality-fallback:4:5:0" as never);
  const left = "equality-certificate-left" as ValueId;
  const middle = "equality-certificate-middle" as ValueId;
  const right = "equality-certificate-right" as ValueId;
  const separate = "equality-certificate-separate" as ValueId;
  for (const parameter of [left, middle, right, separate]) {
    builder.add_parameter(parameter, i32_type, {
      source_node: origin,
      start: 0,
      end: 1,
    });
  }
  const first_condition = builder.add_node(
    entry,
    origin,
    { start: 0, end: 5 },
    { tag: "primitive", name: "i32.eq" },
    [left, middle],
    [bool_type],
  )[0];
  if (first_condition === undefined) {
    throw new Error("Expected first equality comparison.");
  }
  builder.connect(entry, after_first);
  builder.connect(entry, fallback);
  builder.terminate(entry, {
    tag: "branch",
    condition: first_condition,
    when_true: after_first,
    when_false: fallback,
  });
  const second_condition = builder.add_node(
    after_first,
    "equality-first:1:2:0" as never,
    { start: 6, end: 11 },
    { tag: "primitive", name: "i32.eq" },
    [middle, right],
    [bool_type],
  )[0];
  if (second_condition === undefined) {
    throw new Error("Expected second equality comparison.");
  }
  builder.connect(after_first, after_second);
  builder.connect(after_first, fallback);
  builder.terminate(after_first, {
    tag: "branch",
    condition: second_condition,
    when_true: after_second,
    when_false: fallback,
  });
  const third_condition = builder.add_node(
    after_second,
    "equality-second:2:3:0" as never,
    { start: 12, end: 18 },
    { tag: "primitive", name: "i32.ne" },
    [right, separate],
    [bool_type],
  )[0];
  if (third_condition === undefined) {
    throw new Error("Expected disequality comparison.");
  }
  builder.connect(after_second, established);
  builder.connect(after_second, fallback);
  builder.terminate(after_second, {
    tag: "branch",
    condition: third_condition,
    when_true: established,
    when_false: fallback,
  });
  const call_span = { start: 19, end: 30 };
  const call = builder.add_node(
    established,
    "equality-third:3:4:0" as never,
    call_span,
    { tag: "call", function_name: "consume" },
    [left, separate],
    [i32_type],
  )[0];
  if (call === undefined) throw new Error("Expected equality call.");
  builder.terminate(established, { tag: "return", value: call });
  const zero = builder.add_node(
    fallback,
    "equality-fallback:4:5:0" as never,
    { start: 31, end: 32 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  if (zero === undefined) throw new Error("Expected equality fallback.");
  builder.terminate(fallback, { tag: "return", value: zero });
  const control_flow = builder.finish();
  const equality: SemanticMachineRequirement = {
    tag: "equality",
    left,
    right,
  };
  const equality_certificate = infer_semantic_machine_certificate(
    control_flow,
    call_span,
    equality,
  );
  if (equality_certificate === undefined) {
    throw new Error("Expected inferred equality certificate.");
  }
  assert_equals(
    verify_semantic_machine_certificate(
      equality_certificate,
      control_flow,
      call_span,
      equality,
    ),
    true,
  );
  assert_equals(Object.isFrozen(equality_certificate.requirement), true);

  const disequality: SemanticMachineRequirement = {
    tag: "disequality",
    left,
    right: separate,
  };
  const disequality_certificate = infer_semantic_machine_certificate(
    control_flow,
    call_span,
    disequality,
  );
  if (disequality_certificate === undefined) {
    throw new Error("Expected inferred disequality certificate.");
  }
  assert_equals(
    verify_semantic_machine_certificate(
      disequality_certificate,
      control_flow,
      call_span,
      disequality,
    ),
    true,
  );
  assert_equals(
    verify_semantic_machine_certificate(
      equality_certificate,
      control_flow,
      call_span,
      disequality,
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

Deno.test("semantic machine certificates independently verify bitwise branches", () => {
  const scenarios: {
    primitive: string;
    mask: number;
    expected: number;
    requirement: (value: ValueId) => SemanticMachineRequirement;
    proved: boolean;
  }[] = [
    {
      primitive: "i32.and",
      mask: 1,
      expected: 1,
      requirement: (value) => ({ tag: "exclusion", value, expected: 2n }),
      proved: true,
    },
    {
      primitive: "i32.or",
      mask: 1,
      expected: 1,
      requirement: (value) => ({ tag: "exclusion", value, expected: 2n }),
      proved: true,
    },
    {
      primitive: "i32.xor",
      mask: 1,
      expected: 3,
      requirement: (value) => ({
        tag: "fact",
        proposition: { tag: "equal", value, expected: 2n },
      }),
      proved: true,
    },
    {
      primitive: "i32.add",
      mask: 1,
      expected: 3,
      requirement: (value) => ({
        tag: "fact",
        proposition: { tag: "equal", value, expected: 2n },
      }),
      proved: false,
    },
  ];
  for (const [index, scenario] of scenarios.entries()) {
    const builder = new SemanticCfgBuilder(`bitwise-certificate-${index}`);
    const entry = builder.add_block(origin);
    const when_true = builder.add_block(
      `bitwise-true:${index}:1:0` as never,
    );
    const when_false = builder.add_block(
      `bitwise-false:${index}:2:0` as never,
    );
    const value = `bitwise-parameter-${index}` as ValueId;
    builder.add_parameter(value, i32_type, {
      source_node: origin,
      start: 0,
      end: 1,
    });
    const mask = builder.add_node(
      entry,
      origin,
      { start: 2, end: 3 },
      { tag: "constant", value: scenario.mask },
      [],
      [i32_type],
    )[0];
    if (mask === undefined) throw new Error("Expected bitwise mask.");
    const result = builder.add_node(
      entry,
      origin,
      { start: 0, end: 3 },
      { tag: "primitive", name: scenario.primitive },
      [value, mask],
      [i32_type],
    )[0];
    if (result === undefined) throw new Error("Expected bitwise result.");
    let compared = result;
    if (index === 0) {
      const masked = builder.add_node(
        entry,
        origin,
        { start: 3, end: 4 },
        { tag: "primitive", name: "bind:masked" },
        [result],
        [i32_type],
      )[0];
      if (masked === undefined) throw new Error("Expected bitwise alias.");
      compared = masked;
    }
    const expected = builder.add_node(
      entry,
      origin,
      { start: 4, end: 5 },
      { tag: "constant", value: scenario.expected },
      [],
      [i32_type],
    )[0];
    if (expected === undefined) throw new Error("Expected bitwise result.");
    const condition = builder.add_node(
      entry,
      origin,
      { start: 0, end: 5 },
      { tag: "primitive", name: "i32.eq" },
      [compared, expected],
      [bool_type],
    )[0];
    if (condition === undefined) throw new Error("Expected bitwise branch.");
    builder.connect(entry, when_true);
    builder.connect(entry, when_false);
    builder.terminate(entry, {
      tag: "branch",
      condition,
      when_true,
      when_false,
    });
    const call_span = { start: 6, end: 12 };
    const call = builder.add_node(
      when_true,
      `bitwise-true:${index}:1:0` as never,
      call_span,
      { tag: "call", function_name: "consume" },
      [value],
      [i32_type],
    )[0];
    if (call === undefined) throw new Error("Expected bitwise call.");
    builder.terminate(when_true, { tag: "return", value: call });
    const fallback = builder.add_node(
      when_false,
      `bitwise-false:${index}:2:0` as never,
      { start: 13, end: 14 },
      { tag: "constant", value: 0 },
      [],
      [i32_type],
    )[0];
    builder.terminate(when_false, { tag: "return", value: fallback });
    const control_flow = builder.finish();
    const requirement = scenario.requirement(value);
    assert_equals(
      infer_semantic_machine_certificate(
        control_flow,
        call_span,
        requirement,
      ) !== undefined,
      scenario.proved,
    );
    assert_equals(
      verify_semantic_machine_certificate(
        semantic_machine_certificate(call_span, requirement),
        control_flow,
        call_span,
        requirement,
      ),
      scenario.proved,
    );
  }
});

Deno.test("semantic machine certificates independently combine remainder congruences", () => {
  for (
    const [first_primitive, proved] of [
      ["i32.rem_s", true],
      ["i32.add", false],
    ] as const
  ) {
    const builder = new SemanticCfgBuilder(
      "remainder-congruence-" + first_primitive,
    );
    const entry = builder.add_block(origin);
    const divisible_by_two = builder.add_block(
      "congruence-two:1:2:0" as never,
    );
    const call_block = builder.add_block(
      "congruence-call:2:3:0" as never,
    );
    const fallback = builder.add_block(
      "congruence-fallback:3:4:0" as never,
    );
    const value = ("congruence-value-" + first_primitive) as ValueId;
    builder.add_parameter(value, i32_type, {
      source_node: origin,
      start: 0,
      end: 1,
    });
    const two = builder.add_node(
      entry,
      origin,
      { start: 2, end: 3 },
      { tag: "constant", value: -2 },
      [],
      [i32_type],
    )[0];
    const zero = builder.add_node(
      entry,
      origin,
      { start: 4, end: 5 },
      { tag: "constant", value: 0 },
      [],
      [i32_type],
    )[0];
    if (two === undefined || zero === undefined) {
      throw new Error("Expected first congruence constants.");
    }
    const remainder_two = builder.add_node(
      entry,
      origin,
      { start: 0, end: 3 },
      { tag: "primitive", name: first_primitive },
      [value, two],
      [i32_type],
    )[0];
    if (remainder_two === undefined) {
      throw new Error("Expected first congruence result.");
    }
    const condition_two = builder.add_node(
      entry,
      origin,
      { start: 0, end: 5 },
      { tag: "primitive", name: "i32.eq" },
      [remainder_two, zero],
      [bool_type],
    )[0];
    if (condition_two === undefined) {
      throw new Error("Expected first congruence comparison.");
    }
    builder.connect(entry, divisible_by_two);
    builder.connect(entry, fallback);
    builder.terminate(entry, {
      tag: "branch",
      condition: condition_two,
      when_true: divisible_by_two,
      when_false: fallback,
    });
    const three = builder.add_node(
      divisible_by_two,
      "congruence-two:1:2:0" as never,
      { start: 6, end: 7 },
      { tag: "constant", value: 3 },
      [],
      [i32_type],
    )[0];
    if (three === undefined) throw new Error("Expected second divisor.");
    const remainder_three = builder.add_node(
      divisible_by_two,
      "congruence-two:1:2:0" as never,
      { start: 6, end: 9 },
      { tag: "primitive", name: "i32.rem_s" },
      [value, three],
      [i32_type],
    )[0];
    if (remainder_three === undefined) {
      throw new Error("Expected second congruence result.");
    }
    const condition_three = builder.add_node(
      divisible_by_two,
      "congruence-two:1:2:0" as never,
      { start: 6, end: 11 },
      { tag: "primitive", name: "i32.eq" },
      [remainder_three, zero],
      [bool_type],
    )[0];
    if (condition_three === undefined) {
      throw new Error("Expected second congruence comparison.");
    }
    builder.connect(divisible_by_two, call_block);
    builder.connect(divisible_by_two, fallback);
    builder.terminate(divisible_by_two, {
      tag: "branch",
      condition: condition_three,
      when_true: call_block,
      when_false: fallback,
    });
    const call_span = { start: 12, end: 19 };
    const call = builder.add_node(
      call_block,
      "congruence-call:2:3:0" as never,
      call_span,
      { tag: "call", function_name: "consume" },
      [value],
      [i32_type],
    )[0];
    if (call === undefined) throw new Error("Expected congruence call.");
    builder.terminate(call_block, { tag: "return", value: call });
    const fallback_value = builder.add_node(
      fallback,
      "congruence-fallback:3:4:0" as never,
      { start: 20, end: 21 },
      { tag: "constant", value: 0 },
      [],
      [i32_type],
    )[0];
    builder.terminate(fallback, { tag: "return", value: fallback_value });
    const control_flow = builder.finish();
    const requirement: SemanticMachineRequirement = {
      tag: "congruence",
      value,
      modulus: 6n,
      residue: 0n,
    };
    assert_equals(
      infer_semantic_machine_certificate(
        control_flow,
        call_span,
        requirement,
      ) !== undefined,
      proved,
    );
    assert_equals(
      verify_semantic_machine_certificate(
        semantic_machine_certificate(call_span, requirement),
        control_flow,
        call_span,
        requirement,
      ),
      proved,
    );
    const universal: SemanticMachineRequirement = {
      tag: "congruence",
      value,
      modulus: 1n,
      residue: 0n,
    };
    assert_equals(
      infer_semantic_machine_certificate(
        control_flow,
        call_span,
        universal,
      ) !== undefined,
      true,
    );
    assert_equals(
      verify_semantic_machine_certificate(
        semantic_machine_certificate(call_span, universal),
        control_flow,
        call_span,
        universal,
      ),
      true,
    );
    for (
      const malformed of [
        { ...universal, modulus: 0n },
        { ...universal, residue: 1n },
      ]
    ) {
      assert_equals(
        infer_semantic_machine_certificate(
          control_flow,
          call_span,
          malformed,
        ),
        undefined,
      );
      assert_equals(
        verify_semantic_machine_certificate(
          semantic_machine_certificate(call_span, malformed),
          control_flow,
          call_span,
          malformed,
        ),
        false,
      );
    }
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
