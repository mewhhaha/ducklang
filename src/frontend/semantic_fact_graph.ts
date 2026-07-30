import {
  integer_type_from_name,
  integer_val_type,
  normalize_integer,
} from "../integer.ts";
import {
  assume_machine_fact,
  exclude_machine_fact,
  implies_machine_fact,
  machine_excludes_equal,
  machine_fact_domain,
  type MachineFactDomain,
} from "./fact_graph.ts";
import { proof_limits } from "./proof_limits.ts";
import {
  type SemanticBlock,
  type SemanticBlockId,
  type SemanticCfg,
  type SemanticNode,
  unique_semantic_call_at_span,
} from "./semantic_cfg.ts";
import {
  semantic_machine_certificate,
  semantic_unreachable_certificate,
  type SemanticMachineCertificate,
  type SemanticMachineRequirement,
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
): SemanticMachinePathResult {
  const target = unique_semantic_call_at_span(control_flow, call_span);
  if (target === undefined) return "unknown";
  const ranges = new Map<ValueId, { signed: boolean; width: number }>();
  for (const value of control_flow.values) {
    if (value.type.tag !== "scalar") continue;
    const range = integer_type_from_name(value.type.name);
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
  if (target_block_can_repeat(target.block.id, blocks)) return "unknown";
  const producers = semantic_value_producers(control_flow);
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
            domain,
            aliased_machine_requirement(branch_requirement, aliases),
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

function requirement_value(
  requirement: SemanticMachineRequirement,
): ValueId {
  if (requirement.tag === "fact") return requirement.proposition.value;
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
  if (
    comparison.operation.tag !== "primitive" ||
    comparison.inputs.length !== 2
  ) {
    return undefined;
  }
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
  return comparison_with_constant(
    relation,
    expected_left,
    expected_right,
    ranges,
    producers,
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
  return machine_excludes_equal(
    domain,
    requirement.value,
    requirement.expected,
  );
}
