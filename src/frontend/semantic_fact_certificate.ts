import { expect } from "../expect.ts";
import {
  integer_maximum,
  integer_minimum,
  integer_type_from_name,
  integer_val_type,
  type IntegerType,
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
  };

export type SemanticMachineCertificate = {
  tag: "machine_fact";
  call_span: SourceSpan;
  requirement: SemanticMachineRequirement;
};

export type SemanticBoundedOffsetGoal = {
  tag: "fact";
  proposition: Exclude<FactProposition, { tag: "equal" }>;
};

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
  | SemanticMachineCertificate
  | SemanticPredicateCertificate
  | SemanticRemainderDivisibilityCertificate
  | SemanticRemainderCertificate
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

export function semantic_bounded_offset_certificate(
  call_span: SourceSpan,
  requirement: SemanticBoundedOffsetRequirement,
): SemanticBoundedOffsetCertificate {
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
      goal: Object.freeze({
        tag: "fact",
        proposition: Object.freeze({ ...requirement.goal.proposition }),
      }),
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
  const goal_tag = (requirement.goal.proposition as FactProposition).tag;
  if (
    requirement.goal.tag !== "fact" ||
    (goal_tag !== "less_than" &&
      goal_tag !== "less_equal" &&
      goal_tag !== "greater_than" &&
      goal_tag !== "greater_equal") ||
    requirement.goal.proposition.value !== requirement.logical_result
  ) {
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
    (input_range.width !== 32 && input_range.width !== 64)
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
  const binding = producers.get(requirement.logical_result);
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
  const offset_node = producers.get(requirement.offset);
  if (offset_node?.operation.tag !== "constant") return false;
  const offset_index = target.block.nodes.indexOf(offset_node);
  const operation_index = target.block.nodes.indexOf(operation);
  const binding_index = target.block.nodes.indexOf(binding);
  const call_index = target.block.nodes.indexOf(target.node);
  if (
    offset_index < 0 ||
    operation_index <= offset_index ||
    binding_index <= operation_index ||
    call_index <= binding_index
  ) {
    return false;
  }
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
): VerifiedSemanticPaths {
  const target = unique_semantic_call_at_span(control_flow, call_span);
  if (target === undefined) return "rejected";
  const ranges = machine_ranges(control_flow);
  let goal_value: ValueId | undefined;
  let goal_range: IntegerType | undefined;
  if (requirement !== undefined) {
    goal_value = requirement_value(requirement);
    goal_range = ranges.get(goal_value);
    if (goal_range === undefined) return "rejected";
  }
  const blocks = new Map(
    control_flow.blocks.map((block) => [block.id, block]),
  );
  const producers = semantic_value_producers(control_flow);
  if (producers === undefined) return "rejected";
  const value_types = new Map(
    control_flow.values.map((value) => [value.value, value.type]),
  );
  if (target_block_can_repeat(target.block.id, blocks)) {
    if (bounded_offset !== undefined) return "rejected";
    if (
      requirement !== undefined &&
      verified_repeating_call_requirement(
        control_flow,
        target.block.id,
        requirement,
        ranges,
        producers,
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
      expect(
        goal_value !== undefined && goal_range !== undefined,
        "Semantic fact goal lost its machine range.",
      );
      const path_goal_value = resolved_alias(goal_value, aliases);
      if (path_goal_value === undefined) return "rejected";
      const path_goal_range = ranges.get(path_goal_value);
      if (path_goal_range === undefined) return "rejected";
      const interval = interval_from_premises(
        path_premises,
        path_goal_value,
        path_goal_range,
      );
      if (interval.contradiction) break;
      feasible_paths += 1;
      if (
        !interval_implies_requirement(
          interval,
          requirement,
          path_premises,
          path_goal_value,
          path_goal_range,
        )
      ) {
        return "rejected";
      }
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
      range = integer_type_from_name(value.type.name);
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
  target: SemanticBlockId,
  requirement: SemanticMachineRequirement,
  ranges: ReadonlyMap<ValueId, IntegerType>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
): boolean {
  const dominators = verified_block_dominators(control_flow);
  const target_dominators = dominators.get(target);
  if (target_dominators === undefined) return false;
  const premises: SemanticMachineRequirement[] = [];
  for (const block of control_flow.blocks) {
    if (block.id === target) continue;
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
    const premise = verified_comparison_requirement(
      comparison,
      branch_value,
      ranges,
      producers,
    );
    if (premise !== undefined) premises.push(premise);
    const bitmask_premise = verified_bitmask_requirement(
      comparison,
      branch_value,
      ranges,
      producers,
      new Map(),
    );
    if (bitmask_premise !== undefined) premises.push(bitmask_premise);
    const congruence_premise = verified_remainder_congruence_requirement(
      comparison,
      branch_value,
      ranges,
      producers,
      new Map(),
    );
    if (congruence_premise !== undefined) {
      premises.push(congruence_premise);
    }
  }
  if (premises_are_contradictory(premises, ranges)) return false;
  const goal_value = requirement_value(requirement);
  const goal_range = ranges.get(goal_value);
  if (goal_range === undefined) return false;
  const interval = interval_from_premises(
    premises,
    goal_value,
    goal_range,
  );
  if (interval.contradiction) return false;
  return interval_implies_requirement(
    interval,
    requirement,
    premises,
    goal_value,
    goal_range,
  );
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
} {
  const booleans = new Map(current);
  const aliases = new Map(current_aliases);
  const premises = [...current_premises];
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
  return { booleans, aliases, premises };
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
  if (minimum === maximum) {
    return [{
      tag: "fact",
      proposition: {
        tag: "equal",
        value: requirement.result,
        expected: minimum,
      },
    }];
  }
  return [
    {
      tag: "fact",
      proposition: {
        tag: "greater_equal",
        value: requirement.result,
        bound: minimum,
      },
    },
    {
      tag: "fact",
      proposition: {
        tag: "less_equal",
        value: requirement.result,
        bound: maximum,
      },
    },
  ];
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
  return verified_constant_comparison(
    relation,
    expected_left,
    expected_right,
    ranges,
    producers,
  );
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

function verified_comparison_truth(
  comparison: SemanticNode,
  ranges: ReadonlyMap<ValueId, IntegerType>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
): boolean | undefined {
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
  if (!contradiction && minimum === maximum && exclusions.has(minimum)) {
    contradiction = true;
  }
  if (!contradiction) {
    const size = maximum - minimum + 1n;
    if (
      size > 0n &&
      size <= BigInt(proof_limits.maximum_exclusions_per_value)
    ) {
      let exhausted = true;
      for (let candidate = minimum; candidate <= maximum; candidate += 1n) {
        if (exclusions.has(candidate)) continue;
        exhausted = false;
        break;
      }
      if (exhausted) contradiction = true;
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

function premises_are_contradictory(
  premises: readonly SemanticMachineRequirement[],
  ranges: ReadonlyMap<ValueId, IntegerType>,
): boolean {
  const values = new Set(premises.map(requirement_value));
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
  const unsigned_intervals: { minimum: bigint; maximum: bigint }[] = [];
  if (!range.signed || interval.minimum >= 0n) {
    unsigned_intervals.push({
      minimum: interval.minimum,
      maximum: interval.maximum,
    });
  } else if (interval.maximum < 0n) {
    unsigned_intervals.push({
      minimum: interval.minimum + modulus,
      maximum: interval.maximum + modulus,
    });
  } else {
    unsigned_intervals.push({
      minimum: interval.minimum + modulus,
      maximum: modulus - 1n,
    });
    unsigned_intervals.push({ minimum: 0n, maximum: interval.maximum });
  }
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

function interval_implies_requirement(
  interval: IntervalState,
  requirement: SemanticMachineRequirement,
  premises: readonly SemanticMachineRequirement[],
  value: ValueId,
  range: IntegerType,
): boolean {
  if (interval.contradiction) return true;
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
