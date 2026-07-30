import {
  integer_type_from_name,
  integer_val_type,
  normalize_integer,
} from "../integer.ts";
import {
  assume_machine_bitmask,
  assume_machine_congruence,
  assume_machine_difference,
  assume_machine_disequality,
  assume_machine_equality,
  assume_machine_fact,
  exclude_machine_fact,
  implies_machine_bitmask,
  implies_machine_congruence,
  implies_machine_difference,
  implies_machine_disequality,
  implies_machine_equality,
  implies_machine_fact,
  machine_excludes_equal,
  machine_fact_domain,
  type MachineFactDomain,
  transfer_machine_offset,
} from "./fact_graph.ts";
import { proof_limits } from "./proof_limits.ts";
import {
  semantic_cfg_is_well_formed,
  type SemanticBlock,
  type SemanticBlockId,
  type SemanticCfg,
  type SemanticNode,
  unique_semantic_call_at_span,
} from "./semantic_cfg.ts";
import {
  semantic_bounded_offset_certificate,
  semantic_machine_certificate,
  semantic_remainder_certificate,
  semantic_remainder_divisibility_certificate,
  semantic_unreachable_certificate,
  type SemanticBoundedOffsetCertificate,
  type SemanticBoundedOffsetRequirement,
  type SemanticMachineCertificate,
  type SemanticMachineRequirement,
  type SemanticRemainderCertificate,
  type SemanticRemainderDivisibilityCertificate,
  type SemanticRemainderDivisibilityRequirement,
  type SemanticRemainderRequirement,
  type SemanticUnreachableCertificate,
} from "./semantic_fact_certificate.ts";
import type { ValueId } from "./semantic_identity.ts";
import type { SourceSpan } from "./syntax.ts";

export type { SemanticMachineRequirement } from "./semantic_fact_certificate.ts";

type PathState = {
  block: SemanticBlockId;
  predecessor: SemanticBlockId | undefined;
  domain: MachineFactDomain;
  booleans: ReadonlyMap<ValueId, boolean>;
  aliases: ReadonlyMap<ValueId, ValueId>;
  visited: ReadonlySet<SemanticBlockId>;
};

export function infer_semantic_machine_certificate(
  control_flow: SemanticCfg,
  call_span: SourceSpan,
  requirement: SemanticMachineRequirement,
): SemanticMachineCertificate | undefined {
  if (
    requirement.tag === "congruence" &&
    (requirement.modulus <= 0n ||
      requirement.residue < 0n ||
      requirement.residue >= requirement.modulus)
  ) {
    return undefined;
  }
  if (
    requirement.tag === "difference" &&
    typeof requirement.maximum !== "bigint"
  ) {
    return undefined;
  }
  if (
    semantic_cfg_machine_path_result(
      control_flow,
      call_span,
      requirement,
    ) !== "proved"
  ) {
    return undefined;
  }
  return semantic_machine_certificate(call_span, requirement);
}

export function infer_semantic_bounded_offset_certificate(
  control_flow: SemanticCfg,
  call_span: SourceSpan,
  requirement: SemanticBoundedOffsetRequirement,
): SemanticBoundedOffsetCertificate | undefined {
  if (
    semantic_cfg_machine_path_result(
      control_flow,
      call_span,
      requirement.goal,
      requirement,
    ) !== "proved"
  ) {
    return undefined;
  }
  return semantic_bounded_offset_certificate(call_span, requirement);
}

export function infer_semantic_remainder_certificate(
  control_flow: SemanticCfg,
  call_span: SourceSpan,
  requirement: SemanticRemainderRequirement,
): SemanticRemainderCertificate | undefined {
  const machine_requirement: SemanticMachineRequirement = {
    tag: "fact",
    proposition: {
      tag: "equal",
      value: requirement.remainder,
      expected: requirement.expected,
    },
  };
  if (
    semantic_cfg_machine_path_result(
      control_flow,
      call_span,
      machine_requirement,
    ) !== "proved"
  ) {
    return undefined;
  }
  return semantic_remainder_certificate(call_span, requirement);
}

export function infer_semantic_remainder_divisibility_certificate(
  control_flow: SemanticCfg,
  call_span: SourceSpan,
  requirement: SemanticRemainderDivisibilityRequirement,
): SemanticRemainderDivisibilityCertificate | undefined {
  if (
    infer_semantic_remainder_certificate(
      control_flow,
      call_span,
      requirement.premise,
    ) === undefined
  ) {
    return undefined;
  }
  return semantic_remainder_divisibility_certificate(call_span, requirement);
}

export function infer_semantic_unreachable_certificate(
  control_flow: SemanticCfg,
  call_span: SourceSpan,
): SemanticUnreachableCertificate | undefined {
  if (
    semantic_cfg_machine_path_result(
      control_flow,
      call_span,
      undefined,
    ) !== "unreachable"
  ) {
    return undefined;
  }
  return semantic_unreachable_certificate(call_span);
}

type SemanticMachinePathResult =
  | "proved"
  | "unproved"
  | "unreachable"
  | "unknown";

function semantic_cfg_machine_path_result(
  control_flow: SemanticCfg,
  call_span: SourceSpan,
  requirement: SemanticMachineRequirement | undefined,
  bounded_offset?: SemanticBoundedOffsetRequirement,
): SemanticMachinePathResult {
  if (!semantic_cfg_is_well_formed(control_flow)) return "unknown";
  const target = unique_semantic_call_at_span(control_flow, call_span);
  if (target === undefined) return "unknown";
  const ranges = new Map<ValueId, { signed: boolean; width: number }>();
  for (const value of control_flow.values) {
    let range: { signed: boolean; width: number } | undefined;
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
  if (
    requirement !== undefined &&
    !requirement_has_range(requirement, ranges)
  ) {
    return "unknown";
  }
  const blocks = new Map(
    control_flow.blocks.map((block) => [block.id, block]),
  );
  const producers = semantic_value_producers(control_flow);
  if (target_block_can_repeat(target.block.id, blocks)) {
    if (bounded_offset !== undefined) return "unknown";
    if (
      requirement !== undefined &&
      repeating_call_requirement_holds(
        control_flow,
        target.block.id,
        requirement,
        ranges,
        producers,
      )
    ) {
      return "proved";
    }
    return "unknown";
  }
  const reaches_target = blocks_reaching_target(
    target.block.id,
    blocks,
  );
  const entry_counts = new Map<SemanticBlockId, number>();
  entry_counts.set(control_flow.entry, 1);
  const pending: PathState[] = [{
    block: control_flow.entry,
    predecessor: undefined,
    domain: machine_fact_domain(ranges),
    booleans: new Map(),
    aliases: new Map(),
    visited: new Set(),
  }];
  let paths = 0;
  let steps = 0;
  while (pending.length > 0) {
    steps += 1;
    if (steps > proof_limits.compiler_search_steps) return "unknown";
    const state = pending.pop();
    if (state === undefined) return "unknown";
    if (state.visited.has(state.block)) return "unknown";
    const visited = new Set(state.visited);
    visited.add(state.block);
    if (visited.size > proof_limits.compiler_search_depth) return "unknown";
    const block = blocks.get(state.block);
    if (block === undefined) return "unknown";
    let domain = state.domain;
    let booleans = new Map(state.booleans);
    let aliases = new Map(state.aliases);
    for (const node of block.nodes) {
      steps += 1;
      if (steps > proof_limits.compiler_search_steps) return "unknown";
      if (node === target.node) {
        paths += 1;
        if (
          requirement !== undefined &&
          !machine_requirement_holds(
            domain,
            aliased_machine_requirement(requirement, aliases),
          )
        ) {
          return "unproved";
        }
        break;
      }
      const transferred = transfer_semantic_node(
        node,
        state.predecessor,
        domain,
        booleans,
        aliases,
        bounded_offset,
      );
      domain = transferred.domain;
      booleans = transferred.booleans;
      aliases = transferred.aliases;
    }
    if (block.id === target.block.id) continue;
    if (!domain.reachable) continue;
    if (block.terminator.tag !== "branch") {
      for (const successor of block.successors) {
        if (!reaches_target.has(successor)) continue;
        if (
          !enqueue_path(
            pending,
            entry_counts,
            {
              block: successor,
              predecessor: block.id,
              domain,
              booleans,
              aliases,
              visited,
            },
          )
        ) {
          return "unknown";
        }
      }
      continue;
    }
    const known_condition = booleans.get(block.terminator.condition);
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
      let branch_domain = domain;
      const comparison = producers.get(block.terminator.condition);
      if (comparison !== undefined) {
        const branch_requirement = semantic_comparison_requirement(
          comparison,
          branch_value,
          ranges,
          producers,
        );
        if (branch_requirement !== undefined) {
          branch_domain = assume_machine_requirement(
            branch_domain,
            aliased_machine_requirement(branch_requirement, aliases),
          );
        }
        const bitmask_requirement = semantic_bitmask_requirement(
          comparison,
          branch_value,
          ranges,
          producers,
          aliases,
        );
        if (bitmask_requirement !== undefined) {
          branch_domain = assume_machine_requirement(
            branch_domain,
            aliased_machine_requirement(bitmask_requirement, aliases),
          );
        }
        const congruence_requirement =
          semantic_remainder_congruence_requirement(
            comparison,
            branch_value,
            ranges,
            producers,
            aliases,
          );
        if (congruence_requirement !== undefined) {
          branch_domain = assume_machine_requirement(
            branch_domain,
            aliased_machine_requirement(congruence_requirement, aliases),
          );
        }
      }
      if (!branch_domain.reachable) continue;
      if (
        !enqueue_path(
          pending,
          entry_counts,
          {
            block: successor,
            predecessor: block.id,
            domain: branch_domain,
            booleans,
            aliases,
            visited,
          },
        )
      ) {
        return "unknown";
      }
    }
  }
  if (paths === 0) return "unreachable";
  if (requirement === undefined) return "unproved";
  return "proved";
}

function requirement_has_range(
  requirement: SemanticMachineRequirement,
  ranges: ReadonlyMap<ValueId, { signed: boolean; width: number }>,
): boolean {
  if (requirement.tag === "fact") {
    return ranges.has(requirement.proposition.value);
  }
  if (
    requirement.tag === "difference" ||
    requirement.tag === "equality" ||
    requirement.tag === "disequality"
  ) {
    const left = ranges.get(requirement.left);
    const right = ranges.get(requirement.right);
    return left !== undefined && right !== undefined &&
      left.signed === right.signed && left.width === right.width;
  }
  return ranges.has(requirement.value);
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

function repeating_call_requirement_holds(
  control_flow: SemanticCfg,
  target: SemanticBlockId,
  requirement: SemanticMachineRequirement,
  ranges: ReadonlyMap<ValueId, { signed: boolean; width: number }>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
): boolean {
  const dominators = semantic_block_dominators(control_flow);
  const target_dominators = dominators.get(target);
  if (target_dominators === undefined) return false;
  let domain = machine_fact_domain(ranges);
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
    const premise = semantic_comparison_requirement(
      comparison,
      branch_value,
      ranges,
      producers,
    );
    if (premise !== undefined) {
      domain = assume_machine_requirement(domain, premise);
    }
    const bitmask_premise = semantic_bitmask_requirement(
      comparison,
      branch_value,
      ranges,
      producers,
      new Map(),
    );
    if (bitmask_premise !== undefined) {
      domain = assume_machine_requirement(domain, bitmask_premise);
    }
    const congruence_premise = semantic_remainder_congruence_requirement(
      comparison,
      branch_value,
      ranges,
      producers,
      new Map(),
    );
    if (congruence_premise !== undefined) {
      domain = assume_machine_requirement(domain, congruence_premise);
    }
  }
  return machine_requirement_holds(domain, requirement);
}

function semantic_block_dominators(
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

function enqueue_path(
  pending: PathState[],
  entry_counts: Map<SemanticBlockId, number>,
  state: PathState,
): boolean {
  let count = 1;
  const previous = entry_counts.get(state.block);
  if (previous !== undefined) count = previous + 1;
  if (count > proof_limits.maximum_formula_disjuncts) return false;
  entry_counts.set(state.block, count);
  pending.push(state);
  return true;
}

function transfer_semantic_node(
  node: SemanticNode,
  predecessor: SemanticBlockId | undefined,
  domain: MachineFactDomain,
  booleans: ReadonlyMap<ValueId, boolean>,
  aliases: ReadonlyMap<ValueId, ValueId>,
  bounded_offset: SemanticBoundedOffsetRequirement | undefined,
): {
  domain: MachineFactDomain;
  booleans: Map<ValueId, boolean>;
  aliases: Map<ValueId, ValueId>;
} {
  const next_booleans = new Map(booleans);
  const next_aliases = new Map(aliases);
  if (node.operation.tag === "constant") {
    const output = node.outputs[0];
    if (output === undefined) {
      return { domain, booleans: next_booleans, aliases: next_aliases };
    }
    if (typeof node.operation.value === "boolean") {
      next_booleans.set(output, node.operation.value);
      return { domain, booleans: next_booleans, aliases: next_aliases };
    }
    const constant = integer_constant(node.operation.value);
    const range = domain.ranges.get(output);
    if (constant === undefined || range === undefined) {
      return { domain, booleans: next_booleans, aliases: next_aliases };
    }
    return {
      domain: assume_machine_fact(domain, {
        tag: "equal",
        value: output,
        expected: normalize_integer(range, constant),
      }),
      booleans: next_booleans,
      aliases: next_aliases,
    };
  }
  if (
    bounded_offset !== undefined &&
    node.outputs[0] === bounded_offset.result &&
    semantic_bounded_offset_operation_matches(
      node,
      bounded_offset,
      domain,
    )
  ) {
    return {
      domain: transfer_machine_offset(
        domain,
        bounded_offset.operation,
        bounded_offset.input,
        bounded_offset.offset,
        bounded_offset.result,
      ),
      booleans: next_booleans,
      aliases: next_aliases,
    };
  }
  if (
    node.operation.tag === "primitive" &&
    node.operation.name.startsWith("bind:") &&
    node.inputs.length === 1 &&
    node.outputs.length === 1
  ) {
    const input = node.inputs[0];
    const output = node.outputs[0];
    if (input === undefined || output === undefined) {
      return { domain, booleans: next_booleans, aliases: next_aliases };
    }
    const input_range = domain.ranges.get(input);
    const output_range = domain.ranges.get(output);
    if (
      input_range === undefined || output_range === undefined ||
      input_range.width !== output_range.width ||
      input_range.signed !== output_range.signed
    ) {
      return { domain, booleans: next_booleans, aliases: next_aliases };
    }
    const resolved = resolved_alias(input, next_aliases);
    if (resolved !== undefined) next_aliases.set(output, resolved);
    return { domain, booleans: next_booleans, aliases: next_aliases };
  }
  if (node.operation.tag !== "phi" || predecessor === undefined) {
    return { domain, booleans: next_booleans, aliases: next_aliases };
  }
  const incoming = node.operation.incoming.find((candidate) =>
    candidate.predecessor === predecessor
  );
  const output = node.outputs[0];
  if (incoming === undefined || output === undefined) {
    return { domain, booleans: next_booleans, aliases: next_aliases };
  }
  const incoming_boolean = next_booleans.get(incoming.value);
  if (incoming_boolean !== undefined) {
    next_booleans.set(output, incoming_boolean);
  }
  const incoming_value = resolved_alias(incoming.value, next_aliases);
  if (incoming_value !== undefined) {
    next_aliases.set(output, incoming_value);
  }
  return {
    domain,
    booleans: next_booleans,
    aliases: next_aliases,
  };
}

function semantic_bounded_offset_operation_matches(
  node: SemanticNode,
  requirement: SemanticBoundedOffsetRequirement,
  domain: MachineFactDomain,
): boolean {
  if (
    node.operation.tag !== "primitive" ||
    node.inputs.length !== 2 ||
    node.inputs[0] !== requirement.input ||
    node.inputs[1] !== requirement.offset ||
    node.outputs.length !== 1 ||
    node.outputs[0] !== requirement.result
  ) {
    return false;
  }
  const input_range = domain.ranges.get(requirement.input);
  const offset_range = domain.ranges.get(requirement.offset);
  const result_range = domain.ranges.get(requirement.result);
  if (
    input_range === undefined || offset_range === undefined ||
    result_range === undefined ||
    input_range.width !== offset_range.width ||
    input_range.signed !== offset_range.signed ||
    input_range.width !== result_range.width ||
    input_range.signed !== result_range.signed ||
    (input_range.width !== 32 && input_range.width !== 64)
  ) {
    return false;
  }
  const val_type = integer_val_type(input_range);
  if (val_type === undefined) return false;
  let primitive = val_type + ".add";
  if (requirement.operation === "subtract") primitive = val_type + ".sub";
  return node.operation.name === primitive;
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

function requirement_value(
  requirement: SemanticMachineRequirement,
): ValueId {
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

function integer_constant(
  value: string | number | bigint | boolean,
): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return undefined;
  }
  return BigInt(value);
}

function semantic_comparison_requirement(
  comparison: SemanticNode,
  branch_value: boolean,
  ranges: ReadonlyMap<ValueId, { signed: boolean; width: number }>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
): SemanticMachineRequirement | undefined {
  if (comparison.operation.tag !== "primitive") {
    return undefined;
  }
  if (comparison.operation.name.startsWith("range-has-next:")) {
    return semantic_range_requirement(
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
    left_range.signed !== right_range.signed ||
    left_range.width !== right_range.width ||
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
  const constant_requirement = comparison_with_constant(
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

function semantic_bitmask_requirement(
  comparison: SemanticNode,
  branch_value: boolean,
  ranges: ReadonlyMap<ValueId, { signed: boolean; width: number }>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
  aliases: ReadonlyMap<ValueId, ValueId>,
): SemanticMachineRequirement | undefined {
  const equality = semantic_comparison_requirement(
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
    left_range.width !== result_range.width ||
    left_range.signed !== result_range.signed ||
    right_range.width !== result_range.width ||
    right_range.signed !== result_range.signed
  ) {
    return undefined;
  }
  const left_constant = produced_integer_constant(left, producers);
  const right_constant = produced_integer_constant(right, producers);
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

function semantic_remainder_congruence_requirement(
  comparison: SemanticNode,
  branch_value: boolean,
  ranges: ReadonlyMap<ValueId, { signed: boolean; width: number }>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
  aliases: ReadonlyMap<ValueId, ValueId>,
): SemanticMachineRequirement | undefined {
  const equality = semantic_comparison_requirement(
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
    dividend_range.signed !== divisor_range.signed ||
    dividend_range.width !== divisor_range.width ||
    dividend_range.signed !== remainder_range.signed ||
    dividend_range.width !== remainder_range.width
  ) {
    return undefined;
  }
  const val_type = integer_val_type(dividend_range);
  if (val_type === undefined) return undefined;
  let primitive = val_type + ".rem_u";
  if (dividend_range.signed) primitive = val_type + ".rem_s";
  if (operation.operation.name !== primitive) return undefined;
  const produced_divisor = produced_integer_constant(
    divisor_value,
    producers,
  );
  if (produced_divisor === undefined) return undefined;
  let divisor = normalize_integer(divisor_range, produced_divisor);
  if (divisor === 0n) return undefined;
  if (divisor < 0n) divisor = -divisor;
  let residue = equality.proposition.expected % divisor;
  if (residue < 0n) residue += divisor;
  return {
    tag: "congruence",
    value: dividend,
    modulus: divisor,
    residue,
  };
}

function semantic_range_requirement(
  comparison: SemanticNode,
  branch_value: boolean,
  ranges: ReadonlyMap<ValueId, { signed: boolean; width: number }>,
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
    current_range.signed !== end_range.signed ||
    current_range.width !== end_range.width ||
    current_range.signed !== step_range.signed ||
    current_range.width !== step_range.width
  ) {
    return undefined;
  }
  const end_constant = produced_integer_constant(end, producers);
  const step_constant = produced_integer_constant(step, producers);
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
      return value_constant_requirement(
        "less_equal",
        current,
        normalized_end,
        false,
      );
    }
    if (branch_value && exclusive) {
      return value_constant_requirement(
        "less",
        current,
        normalized_end,
        false,
      );
    }
    if (inclusive) {
      return value_constant_requirement(
        "less",
        current,
        normalized_end,
        true,
      );
    }
    return value_constant_requirement(
      "less_equal",
      current,
      normalized_end,
      true,
    );
  }
  if (branch_value && inclusive) {
    return value_constant_requirement(
      "less_equal",
      current,
      normalized_end,
      true,
    );
  }
  if (branch_value && exclusive) {
    return value_constant_requirement(
      "less",
      current,
      normalized_end,
      true,
    );
  }
  if (inclusive) {
    return value_constant_requirement(
      "less",
      current,
      normalized_end,
      false,
    );
  }
  return value_constant_requirement(
    "less_equal",
    current,
    normalized_end,
    false,
  );
}

function comparison_primitive_matches_integer_type(
  primitive: string,
  type: { signed: boolean; width: number },
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

function comparison_with_constant(
  relation: "equal" | "not_equal" | "less" | "less_equal",
  left: ValueId,
  right: ValueId,
  ranges: ReadonlyMap<ValueId, { signed: boolean; width: number }>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
): SemanticMachineRequirement | undefined {
  const left_constant = produced_integer_constant(left, producers);
  const right_constant = produced_integer_constant(right, producers);
  const left_range = ranges.get(left);
  const right_range = ranges.get(right);
  if (
    right_constant !== undefined && left_range !== undefined &&
    right_range !== undefined
  ) {
    return value_constant_requirement(
      relation,
      left,
      normalize_integer(right_range, right_constant),
      false,
    );
  }
  if (
    left_constant !== undefined && right_range !== undefined &&
    left_range !== undefined
  ) {
    return value_constant_requirement(
      relation,
      right,
      normalize_integer(left_range, left_constant),
      true,
    );
  }
  return undefined;
}

function produced_integer_constant(
  value: ValueId,
  producers: ReadonlyMap<ValueId, SemanticNode>,
): bigint | undefined {
  const producer = producers.get(value);
  if (producer?.operation.tag !== "constant") return undefined;
  return integer_constant(producer.operation.value);
}

function value_constant_requirement(
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

function assume_machine_requirement(
  domain: MachineFactDomain,
  requirement: SemanticMachineRequirement,
): MachineFactDomain {
  if (requirement.tag === "fact") {
    return assume_machine_fact(domain, requirement.proposition);
  }
  if (requirement.tag === "bitmask") {
    return assume_machine_bitmask(
      domain,
      requirement.value,
      requirement.known_zero,
      requirement.known_one,
    );
  }
  if (requirement.tag === "congruence") {
    return assume_machine_congruence(
      domain,
      requirement.value,
      requirement.modulus,
      requirement.residue,
    );
  }
  if (requirement.tag === "difference") {
    return assume_machine_difference(
      domain,
      requirement.left,
      requirement.right,
      requirement.maximum,
    );
  }
  if (requirement.tag === "equality") {
    return assume_machine_equality(
      domain,
      requirement.left,
      requirement.right,
    );
  }
  if (requirement.tag === "disequality") {
    return assume_machine_disequality(
      domain,
      requirement.left,
      requirement.right,
    );
  }
  return exclude_machine_fact(domain, {
    tag: "equal",
    value: requirement.value,
    expected: requirement.expected,
  });
}

function machine_requirement_holds(
  domain: MachineFactDomain,
  requirement: SemanticMachineRequirement,
): boolean {
  if (requirement.tag === "fact") {
    return implies_machine_fact(domain, requirement.proposition);
  }
  if (requirement.tag === "bitmask") {
    return implies_machine_bitmask(
      domain,
      requirement.value,
      requirement.known_zero,
      requirement.known_one,
    );
  }
  if (requirement.tag === "congruence") {
    return implies_machine_congruence(
      domain,
      requirement.value,
      requirement.modulus,
      requirement.residue,
    );
  }
  if (requirement.tag === "difference") {
    return implies_machine_difference(
      domain,
      requirement.left,
      requirement.right,
      requirement.maximum,
    );
  }
  if (requirement.tag === "equality") {
    return implies_machine_equality(
      domain,
      requirement.left,
      requirement.right,
    );
  }
  if (requirement.tag === "disequality") {
    return implies_machine_disequality(
      domain,
      requirement.left,
      requirement.right,
    );
  }
  return machine_excludes_equal(
    domain,
    requirement.value,
    requirement.expected,
  );
}
