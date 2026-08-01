import { expect } from "../expect.ts";
import { type Prim, primitive_trap_conditions } from "../op.ts";
import { text_byte_offset_is_boundary } from "./text.ts";
import {
  integer_maximum,
  integer_minimum,
  integer_type_from_name,
  integer_val_type,
  type IntegerType,
  machine_integer_type_from_name,
  normalize_integer,
} from "../integer.ts";
import type { FactProposition } from "./fact_graph.ts";
import { proof_limits } from "./proof_limits.ts";
import {
  semantic_cfg_is_well_formed,
  type SemanticBlock,
  type SemanticBlockId,
  type SemanticCfg,
  type SemanticNode,
  unique_semantic_call_at_span,
  unique_semantic_index_at_span,
  unique_semantic_narrowing_at_span,
  unique_semantic_node_at_span,
  unique_semantic_primitive_at_span,
  unique_semantic_slice_at_span,
} from "./semantic_cfg.ts";
import type { ValueId } from "./semantic_identity.ts";
import {
  type RepresentationType,
  same_representation_type,
} from "./representation_type.ts";
import type { SourceSpan } from "./syntax.ts";

export type SemanticMachineRequirement =
  | { tag: "fact"; proposition: FactProposition }
  | { tag: "exclusion"; value: ValueId; expected: bigint }
  | {
    tag: "congruence";
    value: ValueId;
    modulus: bigint;
    residue: bigint;
  }
  | {
    tag: "bitmask";
    value: ValueId;
    known_zero: bigint;
    known_one: bigint;
  }
  | {
    tag: "difference";
    left: ValueId;
    right: ValueId;
    maximum: bigint;
  }
  | {
    tag: "equality";
    left: ValueId;
    right: ValueId;
  }
  | {
    tag: "disequality";
    left: ValueId;
    right: ValueId;
  };

export type SemanticMachineCertificate = {
  tag: "machine_fact";
  call_span: SourceSpan;
  requirement: SemanticMachineRequirement;
};

export type SemanticIndexBoundsRequirement =
  | {
    index: ValueId;
    length: number;
    length_value?: never;
    object?: never;
  }
  | {
    index: ValueId;
    length?: never;
    length_value: ValueId;
    object: ValueId;
  };

export type SemanticIndexBoundsCertificate = {
  tag: "index_bounds";
  index_span: SourceSpan;
  requirement: SemanticIndexBoundsRequirement;
};

export type SemanticSliceBoundsRequirement =
  | {
    object: ValueId;
    start: ValueId;
    end: ValueId;
    length: number;
    length_value?: never;
    utf8_boundaries?: "static_literal";
  }
  | {
    object: ValueId;
    start: ValueId;
    end: ValueId;
    length?: never;
    length_value: ValueId;
    utf8_boundaries?: "static_literal";
  };

export type SemanticSliceBoundsCertificate = {
  tag: "slice_bounds";
  operation_span: SourceSpan;
  requirement: SemanticSliceBoundsRequirement;
};

export type SemanticIntegerNarrowingRequirement = {
  value: ValueId;
  source: IntegerType;
  target: IntegerType;
};

export type SemanticIntegerNarrowingCertificate = {
  tag: "integer_narrowing";
  operation_span: SourceSpan;
  requirement: SemanticIntegerNarrowingRequirement;
};

export type SemanticPrimitiveSafetyRequirement = {
  primitive: Prim;
  dividend: ValueId;
  divisor: ValueId;
  overflow_guard?:
    | "dividend_not_minimum"
    | "divisor_not_negative_one"
    | "pathwise_disjunction";
};

export type SemanticPrimitiveSafetyCertificate = {
  tag: "primitive_safety";
  operation_span: SourceSpan;
  requirement: SemanticPrimitiveSafetyRequirement;
};

export type SemanticTypeRequirement = {
  value: ValueId;
  type: string;
  expected: boolean;
};

export type SemanticTypeCertificate = {
  tag: "type_fact";
  call_span: SourceSpan;
  requirement: SemanticTypeRequirement;
};

export type SemanticBoundedOffsetGoal =
  | { tag: "fact"; proposition: Exclude<FactProposition, { tag: "equal" }> }
  | Extract<SemanticMachineRequirement, { tag: "difference" }>;

export type SemanticBoundedOffsetRequirement = {
  operation: "add" | "subtract";
  input: ValueId;
  offset: ValueId;
  result: ValueId;
  logical_result: ValueId;
  goal: SemanticBoundedOffsetGoal;
};

export type SemanticBoundedOffsetCertificate = {
  tag: "bounded_offset";
  call_span: SourceSpan;
  requirement: SemanticBoundedOffsetRequirement;
};

export type SemanticPredicateAtom = {
  predicate: string;
  arguments: readonly ValueId[];
};

export type SemanticPredicateCertificate = {
  tag: "predicate_alias";
  call_span: SourceSpan;
  premise: SemanticPredicateAtom;
  conclusion: SemanticPredicateAtom;
};

export type SemanticRemainderRequirement = {
  dividend: ValueId;
  divisor: ValueId;
  remainder: ValueId;
  expected: bigint;
};

export type SemanticRemainderCertificate = {
  tag: "remainder_fact";
  call_span: SourceSpan;
  requirement: SemanticRemainderRequirement;
};

export type SemanticRemainderDivisibilityRequirement = {
  premise: SemanticRemainderRequirement & { expected: 0n };
  goal_divisor: bigint;
};

export type SemanticRemainderDivisibilityCertificate = {
  tag: "remainder_divisibility";
  call_span: SourceSpan;
  requirement: SemanticRemainderDivisibilityRequirement;
};

export type SemanticUnreachableCertificate = {
  tag: "machine_unreachable";
  call_span: SourceSpan;
};

export type SemanticControlFlowCertificate =
  | SemanticBoundedOffsetCertificate
  | SemanticIndexBoundsCertificate
  | SemanticIntegerNarrowingCertificate
  | SemanticMachineCertificate
  | SemanticPredicateCertificate
  | SemanticPrimitiveSafetyCertificate
  | SemanticRemainderDivisibilityCertificate
  | SemanticRemainderCertificate
  | SemanticSliceBoundsCertificate
  | SemanticTypeCertificate
  | SemanticUnreachableCertificate;

type VerificationState = {
  block: SemanticBlockId;
  predecessor: SemanticBlockId | undefined;
  booleans: ReadonlyMap<ValueId, boolean>;
  aliases: ReadonlyMap<ValueId, ValueId>;
  premises: readonly SemanticMachineRequirement[];
  visited: ReadonlySet<SemanticBlockId>;
};

type IntervalState = {
  minimum: bigint;
  maximum: bigint;
  exclusions: Set<bigint>;
  contradiction: boolean;
};

type VerifiedBitmaskState = {
  known_zero: bigint;
  known_one: bigint;
  malformed: boolean;
};

type VerifiedCongruence = {
  modulus: bigint;
  residue: bigint;
};

const VERIFIED_DIFFERENCE_ZERO = Symbol("duck.verified_difference_zero");
type VerifiedDifferenceTerm = ValueId | typeof VERIFIED_DIFFERENCE_ZERO;

export function semantic_machine_certificate(
  call_span: SourceSpan,
  requirement: SemanticMachineRequirement,
): SemanticMachineCertificate {
  return Object.freeze({
    tag: "machine_fact",
    call_span: Object.freeze({
      start: call_span.start,
      end: call_span.end,
    }),
    requirement: snapshot_machine_requirement(requirement),
  });
}

export function semantic_index_bounds_certificate(
  index_span: SourceSpan,
  requirement: SemanticIndexBoundsRequirement,
): SemanticIndexBoundsCertificate {
  if (requirement.length !== undefined) {
    expect(
      Number.isSafeInteger(requirement.length) && requirement.length >= 0,
      "Semantic index bound length must be a non-negative safe integer.",
    );
  } else {
    expect(
      requirement.length_value !== undefined &&
        requirement.object !== undefined,
      "Semantic dynamic index bound must identify its length and object.",
    );
  }
  return Object.freeze({
    tag: "index_bounds",
    index_span: Object.freeze({
      start: index_span.start,
      end: index_span.end,
    }),
    requirement: Object.freeze({ ...requirement }),
  });
}

export function semantic_primitive_safety_certificate(
  operation_span: SourceSpan,
  requirement: SemanticPrimitiveSafetyRequirement,
): SemanticPrimitiveSafetyCertificate {
  return Object.freeze({
    tag: "primitive_safety",
    operation_span: Object.freeze({
      start: operation_span.start,
      end: operation_span.end,
    }),
    requirement: Object.freeze({ ...requirement }),
  });
}

export function semantic_slice_bounds_certificate(
  operation_span: SourceSpan,
  requirement: SemanticSliceBoundsRequirement,
): SemanticSliceBoundsCertificate {
  return Object.freeze({
    tag: "slice_bounds",
    operation_span: Object.freeze({
      start: operation_span.start,
      end: operation_span.end,
    }),
    requirement: Object.freeze({ ...requirement }),
  });
}

export function semantic_integer_narrowing_certificate(
  operation_span: SourceSpan,
  requirement: SemanticIntegerNarrowingRequirement,
): SemanticIntegerNarrowingCertificate {
  return Object.freeze({
    tag: "integer_narrowing",
    operation_span: Object.freeze({
      start: operation_span.start,
      end: operation_span.end,
    }),
    requirement: Object.freeze({
      value: requirement.value,
      source: Object.freeze({ ...requirement.source }),
      target: Object.freeze({ ...requirement.target }),
    }),
  });
}

export function semantic_type_certificate(
  call_span: SourceSpan,
  requirement: SemanticTypeRequirement,
): SemanticTypeCertificate {
  expect(
    typeof requirement.type === "string" && requirement.type.length > 0,
    "Semantic type requirement must name a canonical type.",
  );
  return Object.freeze({
    tag: "type_fact",
    call_span: Object.freeze({
      start: call_span.start,
      end: call_span.end,
    }),
    requirement: Object.freeze({ ...requirement }),
  });
}

export function semantic_bounded_offset_certificate(
  call_span: SourceSpan,
  requirement: SemanticBoundedOffsetRequirement,
): SemanticBoundedOffsetCertificate {
  let goal: SemanticBoundedOffsetGoal;
  if (requirement.goal.tag === "difference") {
    goal = Object.freeze({ ...requirement.goal });
  } else {
    goal = Object.freeze({
      tag: "fact",
      proposition: Object.freeze({ ...requirement.goal.proposition }),
    });
  }
  return Object.freeze({
    tag: "bounded_offset",
    call_span: Object.freeze({
      start: call_span.start,
      end: call_span.end,
    }),
    requirement: Object.freeze({
      operation: requirement.operation,
      input: requirement.input,
      offset: requirement.offset,
      result: requirement.result,
      logical_result: requirement.logical_result,
      goal,
    }),
  });
}

export function semantic_unreachable_certificate(
  call_span: SourceSpan,
): SemanticUnreachableCertificate {
  return Object.freeze({
    tag: "machine_unreachable",
    call_span: Object.freeze({
      start: call_span.start,
      end: call_span.end,
    }),
  });
}

export function semantic_predicate_certificate(
  call_span: SourceSpan,
  premise: SemanticPredicateAtom,
  conclusion: SemanticPredicateAtom,
): SemanticPredicateCertificate {
  return Object.freeze({
    tag: "predicate_alias",
    call_span: Object.freeze({
      start: call_span.start,
      end: call_span.end,
    }),
    premise: snapshot_predicate_atom(premise),
    conclusion: snapshot_predicate_atom(conclusion),
  });
}

export function verify_semantic_predicate_certificate(
  certificate: SemanticPredicateCertificate,
  control_flow: SemanticCfg,
  call_span: SourceSpan,
  available_premises: readonly SemanticPredicateAtom[],
  conclusion: SemanticPredicateAtom,
): boolean {
  expect(
    certificate !== null && typeof certificate === "object",
    "Semantic predicate certificate must be an object.",
  );
  expect(
    certificate.tag === "predicate_alias",
    "Semantic predicate certificate has an invalid tag.",
  );
  if (
    certificate.call_span.start !== call_span.start ||
    certificate.call_span.end !== call_span.end ||
    !available_premises.some((premise) =>
      same_predicate_atom(certificate.premise, premise)
    ) ||
    !same_predicate_atom(certificate.conclusion, conclusion) ||
    certificate.premise.predicate !== conclusion.predicate ||
    certificate.premise.arguments.length !== conclusion.arguments.length
  ) {
    return false;
  }
  const premise = certificate.premise;
  const target = unique_semantic_call_at_span(control_flow, call_span);
  if (target === undefined) return false;
  const value_types = new Map(
    control_flow.values.map((value) => [value.value, value.type]),
  );
  for (const argument of [...premise.arguments, ...conclusion.arguments]) {
    if (!value_types.has(argument)) return false;
  }
  const blocks = new Map(
    control_flow.blocks.map((block) => [block.id, block]),
  );
  if (target_block_can_repeat(target.block.id, blocks)) return false;
  const reaches_target = blocks_reaching_target(target.block.id, blocks);
  const entry_counts = new Map<SemanticBlockId, number>();
  entry_counts.set(control_flow.entry, 1);
  const pending: {
    block: SemanticBlockId;
    predecessor: SemanticBlockId | undefined;
    aliases: ReadonlyMap<ValueId, ValueId>;
    visited: ReadonlySet<SemanticBlockId>;
  }[] = [{
    block: control_flow.entry,
    predecessor: undefined,
    aliases: new Map(),
    visited: new Set(),
  }];
  let paths = 0;
  let steps = 0;
  while (pending.length > 0) {
    steps += 1;
    if (steps > proof_limits.compiler_search_steps) return false;
    const state = pending.pop();
    expect(
      state !== undefined,
      "Semantic predicate certificate worklist disappeared.",
    );
    if (state.visited.has(state.block)) return false;
    const visited = new Set(state.visited);
    visited.add(state.block);
    if (visited.size > proof_limits.compiler_search_depth) return false;
    const block = blocks.get(state.block);
    if (block === undefined) return false;
    const aliases = new Map(state.aliases);
    let reached_call = false;
    for (const node of block.nodes) {
      steps += 1;
      if (steps > proof_limits.compiler_search_steps) return false;
      if (node === target.node) {
        reached_call = true;
        paths += 1;
        for (let index = 0; index < premise.arguments.length; index += 1) {
          const source = premise.arguments[index];
          const destination = conclusion.arguments[index];
          expect(
            source !== undefined && destination !== undefined,
            `Semantic predicate ${premise.predicate} lost argument ${index}.`,
          );
          if (
            resolved_alias(source, aliases) !==
              resolved_alias(destination, aliases)
          ) {
            return false;
          }
        }
        break;
      }
      record_value_alias(node, state.predecessor, aliases, value_types);
    }
    if (reached_call || block.id === target.block.id) continue;
    for (const successor of block.successors) {
      if (!reaches_target.has(successor)) continue;
      let count = 1;
      const previous = entry_counts.get(successor);
      if (previous !== undefined) count = previous + 1;
      if (count > proof_limits.maximum_formula_disjuncts) return false;
      entry_counts.set(successor, count);
      pending.push({
        block: successor,
        predecessor: block.id,
        aliases,
        visited,
      });
    }
  }
  return paths > 0;
}

function snapshot_predicate_atom(
  atom: SemanticPredicateAtom,
): SemanticPredicateAtom {
  return Object.freeze({
    predicate: atom.predicate,
    arguments: Object.freeze([...atom.arguments]),
  });
}

function same_predicate_atom(
  left: SemanticPredicateAtom,
  right: SemanticPredicateAtom,
): boolean {
  if (
    left.predicate !== right.predicate ||
    left.arguments.length !== right.arguments.length
  ) {
    return false;
  }
  return left.arguments.every((argument, index) =>
    argument === right.arguments[index]
  );
}

export function semantic_remainder_certificate(
  call_span: SourceSpan,
  requirement: SemanticRemainderRequirement,
): SemanticRemainderCertificate {
  return Object.freeze({
    tag: "remainder_fact",
    call_span: Object.freeze({
      start: call_span.start,
      end: call_span.end,
    }),
    requirement: Object.freeze({ ...requirement }),
  });
}

export function verify_semantic_remainder_certificate(
  certificate: SemanticRemainderCertificate,
  control_flow: SemanticCfg,
  call_span: SourceSpan,
  requirement: SemanticRemainderRequirement,
): boolean {
  expect(
    certificate !== null && typeof certificate === "object",
    "Semantic remainder certificate must be an object.",
  );
  expect(
    certificate.tag === "remainder_fact",
    "Semantic remainder certificate has an invalid tag.",
  );
  if (
    certificate.call_span.start !== call_span.start ||
    certificate.call_span.end !== call_span.end ||
    !same_remainder_requirement(certificate.requirement, requirement)
  ) {
    return false;
  }
  const ranges = machine_ranges(control_flow);
  const dividend_range = ranges.get(requirement.dividend);
  const divisor_range = ranges.get(requirement.divisor);
  const remainder_range = ranges.get(requirement.remainder);
  if (
    dividend_range === undefined || divisor_range === undefined ||
    remainder_range === undefined ||
    dividend_range.signed !== divisor_range.signed ||
    dividend_range.width !== divisor_range.width ||
    dividend_range.signed !== remainder_range.signed ||
    dividend_range.width !== remainder_range.width
  ) {
    return false;
  }
  const val_type = integer_val_type(dividend_range);
  if (val_type === undefined) return false;
  let primitive = val_type + ".rem_u";
  if (dividend_range.signed) primitive = val_type + ".rem_s";
  const producers = semantic_value_producers(control_flow);
  if (producers === undefined) return false;
  const operation = producers.get(requirement.remainder);
  if (
    operation?.operation.tag !== "primitive" ||
    operation.operation.name !== primitive ||
    operation.inputs.length !== 2 ||
    operation.outputs.length !== 1 ||
    operation.outputs[0] !== requirement.remainder ||
    operation.inputs[0] !== requirement.dividend ||
    operation.inputs[1] !== requirement.divisor
  ) {
    return false;
  }
  const divisor = verified_integer_constant(
    requirement.divisor,
    producers,
  );
  if (
    divisor === undefined ||
    normalize_integer(divisor_range, divisor) === 0n ||
    normalize_integer(remainder_range, requirement.expected) !==
      requirement.expected
  ) {
    return false;
  }
  const target = unique_semantic_call_at_span(control_flow, call_span);
  if (target === undefined) return false;
  const blocks = new Map(
    control_flow.blocks.map((block) => [block.id, block]),
  );
  if (target_block_can_repeat(target.block.id, blocks)) return false;
  const machine_requirement: SemanticMachineRequirement = {
    tag: "fact",
    proposition: {
      tag: "equal",
      value: requirement.remainder,
      expected: requirement.expected,
    },
  };
  return verify_semantic_paths(
    control_flow,
    call_span,
    machine_requirement,
  ) === "proved";
}

function same_remainder_requirement(
  left: SemanticRemainderRequirement,
  right: SemanticRemainderRequirement,
): boolean {
  return left.dividend === right.dividend &&
    left.divisor === right.divisor &&
    left.remainder === right.remainder &&
    left.expected === right.expected;
}

export function semantic_remainder_divisibility_certificate(
  call_span: SourceSpan,
  requirement: SemanticRemainderDivisibilityRequirement,
): SemanticRemainderDivisibilityCertificate {
  return Object.freeze({
    tag: "remainder_divisibility",
    call_span: Object.freeze({
      start: call_span.start,
      end: call_span.end,
    }),
    requirement: Object.freeze({
      premise: Object.freeze({ ...requirement.premise }),
      goal_divisor: requirement.goal_divisor,
    }),
  });
}

export function verify_semantic_remainder_divisibility_certificate(
  certificate: SemanticRemainderDivisibilityCertificate,
  control_flow: SemanticCfg,
  call_span: SourceSpan,
  requirement: SemanticRemainderDivisibilityRequirement,
): boolean {
  expect(
    certificate !== null && typeof certificate === "object",
    "Semantic remainder divisibility certificate must be an object.",
  );
  expect(
    certificate.tag === "remainder_divisibility",
    "Semantic remainder divisibility certificate has an invalid tag.",
  );
  if (
    certificate.call_span.start !== call_span.start ||
    certificate.call_span.end !== call_span.end ||
    !same_remainder_requirement(
      certificate.requirement.premise,
      requirement.premise,
    ) ||
    certificate.requirement.goal_divisor !== requirement.goal_divisor
  ) {
    return false;
  }
  if (
    requirement.premise.expected !== 0n ||
    requirement.goal_divisor <= 0n
  ) {
    return false;
  }
  const ranges = machine_ranges(control_flow);
  const integer = ranges.get(requirement.premise.dividend);
  const divisor_type = ranges.get(requirement.premise.divisor);
  if (
    integer === undefined || divisor_type === undefined ||
    !same_integer_type(integer, divisor_type) ||
    normalize_integer(integer, requirement.goal_divisor) !==
      requirement.goal_divisor
  ) {
    return false;
  }
  const producers = semantic_value_producers(control_flow);
  if (producers === undefined) return false;
  const premise_divisor = verified_integer_constant(
    requirement.premise.divisor,
    producers,
  );
  if (premise_divisor === undefined) return false;
  const normalized_premise_divisor = normalize_integer(
    divisor_type,
    premise_divisor,
  );
  if (
    normalized_premise_divisor !== premise_divisor ||
    normalized_premise_divisor <= 0n ||
    normalized_premise_divisor % requirement.goal_divisor !== 0n
  ) {
    return false;
  }
  const premise_certificate = semantic_remainder_certificate(
    call_span,
    requirement.premise,
  );
  return verify_semantic_remainder_certificate(
    premise_certificate,
    control_flow,
    call_span,
    requirement.premise,
  );
}

export function verify_semantic_bounded_offset_certificate(
  certificate: SemanticBoundedOffsetCertificate,
  control_flow: SemanticCfg,
  call_span: SourceSpan,
  requirement: SemanticBoundedOffsetRequirement,
): boolean {
  expect(
    certificate !== null && typeof certificate === "object",
    "Semantic bounded offset certificate must be an object.",
  );
  expect(
    certificate.tag === "bounded_offset",
    "Semantic bounded offset certificate has an invalid tag.",
  );
  if (!semantic_cfg_is_well_formed(control_flow)) return false;
  if (
    certificate.call_span.start !== call_span.start ||
    certificate.call_span.end !== call_span.end ||
    !same_bounded_offset_requirement(certificate.requirement, requirement)
  ) {
    return false;
  }
  if (
    requirement.operation !== "add" &&
    requirement.operation !== "subtract"
  ) {
    return false;
  }
  if (requirement.goal.tag === "fact") {
    const goal_tag = requirement.goal.proposition.tag;
    if (
      (goal_tag !== "less_than" &&
        goal_tag !== "less_equal" &&
        goal_tag !== "greater_than" &&
        goal_tag !== "greater_equal") ||
      requirement.goal.proposition.value !== requirement.logical_result
    ) {
      return false;
    }
  } else if (requirement.goal.left !== requirement.logical_result) {
    return false;
  }
  const target = unique_semantic_call_at_span(control_flow, call_span);
  if (
    target === undefined ||
    !target.node.inputs.includes(requirement.logical_result)
  ) {
    return false;
  }
  const blocks = new Map(
    control_flow.blocks.map((block) => [block.id, block]),
  );
  if (target_block_can_repeat(target.block.id, blocks)) return false;
  const ranges = machine_ranges(control_flow);
  const input_range = ranges.get(requirement.input);
  const offset_range = ranges.get(requirement.offset);
  const result_range = ranges.get(requirement.result);
  const logical_result_range = ranges.get(requirement.logical_result);
  if (
    input_range === undefined || offset_range === undefined ||
    result_range === undefined || logical_result_range === undefined ||
    !same_integer_type(input_range, offset_range) ||
    !same_integer_type(input_range, result_range) ||
    !same_integer_type(input_range, logical_result_range) ||
    input_range.width < 1 || input_range.width > 64
  ) {
    return false;
  }
  const val_type = integer_val_type(input_range);
  if (val_type === undefined) return false;
  let primitive = val_type + ".add";
  if (requirement.operation === "subtract") primitive = val_type + ".sub";
  const producers = semantic_value_producers(control_flow);
  if (producers === undefined) return false;
  if (
    producers.has(requirement.input) ||
    !control_flow.parameters.includes(requirement.input)
  ) {
    return false;
  }
  const operation = producers.get(requirement.result);
  if (
    operation?.operation.tag !== "primitive" ||
    operation.operation.name !== primitive ||
    operation.inputs.length !== 2 ||
    operation.inputs[0] !== requirement.input ||
    operation.inputs[1] !== requirement.offset ||
    operation.outputs.length !== 1 ||
    operation.outputs[0] !== requirement.result
  ) {
    return false;
  }
  let binding: SemanticNode | undefined;
  if (requirement.logical_result !== requirement.result) {
    binding = producers.get(requirement.logical_result);
    if (
      binding?.operation.tag !== "primitive" ||
      !binding.operation.name.startsWith("bind:") ||
      binding.inputs.length !== 1 ||
      binding.inputs[0] !== requirement.result ||
      binding.outputs.length !== 1 ||
      binding.outputs[0] !== requirement.logical_result
    ) {
      return false;
    }
  }
  const offset_node = producers.get(requirement.offset);
  if (offset_node?.operation.tag !== "constant") return false;
  const offset_index = target.block.nodes.indexOf(offset_node);
  const operation_index = target.block.nodes.indexOf(operation);
  let binding_index = operation_index;
  if (binding !== undefined) {
    binding_index = target.block.nodes.indexOf(binding);
  }
  const call_index = target.block.nodes.indexOf(target.node);
  if (
    offset_index < 0 ||
    operation_index <= offset_index ||
    call_index <= binding_index
  ) {
    return false;
  }
  if (binding !== undefined && binding_index <= operation_index) return false;
  const offset = verified_integer_constant(requirement.offset, producers);
  if (
    offset === undefined ||
    normalize_integer(offset_range, offset) !== offset
  ) {
    return false;
  }
  return verify_semantic_paths(
    control_flow,
    call_span,
    requirement.goal,
    requirement,
  ) === "proved";
}

export function verify_semantic_machine_certificate(
  certificate: SemanticMachineCertificate,
  control_flow: SemanticCfg,
  call_span: SourceSpan,
  requirement: SemanticMachineRequirement,
): boolean {
  expect(
    certificate !== null && typeof certificate === "object",
    "Semantic machine certificate must be an object.",
  );
  expect(
    certificate.tag === "machine_fact",
    "Semantic machine certificate has an invalid tag.",
  );
  if (
    certificate.call_span.start !== call_span.start ||
    certificate.call_span.end !== call_span.end ||
    !same_machine_requirement(certificate.requirement, requirement)
  ) {
    return false;
  }
  return verify_semantic_paths(
    control_flow,
    call_span,
    requirement,
  ) === "proved";
}

export function verify_semantic_machine_checkpoint_certificate(
  certificate: SemanticMachineCertificate,
  control_flow: SemanticCfg,
  checkpoint_span: SourceSpan,
  requirement: SemanticMachineRequirement,
): boolean {
  expect(
    certificate !== null && typeof certificate === "object",
    "Semantic machine checkpoint certificate must be an object.",
  );
  expect(
    certificate.tag === "machine_fact",
    "Semantic machine checkpoint certificate has an invalid tag.",
  );
  if (
    certificate.call_span.start !== checkpoint_span.start ||
    certificate.call_span.end !== checkpoint_span.end ||
    !same_machine_requirement(certificate.requirement, requirement)
  ) {
    return false;
  }
  const target = unique_semantic_node_at_span(control_flow, checkpoint_span);
  if (target === undefined) return false;
  return verify_semantic_paths(
    control_flow,
    checkpoint_span,
    requirement,
    undefined,
    target,
  ) === "proved";
}

export function verify_semantic_index_bounds_certificate(
  certificate: SemanticIndexBoundsCertificate,
  control_flow: SemanticCfg,
  index_span: SourceSpan,
  requirement: SemanticIndexBoundsRequirement,
): boolean {
  expect(
    certificate !== null && typeof certificate === "object",
    "Semantic index bounds certificate must be an object.",
  );
  expect(
    certificate.tag === "index_bounds",
    "Semantic index bounds certificate has an invalid tag.",
  );
  if (
    certificate.index_span.start !== index_span.start ||
    certificate.index_span.end !== index_span.end ||
    certificate.requirement.index !== requirement.index ||
    certificate.requirement.length !== requirement.length ||
    certificate.requirement.length_value !== requirement.length_value ||
    certificate.requirement.object !== requirement.object ||
    !semantic_cfg_is_well_formed(control_flow)
  ) {
    return false;
  }
  const target = unique_semantic_index_at_span(control_flow, index_span);
  if (target === undefined || target.node.operation.tag !== "index") {
    return false;
  }
  if (target.node.inputs[1] !== requirement.index) return false;
  let upper: SemanticMachineRequirement;
  if (requirement.length !== undefined) {
    if (
      !Number.isSafeInteger(requirement.length) ||
      requirement.length < 0 ||
      target.node.operation.length !== requirement.length
    ) {
      return false;
    }
    upper = {
      tag: "fact",
      proposition: {
        tag: "less_than",
        value: requirement.index,
        bound: BigInt(requirement.length),
      },
    };
  } else {
    if (
      requirement.length_value === undefined ||
      requirement.object === undefined ||
      target.node.operation.length !== undefined ||
      target.node.inputs[0] !== requirement.object ||
      !verify_semantic_index_length_measure(
        control_flow,
        index_span,
        requirement,
      )
    ) {
      return false;
    }
    upper = {
      tag: "difference",
      left: requirement.index,
      right: requirement.length_value,
      maximum: -1n,
    };
  }
  const lower: SemanticMachineRequirement = {
    tag: "fact",
    proposition: {
      tag: "greater_equal",
      value: requirement.index,
      bound: 0n,
    },
  };
  return verify_semantic_paths(
        control_flow,
        index_span,
        lower,
        undefined,
        target,
      ) === "proved" &&
    verify_semantic_paths(
        control_flow,
        index_span,
        upper,
        undefined,
        target,
      ) === "proved";
}

export function verify_semantic_primitive_safety_certificate(
  certificate: SemanticPrimitiveSafetyCertificate,
  control_flow: SemanticCfg,
  operation_span: SourceSpan,
  requirement: SemanticPrimitiveSafetyRequirement,
): boolean {
  expect(
    certificate !== null && typeof certificate === "object",
    "Semantic primitive safety certificate must be an object.",
  );
  expect(
    certificate.tag === "primitive_safety",
    "Semantic primitive safety certificate has an invalid tag.",
  );
  if (
    certificate.operation_span.start !== operation_span.start ||
    certificate.operation_span.end !== operation_span.end ||
    certificate.requirement.primitive !== requirement.primitive ||
    certificate.requirement.dividend !== requirement.dividend ||
    certificate.requirement.divisor !== requirement.divisor ||
    certificate.requirement.overflow_guard !== requirement.overflow_guard ||
    !semantic_cfg_is_well_formed(control_flow)
  ) {
    return false;
  }
  const target = unique_semantic_primitive_at_span(
    control_flow,
    operation_span,
    requirement.primitive,
  );
  if (
    target === undefined ||
    target.node.inputs.length !== 2 ||
    target.node.inputs[0] !== requirement.dividend ||
    target.node.inputs[1] !== requirement.divisor ||
    target.node.outputs.length !== 1
  ) {
    return false;
  }
  const result = target.node.outputs[0];
  if (result === undefined) return false;
  const value_types = new Map(
    control_flow.values.map((value) => [value.value, value.type]),
  );
  const dividend_type = value_types.get(requirement.dividend);
  const divisor_type = value_types.get(requirement.divisor);
  const result_type = value_types.get(result);
  let dividend_range: IntegerType | undefined;
  let divisor_range: IntegerType | undefined;
  let result_range: IntegerType | undefined;
  if (dividend_type?.tag === "scalar") {
    dividend_range = integer_type_from_name(dividend_type.name);
  } else if (dividend_type?.tag === "integer") {
    dividend_range = {
      signed: dividend_type.signed,
      width: dividend_type.width,
    };
  }
  if (divisor_type?.tag === "scalar") {
    divisor_range = integer_type_from_name(divisor_type.name);
  } else if (divisor_type?.tag === "integer") {
    divisor_range = {
      signed: divisor_type.signed,
      width: divisor_type.width,
    };
  }
  if (result_type?.tag === "scalar") {
    result_range = integer_type_from_name(result_type.name);
  } else if (result_type?.tag === "integer") {
    result_range = {
      signed: result_type.signed,
      width: result_type.width,
    };
  }
  if (
    dividend_range === undefined || divisor_range === undefined ||
    result_range === undefined ||
    dividend_range.signed !== divisor_range.signed ||
    dividend_range.width !== divisor_range.width ||
    dividend_range.signed !== result_range.signed ||
    dividend_range.width !== result_range.width
  ) {
    return false;
  }
  const val_type = integer_val_type(dividend_range);
  if (val_type === undefined) return false;
  let expected_primitive = val_type + ".rem_";
  if (requirement.primitive.includes(".div_")) {
    expected_primitive = val_type + ".div_";
  }
  if (dividend_range.signed) {
    expected_primitive += "s";
  } else {
    expected_primitive += "u";
  }
  if (requirement.primitive !== expected_primitive) return false;
  const trap_conditions = primitive_trap_conditions(requirement.primitive);
  if (!trap_conditions.includes("nonzero_divisor")) return false;
  const nonzero: SemanticMachineRequirement = {
    tag: "exclusion",
    value: requirement.divisor,
    expected: 0n,
  };
  if (
    verify_semantic_paths(
      control_flow,
      operation_span,
      nonzero,
      undefined,
      target,
    ) !== "proved"
  ) {
    return false;
  }
  const checks_overflow = trap_conditions.includes(
    "signed_division_overflow",
  );
  if (!checks_overflow) return requirement.overflow_guard === undefined;
  if (!dividend_range.signed) return false;
  if (requirement.overflow_guard === "pathwise_disjunction") {
    const dividend_guard: SemanticMachineRequirement = {
      tag: "exclusion",
      value: requirement.dividend,
      expected: integer_minimum(dividend_range),
    };
    const divisor_guard: SemanticMachineRequirement = {
      tag: "exclusion",
      value: requirement.divisor,
      expected: -1n,
    };
    return verify_semantic_paths(
      control_flow,
      operation_span,
      dividend_guard,
      undefined,
      target,
      divisor_guard,
    ) === "proved";
  }
  let overflow_requirement: SemanticMachineRequirement;
  if (requirement.overflow_guard === "dividend_not_minimum") {
    overflow_requirement = {
      tag: "exclusion",
      value: requirement.dividend,
      expected: integer_minimum(dividend_range),
    };
  } else if (requirement.overflow_guard === "divisor_not_negative_one") {
    overflow_requirement = {
      tag: "exclusion",
      value: requirement.divisor,
      expected: -1n,
    };
  } else {
    return false;
  }
  return verify_semantic_paths(
    control_flow,
    operation_span,
    overflow_requirement,
    undefined,
    target,
  ) === "proved";
}

export function verify_semantic_slice_bounds_certificate(
  certificate: SemanticSliceBoundsCertificate,
  control_flow: SemanticCfg,
  operation_span: SourceSpan,
  requirement: SemanticSliceBoundsRequirement,
): boolean {
  expect(
    certificate !== null && typeof certificate === "object",
    "Semantic slice bounds certificate must be an object.",
  );
  expect(
    certificate.tag === "slice_bounds",
    "Semantic slice bounds certificate has an invalid tag.",
  );
  if (
    certificate.operation_span.start !== operation_span.start ||
    certificate.operation_span.end !== operation_span.end ||
    certificate.requirement.object !== requirement.object ||
    certificate.requirement.start !== requirement.start ||
    certificate.requirement.end !== requirement.end ||
    certificate.requirement.length !== requirement.length ||
    certificate.requirement.length_value !== requirement.length_value ||
    certificate.requirement.utf8_boundaries !==
      requirement.utf8_boundaries ||
    !semantic_cfg_is_well_formed(control_flow)
  ) {
    return false;
  }
  const target = unique_semantic_slice_at_span(control_flow, operation_span);
  if (
    target === undefined ||
    target.node.inputs[0] !== requirement.object ||
    target.node.inputs[1] !== requirement.start ||
    target.node.inputs[2] !== requirement.end
  ) {
    return false;
  }
  let object_type = control_flow.values.find((value) =>
    value.value === requirement.object
  )?.type;
  if (object_type === undefined) return false;
  while (object_type.tag === "owned") object_type = object_type.value;
  const is_text = object_type.tag === "scalar" &&
    object_type.name === "Text";
  const is_bytes = object_type.tag === "scalar" &&
    object_type.name === "Bytes";
  if (!is_text && !is_bytes) return false;
  if (is_bytes && requirement.utf8_boundaries !== undefined) return false;
  if (is_text) {
    if (requirement.utf8_boundaries !== "static_literal") return false;
    let object_constant: string | undefined;
    let start_constant: bigint | undefined;
    let end_constant: bigint | undefined;
    for (const block of control_flow.blocks) {
      for (const node of block.nodes) {
        if (
          node.outputs.length !== 1 ||
          node.operation.tag !== "constant"
        ) {
          continue;
        }
        const output = node.outputs[0];
        if (
          output === requirement.object &&
          typeof node.operation.value === "string"
        ) {
          object_constant = node.operation.value;
        }
        if (output === requirement.start) {
          if (typeof node.operation.value === "bigint") {
            start_constant = node.operation.value;
          } else if (
            typeof node.operation.value === "number" &&
            Number.isSafeInteger(node.operation.value)
          ) {
            start_constant = BigInt(node.operation.value);
          }
        }
        if (output === requirement.end) {
          if (typeof node.operation.value === "bigint") {
            end_constant = node.operation.value;
          } else if (
            typeof node.operation.value === "number" &&
            Number.isSafeInteger(node.operation.value)
          ) {
            end_constant = BigInt(node.operation.value);
          }
        }
      }
    }
    if (
      object_constant === undefined ||
      start_constant === undefined ||
      end_constant === undefined ||
      start_constant < BigInt(Number.MIN_SAFE_INTEGER) ||
      start_constant > BigInt(Number.MAX_SAFE_INTEGER) ||
      end_constant < BigInt(Number.MIN_SAFE_INTEGER) ||
      end_constant > BigInt(Number.MAX_SAFE_INTEGER) ||
      !text_byte_offset_is_boundary(
        object_constant,
        Number(start_constant),
      ) ||
      !text_byte_offset_is_boundary(object_constant, Number(end_constant))
    ) {
      return false;
    }
  }
  let upper: SemanticMachineRequirement;
  if (requirement.length !== undefined) {
    if (
      !Number.isSafeInteger(requirement.length) ||
      requirement.length < 0 ||
      target.node.operation.tag !== "slice" ||
      target.node.operation.length !== requirement.length
    ) {
      return false;
    }
    upper = {
      tag: "fact",
      proposition: {
        tag: "less_equal",
        value: requirement.end,
        bound: BigInt(requirement.length),
      },
    };
  } else {
    const invariant_aliases = verified_loop_invariant_aliases(
      control_flow,
      new Map(
        control_flow.values.map((value) => [value.value, value.type]),
      ),
    );
    let matching_measure = false;
    if (requirement.length_value !== undefined) {
      for (const block of control_flow.blocks) {
        for (const node of block.nodes) {
          const measured_object = node.inputs[0];
          const required_object = resolved_alias(
            requirement.object,
            invariant_aliases,
          );
          let resolved_measured_object: ValueId | undefined;
          if (measured_object !== undefined) {
            resolved_measured_object = resolved_alias(
              measured_object,
              invariant_aliases,
            );
          }
          if (
            node.operation.tag === "call" &&
            node.operation.function_name === "@len" &&
            node.inputs.length === 1 &&
            required_object !== undefined &&
            resolved_measured_object === required_object &&
            node.outputs.length === 1 &&
            node.outputs[0] === requirement.length_value
          ) {
            matching_measure = true;
          }
        }
      }
    }
    if (
      requirement.length_value === undefined ||
      target.node.operation.tag !== "slice" ||
      target.node.operation.length !== undefined ||
      !matching_measure
    ) {
      return false;
    }
    upper = {
      tag: "difference",
      left: requirement.end,
      right: requirement.length_value,
      maximum: 0n,
    };
  }
  const lower: SemanticMachineRequirement = {
    tag: "fact",
    proposition: {
      tag: "greater_equal",
      value: requirement.start,
      bound: 0n,
    },
  };
  const ordered: SemanticMachineRequirement = {
    tag: "difference",
    left: requirement.start,
    right: requirement.end,
    maximum: 0n,
  };
  return verify_semantic_paths(
        control_flow,
        operation_span,
        lower,
        undefined,
        target,
      ) === "proved" &&
    verify_semantic_paths(
        control_flow,
        operation_span,
        ordered,
        undefined,
        target,
      ) === "proved" &&
    verify_semantic_paths(
        control_flow,
        operation_span,
        upper,
        undefined,
        target,
      ) === "proved";
}

export function verify_semantic_integer_narrowing_certificate(
  certificate: SemanticIntegerNarrowingCertificate,
  control_flow: SemanticCfg,
  operation_span: SourceSpan,
  requirement: SemanticIntegerNarrowingRequirement,
): boolean {
  expect(
    certificate !== null && typeof certificate === "object",
    "Semantic integer narrowing certificate must be an object.",
  );
  expect(
    certificate.tag === "integer_narrowing",
    "Semantic integer narrowing certificate has an invalid tag.",
  );
  if (
    certificate.operation_span.start !== operation_span.start ||
    certificate.operation_span.end !== operation_span.end ||
    certificate.requirement.value !== requirement.value ||
    certificate.requirement.source.signed !== requirement.source.signed ||
    certificate.requirement.source.width !== requirement.source.width ||
    certificate.requirement.target.signed !== requirement.target.signed ||
    certificate.requirement.target.width !== requirement.target.width ||
    !semantic_cfg_is_well_formed(control_flow)
  ) {
    return false;
  }
  const target = unique_semantic_narrowing_at_span(
    control_flow,
    operation_span,
  );
  if (
    target === undefined ||
    target.node.operation.tag !== "narrow_integer" ||
    target.node.inputs[0] !== requirement.value ||
    target.node.operation.source.signed !== requirement.source.signed ||
    target.node.operation.source.width !== requirement.source.width ||
    target.node.operation.target.signed !== requirement.target.signed ||
    target.node.operation.target.width !== requirement.target.width
  ) {
    return false;
  }
  const lower: SemanticMachineRequirement = {
    tag: "fact",
    proposition: {
      tag: "greater_equal",
      value: requirement.value,
      bound: integer_minimum(requirement.target),
    },
  };
  const upper: SemanticMachineRequirement = {
    tag: "fact",
    proposition: {
      tag: "less_equal",
      value: requirement.value,
      bound: integer_maximum(requirement.target),
    },
  };
  return verify_semantic_paths(
        control_flow,
        operation_span,
        lower,
        undefined,
        target,
      ) === "proved" &&
    verify_semantic_paths(
        control_flow,
        operation_span,
        upper,
        undefined,
        target,
      ) === "proved";
}

export function verify_semantic_integer_narrowing_unreachable(
  control_flow: SemanticCfg,
  operation_span: SourceSpan,
): boolean {
  if (!semantic_cfg_is_well_formed(control_flow)) return false;
  const target = unique_semantic_narrowing_at_span(
    control_flow,
    operation_span,
  );
  if (target === undefined) return false;
  return verify_semantic_paths(
    control_flow,
    operation_span,
    undefined,
    undefined,
    target,
  ) === "unreachable";
}

export function verify_semantic_integer_narrowing_disproved(
  control_flow: SemanticCfg,
  operation_span: SourceSpan,
): boolean {
  if (!semantic_cfg_is_well_formed(control_flow)) return false;
  const target = unique_semantic_narrowing_at_span(
    control_flow,
    operation_span,
  );
  if (
    target === undefined ||
    target.node.operation.tag !== "narrow_integer"
  ) {
    return false;
  }
  const value = target.node.inputs[0];
  if (value === undefined) return false;
  const below_target: SemanticMachineRequirement = {
    tag: "fact",
    proposition: {
      tag: "less_than",
      value,
      bound: integer_minimum(target.node.operation.target),
    },
  };
  const above_target: SemanticMachineRequirement = {
    tag: "fact",
    proposition: {
      tag: "greater_than",
      value,
      bound: integer_maximum(target.node.operation.target),
    },
  };
  return verify_semantic_paths(
    control_flow,
    operation_span,
    below_target,
    undefined,
    target,
    above_target,
  ) === "proved";
}

export function verify_semantic_slice_unreachable(
  control_flow: SemanticCfg,
  operation_span: SourceSpan,
): boolean {
  if (!semantic_cfg_is_well_formed(control_flow)) return false;
  const target = unique_semantic_slice_at_span(control_flow, operation_span);
  if (target === undefined) return false;
  return verify_semantic_paths(
    control_flow,
    operation_span,
    undefined,
    undefined,
    target,
  ) === "unreachable";
}

export function verify_semantic_slice_disproved(
  control_flow: SemanticCfg,
  operation_span: SourceSpan,
  requirement: SemanticSliceBoundsRequirement,
): boolean {
  if (!semantic_cfg_is_well_formed(control_flow)) return false;
  const target = unique_semantic_slice_at_span(control_flow, operation_span);
  if (
    target === undefined ||
    target.node.inputs[0] !== requirement.object ||
    target.node.inputs[1] !== requirement.start ||
    target.node.inputs[2] !== requirement.end
  ) {
    return false;
  }
  let object_type = control_flow.values.find((value) =>
    value.value === requirement.object
  )?.type;
  if (object_type === undefined) return false;
  while (object_type.tag === "owned") object_type = object_type.value;
  const is_text = object_type.tag === "scalar" &&
    object_type.name === "Text";
  const is_bytes = object_type.tag === "scalar" &&
    object_type.name === "Bytes";
  if (!is_text && !is_bytes) return false;
  if (is_bytes && requirement.utf8_boundaries !== undefined) return false;
  if (is_text && requirement.utf8_boundaries !== "static_literal") {
    return false;
  }
  let above_length: SemanticMachineRequirement;
  if (requirement.length !== undefined) {
    if (
      !Number.isSafeInteger(requirement.length) ||
      requirement.length < 0 ||
      target.node.operation.tag !== "slice" ||
      target.node.operation.length !== requirement.length
    ) {
      return false;
    }
    above_length = {
      tag: "fact",
      proposition: {
        tag: "greater_than",
        value: requirement.end,
        bound: BigInt(requirement.length),
      },
    };
  } else {
    const aliases = verified_loop_invariant_aliases(
      control_flow,
      new Map(
        control_flow.values.map((value) => [value.value, value.type]),
      ),
    );
    let matching_measure = false;
    if (requirement.length_value !== undefined) {
      for (const block of control_flow.blocks) {
        for (const node of block.nodes) {
          const measured_object = node.inputs[0];
          const indexed_object = resolved_alias(requirement.object, aliases);
          let resolved_measured_object: ValueId | undefined;
          if (measured_object !== undefined) {
            resolved_measured_object = resolved_alias(
              measured_object,
              aliases,
            );
          }
          if (
            node.operation.tag === "call" &&
            node.operation.function_name === "@len" &&
            node.inputs.length === 1 &&
            indexed_object !== undefined &&
            resolved_measured_object === indexed_object &&
            node.outputs.length === 1 &&
            node.outputs[0] === requirement.length_value
          ) {
            matching_measure = true;
          }
        }
      }
    }
    if (
      requirement.length_value === undefined ||
      target.node.operation.tag !== "slice" ||
      target.node.operation.length !== undefined ||
      !matching_measure
    ) {
      return false;
    }
    above_length = {
      tag: "difference",
      left: requirement.length_value,
      right: requirement.end,
      maximum: -1n,
    };
  }
  const below_zero: SemanticMachineRequirement = {
    tag: "fact",
    proposition: {
      tag: "less_than",
      value: requirement.start,
      bound: 0n,
    },
  };
  const reversed: SemanticMachineRequirement = {
    tag: "difference",
    left: requirement.end,
    right: requirement.start,
    maximum: -1n,
  };
  const violations = [below_zero, reversed, above_length];
  for (let index = 0; index < violations.length; index += 1) {
    const violation = violations[index];
    if (violation === undefined) return false;
    if (
      verify_semantic_paths(
        control_flow,
        operation_span,
        violation,
        undefined,
        target,
      ) === "proved"
    ) {
      return true;
    }
    for (
      let alternative_index = index + 1;
      alternative_index < violations.length;
      alternative_index += 1
    ) {
      const alternative = violations[alternative_index];
      if (alternative === undefined) return false;
      if (
        verify_semantic_paths(
          control_flow,
          operation_span,
          violation,
          undefined,
          target,
          alternative,
        ) === "proved"
      ) {
        return true;
      }
    }
  }
  return false;
}

export function verify_semantic_primitive_unreachable(
  control_flow: SemanticCfg,
  operation_span: SourceSpan,
  primitive: Prim,
): boolean {
  if (!semantic_cfg_is_well_formed(control_flow)) return false;
  const target = unique_semantic_primitive_at_span(
    control_flow,
    operation_span,
    primitive,
  );
  if (target === undefined) return false;
  return verify_semantic_paths(
    control_flow,
    operation_span,
    undefined,
    undefined,
    target,
  ) === "unreachable";
}

export function verify_semantic_primitive_disproved(
  control_flow: SemanticCfg,
  operation_span: SourceSpan,
  primitive: Prim,
): boolean {
  if (!semantic_cfg_is_well_formed(control_flow)) return false;
  const target = unique_semantic_primitive_at_span(
    control_flow,
    operation_span,
    primitive,
  );
  if (
    target === undefined ||
    target.node.inputs.length !== 2 ||
    target.node.outputs.length !== 1
  ) {
    return false;
  }
  const dividend = target.node.inputs[0];
  const divisor = target.node.inputs[1];
  const result = target.node.outputs[0];
  if (
    dividend === undefined || divisor === undefined || result === undefined
  ) {
    return false;
  }
  const value_types = new Map(
    control_flow.values.map((value) => [value.value, value.type]),
  );
  const dividend_type = value_types.get(dividend);
  const divisor_type = value_types.get(divisor);
  const result_type = value_types.get(result);
  let dividend_range: IntegerType | undefined;
  let divisor_range: IntegerType | undefined;
  let result_range: IntegerType | undefined;
  if (dividend_type?.tag === "scalar") {
    dividend_range = integer_type_from_name(dividend_type.name);
  } else if (dividend_type?.tag === "integer") {
    dividend_range = {
      signed: dividend_type.signed,
      width: dividend_type.width,
    };
  }
  if (divisor_type?.tag === "scalar") {
    divisor_range = integer_type_from_name(divisor_type.name);
  } else if (divisor_type?.tag === "integer") {
    divisor_range = {
      signed: divisor_type.signed,
      width: divisor_type.width,
    };
  }
  if (result_type?.tag === "scalar") {
    result_range = integer_type_from_name(result_type.name);
  } else if (result_type?.tag === "integer") {
    result_range = {
      signed: result_type.signed,
      width: result_type.width,
    };
  }
  if (
    dividend_range === undefined || divisor_range === undefined ||
    result_range === undefined ||
    dividend_range.signed !== divisor_range.signed ||
    dividend_range.width !== divisor_range.width ||
    dividend_range.signed !== result_range.signed ||
    dividend_range.width !== result_range.width
  ) {
    return false;
  }
  const val_type = integer_val_type(dividend_range);
  if (val_type === undefined) return false;
  let expected_primitive = val_type + ".rem_";
  if (primitive.includes(".div_")) expected_primitive = val_type + ".div_";
  if (dividend_range.signed) {
    expected_primitive += "s";
  } else {
    expected_primitive += "u";
  }
  if (primitive !== expected_primitive) return false;
  const trap_conditions = primitive_trap_conditions(primitive);
  if (!trap_conditions.includes("nonzero_divisor")) return false;
  const divisor_zero: SemanticMachineRequirement = {
    tag: "fact",
    proposition: {
      tag: "equal",
      value: divisor,
      expected: 0n,
    },
  };
  if (!trap_conditions.includes("signed_division_overflow")) {
    return verify_semantic_paths(
      control_flow,
      operation_span,
      divisor_zero,
      undefined,
      target,
    ) === "proved";
  }
  if (!dividend_range.signed) return false;
  const dividend_minimum: SemanticMachineRequirement = {
    tag: "fact",
    proposition: {
      tag: "equal",
      value: dividend,
      expected: integer_minimum(dividend_range),
    },
  };
  const divisor_negative_one: SemanticMachineRequirement = {
    tag: "fact",
    proposition: {
      tag: "equal",
      value: divisor,
      expected: -1n,
    },
  };
  return verify_semantic_paths(
        control_flow,
        operation_span,
        divisor_zero,
        undefined,
        target,
        dividend_minimum,
      ) === "proved" &&
    verify_semantic_paths(
        control_flow,
        operation_span,
        divisor_zero,
        undefined,
        target,
        divisor_negative_one,
      ) === "proved";
}

export function verify_semantic_index_unreachable(
  control_flow: SemanticCfg,
  index_span: SourceSpan,
): boolean {
  if (!semantic_cfg_is_well_formed(control_flow)) return false;
  const target = unique_semantic_index_at_span(control_flow, index_span);
  if (target === undefined) return false;
  return verify_semantic_paths(
    control_flow,
    index_span,
    undefined,
    undefined,
    target,
  ) === "unreachable";
}

export function verify_semantic_index_length_measure(
  control_flow: SemanticCfg,
  index_span: SourceSpan,
  requirement: SemanticIndexBoundsRequirement,
): boolean {
  if (!semantic_cfg_is_well_formed(control_flow)) return false;
  const target = unique_semantic_index_at_span(control_flow, index_span);
  if (
    target === undefined ||
    target.node.operation.tag !== "index" ||
    target.node.operation.length !== undefined ||
    target.node.inputs[0] !== requirement.object ||
    target.node.inputs[1] !== requirement.index ||
    requirement.object === undefined ||
    requirement.length_value === undefined
  ) {
    return false;
  }
  const value_types = new Map(
    control_flow.values.map((value) => [value.value, value.type]),
  );
  const aliases = verified_loop_invariant_aliases(
    control_flow,
    value_types,
  );
  const indexed_object = resolved_alias(requirement.object, aliases);
  if (indexed_object === undefined) return false;
  for (const block of control_flow.blocks) {
    for (const node of block.nodes) {
      const measured_object = node.inputs[0];
      if (
        node.operation.tag !== "call" ||
        node.operation.function_name !== "@len" ||
        node.inputs.length !== 1 ||
        measured_object === undefined ||
        resolved_alias(measured_object, aliases) !== indexed_object ||
        node.outputs.length !== 1 ||
        node.outputs[0] !== requirement.length_value
      ) {
        continue;
      }
      return true;
    }
  }
  return false;
}

export function verify_semantic_index_disproved(
  control_flow: SemanticCfg,
  index_span: SourceSpan,
  requirement: SemanticIndexBoundsRequirement,
): boolean {
  if (!semantic_cfg_is_well_formed(control_flow)) return false;
  const target = unique_semantic_index_at_span(control_flow, index_span);
  if (
    target === undefined ||
    target.node.operation.tag !== "index" ||
    target.node.inputs[1] !== requirement.index
  ) {
    return false;
  }
  let above_upper: SemanticMachineRequirement;
  if (requirement.length !== undefined) {
    if (
      !Number.isSafeInteger(requirement.length) ||
      requirement.length < 0 ||
      target.node.operation.length !== requirement.length
    ) {
      return false;
    }
    above_upper = {
      tag: "fact",
      proposition: {
        tag: "greater_equal",
        value: requirement.index,
        bound: BigInt(requirement.length),
      },
    };
  } else {
    if (
      requirement.length_value === undefined ||
      requirement.object === undefined ||
      target.node.operation.length !== undefined ||
      target.node.inputs[0] !== requirement.object ||
      !verify_semantic_index_length_measure(
        control_flow,
        index_span,
        requirement,
      )
    ) {
      return false;
    }
    above_upper = {
      tag: "difference",
      left: requirement.length_value,
      right: requirement.index,
      maximum: 0n,
    };
  }
  const below_zero: SemanticMachineRequirement = {
    tag: "fact",
    proposition: {
      tag: "less_than",
      value: requirement.index,
      bound: 0n,
    },
  };
  return verify_semantic_paths(
    control_flow,
    index_span,
    below_zero,
    undefined,
    target,
    above_upper,
  ) === "proved";
}

type TypeVerificationState = {
  block: SemanticBlockId;
  predecessor: SemanticBlockId | undefined;
  aliases: ReadonlyMap<ValueId, ValueId>;
  booleans: ReadonlyMap<ValueId, boolean>;
  tests: ReadonlyMap<ValueId, Omit<SemanticTypeRequirement, "expected">>;
  premises: readonly SemanticTypeRequirement[];
  visited: ReadonlySet<SemanticBlockId>;
};

export function verify_semantic_type_certificate(
  certificate: SemanticTypeCertificate,
  control_flow: SemanticCfg,
  call_span: SourceSpan,
  requirement: SemanticTypeRequirement,
): boolean {
  expect(
    certificate !== null && typeof certificate === "object",
    "Semantic type certificate must be an object.",
  );
  expect(
    certificate.tag === "type_fact",
    "Semantic type certificate has an invalid tag.",
  );
  if (
    certificate.call_span.start !== call_span.start ||
    certificate.call_span.end !== call_span.end ||
    certificate.requirement.value !== requirement.value ||
    certificate.requirement.type !== requirement.type ||
    certificate.requirement.expected !== requirement.expected ||
    typeof requirement.type !== "string" || requirement.type.length === 0 ||
    !semantic_cfg_is_well_formed(control_flow)
  ) {
    return false;
  }
  const target = unique_semantic_call_at_span(control_flow, call_span);
  if (target === undefined) return false;
  const blocks = new Map(
    control_flow.blocks.map((block) => [block.id, block]),
  );
  const value_types = new Map(
    control_flow.values.map((value) => [value.value, value.type]),
  );
  if (target_block_can_repeat(target.block.id, blocks)) return false;
  const reaches_target = blocks_reaching_target(target.block.id, blocks);
  const entry_counts = new Map<SemanticBlockId, number>();
  entry_counts.set(control_flow.entry, 1);
  const pending: TypeVerificationState[] = [{
    block: control_flow.entry,
    predecessor: undefined,
    aliases: new Map(),
    booleans: new Map(),
    tests: new Map(),
    premises: [],
    visited: new Set(),
  }];
  let feasible_paths = 0;
  let steps = 0;
  while (pending.length > 0) {
    steps += 1;
    if (steps > proof_limits.compiler_search_steps) return false;
    const state = pending.pop();
    expect(
      state !== undefined,
      "Semantic type certificate worklist disappeared.",
    );
    if (state.visited.has(state.block)) return false;
    const visited = new Set(state.visited);
    visited.add(state.block);
    if (visited.size > proof_limits.compiler_search_depth) return false;
    const block = blocks.get(state.block);
    if (block === undefined) return false;
    let aliases = new Map(state.aliases);
    let booleans = new Map(state.booleans);
    let tests = new Map(state.tests);
    let premises = [...state.premises];
    let reached_call = false;
    for (const node of block.nodes) {
      steps += 1;
      if (steps > proof_limits.compiler_search_steps) return false;
      if (node === target.node) {
        reached_call = true;
        if (verified_type_premises_contradict(premises)) break;
        feasible_paths += 1;
        if (
          !verified_type_premises_imply(premises, {
            ...requirement,
            value: resolved_verified_type_alias(
              requirement.value,
              aliases,
            ),
          })
        ) {
          return false;
        }
        break;
      }
      const transferred = transfer_verified_type_node(
        node,
        state.predecessor,
        aliases,
        booleans,
        tests,
        premises,
        value_types,
      );
      booleans = transferred.booleans;
      aliases = transferred.aliases;
      tests = transferred.tests;
      premises = transferred.premises;
    }
    if (reached_call || block.id === target.block.id) continue;
    if (block.terminator.tag !== "branch") {
      for (const successor of block.successors) {
        if (!reaches_target.has(successor)) continue;
        if (
          !enqueue_type_verification_state(
            pending,
            entry_counts,
            {
              block: successor,
              predecessor: block.id,
              aliases,
              booleans,
              tests,
              premises,
              visited,
            },
          )
        ) {
          return false;
        }
      }
      continue;
    }
    const known_condition = booleans.get(block.terminator.condition);
    const type_test = tests.get(block.terminator.condition);
    for (
      const [branch_value, successor] of [
        [true, block.terminator.when_true],
        [false, block.terminator.when_false],
      ] as const
    ) {
      if (!reaches_target.has(successor)) continue;
      if (
        known_condition !== undefined && known_condition !== branch_value
      ) {
        continue;
      }
      const branch_premises = [...premises];
      if (type_test !== undefined) {
        branch_premises.push({
          ...type_test,
          expected: branch_value,
        });
      }
      if (
        verified_type_premises_contradict(branch_premises)
      ) {
        continue;
      }
      if (
        !enqueue_type_verification_state(
          pending,
          entry_counts,
          {
            block: successor,
            predecessor: block.id,
            aliases,
            booleans,
            tests,
            premises: branch_premises,
            visited,
          },
        )
      ) {
        return false;
      }
    }
  }
  return feasible_paths > 0;
}

function transfer_verified_type_node(
  node: SemanticNode,
  predecessor: SemanticBlockId | undefined,
  current_aliases: ReadonlyMap<ValueId, ValueId>,
  current_booleans: ReadonlyMap<ValueId, boolean>,
  current_tests: ReadonlyMap<
    ValueId,
    Omit<SemanticTypeRequirement, "expected">
  >,
  current_premises: readonly SemanticTypeRequirement[],
  value_types: ReadonlyMap<ValueId, RepresentationType>,
): {
  booleans: Map<ValueId, boolean>;
  aliases: Map<ValueId, ValueId>;
  tests: Map<ValueId, Omit<SemanticTypeRequirement, "expected">>;
  premises: SemanticTypeRequirement[];
} {
  const booleans = new Map(current_booleans);
  const aliases = new Map(current_aliases);
  const tests = new Map(current_tests);
  const premises = [...current_premises];
  const output = node.outputs[0];
  if (node.operation.tag === "constant" && output !== undefined) {
    if (typeof node.operation.value === "boolean") {
      booleans.set(output, node.operation.value);
    }
    return { aliases, booleans, tests, premises };
  }
  if (
    node.operation.tag === "type_test" &&
    node.inputs.length === 1 &&
    output !== undefined
  ) {
    const input = node.inputs[0];
    if (input !== undefined) {
      tests.set(output, {
        value: resolved_verified_type_alias(input, aliases),
        type: node.operation.type,
      });
    }
    return { aliases, booleans, tests, premises };
  }
  if (
    node.operation.tag === "primitive" &&
    node.operation.name.startsWith("bind:") &&
    node.inputs.length === 1 &&
    output !== undefined
  ) {
    const input = node.inputs[0];
    const input_type = value_types.get(input as ValueId);
    const output_type = value_types.get(output);
    if (
      input !== undefined && input_type !== undefined &&
      output_type !== undefined &&
      same_representation_type(input_type, output_type)
    ) {
      aliases.set(output, resolved_verified_type_alias(input, aliases));
      const input_boolean = booleans.get(input);
      if (input_boolean !== undefined) booleans.set(output, input_boolean);
      const input_test = tests.get(input);
      if (input_test !== undefined) tests.set(output, input_test);
    }
    return { aliases, booleans, tests, premises };
  }
  if (
    node.operation.tag === "ownership_transition" &&
    (node.operation.transition === "borrow" ||
      node.operation.transition === "freeze") &&
    node.inputs.length === 1 &&
    output !== undefined
  ) {
    const input = node.inputs[0];
    const input_type = value_types.get(input as ValueId);
    const output_type = value_types.get(output);
    if (
      input !== undefined && input_type !== undefined &&
      output_type !== undefined &&
      same_representation_type(input_type, output_type)
    ) {
      transfer_verified_type_premises(
        premises,
        resolved_verified_type_alias(input, aliases),
        output,
      );
      const input_boolean = booleans.get(input);
      if (input_boolean !== undefined) booleans.set(output, input_boolean);
      const input_test = tests.get(input);
      if (input_test !== undefined) tests.set(output, input_test);
    }
    return { aliases, booleans, tests, premises };
  }
  if (
    node.operation.tag !== "phi" || predecessor === undefined ||
    output === undefined
  ) {
    return { aliases, booleans, tests, premises };
  }
  const incoming = node.operation.incoming.find((candidate) =>
    candidate.predecessor === predecessor
  );
  if (incoming === undefined) {
    return { aliases, booleans, tests, premises };
  }
  const incoming_boolean = booleans.get(incoming.value);
  if (incoming_boolean !== undefined) booleans.set(output, incoming_boolean);
  const incoming_test = tests.get(incoming.value);
  if (incoming_test !== undefined) tests.set(output, incoming_test);
  aliases.set(
    output,
    resolved_verified_type_alias(incoming.value, aliases),
  );
  return { aliases, booleans, tests, premises };
}

function resolved_verified_type_alias(
  value: ValueId,
  aliases: ReadonlyMap<ValueId, ValueId>,
): ValueId {
  let current = value;
  const visited = new Set<ValueId>();
  while (!visited.has(current)) {
    visited.add(current);
    const next = aliases.get(current);
    if (next === undefined || next === current) return current;
    current = next;
  }
  return value;
}

function transfer_verified_type_premises(
  premises: SemanticTypeRequirement[],
  source: ValueId,
  target: ValueId,
): void {
  const inherited = premises.filter((premise) => premise.value === source);
  for (const premise of inherited) {
    premises.push({ ...premise, value: target });
  }
}

function verified_type_premises_contradict(
  premises: readonly SemanticTypeRequirement[],
): boolean {
  for (let left_index = 0; left_index < premises.length; left_index += 1) {
    const left = premises[left_index];
    expect(left !== undefined, "Semantic type premise disappeared.");
    for (
      let right_index = left_index + 1;
      right_index < premises.length;
      right_index += 1
    ) {
      const right = premises[right_index];
      expect(right !== undefined, "Semantic type premise disappeared.");
      if (
        left.value === right.value && left.type === right.type &&
        left.expected !== right.expected
      ) {
        return true;
      }
    }
  }
  return false;
}

function verified_type_premises_imply(
  premises: readonly SemanticTypeRequirement[],
  requirement: SemanticTypeRequirement,
): boolean {
  return premises.some((premise) =>
    premise.value === requirement.value &&
    premise.type === requirement.type &&
    premise.expected === requirement.expected
  );
}

function enqueue_type_verification_state(
  pending: TypeVerificationState[],
  entry_counts: Map<SemanticBlockId, number>,
  state: TypeVerificationState,
): boolean {
  let count = 1;
  const previous = entry_counts.get(state.block);
  if (previous !== undefined) count = previous + 1;
  if (count > proof_limits.maximum_formula_disjuncts) return false;
  entry_counts.set(state.block, count);
  pending.push(state);
  return true;
}

export function verify_semantic_unreachable_certificate(
  certificate: SemanticUnreachableCertificate,
  control_flow: SemanticCfg,
  call_span: SourceSpan,
): boolean {
  expect(
    certificate !== null && typeof certificate === "object",
    "Semantic unreachable certificate must be an object.",
  );
  expect(
    certificate.tag === "machine_unreachable",
    "Semantic unreachable certificate has an invalid tag.",
  );
  if (
    certificate.call_span.start !== call_span.start ||
    certificate.call_span.end !== call_span.end
  ) {
    return false;
  }
  return verify_semantic_paths(
    control_flow,
    call_span,
    undefined,
  ) === "unreachable";
}

type VerifiedSemanticPaths = "proved" | "unreachable" | "rejected";

function verify_semantic_paths(
  control_flow: SemanticCfg,
  call_span: SourceSpan,
  requirement: SemanticMachineRequirement | undefined,
  bounded_offset?: SemanticBoundedOffsetRequirement,
  explicit_target?: { block: SemanticBlock; node: SemanticNode },
  alternative_requirement?: SemanticMachineRequirement,
  check_repetition = true,
): VerifiedSemanticPaths {
  if (!semantic_cfg_is_well_formed(control_flow)) return "rejected";
  let target = explicit_target;
  if (target === undefined) {
    target = unique_semantic_call_at_span(control_flow, call_span);
  }
  if (target === undefined) return "rejected";
  const ranges = machine_ranges(control_flow);
  const requirements: SemanticMachineRequirement[] = [];
  if (requirement !== undefined) requirements.push(requirement);
  if (alternative_requirement !== undefined) {
    requirements.push(alternative_requirement);
  }
  for (const candidate of requirements) {
    const goal_value = requirement_value(candidate);
    const goal_range = ranges.get(goal_value);
    if (goal_range === undefined) return "rejected";
    if (
      candidate.tag !== "difference" &&
      candidate.tag !== "equality" &&
      candidate.tag !== "disequality"
    ) {
      continue;
    }
    const right_range = ranges.get(candidate.right);
    if (
      right_range === undefined ||
      !same_integer_type(goal_range, right_range)
    ) {
      return "rejected";
    }
  }
  const blocks = new Map(
    control_flow.blocks.map((block) => [block.id, block]),
  );
  const producers = semantic_value_producers(control_flow);
  if (producers === undefined) return "rejected";
  const value_types = new Map(
    control_flow.values.map((value) => [value.value, value.type]),
  );
  if (
    requirement === undefined &&
    verified_target_has_impossible_dominating_branch(
      control_flow,
      target.block.id,
      ranges,
      producers,
    )
  ) {
    return "unreachable";
  }
  if (check_repetition && target_block_can_repeat(target.block.id, blocks)) {
    if (bounded_offset !== undefined) return "rejected";
    if (
      requirement !== undefined &&
      verified_repeating_call_requirement(
        control_flow,
        target,
        requirement,
        ranges,
        producers,
        value_types,
        alternative_requirement,
      )
    ) {
      return "proved";
    }
    return "rejected";
  }
  const reaches_target = blocks_reaching_target(target.block.id, blocks);
  const entry_counts = new Map<SemanticBlockId, number>();
  entry_counts.set(control_flow.entry, 1);
  const pending: VerificationState[] = [{
    block: control_flow.entry,
    predecessor: undefined,
    booleans: new Map(),
    aliases: new Map(),
    premises: [],
    visited: new Set(),
  }];
  let feasible_paths = 0;
  let steps = 0;
  while (pending.length > 0) {
    steps += 1;
    if (steps > proof_limits.compiler_search_steps) return "rejected";
    const state = pending.pop();
    expect(state !== undefined, "Semantic certificate worklist disappeared.");
    if (state.visited.has(state.block)) return "rejected";
    const visited = new Set(state.visited);
    visited.add(state.block);
    if (visited.size > proof_limits.compiler_search_depth) return "rejected";
    const block = blocks.get(state.block);
    if (block === undefined) return "rejected";
    const transferred = transfer_semantic_values(
      block,
      state.predecessor,
      state.booleans,
      state.aliases,
      state.premises,
      ranges,
      producers,
      value_types,
      target.node,
      bounded_offset,
    );
    const booleans = transferred.booleans;
    const aliases = transferred.aliases;
    const path_premises = transferred.premises;
    if (transferred.bounded_offset_rejected) return "rejected";
    let reached_call = false;
    for (const node of block.nodes) {
      steps += 1;
      if (steps > proof_limits.compiler_search_steps) return "rejected";
      if (node !== target.node) continue;
      reached_call = true;
      if (premises_are_contradictory(path_premises, ranges)) break;
      if (requirement === undefined) {
        feasible_paths += 1;
        break;
      }
      let path_is_feasible = true;
      let path_is_proved = false;
      for (const candidate of requirements) {
        const path_requirement = aliased_machine_requirement(
          candidate,
          aliases,
        );
        const path_goal_value = requirement_value(path_requirement);
        const path_goal_range = ranges.get(path_goal_value);
        if (path_goal_range === undefined) return "rejected";
        const interval = interval_from_premises(
          path_premises,
          path_goal_value,
          path_goal_range,
        );
        if (interval.contradiction) {
          path_is_feasible = false;
          break;
        }
        if (
          interval_implies_requirement(
            interval,
            path_requirement,
            path_premises,
            path_goal_value,
            path_goal_range,
            ranges,
          )
        ) {
          path_is_proved = true;
          break;
        }
      }
      if (!path_is_feasible) break;
      feasible_paths += 1;
      if (!path_is_proved) return "rejected";
      break;
    }
    if (reached_call || block.id === target.block.id) continue;
    if (block.terminator.tag !== "branch") {
      for (const successor of block.successors) {
        if (!reaches_target.has(successor)) continue;
        if (
          !enqueue_verification_state(
            pending,
            entry_counts,
            {
              block: successor,
              predecessor: block.id,
              booleans,
              aliases,
              premises: path_premises,
              visited,
            },
          )
        ) {
          return "rejected";
        }
      }
      continue;
    }
    let comparison = producers.get(block.terminator.condition);
    if (
      comparison !== undefined &&
      (comparison.outputs.length !== 1 ||
        comparison.outputs[0] !== block.terminator.condition)
    ) {
      comparison = undefined;
    }
    let known_condition = booleans.get(block.terminator.condition);
    if (known_condition === undefined && comparison !== undefined) {
      known_condition = verified_comparison_truth(
        comparison,
        ranges,
        producers,
      );
    }
    for (
      const [branch_value, successor] of [
        [true, block.terminator.when_true],
        [false, block.terminator.when_false],
      ] as const
    ) {
      if (!reaches_target.has(successor)) continue;
      if (
        known_condition !== undefined && known_condition !== branch_value
      ) {
        continue;
      }
      const premises = [...path_premises];
      if (comparison !== undefined) {
        const premise = verified_comparison_requirement(
          comparison,
          branch_value,
          ranges,
          producers,
        );
        if (premise !== undefined) {
          if (bounded_offset !== undefined) {
            premises.push(premise);
          } else {
            premises.push(aliased_machine_requirement(premise, aliases));
          }
        }
        const bitmask_premise = verified_bitmask_requirement(
          comparison,
          branch_value,
          ranges,
          producers,
          aliases,
        );
        if (bitmask_premise !== undefined) {
          if (bounded_offset !== undefined) {
            premises.push(bitmask_premise);
          } else {
            premises.push(
              aliased_machine_requirement(bitmask_premise, aliases),
            );
          }
        }
        const congruence_premise = verified_remainder_congruence_requirement(
          comparison,
          branch_value,
          ranges,
          producers,
          aliases,
        );
        if (congruence_premise !== undefined) {
          if (bounded_offset !== undefined) {
            premises.push(congruence_premise);
          } else {
            premises.push(
              aliased_machine_requirement(congruence_premise, aliases),
            );
          }
        }
      }
      if (
        !enqueue_verification_state(
          pending,
          entry_counts,
          {
            block: successor,
            predecessor: block.id,
            booleans,
            aliases,
            premises,
            visited,
          },
        )
      ) {
        return "rejected";
      }
    }
  }
  if (feasible_paths === 0) return "unreachable";
  if (requirement === undefined) return "rejected";
  return "proved";
}

function snapshot_machine_requirement(
  requirement: SemanticMachineRequirement,
): SemanticMachineRequirement {
  if (requirement.tag === "exclusion") {
    return Object.freeze({
      tag: "exclusion",
      value: requirement.value,
      expected: requirement.expected,
    });
  }
  if (requirement.tag === "bitmask") {
    return Object.freeze({
      tag: "bitmask",
      value: requirement.value,
      known_zero: requirement.known_zero,
      known_one: requirement.known_one,
    });
  }
  if (requirement.tag === "congruence") {
    return Object.freeze({
      tag: "congruence",
      value: requirement.value,
      modulus: requirement.modulus,
      residue: requirement.residue,
    });
  }
  if (requirement.tag === "difference") {
    return Object.freeze({
      tag: "difference",
      left: requirement.left,
      right: requirement.right,
      maximum: requirement.maximum,
    });
  }
  if (
    requirement.tag === "equality" ||
    requirement.tag === "disequality"
  ) {
    return Object.freeze({
      tag: requirement.tag,
      left: requirement.left,
      right: requirement.right,
    });
  }
  return Object.freeze({
    tag: "fact",
    proposition: Object.freeze({ ...requirement.proposition }),
  });
}

function same_machine_requirement(
  left: SemanticMachineRequirement,
  right: SemanticMachineRequirement,
): boolean {
  if (left.tag !== right.tag) return false;
  if (left.tag === "exclusion" && right.tag === "exclusion") {
    return left.value === right.value && left.expected === right.expected;
  }
  if (left.tag === "bitmask" && right.tag === "bitmask") {
    return left.value === right.value &&
      left.known_zero === right.known_zero &&
      left.known_one === right.known_one;
  }
  if (left.tag === "congruence" && right.tag === "congruence") {
    return left.value === right.value &&
      left.modulus === right.modulus &&
      left.residue === right.residue;
  }
  if (left.tag === "difference" && right.tag === "difference") {
    return left.left === right.left &&
      left.right === right.right &&
      left.maximum === right.maximum;
  }
  if (
    (left.tag === "equality" || left.tag === "disequality") &&
    left.tag === right.tag &&
    (right.tag === "equality" || right.tag === "disequality")
  ) {
    return left.left === right.left && left.right === right.right;
  }
  if (left.tag !== "fact" || right.tag !== "fact") return false;
  if (
    left.proposition.tag !== right.proposition.tag ||
    left.proposition.value !== right.proposition.value
  ) {
    return false;
  }
  if (
    left.proposition.tag === "equal" &&
    right.proposition.tag === "equal"
  ) {
    return left.proposition.expected === right.proposition.expected;
  }
  if (
    left.proposition.tag === "equal" ||
    right.proposition.tag === "equal"
  ) {
    return false;
  }
  return left.proposition.bound === right.proposition.bound;
}

function same_bounded_offset_requirement(
  left: SemanticBoundedOffsetRequirement,
  right: SemanticBoundedOffsetRequirement,
): boolean {
  return left.operation === right.operation &&
    left.input === right.input &&
    left.offset === right.offset &&
    left.result === right.result &&
    left.logical_result === right.logical_result &&
    same_machine_requirement(left.goal, right.goal);
}

function machine_ranges(
  control_flow: SemanticCfg,
): ReadonlyMap<ValueId, IntegerType> {
  const ranges = new Map<ValueId, IntegerType>();
  for (const value of control_flow.values) {
    let range: IntegerType | undefined;
    if (value.type.tag === "scalar") {
      range = machine_integer_type_from_name(value.type.name);
    } else if (value.type.tag === "integer") {
      range = {
        signed: value.type.signed,
        width: value.type.width,
      };
    }
    if (range === undefined || range.width > 128) continue;
    ranges.set(value.value, range);
  }
  return ranges;
}

function requirement_value(requirement: SemanticMachineRequirement): ValueId {
  if (requirement.tag === "fact") return requirement.proposition.value;
  if (
    requirement.tag === "difference" ||
    requirement.tag === "equality" ||
    requirement.tag === "disequality"
  ) {
    return requirement.left;
  }
  return requirement.value;
}

function semantic_value_producers(
  control_flow: SemanticCfg,
): ReadonlyMap<ValueId, SemanticNode> | undefined {
  const producers = new Map<ValueId, SemanticNode>();
  for (const block of control_flow.blocks) {
    for (const node of block.nodes) {
      for (const output of node.outputs) {
        if (producers.has(output)) return undefined;
        producers.set(output, node);
      }
    }
  }
  return producers;
}

function blocks_reaching_target(
  target: SemanticBlockId,
  blocks: ReadonlyMap<SemanticBlockId, SemanticBlock>,
): ReadonlySet<SemanticBlockId> {
  const reachable = new Set<SemanticBlockId>([target]);
  const pending = [target];
  while (pending.length > 0) {
    const block_id = pending.pop();
    if (block_id === undefined) break;
    const block = blocks.get(block_id);
    if (block === undefined) continue;
    for (const predecessor of block.predecessors) {
      if (reachable.has(predecessor)) continue;
      reachable.add(predecessor);
      pending.push(predecessor);
    }
  }
  return reachable;
}

function target_block_can_repeat(
  target: SemanticBlockId,
  blocks: ReadonlyMap<SemanticBlockId, SemanticBlock>,
): boolean {
  const target_block = blocks.get(target);
  if (target_block === undefined) return true;
  const visited = new Set<SemanticBlockId>();
  const pending = [...target_block.successors];
  while (pending.length > 0) {
    const block_id = pending.pop();
    if (block_id === undefined) break;
    if (block_id === target) return true;
    if (visited.has(block_id)) continue;
    visited.add(block_id);
    const block = blocks.get(block_id);
    if (block === undefined) return true;
    pending.push(...block.successors);
  }
  return false;
}

function verified_repeating_call_requirement(
  control_flow: SemanticCfg,
  target: { block: SemanticBlock; node: SemanticNode },
  requirement: SemanticMachineRequirement,
  ranges: ReadonlyMap<ValueId, IntegerType>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
  value_types: ReadonlyMap<ValueId, RepresentationType>,
  alternative_requirement?: SemanticMachineRequirement,
): boolean {
  const dominators = verified_block_dominators(control_flow);
  const target_dominators = dominators.get(target.block.id);
  if (target_dominators === undefined) return false;
  const invariant_aliases = verified_loop_invariant_aliases(
    control_flow,
    value_types,
  );
  const resolved_invariant_requirement = aliased_machine_requirement(
    requirement,
    invariant_aliases,
  );
  let resolved_invariant_alternative: SemanticMachineRequirement | undefined;
  if (alternative_requirement !== undefined) {
    resolved_invariant_alternative = aliased_machine_requirement(
      alternative_requirement,
      invariant_aliases,
    );
  }
  const requirement_values = [
    requirement_value(resolved_invariant_requirement),
  ];
  if (
    resolved_invariant_requirement.tag === "difference" ||
    resolved_invariant_requirement.tag === "equality" ||
    resolved_invariant_requirement.tag === "disequality"
  ) {
    requirement_values.push(resolved_invariant_requirement.right);
  }
  if (resolved_invariant_alternative !== undefined) {
    requirement_values.push(
      requirement_value(resolved_invariant_alternative),
    );
    if (
      resolved_invariant_alternative.tag === "difference" ||
      resolved_invariant_alternative.tag === "equality" ||
      resolved_invariant_alternative.tag === "disequality"
    ) {
      requirement_values.push(resolved_invariant_alternative.right);
    }
  }
  const blocks = new Map(
    control_flow.blocks.map((block) => [block.id, block]),
  );
  let invariant_requirement = true;
  for (const value of requirement_values) {
    const producer = producers.get(value);
    if (producer === undefined) continue;
    const producer_block = control_flow.blocks.find((block) =>
      block.nodes.includes(producer)
    );
    if (
      producer_block !== undefined &&
      target_block_can_repeat(producer_block.id, blocks)
    ) {
      invariant_requirement = false;
    }
  }
  let loop_entry: SemanticBlock | undefined;
  let loop_entry_depth = Number.POSITIVE_INFINITY;
  for (const block_id of target_dominators) {
    if (block_id === target.block.id) continue;
    const block = blocks.get(block_id);
    const block_dominators = dominators.get(block_id);
    if (
      block === undefined ||
      block.nodes.length === 0 ||
      block_dominators === undefined ||
      !target_block_can_repeat(block_id, blocks) ||
      block_dominators.size >= loop_entry_depth
    ) {
      continue;
    }
    loop_entry = block;
    loop_entry_depth = block_dominators.size;
  }
  const loop_entry_node = loop_entry?.nodes[0];
  if (
    invariant_requirement && loop_entry !== undefined &&
    loop_entry_node !== undefined &&
    verify_semantic_paths(
        control_flow,
        loop_entry_node.span,
        resolved_invariant_requirement,
        undefined,
        { block: loop_entry, node: loop_entry_node },
        resolved_invariant_alternative,
        false,
      ) === "proved"
  ) {
    return true;
  }
  const branch_premises: SemanticMachineRequirement[] = [];
  for (const block of control_flow.blocks) {
    if (block.id === target.block.id) continue;
    if (!target_dominators.has(block.id)) continue;
    if (block.terminator.tag !== "branch") continue;
    let branch_value: boolean | undefined;
    if (target_dominators.has(block.terminator.when_true)) {
      branch_value = true;
    }
    if (target_dominators.has(block.terminator.when_false)) {
      if (branch_value !== undefined) continue;
      branch_value = false;
    }
    if (branch_value === undefined) continue;
    let comparison = producers.get(block.terminator.condition);
    if (
      comparison !== undefined &&
      (comparison.outputs.length !== 1 ||
        comparison.outputs[0] !== block.terminator.condition)
    ) {
      comparison = undefined;
    }
    if (comparison === undefined) continue;
    const repeating_block = target_block_can_repeat(block.id, blocks);
    if (repeating_block) {
      if (
        comparison.operation.tag !== "primitive" ||
        !comparison.operation.name.startsWith("range-has-next:")
      ) {
        continue;
      }
      const range_requirement = verified_comparison_requirement(
        comparison,
        branch_value,
        ranges,
        producers,
      );
      if (range_requirement !== undefined) {
        branch_premises.push(
          aliased_machine_requirement(
            range_requirement,
            invariant_aliases,
          ),
        );
      }
      const range_invariant = verified_range_induction_requirement(
        comparison,
        branch_value,
        ranges,
        producers,
      );
      if (range_invariant !== undefined) {
        branch_premises.push(
          aliased_machine_requirement(
            range_invariant,
            invariant_aliases,
          ),
        );
      }
      continue;
    }
    const premise = verified_comparison_requirement(
      comparison,
      branch_value,
      ranges,
      producers,
    );
    if (premise !== undefined) {
      branch_premises.push(
        aliased_machine_requirement(premise, invariant_aliases),
      );
    }
    const range_invariant = verified_range_induction_requirement(
      comparison,
      branch_value,
      ranges,
      producers,
    );
    if (range_invariant !== undefined) {
      branch_premises.push(
        aliased_machine_requirement(range_invariant, invariant_aliases),
      );
    }
    const bitmask_premise = verified_bitmask_requirement(
      comparison,
      branch_value,
      ranges,
      producers,
      new Map(),
    );
    if (bitmask_premise !== undefined) {
      branch_premises.push(
        aliased_machine_requirement(bitmask_premise, invariant_aliases),
      );
    }
    const congruence_premise = verified_remainder_congruence_requirement(
      comparison,
      branch_value,
      ranges,
      producers,
      new Map(),
    );
    if (congruence_premise !== undefined) {
      branch_premises.push(
        aliased_machine_requirement(congruence_premise, invariant_aliases),
      );
    }
  }
  let premises: readonly SemanticMachineRequirement[] = branch_premises;
  const transferred = transfer_semantic_values(
    target.block,
    undefined,
    new Map(),
    invariant_aliases,
    premises,
    ranges,
    producers,
    value_types,
    target.node,
    undefined,
  );
  premises = transferred.premises;
  const resolved_requirement = aliased_machine_requirement(
    requirement,
    transferred.aliases,
  );
  let resolved_alternative: SemanticMachineRequirement | undefined;
  if (alternative_requirement !== undefined) {
    resolved_alternative = aliased_machine_requirement(
      alternative_requirement,
      transferred.aliases,
    );
  }
  if (premises_are_contradictory(premises, ranges)) return false;
  const goal_value = requirement_value(resolved_requirement);
  const goal_range = ranges.get(goal_value);
  if (goal_range === undefined) return false;
  const interval = interval_from_premises(
    premises,
    goal_value,
    goal_range,
  );
  if (interval.contradiction) return false;
  const requirement_holds = interval_implies_requirement(
    interval,
    resolved_requirement,
    premises,
    goal_value,
    goal_range,
    ranges,
  );
  if (requirement_holds || resolved_alternative === undefined) {
    return requirement_holds;
  }
  const alternative_value = requirement_value(resolved_alternative);
  const alternative_range = ranges.get(alternative_value);
  if (alternative_range === undefined) return false;
  const alternative_interval = interval_from_premises(
    premises,
    alternative_value,
    alternative_range,
  );
  if (alternative_interval.contradiction) return false;
  return interval_implies_requirement(
    alternative_interval,
    resolved_alternative,
    premises,
    alternative_value,
    alternative_range,
    ranges,
  );
}

function verified_loop_invariant_aliases(
  control_flow: SemanticCfg,
  value_types: ReadonlyMap<ValueId, RepresentationType>,
): ReadonlyMap<ValueId, ValueId> {
  const aliases = new Map<ValueId, ValueId>();
  let aliases_changed = true;
  while (aliases_changed) {
    aliases_changed = false;
    for (const block of control_flow.blocks) {
      for (const node of block.nodes) {
        const output = node.outputs[0];
        if (
          node.operation.tag === "primitive" &&
          node.operation.name.startsWith("bind:") &&
          node.inputs.length === 1 &&
          node.outputs.length === 1 &&
          output !== undefined &&
          !aliases.has(output) &&
          record_value_alias(node, undefined, aliases, value_types)
        ) {
          aliases_changed = true;
          continue;
        }
        if (
          node.operation.tag !== "phi" ||
          output === undefined ||
          node.operation.incoming.length === 0 ||
          aliases.has(output)
        ) {
          continue;
        }
        const output_type = value_types.get(output);
        if (output_type === undefined) continue;
        let invariant: ValueId | undefined;
        let same_value = true;
        for (const incoming of node.operation.incoming) {
          const incoming_type = value_types.get(incoming.value);
          if (
            incoming_type === undefined ||
            !same_representation_type(output_type, incoming_type)
          ) {
            same_value = false;
            break;
          }
          const resolved = resolved_alias(incoming.value, aliases);
          if (resolved === undefined) {
            same_value = false;
            break;
          }
          if (resolved === output) continue;
          if (invariant === undefined) {
            invariant = resolved;
            continue;
          }
          if (resolved !== invariant) same_value = false;
        }
        if (same_value && invariant !== undefined) {
          aliases.set(output, invariant);
          aliases_changed = true;
        }
      }
    }
  }
  return aliases;
}

function verified_target_has_impossible_dominating_branch(
  control_flow: SemanticCfg,
  target: SemanticBlockId,
  ranges: ReadonlyMap<ValueId, IntegerType>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
): boolean {
  const target_dominators = verified_block_dominators(control_flow).get(
    target,
  );
  if (target_dominators === undefined) return false;
  for (const block of control_flow.blocks) {
    if (block.terminator.tag !== "branch") continue;
    const condition = producers.get(block.terminator.condition);
    if (condition === undefined) continue;
    let truth: boolean | undefined;
    if (
      condition.operation.tag === "constant" &&
      typeof condition.operation.value === "boolean"
    ) {
      truth = condition.operation.value;
    } else {
      truth = verified_comparison_truth(condition, ranges, producers);
    }
    if (truth === undefined) continue;
    let possible = block.terminator.when_false;
    if (truth) possible = block.terminator.when_true;
    if (possible === block.id) continue;
    let impossible = block.terminator.when_true;
    if (truth) impossible = block.terminator.when_false;
    const impossible_block = control_flow.blocks.find((candidate) =>
      candidate.id === impossible
    );
    if (
      impossible_block?.predecessors.length === 1 &&
      impossible_block.predecessors[0] === block.id &&
      target_dominators.has(impossible)
    ) {
      return true;
    }
  }
  return false;
}

function verified_block_dominators(
  control_flow: SemanticCfg,
): ReadonlyMap<SemanticBlockId, ReadonlySet<SemanticBlockId>> {
  const block_ids = new Set(control_flow.blocks.map((block) => block.id));
  const dominators = new Map<SemanticBlockId, Set<SemanticBlockId>>();
  for (const block of control_flow.blocks) {
    if (block.id === control_flow.entry) {
      dominators.set(block.id, new Set([block.id]));
    } else {
      dominators.set(block.id, new Set(block_ids));
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const block of control_flow.blocks) {
      if (block.id === control_flow.entry) continue;
      let intersection = new Set(block_ids);
      if (block.predecessors.length === 0) intersection = new Set();
      for (const predecessor of block.predecessors) {
        const predecessor_dominators = dominators.get(predecessor);
        if (predecessor_dominators === undefined) return new Map();
        intersection = new Set(
          [...intersection].filter((candidate) =>
            predecessor_dominators.has(candidate)
          ),
        );
      }
      intersection.add(block.id);
      const previous = dominators.get(block.id);
      if (previous === undefined) return new Map();
      if (
        previous.size === intersection.size &&
        [...previous].every((candidate) => intersection.has(candidate))
      ) {
        continue;
      }
      dominators.set(block.id, intersection);
      changed = true;
    }
  }
  return dominators;
}

function enqueue_verification_state(
  pending: VerificationState[],
  entry_counts: Map<SemanticBlockId, number>,
  state: VerificationState,
): boolean {
  let count = 1;
  const previous = entry_counts.get(state.block);
  if (previous !== undefined) count = previous + 1;
  if (count > proof_limits.maximum_formula_disjuncts) return false;
  entry_counts.set(state.block, count);
  pending.push(state);
  return true;
}

function transfer_semantic_values(
  block: SemanticBlock,
  predecessor: SemanticBlockId | undefined,
  current: ReadonlyMap<ValueId, boolean>,
  current_aliases: ReadonlyMap<ValueId, ValueId>,
  current_premises: readonly SemanticMachineRequirement[],
  ranges: ReadonlyMap<ValueId, IntegerType>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
  value_types: ReadonlyMap<ValueId, RepresentationType>,
  target: SemanticNode,
  bounded_offset: SemanticBoundedOffsetRequirement | undefined,
): {
  booleans: ReadonlyMap<ValueId, boolean>;
  aliases: ReadonlyMap<ValueId, ValueId>;
  premises: readonly SemanticMachineRequirement[];
  bounded_offset_rejected: boolean;
} {
  const booleans = new Map(current);
  const aliases = new Map(current_aliases);
  const premises = [...current_premises];
  let bounded_offset_rejected = false;
  for (const node of block.nodes) {
    if (node === target) break;
    const output = node.outputs[0];
    if (output === undefined) continue;
    if (
      node.operation.tag === "constant" &&
      typeof node.operation.value === "boolean"
    ) {
      booleans.set(output, node.operation.value);
      continue;
    }
    if (node.operation.tag === "constant") {
      const range = ranges.get(output);
      const constant = verified_integer_constant(output, producers);
      if (range !== undefined && constant !== undefined) {
        premises.push({
          tag: "fact",
          proposition: {
            tag: "equal",
            value: output,
            expected: normalize_integer(range, constant),
          },
        });
      }
      continue;
    }
    if (
      bounded_offset !== undefined &&
      node === producers.get(bounded_offset.result)
    ) {
      const offset_premises = verified_bounded_offset_premises(
        bounded_offset,
        premises,
        aliases,
        ranges,
        producers,
      );
      if (offset_premises !== undefined) {
        premises.push(...offset_premises);
      } else {
        bounded_offset_rejected = true;
      }
      continue;
    }
    if (
      node.operation.tag === "primitive" &&
      node.operation.name.startsWith("bind:") &&
      record_value_alias(node, predecessor, aliases, value_types)
    ) {
      continue;
    }
    if (node.operation.tag !== "phi" || predecessor === undefined) continue;
    const incoming = node.operation.incoming.find((candidate) =>
      candidate.predecessor === predecessor
    );
    if (incoming === undefined) continue;
    const value = booleans.get(incoming.value);
    if (value !== undefined) booleans.set(output, value);
    const incoming_value = resolved_alias(incoming.value, aliases);
    if (incoming_value !== undefined) aliases.set(output, incoming_value);
  }
  return { booleans, aliases, premises, bounded_offset_rejected };
}

function verified_bounded_offset_premises(
  requirement: SemanticBoundedOffsetRequirement,
  premises: readonly SemanticMachineRequirement[],
  aliases: ReadonlyMap<ValueId, ValueId>,
  ranges: ReadonlyMap<ValueId, IntegerType>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
): readonly SemanticMachineRequirement[] | undefined {
  if (
    resolved_alias(requirement.input, aliases) !== requirement.input ||
    !premises.some((premise) =>
      requirement_value(premise) === requirement.input
    )
  ) {
    return undefined;
  }
  const input_range = ranges.get(requirement.input);
  const result_range = ranges.get(requirement.result);
  const offset_range = ranges.get(requirement.offset);
  if (
    input_range === undefined || result_range === undefined ||
    offset_range === undefined ||
    !same_integer_type(input_range, result_range) ||
    !same_integer_type(input_range, offset_range)
  ) {
    return undefined;
  }
  const interval = interval_from_premises(
    premises,
    requirement.input,
    input_range,
  );
  if (interval.contradiction) return undefined;
  const offset = verified_integer_constant(requirement.offset, producers);
  if (
    offset === undefined ||
    normalize_integer(offset_range, offset) !== offset
  ) {
    return undefined;
  }
  let minimum = interval.minimum + offset;
  let maximum = interval.maximum + offset;
  if (requirement.operation === "subtract") {
    minimum = interval.minimum - offset;
    maximum = interval.maximum - offset;
  }
  const range_minimum = integer_minimum(result_range);
  const range_maximum = integer_maximum(result_range);
  if (minimum < range_minimum || maximum > range_maximum) return undefined;
  const transferred: SemanticMachineRequirement[] = [];
  if (minimum === maximum) {
    transferred.push({
      tag: "fact",
      proposition: {
        tag: "equal",
        value: requirement.result,
        expected: minimum,
      },
    });
  } else {
    transferred.push({
      tag: "fact",
      proposition: {
        tag: "greater_equal",
        value: requirement.result,
        bound: minimum,
      },
    });
    transferred.push({
      tag: "fact",
      proposition: {
        tag: "less_equal",
        value: requirement.result,
        bound: maximum,
      },
    });
  }
  let difference = offset;
  if (requirement.operation === "subtract") difference = -offset;
  transferred.push({
    tag: "difference",
    left: requirement.result,
    right: requirement.input,
    maximum: difference,
  });
  transferred.push({
    tag: "difference",
    left: requirement.input,
    right: requirement.result,
    maximum: -difference,
  });
  return transferred;
}

function record_value_alias(
  node: SemanticNode,
  predecessor: SemanticBlockId | undefined,
  aliases: Map<ValueId, ValueId>,
  value_types: ReadonlyMap<ValueId, RepresentationType>,
): boolean {
  const output = node.outputs[0];
  if (output === undefined) return false;
  if (
    node.operation.tag === "primitive" &&
    node.operation.name.startsWith("bind:") &&
    node.inputs.length === 1
  ) {
    const input = node.inputs[0];
    expect(input !== undefined, "Semantic binding alias lost its input.");
    const input_type = value_types.get(input);
    const output_type = value_types.get(output);
    if (
      input_type === undefined || output_type === undefined ||
      !same_representation_type(input_type, output_type)
    ) {
      return false;
    }
    const value = resolved_alias(input, aliases);
    if (value === undefined) return false;
    aliases.set(output, value);
    return true;
  }
  if (node.operation.tag !== "phi" || predecessor === undefined) return false;
  const incoming = node.operation.incoming.find((candidate) =>
    candidate.predecessor === predecessor
  );
  if (incoming === undefined) return false;
  const input_type = value_types.get(incoming.value);
  const output_type = value_types.get(output);
  if (
    input_type === undefined || output_type === undefined ||
    !same_representation_type(input_type, output_type)
  ) {
    return false;
  }
  const value = resolved_alias(incoming.value, aliases);
  if (value === undefined) return false;
  aliases.set(output, value);
  return true;
}

function aliased_machine_requirement(
  requirement: SemanticMachineRequirement,
  aliases: ReadonlyMap<ValueId, ValueId>,
): SemanticMachineRequirement {
  if (
    requirement.tag === "difference" ||
    requirement.tag === "equality" ||
    requirement.tag === "disequality"
  ) {
    const left = resolved_alias(requirement.left, aliases);
    const right = resolved_alias(requirement.right, aliases);
    if (left === undefined || right === undefined) return requirement;
    if (left === requirement.left && right === requirement.right) {
      return requirement;
    }
    if (
      requirement.tag === "equality" ||
      requirement.tag === "disequality"
    ) {
      return {
        tag: requirement.tag,
        left,
        right,
      };
    }
    return {
      tag: "difference",
      left,
      right,
      maximum: requirement.maximum,
    };
  }
  const value = requirement_value(requirement);
  const resolved = resolved_alias(value, aliases);
  if (resolved === undefined || resolved === value) return requirement;
  if (requirement.tag === "exclusion") {
    return {
      tag: "exclusion",
      value: resolved,
      expected: requirement.expected,
    };
  }
  if (requirement.tag === "bitmask") {
    return {
      tag: "bitmask",
      value: resolved,
      known_zero: requirement.known_zero,
      known_one: requirement.known_one,
    };
  }
  if (requirement.tag === "congruence") {
    return {
      tag: "congruence",
      value: resolved,
      modulus: requirement.modulus,
      residue: requirement.residue,
    };
  }
  return {
    tag: "fact",
    proposition: {
      ...requirement.proposition,
      value: resolved,
    },
  };
}

function resolved_alias(
  value: ValueId,
  aliases: ReadonlyMap<ValueId, ValueId>,
): ValueId | undefined {
  const visited = new Set<ValueId>();
  let current = value;
  while (aliases.has(current)) {
    if (visited.has(current)) return undefined;
    visited.add(current);
    const next = aliases.get(current);
    if (next === undefined) return undefined;
    current = next;
  }
  return current;
}

function verified_comparison_requirement(
  comparison: SemanticNode,
  branch_value: boolean,
  ranges: ReadonlyMap<ValueId, IntegerType>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
): SemanticMachineRequirement | undefined {
  if (comparison.operation.tag !== "primitive") {
    return undefined;
  }
  if (comparison.operation.name.startsWith("range-has-next:")) {
    return verified_range_requirement(
      comparison,
      branch_value,
      ranges,
      producers,
    );
  }
  if (comparison.inputs.length !== 2) return undefined;
  const left = comparison.inputs[0];
  const right = comparison.inputs[1];
  if (left === undefined || right === undefined) return undefined;
  const left_range = ranges.get(left);
  const right_range = ranges.get(right);
  if (
    left_range === undefined || right_range === undefined ||
    !same_integer_type(left_range, right_range) ||
    !comparison_primitive_matches_integer_type(
      comparison.operation.name,
      left_range,
    )
  ) {
    return undefined;
  }
  let relation:
    | "equal"
    | "not_equal"
    | "less"
    | "less_equal";
  let expected_left = left;
  let expected_right = right;
  const primitive = comparison.operation.name;
  if (primitive.endsWith(".eq")) {
    relation = "not_equal";
    if (branch_value) relation = "equal";
  } else if (primitive.endsWith(".ne")) {
    relation = "equal";
    if (branch_value) relation = "not_equal";
  } else if (
    primitive.endsWith(".lt_s") || primitive.endsWith(".lt_u")
  ) {
    relation = "less";
    if (!branch_value) {
      relation = "less_equal";
      expected_left = right;
      expected_right = left;
    }
  } else if (
    primitive.endsWith(".le_s") || primitive.endsWith(".le_u")
  ) {
    relation = "less_equal";
    if (!branch_value) {
      relation = "less";
      expected_left = right;
      expected_right = left;
    }
  } else if (
    primitive.endsWith(".gt_s") || primitive.endsWith(".gt_u")
  ) {
    relation = "less_equal";
    if (branch_value) {
      relation = "less";
      expected_left = right;
      expected_right = left;
    }
  } else if (
    primitive.endsWith(".ge_s") || primitive.endsWith(".ge_u")
  ) {
    relation = "less";
    if (branch_value) {
      relation = "less_equal";
      expected_left = right;
      expected_right = left;
    }
  } else {
    return undefined;
  }
  const constant_requirement = verified_constant_comparison(
    relation,
    expected_left,
    expected_right,
    ranges,
    producers,
  );
  if (constant_requirement !== undefined) return constant_requirement;
  if (relation === "equal" || relation === "not_equal") {
    let tag: "equality" | "disequality" = "disequality";
    if (relation === "equal") tag = "equality";
    return {
      tag,
      left: expected_left,
      right: expected_right,
    };
  }
  if (relation !== "less" && relation !== "less_equal") return undefined;
  let maximum = 0n;
  if (relation === "less") maximum = -1n;
  return {
    tag: "difference",
    left: expected_left,
    right: expected_right,
    maximum,
  };
}

function verified_bitmask_requirement(
  comparison: SemanticNode,
  branch_value: boolean,
  ranges: ReadonlyMap<ValueId, IntegerType>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
  aliases: ReadonlyMap<ValueId, ValueId>,
): SemanticMachineRequirement | undefined {
  const equality = verified_comparison_requirement(
    comparison,
    branch_value,
    ranges,
    producers,
  );
  if (
    equality?.tag !== "fact" ||
    equality.proposition.tag !== "equal"
  ) {
    return undefined;
  }
  const result = resolved_alias(equality.proposition.value, aliases);
  if (result === undefined) return undefined;
  const operation = producers.get(result);
  if (
    operation?.operation.tag !== "primitive" ||
    operation.inputs.length !== 2 ||
    operation.outputs.length !== 1 ||
    operation.outputs[0] !== result
  ) {
    return undefined;
  }
  const result_range = ranges.get(result);
  let val_type: "i32" | "i64" | undefined;
  if (result_range !== undefined) {
    val_type = integer_val_type(result_range);
  }
  if (result_range === undefined || val_type === undefined) return undefined;
  let bitwise: "and" | "or" | "xor";
  if (operation.operation.name === val_type + ".and") {
    bitwise = "and";
  } else if (operation.operation.name === val_type + ".or") {
    bitwise = "or";
  } else if (operation.operation.name === val_type + ".xor") {
    bitwise = "xor";
  } else {
    return undefined;
  }
  const left = operation.inputs[0];
  const right = operation.inputs[1];
  if (left === undefined || right === undefined) return undefined;
  const left_range = ranges.get(left);
  const right_range = ranges.get(right);
  if (
    left_range === undefined || right_range === undefined ||
    !same_integer_type(left_range, result_range) ||
    !same_integer_type(right_range, result_range)
  ) {
    return undefined;
  }
  const left_constant = verified_integer_constant(left, producers);
  const right_constant = verified_integer_constant(right, producers);
  let value: ValueId;
  let mask: bigint;
  if (right_constant !== undefined) {
    value = left;
    mask = normalize_integer(right_range, right_constant);
  } else if (left_constant !== undefined) {
    value = right;
    mask = normalize_integer(left_range, left_constant);
  } else {
    return undefined;
  }
  const modulus = 1n << BigInt(result_range.width);
  const width_mask = modulus - 1n;
  let mask_bits = mask;
  if (mask_bits < 0n) mask_bits += modulus;
  const expected = normalize_integer(
    result_range,
    equality.proposition.expected,
  );
  let expected_bits = expected;
  if (expected_bits < 0n) expected_bits += modulus;
  let known_zero: bigint;
  let known_one: bigint;
  if (bitwise === "and") {
    if ((expected_bits & (width_mask ^ mask_bits)) !== 0n) {
      return {
        tag: "bitmask",
        value,
        known_zero: 1n,
        known_one: 1n,
      };
    }
    known_one = expected_bits;
    known_zero = mask_bits ^ expected_bits;
  } else if (bitwise === "or") {
    if ((mask_bits & expected_bits) !== mask_bits) {
      return {
        tag: "bitmask",
        value,
        known_zero: 1n,
        known_one: 1n,
      };
    }
    const variable_bits = width_mask ^ mask_bits;
    known_one = expected_bits & variable_bits;
    known_zero = variable_bits ^ known_one;
  } else {
    known_one = expected_bits ^ mask_bits;
    known_zero = width_mask ^ known_one;
  }
  return {
    tag: "bitmask",
    value,
    known_zero,
    known_one,
  };
}

function verified_remainder_congruence_requirement(
  comparison: SemanticNode,
  branch_value: boolean,
  ranges: ReadonlyMap<ValueId, IntegerType>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
  aliases: ReadonlyMap<ValueId, ValueId>,
): SemanticMachineRequirement | undefined {
  const equality = verified_comparison_requirement(
    comparison,
    branch_value,
    ranges,
    producers,
  );
  if (
    equality?.tag !== "fact" ||
    equality.proposition.tag !== "equal"
  ) {
    return undefined;
  }
  const remainder = resolved_alias(equality.proposition.value, aliases);
  if (remainder === undefined) return undefined;
  const operation = producers.get(remainder);
  if (
    operation?.operation.tag !== "primitive" ||
    operation.inputs.length !== 2 ||
    operation.outputs.length !== 1 ||
    operation.outputs[0] !== remainder
  ) {
    return undefined;
  }
  const dividend = operation.inputs[0];
  const divisor_value = operation.inputs[1];
  if (dividend === undefined || divisor_value === undefined) return undefined;
  const dividend_range = ranges.get(dividend);
  const divisor_range = ranges.get(divisor_value);
  const remainder_range = ranges.get(remainder);
  if (
    dividend_range === undefined || divisor_range === undefined ||
    remainder_range === undefined ||
    !same_integer_type(dividend_range, divisor_range) ||
    !same_integer_type(dividend_range, remainder_range)
  ) {
    return undefined;
  }
  const val_type = integer_val_type(dividend_range);
  if (val_type === undefined) return undefined;
  let primitive = val_type + ".rem_u";
  if (dividend_range.signed) primitive = val_type + ".rem_s";
  if (operation.operation.name !== primitive) return undefined;
  const produced_divisor = verified_integer_constant(
    divisor_value,
    producers,
  );
  if (produced_divisor === undefined) return undefined;
  let divisor = normalize_integer(divisor_range, produced_divisor);
  if (divisor === 0n) return undefined;
  if (divisor < 0n) divisor = -divisor;
  return {
    tag: "congruence",
    value: dividend,
    modulus: divisor,
    residue: canonical_verified_residue(
      equality.proposition.expected,
      divisor,
    ),
  };
}

function verified_range_requirement(
  comparison: SemanticNode,
  branch_value: boolean,
  ranges: ReadonlyMap<ValueId, IntegerType>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
): SemanticMachineRequirement | undefined {
  if (comparison.operation.tag !== "primitive") return undefined;
  if (comparison.inputs.length !== 3) return undefined;
  const current = comparison.inputs[0];
  const end = comparison.inputs[1];
  const step = comparison.inputs[2];
  if (current === undefined || end === undefined || step === undefined) {
    return undefined;
  }
  const current_range = ranges.get(current);
  const end_range = ranges.get(end);
  const step_range = ranges.get(step);
  if (
    current_range === undefined || end_range === undefined ||
    step_range === undefined || !current_range.signed ||
    current_range.width !== 32 ||
    !same_integer_type(current_range, end_range) ||
    !same_integer_type(current_range, step_range)
  ) {
    return undefined;
  }
  const end_constant = verified_integer_constant(end, producers);
  const step_constant = verified_integer_constant(step, producers);
  if (end_constant === undefined || step_constant === undefined) {
    return undefined;
  }
  const normalized_end = normalize_integer(end_range, end_constant);
  const normalized_step = normalize_integer(step_range, step_constant);
  if (normalized_step === 0n) return undefined;
  const inclusive = comparison.operation.name ===
    "range-has-next:inclusive";
  const exclusive = comparison.operation.name ===
    "range-has-next:exclusive";
  if (!inclusive && !exclusive) return undefined;
  if (normalized_step > 0n) {
    if (branch_value && inclusive) {
      return verified_value_constant_requirement(
        "less_equal",
        current,
        normalized_end,
        false,
      );
    }
    if (branch_value && exclusive) {
      return verified_value_constant_requirement(
        "less",
        current,
        normalized_end,
        false,
      );
    }
    if (inclusive) {
      return verified_value_constant_requirement(
        "less",
        current,
        normalized_end,
        true,
      );
    }
    return verified_value_constant_requirement(
      "less_equal",
      current,
      normalized_end,
      true,
    );
  }
  if (branch_value && inclusive) {
    return verified_value_constant_requirement(
      "less_equal",
      current,
      normalized_end,
      true,
    );
  }
  if (branch_value && exclusive) {
    return verified_value_constant_requirement(
      "less",
      current,
      normalized_end,
      true,
    );
  }
  if (inclusive) {
    return verified_value_constant_requirement(
      "less",
      current,
      normalized_end,
      false,
    );
  }
  return verified_value_constant_requirement(
    "less_equal",
    current,
    normalized_end,
    false,
  );
}

function verified_range_induction_requirement(
  comparison: SemanticNode,
  branch_value: boolean,
  ranges: ReadonlyMap<ValueId, IntegerType>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
): SemanticMachineRequirement | undefined {
  if (
    !branch_value ||
    comparison.operation.tag !== "primitive" ||
    !comparison.operation.name.startsWith("range-has-next:") ||
    comparison.inputs.length !== 3
  ) {
    return undefined;
  }
  const current = comparison.inputs[0];
  const end = comparison.inputs[1];
  const step = comparison.inputs[2];
  if (current === undefined || end === undefined || step === undefined) {
    return undefined;
  }
  const range = ranges.get(current);
  const end_range = ranges.get(end);
  const step_range = ranges.get(step);
  if (
    range === undefined || end_range === undefined ||
    step_range === undefined || !range.signed || range.width !== 32 ||
    !same_integer_type(range, end_range) ||
    !same_integer_type(range, step_range)
  ) {
    return undefined;
  }
  const phi = producers.get(current);
  if (
    phi?.operation.tag !== "phi" ||
    phi.outputs.length !== 1 ||
    phi.outputs[0] !== current ||
    phi.operation.incoming.length !== 2
  ) {
    return undefined;
  }
  let start_value: ValueId | undefined;
  let next_value: ValueId | undefined;
  for (const incoming of phi.operation.incoming) {
    const producer = producers.get(incoming.value);
    if (
      producer?.operation.tag === "primitive" &&
      producer.operation.name === "range-next"
    ) {
      if (next_value !== undefined) return undefined;
      next_value = incoming.value;
      continue;
    }
    if (verified_integer_constant(incoming.value, producers) !== undefined) {
      if (start_value !== undefined) return undefined;
      start_value = incoming.value;
    }
  }
  if (start_value === undefined || next_value === undefined) return undefined;
  const next = producers.get(next_value);
  if (
    next?.operation.tag !== "primitive" ||
    next.operation.name !== "range-next" ||
    next.inputs.length !== 2 ||
    next.inputs[0] !== current ||
    next.inputs[1] !== step ||
    next.outputs.length !== 1 ||
    next.outputs[0] !== next_value
  ) {
    return undefined;
  }
  const start_constant = verified_integer_constant(start_value, producers);
  const end_constant = verified_integer_constant(end, producers);
  const step_constant = verified_integer_constant(step, producers);
  if (
    start_constant === undefined || end_constant === undefined ||
    step_constant === undefined
  ) {
    return undefined;
  }
  const start = normalize_integer(range, start_constant);
  const range_end = normalize_integer(range, end_constant);
  const range_step = normalize_integer(range, step_constant);
  if (range_step === 0n) return undefined;
  const inclusive = comparison.operation.name ===
    "range-has-next:inclusive";
  const exclusive = comparison.operation.name ===
    "range-has-next:exclusive";
  if (!inclusive && !exclusive) return undefined;
  if (range_step > 0n) {
    let maximum_body_value = range_end;
    if (exclusive) maximum_body_value -= 1n;
    if (maximum_body_value > integer_maximum(range) - range_step) {
      return undefined;
    }
    return {
      tag: "fact",
      proposition: {
        tag: "greater_equal",
        value: current,
        bound: start,
      },
    };
  }
  let minimum_body_value = range_end;
  if (exclusive) minimum_body_value += 1n;
  if (minimum_body_value < integer_minimum(range) - range_step) {
    return undefined;
  }
  return {
    tag: "fact",
    proposition: {
      tag: "less_equal",
      value: current,
      bound: start,
    },
  };
}

function verified_comparison_truth(
  comparison: SemanticNode,
  ranges: ReadonlyMap<ValueId, IntegerType>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
): boolean | undefined {
  if (
    comparison.operation.tag === "primitive" &&
    comparison.operation.name.startsWith("range-has-next:") &&
    comparison.inputs.length === 3
  ) {
    const current = comparison.inputs[0];
    const end = comparison.inputs[1];
    const step = comparison.inputs[2];
    if (current === undefined || end === undefined || step === undefined) {
      return undefined;
    }
    const current_producer = producers.get(current);
    if (current_producer?.operation.tag !== "phi") return undefined;
    let start: bigint | undefined;
    for (const incoming of current_producer.operation.incoming) {
      const candidate = verified_integer_constant(
        incoming.value,
        producers,
      );
      if (candidate !== undefined) {
        start = candidate;
        break;
      }
    }
    const end_constant = verified_integer_constant(end, producers);
    const step_constant = verified_integer_constant(step, producers);
    const range = ranges.get(current);
    if (
      start === undefined || end_constant === undefined ||
      step_constant === undefined || range === undefined
    ) {
      return undefined;
    }
    const normalized_start = normalize_integer(range, start);
    const normalized_end = normalize_integer(range, end_constant);
    const normalized_step = normalize_integer(range, step_constant);
    const inclusive = comparison.operation.name.endsWith(":inclusive");
    if (normalized_step > 0n) {
      if (inclusive) return normalized_start <= normalized_end;
      return normalized_start < normalized_end;
    }
    if (normalized_step < 0n) {
      if (inclusive) return normalized_start >= normalized_end;
      return normalized_start > normalized_end;
    }
    return false;
  }
  if (
    comparison.operation.tag !== "primitive" ||
    comparison.inputs.length !== 2
  ) {
    return undefined;
  }
  const left = comparison.inputs[0];
  const right = comparison.inputs[1];
  if (left === undefined || right === undefined) return undefined;
  const left_constant = verified_integer_constant(left, producers);
  const right_constant = verified_integer_constant(right, producers);
  const left_range = ranges.get(left);
  const right_range = ranges.get(right);
  if (
    left_constant === undefined || right_constant === undefined ||
    left_range === undefined || right_range === undefined ||
    !same_integer_type(left_range, right_range) ||
    !comparison_primitive_matches_integer_type(
      comparison.operation.name,
      left_range,
    )
  ) {
    return undefined;
  }
  const primitive = comparison.operation.name;
  const normalized_left = normalize_integer(left_range, left_constant);
  const normalized_right = normalize_integer(right_range, right_constant);
  if (primitive.endsWith(".eq")) return normalized_left === normalized_right;
  if (primitive.endsWith(".ne")) return normalized_left !== normalized_right;
  if (
    primitive.endsWith(".lt_s") || primitive.endsWith(".lt_u")
  ) {
    return normalized_left < normalized_right;
  }
  if (
    primitive.endsWith(".le_s") || primitive.endsWith(".le_u")
  ) {
    return normalized_left <= normalized_right;
  }
  if (
    primitive.endsWith(".gt_s") || primitive.endsWith(".gt_u")
  ) {
    return normalized_left > normalized_right;
  }
  if (
    primitive.endsWith(".ge_s") || primitive.endsWith(".ge_u")
  ) {
    return normalized_left >= normalized_right;
  }
  return undefined;
}

function verified_constant_comparison(
  relation: "equal" | "not_equal" | "less" | "less_equal",
  left: ValueId,
  right: ValueId,
  ranges: ReadonlyMap<ValueId, IntegerType>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
): SemanticMachineRequirement | undefined {
  const left_constant = verified_integer_constant(left, producers);
  const right_constant = verified_integer_constant(right, producers);
  const left_range = ranges.get(left);
  const right_range = ranges.get(right);
  if (
    right_constant !== undefined && left_range !== undefined &&
    right_range !== undefined && same_integer_type(left_range, right_range)
  ) {
    return verified_value_constant_requirement(
      relation,
      left,
      normalize_integer(right_range, right_constant),
      false,
    );
  }
  if (
    left_constant !== undefined && right_range !== undefined &&
    left_range !== undefined && same_integer_type(left_range, right_range)
  ) {
    return verified_value_constant_requirement(
      relation,
      right,
      normalize_integer(left_range, left_constant),
      true,
    );
  }
  return undefined;
}

function verified_integer_constant(
  value: ValueId,
  producers: ReadonlyMap<ValueId, SemanticNode>,
): bigint | undefined {
  const producer = producers.get(value);
  if (
    producer?.operation.tag !== "constant" ||
    producer.outputs.length !== 1 ||
    producer.outputs[0] !== value
  ) {
    return undefined;
  }
  const constant = producer.operation.value;
  if (typeof constant === "bigint") return constant;
  if (typeof constant !== "number" || !Number.isSafeInteger(constant)) {
    return undefined;
  }
  return BigInt(constant);
}

function same_integer_type(left: IntegerType, right: IntegerType): boolean {
  return left.signed === right.signed && left.width === right.width;
}

function comparison_primitive_matches_integer_type(
  primitive: string,
  type: IntegerType,
): boolean {
  const val_type = integer_val_type(type);
  if (val_type === undefined || !primitive.startsWith(val_type + ".")) {
    return false;
  }
  const operation = primitive.slice(val_type.length + 1);
  if (operation === "eq" || operation === "ne") return true;
  if (
    operation === "lt_s" || operation === "le_s" ||
    operation === "gt_s" || operation === "ge_s"
  ) {
    return type.signed;
  }
  if (
    operation === "lt_u" || operation === "le_u" ||
    operation === "gt_u" || operation === "ge_u"
  ) {
    return !type.signed;
  }
  return false;
}

function verified_value_constant_requirement(
  relation: "equal" | "not_equal" | "less" | "less_equal",
  value: ValueId,
  expected: bigint,
  constant_is_left: boolean,
): SemanticMachineRequirement {
  if (relation === "equal") {
    return {
      tag: "fact",
      proposition: { tag: "equal", value, expected },
    };
  }
  if (relation === "not_equal") {
    return { tag: "exclusion", value, expected };
  }
  if (relation === "less") {
    if (constant_is_left) {
      return {
        tag: "fact",
        proposition: { tag: "greater_than", value, bound: expected },
      };
    }
    return {
      tag: "fact",
      proposition: { tag: "less_than", value, bound: expected },
    };
  }
  if (constant_is_left) {
    return {
      tag: "fact",
      proposition: { tag: "greater_equal", value, bound: expected },
    };
  }
  return {
    tag: "fact",
    proposition: { tag: "less_equal", value, bound: expected },
  };
}

function interval_from_premises(
  premises: readonly SemanticMachineRequirement[],
  value: ValueId,
  range: IntegerType,
): IntervalState {
  let minimum = integer_minimum(range);
  let maximum = integer_maximum(range);
  const exclusions = new Set<bigint>();
  for (const premise of premises) {
    if (requirement_value(premise) !== value) continue;
    if (
      premise.tag === "difference" ||
      premise.tag === "equality" ||
      premise.tag === "disequality"
    ) {
      continue;
    }
    if (premise.tag === "exclusion") {
      exclusions.add(premise.expected);
      continue;
    }
    if (premise.tag === "bitmask" || premise.tag === "congruence") continue;
    const proposition = premise.proposition;
    if (proposition.tag === "equal") {
      if (proposition.expected > minimum) minimum = proposition.expected;
      if (proposition.expected < maximum) maximum = proposition.expected;
      continue;
    }
    if (proposition.tag === "less_than") {
      const bound = proposition.bound - 1n;
      if (bound < maximum) maximum = bound;
      continue;
    }
    if (proposition.tag === "less_equal") {
      if (proposition.bound < maximum) maximum = proposition.bound;
      continue;
    }
    if (proposition.tag === "greater_than") {
      const bound = proposition.bound + 1n;
      if (bound > minimum) minimum = bound;
      continue;
    }
    if (proposition.bound > minimum) minimum = proposition.bound;
  }
  let contradiction = minimum > maximum;
  while (!contradiction && exclusions.has(minimum)) {
    minimum += 1n;
    contradiction = minimum > maximum;
  }
  while (!contradiction && exclusions.has(maximum)) {
    maximum -= 1n;
    contradiction = minimum > maximum;
  }
  if (!contradiction && minimum === maximum && exclusions.has(minimum)) {
    contradiction = true;
  }
  if (!contradiction) {
    const size = maximum - minimum + 1n;
    if (
      size > 0n &&
      size <= BigInt(proof_limits.maximum_exclusions_per_value + 1)
    ) {
      let remaining: bigint | undefined;
      for (let candidate = minimum; candidate <= maximum; candidate += 1n) {
        if (exclusions.has(candidate)) continue;
        if (remaining !== undefined) {
          remaining = undefined;
          break;
        }
        remaining = candidate;
      }
      if (remaining !== undefined) {
        minimum = remaining;
        maximum = remaining;
      } else {
        let exhausted = true;
        for (let candidate = minimum; candidate <= maximum; candidate += 1n) {
          if (!exclusions.has(candidate)) {
            exhausted = false;
            break;
          }
        }
        if (exhausted) contradiction = true;
      }
    }
  }
  return { minimum, maximum, exclusions, contradiction };
}

function bitmask_from_premises(
  premises: readonly SemanticMachineRequirement[],
  value: ValueId,
  range: IntegerType,
): VerifiedBitmaskState {
  const width_mask = (1n << BigInt(range.width)) - 1n;
  let known_zero = 0n;
  let known_one = 0n;
  let malformed = false;
  for (const premise of premises) {
    if (premise.tag !== "bitmask" || premise.value !== value) continue;
    if (
      premise.known_zero < 0n || premise.known_one < 0n ||
      premise.known_zero > width_mask || premise.known_one > width_mask
    ) {
      malformed = true;
      continue;
    }
    known_zero |= premise.known_zero;
    known_one |= premise.known_one;
  }
  return { known_zero, known_one, malformed };
}

function congruence_from_premises(
  premises: readonly SemanticMachineRequirement[],
  value: ValueId,
): {
  congruence: VerifiedCongruence | undefined;
  contradiction: boolean;
  malformed: boolean;
} {
  let congruence: VerifiedCongruence | undefined;
  for (const premise of premises) {
    if (premise.tag !== "congruence" || premise.value !== value) continue;
    if (
      premise.modulus <= 0n ||
      premise.residue < 0n ||
      premise.residue >= premise.modulus
    ) {
      return {
        congruence: undefined,
        contradiction: false,
        malformed: true,
      };
    }
    const next = {
      modulus: premise.modulus,
      residue: premise.residue,
    };
    if (congruence === undefined) {
      congruence = next;
      continue;
    }
    const combined = combine_verified_congruences(congruence, next);
    if (combined === undefined) {
      return { congruence, contradiction: true, malformed: false };
    }
    congruence = combined;
  }
  return { congruence, contradiction: false, malformed: false };
}

function verified_value_matches_bitmask(
  value: bigint,
  bitmask: VerifiedBitmaskState,
  range: IntegerType,
): boolean {
  const normalized = normalize_integer(range, value);
  let bits = normalized;
  if (bits < 0n) bits += 1n << BigInt(range.width);
  return (bits & bitmask.known_zero) === 0n &&
    (bits & bitmask.known_one) === bitmask.known_one;
}

function verified_difference_closure(
  premises: readonly SemanticMachineRequirement[],
  ranges: ReadonlyMap<ValueId, IntegerType>,
  additional_values: readonly ValueId[],
): {
  bounds: ReadonlyMap<
    VerifiedDifferenceTerm,
    ReadonlyMap<VerifiedDifferenceTerm, bigint>
  >;
  contradiction: boolean;
} | undefined {
  const values = new Set<ValueId>(additional_values);
  for (const premise of premises) {
    if (
      premise.tag === "difference" ||
      premise.tag === "equality" ||
      premise.tag === "disequality"
    ) {
      values.add(premise.left);
      values.add(premise.right);
    }
  }
  if (
    values.size > proof_limits.maximum_relational_terms_per_function
  ) {
    return undefined;
  }
  const ordered_values = [...values].sort();
  const terms: VerifiedDifferenceTerm[] = [
    VERIFIED_DIFFERENCE_ZERO,
    ...ordered_values,
  ];
  const bounds = new Map<
    VerifiedDifferenceTerm,
    Map<VerifiedDifferenceTerm, bigint>
  >();
  for (const term of terms) {
    bounds.set(term, new Map([[term, 0n]]));
  }
  for (const value of ordered_values) {
    const range = ranges.get(value);
    if (range === undefined) return undefined;
    const interval = interval_from_premises(premises, value, range);
    if (interval.contradiction) {
      return { bounds, contradiction: true };
    }
    const reduced = verified_reduced_scalar_bounds(
      premises,
      value,
      range,
    );
    let minimum = interval.minimum;
    let maximum = interval.maximum;
    if (reduced !== undefined) {
      minimum = reduced.minimum;
      maximum = reduced.maximum;
    }
    set_verified_difference(
      bounds,
      value,
      VERIFIED_DIFFERENCE_ZERO,
      maximum,
    );
    set_verified_difference(
      bounds,
      VERIFIED_DIFFERENCE_ZERO,
      value,
      -minimum,
    );
  }
  for (const premise of premises) {
    if (premise.tag === "equality") {
      set_verified_difference(bounds, premise.left, premise.right, 0n);
      set_verified_difference(bounds, premise.right, premise.left, 0n);
      continue;
    }
    if (premise.tag !== "difference") continue;
    if (typeof premise.maximum !== "bigint") return undefined;
    const left_range = ranges.get(premise.left);
    const right_range = ranges.get(premise.right);
    if (
      left_range === undefined || right_range === undefined ||
      !same_integer_type(left_range, right_range)
    ) {
      return undefined;
    }
    set_verified_difference(
      bounds,
      premise.left,
      premise.right,
      premise.maximum,
    );
  }
  for (const through of terms) {
    for (const left of terms) {
      const left_to_through = bounds.get(left)?.get(through);
      if (left_to_through === undefined) continue;
      for (const right of terms) {
        const through_to_right = bounds.get(through)?.get(right);
        if (through_to_right === undefined) continue;
        set_verified_difference(
          bounds,
          left,
          right,
          left_to_through + through_to_right,
        );
      }
    }
  }
  for (const term of terms) {
    const self = bounds.get(term)?.get(term);
    if (self !== undefined && self < 0n) {
      return { bounds, contradiction: true };
    }
  }
  return { bounds, contradiction: false };
}

function set_verified_difference(
  bounds: Map<
    VerifiedDifferenceTerm,
    Map<VerifiedDifferenceTerm, bigint>
  >,
  left: VerifiedDifferenceTerm,
  right: VerifiedDifferenceTerm,
  maximum: bigint,
): void {
  let row = bounds.get(left);
  if (row === undefined) {
    row = new Map();
    bounds.set(left, row);
  }
  const current = row.get(right);
  if (current !== undefined && current <= maximum) return;
  row.set(right, maximum);
}

function verified_relation_implies(
  premises: readonly SemanticMachineRequirement[],
  requirement: Extract<
    SemanticMachineRequirement,
    { tag: "difference" | "equality" | "disequality" }
  >,
  ranges: ReadonlyMap<ValueId, IntegerType>,
): boolean {
  if (
    requirement.tag === "difference" &&
    typeof requirement.maximum !== "bigint"
  ) {
    return false;
  }
  const left_range = ranges.get(requirement.left);
  const right_range = ranges.get(requirement.right);
  if (
    left_range === undefined || right_range === undefined ||
    !same_integer_type(left_range, right_range)
  ) {
    return false;
  }
  const closure = verified_difference_closure(
    premises,
    ranges,
    [requirement.left, requirement.right],
  );
  if (closure === undefined || closure.contradiction) return false;
  const forward = closure.bounds.get(requirement.left)?.get(requirement.right);
  const reverse = closure.bounds.get(requirement.right)?.get(requirement.left);
  if (requirement.tag === "difference") {
    return forward !== undefined && forward <= requirement.maximum;
  }
  if (requirement.tag === "equality") {
    return forward !== undefined && forward <= 0n &&
      reverse !== undefined && reverse <= 0n;
  }
  if (
    (forward !== undefined && forward <= -1n) ||
    (reverse !== undefined && reverse <= -1n)
  ) {
    return true;
  }
  for (const premise of premises) {
    if (premise.tag !== "disequality") continue;
    if (
      verified_values_are_equal(
        closure.bounds,
        premise.left,
        requirement.left,
      ) &&
      verified_values_are_equal(
        closure.bounds,
        premise.right,
        requirement.right,
      )
    ) {
      return true;
    }
    if (
      verified_values_are_equal(
        closure.bounds,
        premise.left,
        requirement.right,
      ) &&
      verified_values_are_equal(
        closure.bounds,
        premise.right,
        requirement.left,
      )
    ) {
      return true;
    }
  }
  return false;
}

function verified_values_are_equal(
  bounds: ReadonlyMap<
    VerifiedDifferenceTerm,
    ReadonlyMap<VerifiedDifferenceTerm, bigint>
  >,
  left: ValueId,
  right: ValueId,
): boolean {
  const forward = bounds.get(left)?.get(right);
  const reverse = bounds.get(right)?.get(left);
  return forward !== undefined && forward <= 0n &&
    reverse !== undefined && reverse <= 0n;
}

function premises_are_contradictory(
  premises: readonly SemanticMachineRequirement[],
  ranges: ReadonlyMap<ValueId, IntegerType>,
): boolean {
  const closure = verified_difference_closure(premises, ranges, []);
  if (closure?.contradiction) return true;
  if (closure !== undefined) {
    for (const premise of premises) {
      if (
        premise.tag === "disequality" &&
        verified_values_are_equal(
          closure.bounds,
          premise.left,
          premise.right,
        )
      ) {
        return true;
      }
    }
  }
  const values = new Set<ValueId>();
  for (const premise of premises) {
    values.add(requirement_value(premise));
    if (
      premise.tag === "difference" ||
      premise.tag === "equality" ||
      premise.tag === "disequality"
    ) {
      values.add(premise.right);
    }
  }
  for (const value of values) {
    const range = ranges.get(value);
    if (range === undefined) continue;
    const interval = interval_from_premises(premises, value, range);
    if (interval.contradiction) {
      return true;
    }
    const bitmask = bitmask_from_premises(premises, value, range);
    if (
      bitmask.malformed ||
      (bitmask.known_zero & bitmask.known_one) !== 0n
    ) {
      return true;
    }
    if (
      interval.minimum === interval.maximum &&
      !verified_value_matches_bitmask(interval.minimum, bitmask, range)
    ) {
      return true;
    }
    const congruence = congruence_from_premises(premises, value);
    if (congruence.contradiction) return true;
    if (
      !congruence.malformed &&
      congruence.congruence !== undefined &&
      !verified_bitmask_matches_congruence(bitmask, congruence.congruence)
    ) {
      return true;
    }
    if (
      !congruence.malformed &&
      congruence.congruence !== undefined &&
      interval.minimum === interval.maximum &&
      canonical_verified_residue(
          interval.minimum,
          congruence.congruence.modulus,
        ) !== congruence.congruence.residue
    ) {
      return true;
    }
    if (
      !congruence.malformed &&
      congruence.congruence !== undefined &&
      reduce_verified_congruence(
          interval,
          congruence.congruence,
          bitmask,
          range,
        ).tag === "none"
    ) {
      return true;
    }
    if (
      !congruence.malformed &&
      congruence.congruence !== undefined &&
      (bitmask.known_zero !== 0n || bitmask.known_one !== 0n)
    ) {
      const witness = verified_reduced_product_has_witness(
        interval,
        bitmask,
        congruence.congruence,
        range,
      );
      if (witness === false) return true;
    }
  }
  return false;
}

function verified_bitmask_matches_congruence(
  bitmask: VerifiedBitmaskState,
  congruence: VerifiedCongruence,
): boolean {
  let power_of_two = 1n;
  let remaining = congruence.modulus;
  while (remaining % 2n === 0n) {
    power_of_two *= 2n;
    remaining /= 2n;
  }
  const fixed_mask = power_of_two - 1n;
  const required_one = congruence.residue & fixed_mask;
  const required_zero = fixed_mask ^ required_one;
  return (bitmask.known_zero & required_one) === 0n &&
    (bitmask.known_one & required_zero) === 0n;
}

function verified_reduced_product_has_witness(
  interval: IntervalState,
  bitmask: VerifiedBitmaskState,
  congruence: VerifiedCongruence,
  range: IntegerType,
): boolean | undefined {
  const modulus = 1n << BigInt(range.width);
  const unsigned_intervals = verified_unsigned_intervals(interval, range);
  let steps = 0;
  for (const bounds of unsigned_intervals) {
    let lower = bounds.minimum;
    while (lower <= bounds.maximum) {
      const bits = minimum_verified_bitmask_value(
        lower,
        bitmask,
        range.width,
      );
      if (bits === undefined || bits > bounds.maximum) break;
      if (steps + range.width > proof_limits.compiler_search_steps) {
        return undefined;
      }
      steps += range.width;
      let value = bits;
      if (range.signed) {
        const sign = 1n << BigInt(range.width - 1);
        if (bits >= sign) value -= modulus;
      }
      if (
        canonical_verified_residue(value, congruence.modulus) ===
          congruence.residue &&
        !interval.exclusions.has(value)
      ) {
        return true;
      }
      lower = bits + 1n;
    }
  }
  return false;
}

function verified_unsigned_intervals(
  interval: IntervalState,
  range: IntegerType,
): readonly { minimum: bigint; maximum: bigint }[] {
  if (!range.signed || interval.minimum >= 0n) {
    return [{
      minimum: interval.minimum,
      maximum: interval.maximum,
    }];
  }
  const modulus = 1n << BigInt(range.width);
  if (interval.maximum < 0n) {
    return [{
      minimum: interval.minimum + modulus,
      maximum: interval.maximum + modulus,
    }];
  }
  return [
    {
      minimum: interval.minimum + modulus,
      maximum: modulus - 1n,
    },
    { minimum: 0n, maximum: interval.maximum },
  ];
}

function minimum_verified_bitmask_value(
  lower: bigint,
  bitmask: VerifiedBitmaskState,
  width: number,
): bigint | undefined {
  const equal = new Map<number, bigint | undefined>();
  const greater = new Map<number, bigint | undefined>();
  const search = (
    bit: number,
    already_greater: boolean,
  ): bigint | undefined => {
    if (bit < 0) return 0n;
    let memo = equal;
    if (already_greater) memo = greater;
    if (memo.has(bit)) return memo.get(bit);
    const bit_value = 1n << BigInt(bit);
    let lower_digit = 0n;
    if ((lower & bit_value) !== 0n) lower_digit = 1n;
    for (const digit of [0n, 1n]) {
      if (digit === 0n && (bitmask.known_one & bit_value) !== 0n) {
        continue;
      }
      if (digit === 1n && (bitmask.known_zero & bit_value) !== 0n) {
        continue;
      }
      if (!already_greater && digit < lower_digit) continue;
      const suffix = search(
        bit - 1,
        already_greater || digit > lower_digit,
      );
      if (suffix === undefined) continue;
      const result = digit * bit_value + suffix;
      memo.set(bit, result);
      return result;
    }
    memo.set(bit, undefined);
    return undefined;
  };
  return search(width - 1, false);
}

function maximum_verified_bitmask_value(
  upper: bigint,
  bitmask: VerifiedBitmaskState,
  width: number,
): bigint | undefined {
  const equal = new Map<number, bigint | undefined>();
  const less = new Map<number, bigint | undefined>();
  const search = (
    bit: number,
    already_less: boolean,
  ): bigint | undefined => {
    if (bit < 0) return 0n;
    let memo = equal;
    if (already_less) memo = less;
    if (memo.has(bit)) return memo.get(bit);
    const bit_value = 1n << BigInt(bit);
    let upper_digit = 0n;
    if ((upper & bit_value) !== 0n) upper_digit = 1n;
    for (const digit of [1n, 0n]) {
      if (digit === 0n && (bitmask.known_one & bit_value) !== 0n) {
        continue;
      }
      if (digit === 1n && (bitmask.known_zero & bit_value) !== 0n) {
        continue;
      }
      if (!already_less && digit > upper_digit) continue;
      const suffix = search(
        bit - 1,
        already_less || digit < upper_digit,
      );
      if (suffix === undefined) continue;
      const result = digit * bit_value + suffix;
      memo.set(bit, result);
      return result;
    }
    memo.set(bit, undefined);
    return undefined;
  };
  return search(width - 1, false);
}

function verified_reduced_scalar_bounds(
  premises: readonly SemanticMachineRequirement[],
  value: ValueId,
  range: IntegerType,
): { minimum: bigint; maximum: bigint } | undefined {
  const interval = interval_from_premises(premises, value, range);
  if (interval.contradiction) return undefined;
  const bitmask = bitmask_from_premises(premises, value, range);
  if (
    bitmask.malformed ||
    (bitmask.known_zero & bitmask.known_one) !== 0n
  ) {
    return undefined;
  }
  const congruence = congruence_from_premises(premises, value);
  if (congruence.malformed || congruence.contradiction) return undefined;
  const unsigned_intervals = verified_unsigned_intervals(interval, range);
  const modulus = 1n << BigInt(range.width);
  let minimum: bigint | undefined;
  let steps = 0;
  for (const bounds of unsigned_intervals) {
    let lower = bounds.minimum;
    while (lower <= bounds.maximum) {
      const bits = minimum_verified_bitmask_value(
        lower,
        bitmask,
        range.width,
      );
      if (bits === undefined || bits > bounds.maximum) break;
      if (steps + range.width > proof_limits.compiler_search_steps) {
        return undefined;
      }
      steps += range.width;
      let candidate = bits;
      if (range.signed) {
        const sign = 1n << BigInt(range.width - 1);
        if (bits >= sign) candidate -= modulus;
      }
      let matches_congruence = true;
      if (congruence.congruence !== undefined) {
        matches_congruence = canonical_verified_residue(
          candidate,
          congruence.congruence.modulus,
        ) === congruence.congruence.residue;
      }
      if (
        matches_congruence &&
        !interval.exclusions.has(candidate)
      ) {
        minimum = candidate;
        break;
      }
      lower = bits + 1n;
    }
    if (minimum !== undefined) break;
  }
  if (minimum === undefined) return undefined;

  let maximum: bigint | undefined;
  steps = 0;
  for (const bounds of [...unsigned_intervals].reverse()) {
    let upper = bounds.maximum;
    while (upper >= bounds.minimum) {
      const bits = maximum_verified_bitmask_value(
        upper,
        bitmask,
        range.width,
      );
      if (bits === undefined || bits < bounds.minimum) break;
      if (steps + range.width > proof_limits.compiler_search_steps) {
        return undefined;
      }
      steps += range.width;
      let candidate = bits;
      if (range.signed) {
        const sign = 1n << BigInt(range.width - 1);
        if (bits >= sign) candidate -= modulus;
      }
      let matches_congruence = true;
      if (congruence.congruence !== undefined) {
        matches_congruence = canonical_verified_residue(
          candidate,
          congruence.congruence.modulus,
        ) === congruence.congruence.residue;
      }
      if (
        matches_congruence &&
        !interval.exclusions.has(candidate)
      ) {
        maximum = candidate;
        break;
      }
      upper = bits - 1n;
    }
    if (maximum !== undefined) break;
  }
  if (maximum === undefined) return undefined;
  return { minimum, maximum };
}

function interval_implies_requirement(
  interval: IntervalState,
  requirement: SemanticMachineRequirement,
  premises: readonly SemanticMachineRequirement[],
  value: ValueId,
  range: IntegerType,
  ranges: ReadonlyMap<ValueId, IntegerType>,
): boolean {
  if (interval.contradiction) return true;
  if (
    requirement.tag === "difference" ||
    requirement.tag === "equality" ||
    requirement.tag === "disequality"
  ) {
    return verified_relation_implies(premises, requirement, ranges);
  }
  const bitmask = bitmask_from_premises(premises, value, range);
  if (
    bitmask.malformed ||
    (bitmask.known_zero & bitmask.known_one) !== 0n
  ) {
    return false;
  }
  let minimum = interval.minimum;
  let maximum = interval.maximum;
  const width_mask = (1n << BigInt(range.width)) - 1n;
  if ((bitmask.known_zero | bitmask.known_one) === width_mask) {
    let exact = bitmask.known_one;
    if (range.signed) {
      const sign = 1n << BigInt(range.width - 1);
      if (exact >= sign) exact -= width_mask + 1n;
    }
    if (
      exact < minimum || exact > maximum ||
      interval.exclusions.has(exact)
    ) {
      return false;
    }
    minimum = exact;
    maximum = exact;
  }
  const premise_congruence = congruence_from_premises(premises, value);
  if (premise_congruence.malformed || premise_congruence.contradiction) {
    return false;
  }
  if (premise_congruence.congruence !== undefined) {
    const reduced = reduce_verified_congruence(
      {
        minimum,
        maximum,
        exclusions: interval.exclusions,
        contradiction: false,
      },
      premise_congruence.congruence,
      bitmask,
      range,
    );
    if (reduced.tag === "none") return false;
    if (reduced.tag === "one") {
      minimum = reduced.value;
      maximum = reduced.value;
    }
  }
  if (requirement.tag === "exclusion") {
    if (
      requirement.expected < minimum ||
      requirement.expected > maximum ||
      interval.exclusions.has(requirement.expected)
    ) {
      return true;
    }
    if (
      premise_congruence.congruence !== undefined &&
      canonical_verified_residue(
          requirement.expected,
          premise_congruence.congruence.modulus,
        ) !== premise_congruence.congruence.residue
    ) {
      return true;
    }
    return !verified_value_matches_bitmask(
      requirement.expected,
      bitmask,
      range,
    );
  }
  if (requirement.tag === "bitmask") {
    return (bitmask.known_zero & requirement.known_zero) ===
        requirement.known_zero &&
      (bitmask.known_one & requirement.known_one) === requirement.known_one;
  }
  if (requirement.tag === "congruence") {
    if (
      requirement.modulus <= 0n ||
      requirement.residue < 0n ||
      requirement.residue >= requirement.modulus
    ) {
      return false;
    }
    if (requirement.modulus === 1n) return true;
    if (minimum === maximum) {
      return canonical_verified_residue(minimum, requirement.modulus) ===
        requirement.residue;
    }
    if (
      (requirement.modulus & (requirement.modulus - 1n)) === 0n
    ) {
      const fixed_mask = requirement.modulus - 1n;
      const required_one = requirement.residue & fixed_mask;
      const required_zero = fixed_mask ^ required_one;
      if (
        (bitmask.known_zero & required_zero) === required_zero &&
        (bitmask.known_one & required_one) === required_one
      ) {
        return true;
      }
    }
    if (premise_congruence.congruence === undefined) {
      return false;
    }
    return premise_congruence.congruence.modulus % requirement.modulus === 0n &&
      canonical_verified_residue(
          premise_congruence.congruence.residue,
          requirement.modulus,
        ) === requirement.residue;
  }
  const proposition = requirement.proposition;
  if (proposition.tag === "equal") {
    return minimum === proposition.expected &&
      maximum === proposition.expected &&
      !interval.exclusions.has(proposition.expected);
  }
  if (proposition.tag === "less_than") {
    return maximum < proposition.bound;
  }
  if (proposition.tag === "less_equal") {
    return maximum <= proposition.bound;
  }
  if (proposition.tag === "greater_than") {
    return minimum > proposition.bound;
  }
  return minimum >= proposition.bound;
}

function reduce_verified_congruence(
  interval: IntervalState,
  congruence: VerifiedCongruence,
  bitmask: VerifiedBitmaskState,
  range: IntegerType,
):
  | { tag: "unknown" }
  | { tag: "none" }
  | { tag: "one"; value: bigint } {
  const first = interval.minimum +
    canonical_verified_residue(
      congruence.residue - interval.minimum,
      congruence.modulus,
    );
  if (first > interval.maximum) return { tag: "none" };
  const witness_count = (interval.maximum - first) / congruence.modulus + 1n;
  if (witness_count > BigInt(interval.exclusions.size) + 1n) {
    return { tag: "unknown" };
  }
  let remaining: bigint | undefined;
  for (
    let candidate = first;
    candidate <= interval.maximum;
    candidate += congruence.modulus
  ) {
    if (
      interval.exclusions.has(candidate) ||
      !verified_value_matches_bitmask(candidate, bitmask, range)
    ) {
      continue;
    }
    if (remaining !== undefined) return { tag: "unknown" };
    remaining = candidate;
  }
  if (remaining === undefined) return { tag: "none" };
  return { tag: "one", value: remaining };
}

function combine_verified_congruences(
  left: VerifiedCongruence,
  right: VerifiedCongruence,
): VerifiedCongruence | undefined {
  const divisor = greatest_common_verified_divisor(
    left.modulus,
    right.modulus,
  );
  const difference = right.residue - left.residue;
  if (canonical_verified_residue(difference, divisor) !== 0n) {
    return undefined;
  }
  const left_factor = left.modulus / divisor;
  const right_factor = right.modulus / divisor;
  let multiplier = 0n;
  if (right_factor !== 1n) {
    multiplier = canonical_verified_residue(
      difference / divisor *
        verified_modular_inverse(left_factor, right_factor),
      right_factor,
    );
  }
  const modulus = left.modulus * right_factor;
  return {
    modulus,
    residue: canonical_verified_residue(
      left.residue + left.modulus * multiplier,
      modulus,
    ),
  };
}

function verified_modular_inverse(value: bigint, modulus: bigint): bigint {
  let previous_remainder = value;
  let remainder = modulus;
  let previous_coefficient = 1n;
  let coefficient = 0n;
  while (remainder !== 0n) {
    const quotient = previous_remainder / remainder;
    const next_remainder = previous_remainder - quotient * remainder;
    previous_remainder = remainder;
    remainder = next_remainder;
    const next_coefficient = previous_coefficient - quotient * coefficient;
    previous_coefficient = coefficient;
    coefficient = next_coefficient;
  }
  expect(
    previous_remainder === 1n,
    `Verified congruence inverse does not exist for ${value} modulo ${modulus}.`,
  );
  return canonical_verified_residue(previous_coefficient, modulus);
}

function greatest_common_verified_divisor(
  left: bigint,
  right: bigint,
): bigint {
  let dividend = left;
  let divisor = right;
  while (divisor !== 0n) {
    const remainder = dividend % divisor;
    dividend = divisor;
    divisor = remainder;
  }
  return dividend;
}

function canonical_verified_residue(
  value: bigint,
  modulus: bigint,
): bigint {
  let residue = value % modulus;
  if (residue < 0n) residue += modulus;
  return residue;
}
