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
  type SemanticBlock,
  type SemanticBlockId,
  type SemanticCfg,
  type SemanticNode,
  unique_semantic_call_at_span,
} from "./semantic_cfg.ts";
import type { ValueId } from "./semantic_identity.ts";
import type { SourceSpan } from "./syntax.ts";

export type SemanticMachineRequirement =
  | { tag: "fact"; proposition: FactProposition }
  | { tag: "exclusion"; value: ValueId; expected: bigint };

export type SemanticMachineCertificate = {
  tag: "machine_fact";
  call_span: SourceSpan;
  requirement: SemanticMachineRequirement;
};

export type SemanticUnreachableCertificate = {
  tag: "machine_unreachable";
  call_span: SourceSpan;
};

export type SemanticControlFlowCertificate =
  | SemanticMachineCertificate
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
  if (target_block_can_repeat(target.block.id, blocks)) {
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
      target.node,
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
      if (!interval_implies_requirement(interval, requirement)) {
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
    const comparison = producers.get(block.terminator.condition);
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
          premises.push(aliased_machine_requirement(premise, aliases));
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

function machine_ranges(
  control_flow: SemanticCfg,
): ReadonlyMap<ValueId, IntegerType> {
  const ranges = new Map<ValueId, IntegerType>();
  for (const value of control_flow.values) {
    if (value.type.tag !== "scalar") continue;
    const range = integer_type_from_name(value.type.name);
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
): ReadonlyMap<ValueId, SemanticNode> {
  const producers = new Map<ValueId, SemanticNode>();
  for (const block of control_flow.blocks) {
    for (const node of block.nodes) {
      for (const output of node.outputs) producers.set(output, node);
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
    const comparison = producers.get(block.terminator.condition);
    if (comparison === undefined) continue;
    const premise = verified_comparison_requirement(
      comparison,
      branch_value,
      ranges,
      producers,
    );
    if (premise !== undefined) premises.push(premise);
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
  return interval_implies_requirement(interval, requirement);
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
  target: SemanticNode,
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
  if (producer?.operation.tag !== "constant") return undefined;
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

function premises_are_contradictory(
  premises: readonly SemanticMachineRequirement[],
  ranges: ReadonlyMap<ValueId, IntegerType>,
): boolean {
  const values = new Set(premises.map(requirement_value));
  for (const value of values) {
    const range = ranges.get(value);
    if (range === undefined) continue;
    if (interval_from_premises(premises, value, range).contradiction) {
      return true;
    }
  }
  return false;
}

function interval_implies_requirement(
  interval: IntervalState,
  requirement: SemanticMachineRequirement,
): boolean {
  if (interval.contradiction) return true;
  if (requirement.tag === "exclusion") {
    return requirement.expected < interval.minimum ||
      requirement.expected > interval.maximum ||
      interval.exclusions.has(requirement.expected);
  }
  const proposition = requirement.proposition;
  if (proposition.tag === "equal") {
    return interval.minimum === proposition.expected &&
      interval.maximum === proposition.expected &&
      !interval.exclusions.has(proposition.expected);
  }
  if (proposition.tag === "less_than") {
    return interval.maximum < proposition.bound;
  }
  if (proposition.tag === "less_equal") {
    return interval.maximum <= proposition.bound;
  }
  if (proposition.tag === "greater_than") {
    return interval.minimum > proposition.bound;
  }
  return interval.minimum >= proposition.bound;
}
