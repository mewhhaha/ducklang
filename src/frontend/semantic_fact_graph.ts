import {
  integer_maximum,
  integer_minimum,
  integer_type_from_name,
  integer_val_type,
  machine_integer_type_from_name,
  normalize_integer,
} from "../integer.ts";
import { type Prim, primitive_trap_conditions } from "../op.ts";
import { text_byte_offset_is_boundary } from "./text.ts";
import {
  assume_machine_bitmask,
  assume_machine_congruence,
  assume_machine_difference,
  assume_machine_disequality,
  assume_machine_equality,
  assume_machine_fact,
  assume_type_fact,
  exclude_machine_fact,
  exclude_type_fact,
  implies_machine_bitmask,
  implies_machine_congruence,
  implies_machine_difference,
  implies_machine_disequality,
  implies_machine_equality,
  implies_machine_fact,
  implies_type_fact,
  machine_excludes_equal,
  machine_fact_domain,
  type MachineFactDomain,
  transfer_machine_offset,
  transfer_type_facts,
  type_fact_domain,
  type TypeFactDomain,
} from "./fact_graph.ts";
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
  unique_semantic_primitive_at_span,
  unique_semantic_slice_at_span,
} from "./semantic_cfg.ts";
import {
  type RepresentationType,
  same_representation_type,
} from "./representation_type.ts";
import {
  semantic_bounded_offset_certificate,
  semantic_index_bounds_certificate,
  semantic_integer_narrowing_certificate,
  semantic_machine_certificate,
  semantic_primitive_safety_certificate,
  semantic_remainder_certificate,
  semantic_remainder_divisibility_certificate,
  semantic_slice_bounds_certificate,
  semantic_type_certificate,
  semantic_unreachable_certificate,
  type SemanticBoundedOffsetCertificate,
  type SemanticBoundedOffsetRequirement,
  type SemanticIndexBoundsCertificate,
  type SemanticIndexBoundsRequirement,
  type SemanticIntegerNarrowingCertificate,
  type SemanticIntegerNarrowingRequirement,
  type SemanticMachineCertificate,
  type SemanticMachineRequirement,
  type SemanticPrimitiveSafetyCertificate,
  type SemanticPrimitiveSafetyRequirement,
  type SemanticRemainderCertificate,
  type SemanticRemainderDivisibilityCertificate,
  type SemanticRemainderDivisibilityRequirement,
  type SemanticRemainderRequirement,
  type SemanticSliceBoundsCertificate,
  type SemanticSliceBoundsRequirement,
  type SemanticTypeCertificate,
  type SemanticTypeRequirement,
  type SemanticUnreachableCertificate,
  verify_semantic_bounded_offset_certificate,
} from "./semantic_fact_certificate.ts";
import type { ValueId } from "./semantic_identity.ts";
import type { SourceSpan } from "./syntax.ts";

export type { SemanticMachineRequirement } from "./semantic_fact_certificate.ts";
export type { SemanticTypeRequirement } from "./semantic_fact_certificate.ts";

type PathState = {
  block: SemanticBlockId;
  predecessor: SemanticBlockId | undefined;
  domain: MachineFactDomain;
  booleans: ReadonlyMap<ValueId, boolean>;
  aliases: ReadonlyMap<ValueId, ValueId>;
  visited: ReadonlySet<SemanticBlockId>;
};

type TypePathState = {
  block: SemanticBlockId;
  predecessor: SemanticBlockId | undefined;
  domain: TypeFactDomain;
  aliases: ReadonlyMap<ValueId, ValueId>;
  booleans: ReadonlyMap<ValueId, boolean>;
  tests: ReadonlyMap<ValueId, Omit<SemanticTypeRequirement, "expected">>;
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

export function infer_semantic_index_bounds_certificate(
  control_flow: SemanticCfg,
  index_span: SourceSpan,
  requirement: SemanticIndexBoundsRequirement,
): SemanticIndexBoundsCertificate | undefined {
  if (!semantic_cfg_is_well_formed(control_flow)) return undefined;
  const target = unique_semantic_index_at_span(control_flow, index_span);
  if (target === undefined || target.node.operation.tag !== "index") {
    return undefined;
  }
  if (target.node.inputs[1] !== requirement.index) return undefined;
  let upper: SemanticMachineRequirement;
  if (requirement.length !== undefined) {
    if (
      !Number.isSafeInteger(requirement.length) ||
      requirement.length < 0 ||
      target.node.operation.length !== requirement.length
    ) {
      return undefined;
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
      !semantic_index_has_length_measure(
        control_flow,
        index_span,
        requirement,
      )
    ) {
      return undefined;
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
  if (
    semantic_cfg_machine_path_result_at_target(
        control_flow,
        target,
        lower,
      ) !== "proved" ||
    semantic_cfg_machine_path_result_at_target(
        control_flow,
        target,
        upper,
      ) !== "proved"
  ) {
    return undefined;
  }
  return semantic_index_bounds_certificate(index_span, requirement);
}

export function semantic_index_has_length_measure(
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
  const aliases = loop_invariant_aliases(control_flow);
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

export function semantic_index_is_unreachable(
  control_flow: SemanticCfg,
  index_span: SourceSpan,
): boolean {
  if (!semantic_cfg_is_well_formed(control_flow)) return false;
  const target = unique_semantic_index_at_span(control_flow, index_span);
  if (target === undefined) return false;
  return semantic_cfg_machine_path_result_at_target(
    control_flow,
    target,
    undefined,
  ) === "unreachable";
}

export function semantic_index_is_disproved(
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
      !semantic_index_has_length_measure(
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
  return semantic_cfg_machine_path_result_at_target(
    control_flow,
    target,
    below_zero,
    undefined,
    above_upper,
  ) === "proved";
}

export function infer_semantic_integer_narrowing_certificate(
  control_flow: SemanticCfg,
  operation_span: SourceSpan,
  requirement: SemanticIntegerNarrowingRequirement,
): SemanticIntegerNarrowingCertificate | undefined {
  if (!semantic_cfg_is_well_formed(control_flow)) return undefined;
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
    return undefined;
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
  if (
    semantic_cfg_machine_path_result_at_target(
        control_flow,
        target,
        lower,
      ) !== "proved" ||
    semantic_cfg_machine_path_result_at_target(
        control_flow,
        target,
        upper,
      ) !== "proved"
  ) {
    return undefined;
  }
  return semantic_integer_narrowing_certificate(
    operation_span,
    requirement,
  );
}

export function semantic_integer_narrowing_is_unreachable(
  control_flow: SemanticCfg,
  operation_span: SourceSpan,
): boolean {
  if (!semantic_cfg_is_well_formed(control_flow)) return false;
  const target = unique_semantic_narrowing_at_span(
    control_flow,
    operation_span,
  );
  if (target === undefined) return false;
  return semantic_cfg_machine_path_result_at_target(
    control_flow,
    target,
    undefined,
  ) === "unreachable";
}

export function semantic_integer_narrowing_is_disproved(
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
  return semantic_cfg_machine_path_result_at_target(
    control_flow,
    target,
    below_target,
    undefined,
    above_target,
  ) === "proved";
}

export function infer_semantic_slice_bounds_certificate(
  control_flow: SemanticCfg,
  operation_span: SourceSpan,
  requirement: SemanticSliceBoundsRequirement,
): SemanticSliceBoundsCertificate | undefined {
  if (!semantic_cfg_is_well_formed(control_flow)) return undefined;
  const target = unique_semantic_slice_at_span(control_flow, operation_span);
  if (
    target === undefined ||
    target.node.inputs[0] !== requirement.object ||
    target.node.inputs[1] !== requirement.start ||
    target.node.inputs[2] !== requirement.end
  ) {
    return undefined;
  }
  let object_type = control_flow.values.find((value) =>
    value.value === requirement.object
  )?.type;
  if (object_type === undefined) return undefined;
  while (object_type.tag === "owned") object_type = object_type.value;
  const is_text = object_type.tag === "scalar" &&
    object_type.name === "Text";
  const is_bytes = object_type.tag === "scalar" &&
    object_type.name === "Bytes";
  if (!is_text && !is_bytes) return undefined;
  if (is_bytes && requirement.utf8_boundaries !== undefined) {
    return undefined;
  }
  if (is_text) {
    if (requirement.utf8_boundaries !== "static_literal") return undefined;
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
          start_constant = integer_constant(node.operation.value);
        }
        if (output === requirement.end) {
          end_constant = integer_constant(node.operation.value);
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
      return undefined;
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
      return undefined;
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
    const invariant_aliases = loop_invariant_aliases(control_flow);
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
      return undefined;
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
  const lower_result = semantic_cfg_machine_path_result_at_target(
    control_flow,
    target,
    lower,
  );
  const ordered_result = semantic_cfg_machine_path_result_at_target(
    control_flow,
    target,
    ordered,
  );
  const upper_result = semantic_cfg_machine_path_result_at_target(
    control_flow,
    target,
    upper,
  );
  if (
    lower_result !== "proved" ||
    ordered_result !== "proved" ||
    upper_result !== "proved"
  ) {
    return undefined;
  }
  return semantic_slice_bounds_certificate(operation_span, requirement);
}

export function semantic_slice_is_unreachable(
  control_flow: SemanticCfg,
  operation_span: SourceSpan,
): boolean {
  if (!semantic_cfg_is_well_formed(control_flow)) return false;
  const target = unique_semantic_slice_at_span(control_flow, operation_span);
  if (target === undefined) return false;
  return semantic_cfg_machine_path_result_at_target(
    control_flow,
    target,
    undefined,
  ) === "unreachable";
}

export function semantic_slice_is_disproved(
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
    const aliases = loop_invariant_aliases(control_flow);
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
      semantic_cfg_machine_path_result_at_target(
        control_flow,
        target,
        violation,
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
        semantic_cfg_machine_path_result_at_target(
          control_flow,
          target,
          violation,
          undefined,
          alternative,
        ) === "proved"
      ) {
        return true;
      }
    }
  }
  return false;
}

export function infer_semantic_primitive_safety_certificate(
  control_flow: SemanticCfg,
  operation_span: SourceSpan,
  primitive: Prim,
): SemanticPrimitiveSafetyCertificate | undefined {
  if (!semantic_cfg_is_well_formed(control_flow)) return undefined;
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
    return undefined;
  }
  const dividend = target.node.inputs[0];
  const divisor = target.node.inputs[1];
  const result = target.node.outputs[0];
  if (
    dividend === undefined || divisor === undefined || result === undefined
  ) {
    return undefined;
  }
  const value_types = new Map(
    control_flow.values.map((value) => [value.value, value.type]),
  );
  const dividend_type = value_types.get(dividend);
  const divisor_type = value_types.get(divisor);
  const result_type = value_types.get(result);
  let dividend_range: { signed: boolean; width: number } | undefined;
  let divisor_range: { signed: boolean; width: number } | undefined;
  let result_range: { signed: boolean; width: number } | undefined;
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
    return undefined;
  }
  const val_type = integer_val_type(dividend_range);
  if (val_type === undefined) return undefined;
  let expected_primitive = val_type + ".rem_";
  if (primitive.includes(".div_")) expected_primitive = val_type + ".div_";
  if (dividend_range.signed) {
    expected_primitive += "s";
  } else {
    expected_primitive += "u";
  }
  if (primitive !== expected_primitive) return undefined;
  const trap_conditions = primitive_trap_conditions(primitive);
  if (!trap_conditions.includes("nonzero_divisor")) return undefined;
  const nonzero: SemanticMachineRequirement = {
    tag: "exclusion",
    value: divisor,
    expected: 0n,
  };
  if (
    semantic_cfg_machine_path_result_at_target(
      control_flow,
      target,
      nonzero,
    ) !== "proved"
  ) {
    return undefined;
  }
  const requirement: SemanticPrimitiveSafetyRequirement = {
    primitive,
    dividend,
    divisor,
  };
  if (trap_conditions.includes("signed_division_overflow")) {
    if (!dividend_range.signed) return undefined;
    const dividend_guard: SemanticMachineRequirement = {
      tag: "exclusion",
      value: dividend,
      expected: integer_minimum(dividend_range),
    };
    if (
      semantic_cfg_machine_path_result_at_target(
        control_flow,
        target,
        dividend_guard,
      ) === "proved"
    ) {
      requirement.overflow_guard = "dividend_not_minimum";
    } else {
      const divisor_guard: SemanticMachineRequirement = {
        tag: "exclusion",
        value: divisor,
        expected: -1n,
      };
      if (
        semantic_cfg_machine_path_result_at_target(
          control_flow,
          target,
          divisor_guard,
        ) !== "proved"
      ) {
        if (
          semantic_cfg_machine_path_result_at_target(
            control_flow,
            target,
            dividend_guard,
            undefined,
            divisor_guard,
          ) !== "proved"
        ) {
          return undefined;
        }
        requirement.overflow_guard = "pathwise_disjunction";
      } else {
        requirement.overflow_guard = "divisor_not_negative_one";
      }
    }
  }
  return semantic_primitive_safety_certificate(
    operation_span,
    requirement,
  );
}

export function semantic_primitive_is_unreachable(
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
  return semantic_cfg_machine_path_result_at_target(
    control_flow,
    target,
    undefined,
  ) === "unreachable";
}

export function semantic_primitive_is_disproved(
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
  let dividend_range: { signed: boolean; width: number } | undefined;
  let divisor_range: { signed: boolean; width: number } | undefined;
  let result_range: { signed: boolean; width: number } | undefined;
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
    return semantic_cfg_machine_path_result_at_target(
      control_flow,
      target,
      divisor_zero,
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
  return semantic_cfg_machine_path_result_at_target(
        control_flow,
        target,
        divisor_zero,
        undefined,
        dividend_minimum,
      ) === "proved" &&
    semantic_cfg_machine_path_result_at_target(
        control_flow,
        target,
        divisor_zero,
        undefined,
        divisor_negative_one,
      ) === "proved";
}

export function infer_semantic_type_certificate(
  control_flow: SemanticCfg,
  call_span: SourceSpan,
  requirement: SemanticTypeRequirement,
): SemanticTypeCertificate | undefined {
  if (
    typeof requirement.type !== "string" || requirement.type.length === 0 ||
    semantic_cfg_type_path_result(control_flow, call_span, requirement) !==
      "proved"
  ) {
    return undefined;
  }
  return semantic_type_certificate(call_span, requirement);
}

export function infer_semantic_bounded_offset_certificate(
  control_flow: SemanticCfg,
  call_span: SourceSpan,
  requirement: SemanticBoundedOffsetRequirement,
): SemanticBoundedOffsetCertificate | undefined {
  const certificate = semantic_bounded_offset_certificate(
    call_span,
    requirement,
  );
  if (
    !verify_semantic_bounded_offset_certificate(
      certificate,
      control_flow,
      call_span,
      requirement,
    )
  ) {
    return undefined;
  }
  return certificate;
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
  return semantic_cfg_machine_path_result_at_target(
    control_flow,
    target,
    requirement,
    bounded_offset,
  );
}

function semantic_cfg_machine_path_result_at_target(
  control_flow: SemanticCfg,
  target: { block: SemanticBlock; node: SemanticNode },
  requirement: SemanticMachineRequirement | undefined,
  bounded_offset?: SemanticBoundedOffsetRequirement,
  alternative_requirement?: SemanticMachineRequirement,
  check_repetition = true,
): SemanticMachinePathResult {
  const ranges = new Map<ValueId, { signed: boolean; width: number }>();
  for (const value of control_flow.values) {
    let range: { signed: boolean; width: number } | undefined;
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
  if (
    requirement !== undefined &&
    !requirement_has_range(requirement, ranges)
  ) {
    return "unknown";
  }
  if (
    alternative_requirement !== undefined &&
    !requirement_has_range(alternative_requirement, ranges)
  ) {
    return "unknown";
  }
  const blocks = new Map(
    control_flow.blocks.map((block) => [block.id, block]),
  );
  const producers = semantic_value_producers(control_flow);
  if (
    requirement === undefined &&
    target_has_impossible_dominating_branch(
      control_flow,
      target.block.id,
      ranges,
      producers,
    )
  ) {
    return "unreachable";
  }
  if (check_repetition && target_block_can_repeat(target.block.id, blocks)) {
    if (bounded_offset !== undefined) return "unknown";
    if (
      requirement !== undefined &&
      repeating_call_requirement_holds(
        control_flow,
        target,
        requirement,
        ranges,
        producers,
        alternative_requirement,
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
          !(
            machine_requirement_holds(
              domain,
              aliased_machine_requirement(requirement, aliases),
            ) ||
            (
              alternative_requirement !== undefined &&
              machine_requirement_holds(
                domain,
                aliased_machine_requirement(
                  alternative_requirement,
                  aliases,
                ),
              )
            )
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

function semantic_cfg_type_path_result(
  control_flow: SemanticCfg,
  call_span: SourceSpan,
  requirement: SemanticTypeRequirement,
): "proved" | "unproved" | "unknown" {
  if (!semantic_cfg_is_well_formed(control_flow)) return "unknown";
  const target = unique_semantic_call_at_span(control_flow, call_span);
  if (target === undefined) return "unknown";
  const blocks = new Map(
    control_flow.blocks.map((block) => [block.id, block]),
  );
  const value_types = new Map(
    control_flow.values.map((value) => [value.value, value.type]),
  );
  if (target_block_can_repeat(target.block.id, blocks)) return "unknown";
  const reaches_target = blocks_reaching_target(target.block.id, blocks);
  const entry_counts = new Map<SemanticBlockId, number>();
  entry_counts.set(control_flow.entry, 1);
  const pending: TypePathState[] = [{
    block: control_flow.entry,
    predecessor: undefined,
    domain: type_fact_domain(),
    aliases: new Map(),
    booleans: new Map(),
    tests: new Map(),
    visited: new Set(),
  }];
  let paths = 0;
  let steps = 0;
  while (pending.length > 0) {
    steps += 1;
    if (steps > proof_limits.compiler_search_steps) return "unknown";
    const state = pending.pop();
    if (state === undefined || state.visited.has(state.block)) return "unknown";
    const visited = new Set(state.visited);
    visited.add(state.block);
    if (visited.size > proof_limits.compiler_search_depth) return "unknown";
    const block = blocks.get(state.block);
    if (block === undefined) return "unknown";
    let domain = state.domain;
    let aliases = new Map(state.aliases);
    let booleans = new Map(state.booleans);
    let tests = new Map(state.tests);
    let reached_call = false;
    for (const node of block.nodes) {
      steps += 1;
      if (steps > proof_limits.compiler_search_steps) return "unknown";
      if (node === target.node) {
        reached_call = true;
        if (!domain.reachable) break;
        paths += 1;
        if (
          !implies_type_fact(
            domain,
            {
              value: resolved_type_alias(requirement.value, aliases),
              type: requirement.type,
            },
            requirement.expected,
          )
        ) {
          return "unproved";
        }
        break;
      }
      const transferred = transfer_semantic_type_node(
        node,
        state.predecessor,
        domain,
        aliases,
        booleans,
        tests,
        value_types,
      );
      domain = transferred.domain;
      aliases = transferred.aliases;
      booleans = transferred.booleans;
      tests = transferred.tests;
    }
    if (reached_call || block.id === target.block.id) continue;
    if (!domain.reachable) continue;
    if (block.terminator.tag !== "branch") {
      for (const successor of block.successors) {
        if (!reaches_target.has(successor)) continue;
        if (
          !enqueue_type_path(
            pending,
            entry_counts,
            {
              block: successor,
              predecessor: block.id,
              domain,
              aliases,
              booleans,
              tests,
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
      let branch_domain = domain;
      if (type_test !== undefined) {
        const fact = { value: type_test.value, type: type_test.type };
        if (branch_value) {
          branch_domain = assume_type_fact(branch_domain, fact);
        } else {
          branch_domain = exclude_type_fact(branch_domain, fact);
        }
      }
      if (!branch_domain.reachable) continue;
      if (
        !enqueue_type_path(
          pending,
          entry_counts,
          {
            block: successor,
            predecessor: block.id,
            domain: branch_domain,
            aliases,
            booleans,
            tests,
            visited,
          },
        )
      ) {
        return "unknown";
      }
    }
  }
  if (paths === 0) return "unknown";
  return "proved";
}

function transfer_semantic_type_node(
  node: SemanticNode,
  predecessor: SemanticBlockId | undefined,
  current_domain: TypeFactDomain,
  current_aliases: ReadonlyMap<ValueId, ValueId>,
  current_booleans: ReadonlyMap<ValueId, boolean>,
  current_tests: ReadonlyMap<
    ValueId,
    Omit<SemanticTypeRequirement, "expected">
  >,
  value_types: ReadonlyMap<ValueId, RepresentationType>,
): {
  domain: TypeFactDomain;
  aliases: Map<ValueId, ValueId>;
  booleans: Map<ValueId, boolean>;
  tests: Map<ValueId, Omit<SemanticTypeRequirement, "expected">>;
} {
  let domain = current_domain;
  const aliases = new Map(current_aliases);
  const booleans = new Map(current_booleans);
  const tests = new Map(current_tests);
  const output = node.outputs[0];
  if (node.operation.tag === "constant" && output !== undefined) {
    if (typeof node.operation.value === "boolean") {
      booleans.set(output, node.operation.value);
    }
    return { domain, aliases, booleans, tests };
  }
  if (
    node.operation.tag === "type_test" &&
    node.inputs.length === 1 &&
    output !== undefined
  ) {
    const input = node.inputs[0];
    if (input !== undefined) {
      tests.set(output, {
        value: resolved_type_alias(input, aliases),
        type: node.operation.type,
      });
    }
    return { domain, aliases, booleans, tests };
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
      aliases.set(output, resolved_type_alias(input, aliases));
      const input_boolean = booleans.get(input);
      if (input_boolean !== undefined) booleans.set(output, input_boolean);
      const input_test = tests.get(input);
      if (input_test !== undefined) tests.set(output, input_test);
    }
    return { domain, aliases, booleans, tests };
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
      domain = transfer_type_facts(
        domain,
        resolved_type_alias(input, aliases),
        output,
      );
      const input_boolean = booleans.get(input);
      if (input_boolean !== undefined) booleans.set(output, input_boolean);
      const input_test = tests.get(input);
      if (input_test !== undefined) tests.set(output, input_test);
    }
    return { domain, aliases, booleans, tests };
  }
  if (
    node.operation.tag !== "phi" || predecessor === undefined ||
    output === undefined
  ) {
    return { domain, aliases, booleans, tests };
  }
  const incoming = node.operation.incoming.find((candidate) =>
    candidate.predecessor === predecessor
  );
  if (incoming === undefined) return { domain, aliases, booleans, tests };
  const incoming_boolean = booleans.get(incoming.value);
  if (incoming_boolean !== undefined) booleans.set(output, incoming_boolean);
  const incoming_test = tests.get(incoming.value);
  if (incoming_test !== undefined) tests.set(output, incoming_test);
  const incoming_alias = resolved_type_alias(incoming.value, aliases);
  aliases.set(output, incoming_alias);
  return { domain, aliases, booleans, tests };
}

function resolved_type_alias(
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

function enqueue_type_path(
  pending: TypePathState[],
  entry_counts: Map<SemanticBlockId, number>,
  state: TypePathState,
): boolean {
  let count = 1;
  const previous = entry_counts.get(state.block);
  if (previous !== undefined) count = previous + 1;
  if (count > proof_limits.maximum_formula_disjuncts) return false;
  entry_counts.set(state.block, count);
  pending.push(state);
  return true;
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

function target_has_impossible_dominating_branch(
  control_flow: SemanticCfg,
  target: SemanticBlockId,
  ranges: ReadonlyMap<ValueId, { signed: boolean; width: number }>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
): boolean {
  const target_dominators = semantic_block_dominators(control_flow).get(
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
      truth = inferred_comparison_truth(condition, ranges, producers);
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

function inferred_comparison_truth(
  comparison: SemanticNode,
  ranges: ReadonlyMap<ValueId, { signed: boolean; width: number }>,
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
      const candidate = produced_integer_constant(incoming.value, producers);
      if (candidate !== undefined) {
        start = candidate;
        break;
      }
    }
    const end_constant = produced_integer_constant(end, producers);
    const step_constant = produced_integer_constant(step, producers);
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
  const left_constant = produced_integer_constant(left, producers);
  const right_constant = produced_integer_constant(right, producers);
  const left_range = ranges.get(left);
  const right_range = ranges.get(right);
  if (
    left_constant === undefined || right_constant === undefined ||
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
  const primitive = comparison.operation.name;
  const normalized_left = normalize_integer(left_range, left_constant);
  const normalized_right = normalize_integer(right_range, right_constant);
  if (primitive.endsWith(".eq")) return normalized_left === normalized_right;
  if (primitive.endsWith(".ne")) return normalized_left !== normalized_right;
  if (primitive.endsWith(".lt_s") || primitive.endsWith(".lt_u")) {
    return normalized_left < normalized_right;
  }
  if (primitive.endsWith(".le_s") || primitive.endsWith(".le_u")) {
    return normalized_left <= normalized_right;
  }
  if (primitive.endsWith(".gt_s") || primitive.endsWith(".gt_u")) {
    return normalized_left > normalized_right;
  }
  if (primitive.endsWith(".ge_s") || primitive.endsWith(".ge_u")) {
    return normalized_left >= normalized_right;
  }
  return undefined;
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
  target: { block: SemanticBlock; node: SemanticNode },
  requirement: SemanticMachineRequirement,
  ranges: ReadonlyMap<ValueId, { signed: boolean; width: number }>,
  producers: ReadonlyMap<ValueId, SemanticNode>,
  alternative_requirement?: SemanticMachineRequirement,
): boolean {
  const dominators = semantic_block_dominators(control_flow);
  const target_dominators = dominators.get(target.block.id);
  if (target_dominators === undefined) return false;
  const blocks = new Map(
    control_flow.blocks.map((block) => [block.id, block]),
  );
  let aliases = new Map(loop_invariant_aliases(control_flow));
  const resolved_requirement = aliased_machine_requirement(
    requirement,
    aliases,
  );
  let resolved_alternative: SemanticMachineRequirement | undefined;
  if (alternative_requirement !== undefined) {
    resolved_alternative = aliased_machine_requirement(
      alternative_requirement,
      aliases,
    );
  }
  let invariant_requirement = true;
  const requirement_values = [requirement_value(resolved_requirement)];
  if (
    resolved_requirement.tag === "difference" ||
    resolved_requirement.tag === "equality" ||
    resolved_requirement.tag === "disequality"
  ) {
    requirement_values.push(resolved_requirement.right);
  }
  if (resolved_alternative !== undefined) {
    requirement_values.push(requirement_value(resolved_alternative));
    if (
      resolved_alternative.tag === "difference" ||
      resolved_alternative.tag === "equality" ||
      resolved_alternative.tag === "disequality"
    ) {
      requirement_values.push(resolved_alternative.right);
    }
  }
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
    loop_entry_node !== undefined
  ) {
    const entry_result = semantic_cfg_machine_path_result_at_target(
      control_flow,
      { block: loop_entry, node: loop_entry_node },
      resolved_requirement,
      undefined,
      resolved_alternative,
      false,
    );
    if (entry_result === "proved") return true;
  }
  let domain = machine_fact_domain(ranges);
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
    const comparison = producers.get(block.terminator.condition);
    if (comparison === undefined) continue;
    const repeating_block = target_block_can_repeat(block.id, blocks);
    if (repeating_block) {
      if (
        comparison.operation.tag !== "primitive" ||
        !comparison.operation.name.startsWith("range-has-next:")
      ) {
        continue;
      }
      const range_requirement = semantic_comparison_requirement(
        comparison,
        branch_value,
        ranges,
        producers,
      );
      if (range_requirement !== undefined) {
        domain = assume_machine_requirement(
          domain,
          aliased_machine_requirement(range_requirement, aliases),
        );
      }
      const range_invariant = semantic_range_induction_requirement(
        comparison,
        branch_value,
        ranges,
        producers,
      );
      if (range_invariant !== undefined) {
        domain = assume_machine_requirement(
          domain,
          aliased_machine_requirement(range_invariant, aliases),
        );
      }
      continue;
    }
    const premise = semantic_comparison_requirement(
      comparison,
      branch_value,
      ranges,
      producers,
    );
    if (premise !== undefined) {
      domain = assume_machine_requirement(
        domain,
        aliased_machine_requirement(premise, aliases),
      );
    }
    const range_invariant = semantic_range_induction_requirement(
      comparison,
      branch_value,
      ranges,
      producers,
    );
    if (range_invariant !== undefined) {
      domain = assume_machine_requirement(
        domain,
        aliased_machine_requirement(range_invariant, aliases),
      );
    }
    const bitmask_premise = semantic_bitmask_requirement(
      comparison,
      branch_value,
      ranges,
      producers,
      new Map(),
    );
    if (bitmask_premise !== undefined) {
      domain = assume_machine_requirement(
        domain,
        aliased_machine_requirement(bitmask_premise, aliases),
      );
    }
    const congruence_premise = semantic_remainder_congruence_requirement(
      comparison,
      branch_value,
      ranges,
      producers,
      new Map(),
    );
    if (congruence_premise !== undefined) {
      domain = assume_machine_requirement(
        domain,
        aliased_machine_requirement(congruence_premise, aliases),
      );
    }
  }
  let booleans = new Map<ValueId, boolean>();
  for (const node of target.block.nodes) {
    if (node === target.node) break;
    const transferred = transfer_semantic_node(
      node,
      undefined,
      domain,
      booleans,
      aliases,
      undefined,
    );
    domain = transferred.domain;
    booleans = transferred.booleans;
    aliases = transferred.aliases;
  }
  const requirement_holds = machine_requirement_holds(
    domain,
    aliased_machine_requirement(requirement, aliases),
  );
  if (requirement_holds || alternative_requirement === undefined) {
    return requirement_holds;
  }
  return machine_requirement_holds(
    domain,
    aliased_machine_requirement(alternative_requirement, aliases),
  );
}

function loop_invariant_aliases(
  control_flow: SemanticCfg,
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
          !aliases.has(output)
        ) {
          const input = node.inputs[0];
          if (input === undefined) continue;
          const resolved = resolved_alias(input, aliases);
          if (resolved === undefined) continue;
          aliases.set(output, resolved);
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
        let invariant: ValueId | undefined;
        let varies = false;
        for (const incoming of node.operation.incoming) {
          const resolved = resolved_alias(incoming.value, aliases);
          if (resolved === undefined) {
            varies = true;
            break;
          }
          if (resolved === output) continue;
          if (invariant === undefined) {
            invariant = resolved;
            continue;
          }
          if (resolved !== invariant) varies = true;
        }
        if (!varies && invariant !== undefined) {
          aliases.set(output, invariant);
          aliases_changed = true;
        }
      }
    }
  }
  return aliases;
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

function semantic_range_induction_requirement(
  comparison: SemanticNode,
  branch_value: boolean,
  ranges: ReadonlyMap<ValueId, { signed: boolean; width: number }>,
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
    range.signed !== end_range.signed || range.width !== end_range.width ||
    range.signed !== step_range.signed || range.width !== step_range.width
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
    if (produced_integer_constant(incoming.value, producers) !== undefined) {
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
  const start_constant = produced_integer_constant(start_value, producers);
  const end_constant = produced_integer_constant(end, producers);
  const step_constant = produced_integer_constant(step, producers);
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
    if (
      maximum_body_value > integer_maximum(range) - range_step
    ) {
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
