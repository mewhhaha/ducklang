import type { ValueId } from "./semantic_identity.ts";
import {
  integer_maximum,
  integer_minimum,
  type IntegerType,
  normalize_integer,
} from "../integer.ts";
import { proof_limits } from "./proof_limits.ts";

export type ScalarFact =
  | { tag: "bottom" }
  | { tag: "unknown" }
  | { tag: "exact"; value: bigint }
  | { tag: "interval"; minimum: bigint; maximum: bigint };

export type FactEnvironment = ReadonlyMap<ValueId, ScalarFact>;

export type FactState = {
  reachable: boolean;
  facts: FactEnvironment;
};

export type FactOrigin = {
  start: number;
  end: number;
};

export type FactSafety =
  | { tag: "safe" }
  | { tag: "unsafe"; origins: readonly FactOrigin[] };

export type FactEvidence = {
  proposition: FactProposition;
  fact: ScalarFact;
  origins: readonly FactOrigin[];
  safety: FactSafety;
};

export function establish_fact(
  proposition: FactProposition,
  origins: readonly FactOrigin[] = [],
  safety: FactSafety = { tag: "safe" },
): FactEvidence {
  const stable_proposition = snapshot_proposition(proposition);
  const stable_origins = origins.map((origin) => Object.freeze({ ...origin }));
  let stable_safety: FactSafety;
  if (safety.tag === "safe") {
    stable_safety = Object.freeze({ tag: "safe" });
  } else {
    stable_safety = Object.freeze({
      tag: "unsafe",
      origins: Object.freeze(
        safety.origins.map((origin) => Object.freeze({ ...origin })),
      ),
    });
  }
  return Object.freeze({
    proposition: stable_proposition,
    fact: Object.freeze(proposition_fact(stable_proposition)),
    origins: Object.freeze(stable_origins),
    safety: stable_safety,
  });
}

function snapshot_proposition(proposition: FactProposition): FactProposition {
  return Object.freeze({ ...proposition });
}

export type FactProposition =
  | { tag: "equal"; value: ValueId; expected: bigint }
  | { tag: "less_than"; value: ValueId; bound: bigint }
  | { tag: "less_equal"; value: ValueId; bound: bigint }
  | { tag: "greater_than"; value: ValueId; bound: bigint }
  | { tag: "greater_equal"; value: ValueId; bound: bigint };

export type MachineInteger = IntegerType;
export type MachineOffsetOperation = "add" | "subtract";
export type MachineBitwiseOperation = "and" | "or" | "xor";
export type MachineCongruence = {
  modulus: bigint;
  residue: bigint;
};
export type MachineBitmask = {
  known_zero: bigint;
  known_one: bigint;
};
type MachineWitnessSearch =
  | { tag: "found"; value: bigint }
  | { tag: "none" }
  | { tag: "unknown" };

const MACHINE_DOMAIN_TOKEN = Symbol("duck.machine_fact_domain");
const TRUSTED_MACHINE_DOMAINS = new WeakSet<object>();

export class MachineFactDomain {
  readonly #brand = true;
  readonly reachable: boolean;
  readonly facts: FactEnvironment;
  readonly ranges: ReadonlyMap<ValueId, MachineInteger>;
  readonly evidence: ReadonlyMap<ValueId, readonly FactEvidence[]>;
  readonly exclusions: ReadonlyMap<ValueId, readonly bigint[]>;
  readonly congruences: ReadonlyMap<ValueId, readonly MachineCongruence[]>;
  readonly bitmasks: ReadonlyMap<ValueId, MachineBitmask>;

  constructor(
    token: symbol,
    reachable: boolean,
    facts: FactEnvironment,
    ranges: ReadonlyMap<ValueId, MachineInteger>,
    evidence: ReadonlyMap<ValueId, readonly FactEvidence[]>,
    exclusions: ReadonlyMap<ValueId, readonly bigint[]>,
    congruences: ReadonlyMap<ValueId, readonly MachineCongruence[]>,
    bitmasks: ReadonlyMap<ValueId, MachineBitmask>,
  ) {
    if (token !== MACHINE_DOMAIN_TOKEN) {
      throw new Error(
        "MachineFactDomain must be created by FactGraph transitions.",
      );
    }
    this.reachable = reachable;
    this.facts = immutable_environment(facts);
    this.ranges = snapshot_machine_ranges(ranges);
    this.evidence = snapshot_machine_evidence(evidence);
    this.exclusions = snapshot_machine_exclusions(exclusions);
    this.congruences = snapshot_machine_congruences(congruences);
    this.bitmasks = snapshot_machine_bitmasks(bitmasks);
    Object.freeze(this);
    TRUSTED_MACHINE_DOMAINS.add(this);
  }
}

export function machine_range(
  type: MachineInteger,
): { minimum: bigint; maximum: bigint } {
  validate_machine_integer(type);
  return Object.freeze({
    minimum: integer_minimum(type),
    maximum: integer_maximum(type),
  });
}

export function normalize_machine_integer(
  value: bigint,
  type: MachineInteger,
): bigint {
  validate_machine_integer(type);
  return normalize_integer(type, value);
}

export function transfer_machine_offset(
  domain: MachineFactDomain,
  operation: MachineOffsetOperation,
  input: ValueId,
  offset: ValueId,
  result: ValueId,
): MachineFactDomain {
  assert_machine_domain(domain);
  if (operation !== "add" && operation !== "subtract") {
    throw new Error(`Unknown machine offset operation ${String(operation)}.`);
  }
  if (!domain.reachable) return domain;
  const input_range = domain.ranges.get(input);
  const offset_range = domain.ranges.get(offset);
  const result_range = domain.ranges.get(result);
  if (
    input_range === undefined || offset_range === undefined ||
    result_range === undefined
  ) {
    throw new Error(
      `Machine offset ${input}, ${offset}, ${result} is missing a range.`,
    );
  }
  if (
    input_range.width !== offset_range.width ||
    input_range.signed !== offset_range.signed ||
    input_range.width !== result_range.width ||
    input_range.signed !== result_range.signed
  ) {
    throw new Error(
      `Machine offset ${input}, ${offset}, ${result} has incompatible ranges.`,
    );
  }
  const input_fact = domain.facts.get(input);
  const offset_fact = domain.facts.get(offset);
  if (
    input_fact === undefined || input_fact.tag === "unknown" ||
    input_fact.tag === "bottom" || offset_fact === undefined ||
    offset_fact.tag !== "exact"
  ) {
    return replace_machine_fact(domain, result, undefined);
  }
  const input_bounds = fact_bounds(input_fact);
  let minimum = input_bounds.minimum + offset_fact.value;
  let maximum = input_bounds.maximum + offset_fact.value;
  if (operation === "subtract") {
    minimum = input_bounds.minimum - offset_fact.value;
    maximum = input_bounds.maximum - offset_fact.value;
  }
  const range = machine_range(result_range);
  if (minimum < range.minimum || maximum > range.maximum) {
    return replace_machine_fact(domain, result, undefined);
  }
  let transferred = replace_machine_fact(
    domain,
    result,
    bounded_interval(minimum, maximum),
  );
  const congruences = domain.congruences.get(input);
  if (congruences === undefined) return transferred;
  for (const congruence of congruences) {
    let result_residue = congruence.residue + offset_fact.value;
    if (operation === "subtract") {
      result_residue = congruence.residue - offset_fact.value;
    }
    transferred = assume_machine_congruence(
      transferred,
      result,
      congruence.modulus,
      result_residue,
    );
  }
  return transferred;
}

export function transfer_machine_bitwise(
  domain: MachineFactDomain,
  operation: MachineBitwiseOperation,
  left: ValueId,
  right: ValueId,
  result: ValueId,
): MachineFactDomain {
  assert_machine_domain(domain);
  if (operation !== "and" && operation !== "or" && operation !== "xor") {
    throw new Error(`Unknown machine bitwise operation ${String(operation)}.`);
  }
  if (!domain.reachable) return domain;
  const left_range = domain.ranges.get(left);
  const right_range = domain.ranges.get(right);
  const result_range = domain.ranges.get(result);
  if (
    left_range === undefined || right_range === undefined ||
    result_range === undefined
  ) {
    throw new Error(
      `Machine bitwise operation ${left}, ${right}, ${result} is missing a range.`,
    );
  }
  if (
    left_range.width !== right_range.width ||
    left_range.signed !== right_range.signed ||
    left_range.width !== result_range.width ||
    left_range.signed !== result_range.signed
  ) {
    throw new Error(
      `Machine bitwise operation ${left}, ${right}, ${result} has incompatible ranges.`,
    );
  }
  const left_mask = machine_bitmask_basis(domain, left, left_range);
  const right_mask = machine_bitmask_basis(domain, right, right_range);
  let known_zero: bigint;
  let known_one: bigint;
  if (operation === "and") {
    known_zero = left_mask.known_zero | right_mask.known_zero;
    known_one = left_mask.known_one & right_mask.known_one;
  } else if (operation === "or") {
    known_zero = left_mask.known_zero & right_mask.known_zero;
    known_one = left_mask.known_one | right_mask.known_one;
  } else {
    known_zero = (left_mask.known_zero & right_mask.known_zero) |
      (left_mask.known_one & right_mask.known_one);
    known_one = (left_mask.known_zero & right_mask.known_one) |
      (left_mask.known_one & right_mask.known_zero);
  }
  const transferred = replace_machine_fact(domain, result, undefined);
  return assume_machine_bitmask(
    transferred,
    result,
    known_zero,
    known_one,
  );
}

export function machine_fact_domain(
  ranges: ReadonlyMap<ValueId, MachineInteger>,
): MachineFactDomain {
  const snapshots = new Map<ValueId, MachineInteger>();
  for (const [value, range] of ranges) {
    validate_machine_integer(range);
    snapshots.set(
      value,
      Object.freeze({
        width: range.width,
        signed: range.signed,
      }),
    );
  }
  return new MachineFactDomain(
    MACHINE_DOMAIN_TOKEN,
    true,
    immutable_environment([]),
    snapshots,
    immutable_map<ValueId, readonly FactEvidence[]>([]),
    immutable_map<ValueId, readonly bigint[]>([]),
    immutable_map<ValueId, readonly MachineCongruence[]>([]),
    immutable_map<ValueId, MachineBitmask>([]),
  );
}

export function assume_machine_congruence(
  domain: MachineFactDomain,
  value: ValueId,
  modulus: bigint,
  residue: bigint,
): MachineFactDomain {
  assert_machine_domain(domain);
  const range = domain.ranges.get(value);
  if (range === undefined) {
    throw new Error(`Missing machine range for ${value}.`);
  }
  const congruence = canonical_machine_congruence(modulus, residue);
  if (!domain.reachable || congruence.modulus === 1n) return domain;
  const fact = domain.facts.get(value);
  let current: ScalarFact = bounded_interval(
    integer_minimum(range),
    integer_maximum(range),
  );
  if (fact !== undefined) current = fact;
  const known = domain.congruences.get(value);
  let existing: readonly MachineCongruence[] = [];
  if (known !== undefined) existing = known;
  for (const candidate of existing) {
    if (!machine_congruences_are_compatible(candidate, congruence)) {
      return unreachable_machine_domain(domain, value);
    }
    if (machine_congruence_implies(candidate, congruence)) return domain;
  }
  const combined = combine_machine_congruences([...existing, congruence]);
  if (
    combined === undefined ||
    !fact_allows_congruence(
      current,
      combined,
      domain.exclusions.get(value),
    )
  ) {
    return unreachable_machine_domain(domain, value);
  }
  const bitmask = domain.bitmasks.get(value);
  if (bitmask !== undefined) {
    const congruence_mask = machine_congruence_bitmask(combined, range);
    if (!machine_bitmasks_are_compatible(bitmask, congruence_mask)) {
      return unreachable_machine_domain(domain, value);
    }
    const witness = machine_reduced_product_witness(
      current,
      bitmask,
      [combined],
      range,
      domain.exclusions.get(value),
    );
    if (witness.tag === "none") {
      return unreachable_machine_domain(domain, value);
    }
  }
  const congruences = new Map(domain.congruences);
  congruences.set(
    value,
    Object.freeze([combined]),
  );
  return new MachineFactDomain(
    MACHINE_DOMAIN_TOKEN,
    true,
    domain.facts,
    domain.ranges,
    domain.evidence,
    domain.exclusions,
    congruences,
    domain.bitmasks,
  );
}

export function implies_machine_congruence(
  domain: MachineFactDomain,
  value: ValueId,
  modulus: bigint,
  residue: bigint,
): boolean {
  assert_machine_domain(domain);
  const range = domain.ranges.get(value);
  if (range === undefined) {
    throw new Error(`Missing machine range for ${value}.`);
  }
  const goal = canonical_machine_congruence(modulus, residue);
  if (!domain.reachable) return false;
  if (goal.modulus === 1n) return true;
  const fact = domain.facts.get(value);
  if (
    fact?.tag === "exact" &&
    canonical_residue(fact.value, goal.modulus) === goal.residue
  ) {
    return true;
  }
  const bitmask = domain.bitmasks.get(value);
  if (bitmask !== undefined) {
    let current: ScalarFact = bounded_interval(
      integer_minimum(range),
      integer_maximum(range),
    );
    if (fact !== undefined) current = fact;
    const witnesses = machine_bitmask_witnesses(
      current,
      bitmask,
      range,
      domain.exclusions.get(value),
    );
    if (
      witnesses.length === 1 &&
      canonical_residue(witnesses[0], goal.modulus) === goal.residue
    ) {
      return true;
    }
    const machine_modulus = 1n << BigInt(range.width);
    if (
      goal.modulus <= machine_modulus &&
      is_power_of_two(goal.modulus)
    ) {
      const premise = machine_bitmask_basis(domain, value, range);
      const goal_mask = machine_congruence_bitmask(goal, range);
      if (
        (premise.known_zero & goal_mask.known_zero) ===
          goal_mask.known_zero &&
        (premise.known_one & goal_mask.known_one) === goal_mask.known_one
      ) {
        return true;
      }
    }
  }
  const congruences = domain.congruences.get(value);
  if (congruences === undefined) return false;
  const combined = combine_machine_congruences(congruences);
  if (combined === undefined) return false;
  return machine_congruence_implies(combined, goal);
}

export function machine_congruences(
  domain: MachineFactDomain,
  value: ValueId,
): readonly MachineCongruence[] {
  assert_machine_domain(domain);
  if (!domain.ranges.has(value)) {
    throw new Error(`Missing machine range for ${value}.`);
  }
  const congruences = domain.congruences.get(value);
  if (congruences === undefined) return EMPTY_CONGRUENCES;
  return congruences;
}

export function assume_machine_bitmask(
  domain: MachineFactDomain,
  value: ValueId,
  known_zero: bigint,
  known_one: bigint,
): MachineFactDomain {
  assert_machine_domain(domain);
  const range = domain.ranges.get(value);
  if (range === undefined) {
    throw new Error(`Missing machine range for ${value}.`);
  }
  const asserted = canonical_machine_bitmask(range, known_zero, known_one);
  if (!domain.reachable) return domain;
  const known = domain.bitmasks.get(value);
  let existing = EMPTY_MACHINE_BITMASK;
  if (known !== undefined) existing = known;
  const combined = canonical_machine_bitmask(
    range,
    existing.known_zero | asserted.known_zero,
    existing.known_one | asserted.known_one,
  );
  if ((combined.known_zero & combined.known_one) !== 0n) {
    return unreachable_machine_domain(domain, value);
  }
  if (
    combined.known_zero === existing.known_zero &&
    combined.known_one === existing.known_one
  ) {
    return domain;
  }
  const fact = domain.facts.get(value);
  let current: ScalarFact = bounded_interval(
    integer_minimum(range),
    integer_maximum(range),
  );
  if (fact !== undefined) current = fact;
  const witnesses = machine_bitmask_witnesses(
    current,
    combined,
    range,
    domain.exclusions.get(value),
  );
  if (witnesses.length === 0) {
    return unreachable_machine_domain(domain, value);
  }
  const congruences = domain.congruences.get(value);
  if (congruences !== undefined) {
    for (const congruence of congruences) {
      const congruence_mask = machine_congruence_bitmask(congruence, range);
      if (!machine_bitmasks_are_compatible(combined, congruence_mask)) {
        return unreachable_machine_domain(domain, value);
      }
    }
    const witness = machine_reduced_product_witness(
      current,
      combined,
      congruences,
      range,
      domain.exclusions.get(value),
    );
    if (witness.tag === "none") {
      return unreachable_machine_domain(domain, value);
    }
  }
  const bitmasks = new Map(domain.bitmasks);
  bitmasks.set(value, combined);
  return new MachineFactDomain(
    MACHINE_DOMAIN_TOKEN,
    true,
    domain.facts,
    domain.ranges,
    domain.evidence,
    domain.exclusions,
    domain.congruences,
    bitmasks,
  );
}

export function implies_machine_bitmask(
  domain: MachineFactDomain,
  value: ValueId,
  known_zero: bigint,
  known_one: bigint,
): boolean {
  assert_machine_domain(domain);
  const range = domain.ranges.get(value);
  if (range === undefined) {
    throw new Error(`Missing machine range for ${value}.`);
  }
  const goal = canonical_machine_bitmask(range, known_zero, known_one);
  if (!domain.reachable) return false;
  if ((goal.known_zero & goal.known_one) !== 0n) return false;
  const premise = machine_bitmask_basis(domain, value, range);
  return (premise.known_zero & goal.known_zero) === goal.known_zero &&
    (premise.known_one & goal.known_one) === goal.known_one;
}

export function machine_bitmask(
  domain: MachineFactDomain,
  value: ValueId,
): MachineBitmask {
  assert_machine_domain(domain);
  if (!domain.ranges.has(value)) {
    throw new Error(`Missing machine range for ${value}.`);
  }
  const bitmask = domain.bitmasks.get(value);
  if (bitmask === undefined) return EMPTY_MACHINE_BITMASK;
  return bitmask;
}

function replace_machine_fact(
  domain: MachineFactDomain,
  value: ValueId,
  fact: ScalarFact | undefined,
): MachineFactDomain {
  const facts = new Map(domain.facts);
  const evidence = new Map(domain.evidence);
  const exclusions = new Map(domain.exclusions);
  const congruences = new Map(domain.congruences);
  const bitmasks = new Map(domain.bitmasks);
  facts.delete(value);
  evidence.delete(value);
  exclusions.delete(value);
  congruences.delete(value);
  bitmasks.delete(value);
  if (fact !== undefined) facts.set(value, fact);
  return new MachineFactDomain(
    MACHINE_DOMAIN_TOKEN,
    domain.reachable,
    facts,
    domain.ranges,
    evidence,
    exclusions,
    congruences,
    bitmasks,
  );
}

export function assume_machine_fact(
  domain: MachineFactDomain,
  proposition: FactProposition,
): MachineFactDomain {
  assert_machine_domain(domain);
  if (!domain.reachable) return domain;
  const range = domain.ranges.get(proposition.value);
  if (range === undefined) {
    throw new Error(`Missing machine range for ${proposition.value}.`);
  }
  const current = domain.facts.get(proposition.value);
  if (proposition.tag === "equal") {
    const excluded = domain.exclusions.get(proposition.value);
    if (excluded !== undefined && excluded.includes(proposition.expected)) {
      return unreachable_machine_domain(domain, proposition.value);
    }
  }
  let existing: ScalarFact = unknown_fact;
  if (current !== undefined) existing = current;
  const asserted_fact = machine_proposition_fact(proposition, range);
  const narrowed_fact = meet_facts(existing, asserted_fact);
  const known_exclusions = domain.exclusions.get(proposition.value);
  const fact = apply_exclusions(narrowed_fact, known_exclusions, range);
  const congruences = domain.congruences.get(proposition.value);
  if (congruences !== undefined) {
    const combined = combine_machine_congruences(congruences);
    if (
      combined === undefined ||
      !fact_allows_congruence(fact, combined, known_exclusions)
    ) {
      return unreachable_machine_domain(domain, proposition.value);
    }
  }
  const bitmask = domain.bitmasks.get(proposition.value);
  if (
    bitmask !== undefined &&
    machine_bitmask_witnesses(
        fact,
        bitmask,
        range,
        known_exclusions,
      ).length === 0
  ) {
    return unreachable_machine_domain(domain, proposition.value);
  }
  if (bitmask !== undefined && congruences !== undefined) {
    const witness = machine_reduced_product_witness(
      fact,
      bitmask,
      congruences,
      range,
      known_exclusions,
    );
    if (witness.tag === "none") {
      return unreachable_machine_domain(domain, proposition.value);
    }
  }
  const result = new Map(domain.facts);
  result.set(proposition.value, fact);
  const evidence = new Map(domain.evidence);
  const prior = evidence.get(proposition.value);
  const current_evidence: FactEvidence[] = [];
  if (prior !== undefined) current_evidence.push(...prior);
  current_evidence.push(establish_bounded_fact(proposition, asserted_fact));
  evidence.set(proposition.value, Object.freeze(current_evidence));
  const reachable = fact.tag !== "bottom";
  return new MachineFactDomain(
    MACHINE_DOMAIN_TOKEN,
    reachable,
    result,
    domain.ranges,
    evidence,
    domain.exclusions,
    domain.congruences,
    domain.bitmasks,
  );
}

export function implies_machine_fact(
  domain: MachineFactDomain,
  proposition: FactProposition,
): boolean {
  assert_machine_domain(domain);
  const range = domain.ranges.get(proposition.value);
  if (range === undefined) {
    throw new Error(`Missing machine range for ${proposition.value}.`);
  }
  if (!domain.reachable) return false;
  let current = domain.facts.get(proposition.value);
  const exclusions = domain.exclusions.get(proposition.value);
  const congruences = domain.congruences.get(proposition.value);
  if (congruences !== undefined) {
    let bounded: ScalarFact = bounded_interval(
      integer_minimum(range),
      integer_maximum(range),
    );
    if (current !== undefined) bounded = current;
    if (bounded.tag === "bottom") return false;
    const combined = combine_machine_congruences(congruences);
    if (combined === undefined) return false;
    const remaining = remaining_congruence_singleton(
      bounded,
      combined,
      exclusions,
    );
    if (remaining !== undefined) {
      current = { tag: "exact", value: remaining };
    }
  }
  const bitmask = domain.bitmasks.get(proposition.value);
  if (bitmask !== undefined) {
    let bounded: ScalarFact = bounded_interval(
      integer_minimum(range),
      integer_maximum(range),
    );
    if (current !== undefined) bounded = current;
    const witnesses = machine_bitmask_witnesses(
      bounded,
      bitmask,
      range,
      exclusions,
    );
    if (witnesses.length === 0) return false;
    if (witnesses.length === 1) {
      current = { tag: "exact", value: witnesses[0] };
    }
  }
  if (proposition.tag === "equal" && current !== undefined) {
    const remaining = remaining_singleton(current, exclusions);
    if (remaining !== undefined) return remaining === proposition.expected;
  }
  if (current === undefined) return false;
  if (current.tag === "bottom") return false;
  return fact_implies(current, machine_proposition_fact(proposition, range));
}

export function machine_excludes_equal(
  domain: MachineFactDomain,
  value: ValueId,
  expected: bigint,
): boolean {
  assert_machine_domain(domain);
  const range = domain.ranges.get(value);
  if (range === undefined) {
    throw new Error(`Missing machine range for ${value}.`);
  }
  if (!domain.reachable) return false;
  const bounds = machine_range(range);
  if (expected < bounds.minimum || expected > bounds.maximum) return true;
  const exclusions = domain.exclusions.get(value);
  if (exclusions?.includes(expected)) return true;
  const bitmask = domain.bitmasks.get(value);
  if (
    bitmask !== undefined &&
    !machine_value_matches_bitmask(expected, bitmask, range)
  ) {
    return true;
  }
  const congruences = domain.congruences.get(value);
  if (
    congruences !== undefined &&
    congruences.some((congruence) =>
      canonical_residue(expected, congruence.modulus) !== congruence.residue
    )
  ) {
    return true;
  }
  const current = domain.facts.get(value);
  if (current === undefined || current.tag === "unknown") return false;
  if (current.tag === "bottom") return false;
  if (current.tag === "exact") return current.value !== expected;
  return expected < current.minimum || expected > current.maximum;
}

export function exclude_machine_fact(
  domain: MachineFactDomain,
  proposition: FactProposition,
): MachineFactDomain {
  assert_machine_domain(domain);
  if (!domain.reachable) return domain;
  if (proposition.tag !== "equal") {
    return assume_machine_fact(domain, complementary_proposition(proposition));
  }
  const range = domain.ranges.get(proposition.value);
  if (range === undefined) {
    throw new Error(`Missing machine range for ${proposition.value}.`);
  }
  const bounds = machine_range(range);
  if (
    proposition.expected < bounds.minimum ||
    proposition.expected > bounds.maximum
  ) {
    return domain;
  }
  const current = domain.facts.get(proposition.value);
  if (
    current !== undefined && current.tag === "exact" &&
    current.value === proposition.expected
  ) {
    return unreachable_machine_domain(domain, proposition.value);
  }
  if (
    current === undefined || current.tag !== "exact" ||
    current.value !== proposition.expected
  ) {
    const known_exclusions = domain.exclusions.get(proposition.value);
    let existing: readonly bigint[] = [];
    if (known_exclusions !== undefined) existing = known_exclusions;
    if (existing.includes(proposition.expected)) return domain;
    if (
      existing.length >= proof_limits.maximum_exclusions_per_value
    ) {
      return domain;
    }
    const exclusions = new Map(domain.exclusions);
    exclusions.set(
      proposition.value,
      Object.freeze([...existing, proposition.expected]),
    );
    const updated = new MachineFactDomain(
      MACHINE_DOMAIN_TOKEN,
      true,
      domain.facts,
      domain.ranges,
      domain.evidence,
      exclusions,
      domain.congruences,
      domain.bitmasks,
    );
    const updated_values = exclusions.get(proposition.value);
    let current_fact: ScalarFact = bounded_interval(
      bounds.minimum,
      bounds.maximum,
    );
    if (current !== undefined) current_fact = current;
    if (
      updated_values !== undefined &&
      apply_exclusions(current_fact, updated_values, range).tag === "bottom"
    ) {
      return unreachable_machine_domain(updated, proposition.value);
    }
    const congruences = updated.congruences.get(proposition.value);
    if (congruences !== undefined) {
      const combined = combine_machine_congruences(congruences);
      if (
        combined === undefined ||
        !fact_allows_congruence(current_fact, combined, updated_values)
      ) {
        return unreachable_machine_domain(updated, proposition.value);
      }
    }
    const bitmask = updated.bitmasks.get(proposition.value);
    if (
      bitmask !== undefined &&
      machine_bitmask_witnesses(
          current_fact,
          bitmask,
          range,
          updated_values,
        ).length === 0
    ) {
      return unreachable_machine_domain(updated, proposition.value);
    }
    if (bitmask !== undefined && congruences !== undefined) {
      const witness = machine_reduced_product_witness(
        current_fact,
        bitmask,
        congruences,
        range,
        updated_values,
      );
      if (witness.tag === "none") {
        return unreachable_machine_domain(updated, proposition.value);
      }
    }
    return updated;
  }
  return unreachable_machine_domain(domain, proposition.value);
}

function apply_exclusions(
  fact: ScalarFact,
  exclusions: readonly bigint[] | undefined,
  range: MachineInteger,
): ScalarFact {
  if (exclusions === undefined || exclusions.length === 0) return fact;
  const canonical = canonical_fact(fact);
  if (canonical.tag === "exact" && exclusions.includes(canonical.value)) {
    return { tag: "bottom" };
  }
  if (canonical.tag !== "interval") return canonical;
  const bounds = machine_range(range);
  const size = canonical.maximum - canonical.minimum + 1n;
  if (
    size > BigInt(proof_limits.maximum_exclusions_per_value)
  ) {
    return canonical;
  }
  for (
    let candidate = canonical.minimum;
    candidate <= canonical.maximum;
    candidate += 1n
  ) {
    if (!exclusions.includes(candidate)) return canonical;
  }
  if (
    canonical.minimum <= bounds.maximum && canonical.maximum >= bounds.minimum
  ) {
    return { tag: "bottom" };
  }
  return canonical;
}

function remaining_singleton(
  fact: ScalarFact,
  exclusions: readonly bigint[] | undefined,
): bigint | undefined {
  if (exclusions === undefined) return undefined;
  const canonical = canonical_fact(fact);
  if (canonical.tag === "exact") {
    if (exclusions.includes(canonical.value)) return undefined;
    return canonical.value;
  }
  if (canonical.tag !== "interval") return undefined;
  const size = canonical.maximum - canonical.minimum + 1n;
  if (
    size < 1n ||
    size > BigInt(proof_limits.maximum_exclusions_per_value)
  ) {
    return undefined;
  }
  let remaining: bigint | undefined;
  for (
    let candidate = canonical.minimum;
    candidate <= canonical.maximum;
    candidate += 1n
  ) {
    if (exclusions.includes(candidate)) continue;
    if (remaining !== undefined) return undefined;
    remaining = candidate;
  }
  return remaining;
}

function remaining_congruence_singleton(
  fact: ScalarFact,
  congruence: MachineCongruence,
  exclusions: readonly bigint[] | undefined,
): bigint | undefined {
  const canonical = canonical_fact(fact);
  if (canonical.tag === "bottom" || canonical.tag === "unknown") {
    return undefined;
  }
  const bounds = fact_bounds(canonical);
  const first = bounds.minimum +
    canonical_residue(
      congruence.residue - bounds.minimum,
      congruence.modulus,
    );
  if (first > bounds.maximum) return undefined;
  const witness_count = (bounds.maximum - first) / congruence.modulus + 1n;
  let exclusion_count = 0n;
  if (exclusions !== undefined) {
    exclusion_count = BigInt(exclusions.length);
  }
  if (witness_count > exclusion_count + 1n) return undefined;
  let remaining: bigint | undefined;
  for (
    let candidate = first;
    candidate <= bounds.maximum;
    candidate += congruence.modulus
  ) {
    if (exclusions?.includes(candidate)) continue;
    if (remaining !== undefined) return undefined;
    remaining = candidate;
  }
  return remaining;
}

export function join_machine_domains(
  left: MachineFactDomain,
  right: MachineFactDomain,
): MachineFactDomain {
  assert_machine_domain(left);
  assert_machine_domain(right);
  if (!same_machine_ranges(left.ranges, right.ranges)) {
    throw new Error("Cannot join machine domains with different ranges.");
  }
  if (!left.reachable) return clone_machine_domain(right);
  if (!right.reachable) return clone_machine_domain(left);
  const exclusions = new Map<ValueId, readonly bigint[]>();
  const values = new Set([
    ...left.exclusions.keys(),
    ...right.exclusions.keys(),
  ]);
  for (const value of values) {
    const left_values = left.exclusions.get(value);
    const right_values = right.exclusions.get(value);
    if (left_values === undefined || right_values === undefined) continue;
    const shared = left_values.filter((candidate) =>
      right_values.includes(candidate)
    );
    if (shared.length > 0) exclusions.set(value, Object.freeze(shared));
  }
  return new MachineFactDomain(
    MACHINE_DOMAIN_TOKEN,
    true,
    join_environments(left.facts, right.facts),
    left.ranges,
    immutable_map<ValueId, readonly FactEvidence[]>([]),
    exclusions,
    joined_machine_congruences(left, right),
    joined_machine_bitmasks(left, right),
  );
}

function joined_machine_congruences(
  left: MachineFactDomain,
  right: MachineFactDomain,
): ReadonlyMap<ValueId, readonly MachineCongruence[]> {
  const joined = new Map<ValueId, readonly MachineCongruence[]>();
  for (const value of left.ranges.keys()) {
    const left_basis = machine_congruence_basis(left, value);
    const right_basis = machine_congruence_basis(right, value);
    if (left_basis.length === 0 || right_basis.length === 0) continue;
    const left_congruence = left_basis[0];
    const right_congruence = right_basis[0];
    if (left_congruence === undefined || right_congruence === undefined) {
      continue;
    }
    const difference = absolute_bigint(
      left_congruence.residue - right_congruence.residue,
    );
    const modulus = greatest_common_divisor(
      greatest_common_divisor(
        left_congruence.modulus,
        right_congruence.modulus,
      ),
      difference,
    );
    if (modulus <= 1n) continue;
    const candidate = canonical_machine_congruence(
      modulus,
      left_congruence.residue,
    );
    joined.set(
      value,
      Object.freeze([candidate]),
    );
  }
  return joined;
}

function machine_congruence_basis(
  domain: MachineFactDomain,
  value: ValueId,
): readonly MachineCongruence[] {
  const fact = domain.facts.get(value);
  if (fact?.tag === "exact") {
    return [{ modulus: 0n, residue: fact.value }];
  }
  const congruences = domain.congruences.get(value);
  if (congruences === undefined) return EMPTY_CONGRUENCES;
  const combined = combine_machine_congruences(congruences);
  if (combined === undefined) return EMPTY_CONGRUENCES;
  return [combined];
}

function joined_machine_bitmasks(
  left: MachineFactDomain,
  right: MachineFactDomain,
): ReadonlyMap<ValueId, MachineBitmask> {
  const joined = new Map<ValueId, MachineBitmask>();
  for (const [value, range] of left.ranges) {
    const left_mask = machine_bitmask_basis(left, value, range);
    const right_mask = machine_bitmask_basis(right, value, range);
    const common = canonical_machine_bitmask(
      range,
      left_mask.known_zero & right_mask.known_zero,
      left_mask.known_one & right_mask.known_one,
    );
    if (common.known_zero === 0n && common.known_one === 0n) continue;
    joined.set(value, common);
  }
  return joined;
}

function machine_bitmask_basis(
  domain: MachineFactDomain,
  value: ValueId,
  range: MachineInteger,
): MachineBitmask {
  const fact = domain.facts.get(value);
  if (fact?.tag === "exact") {
    return machine_bitmask_from_value(fact.value, range);
  }
  const bitmask = domain.bitmasks.get(value);
  if (bitmask === undefined) return EMPTY_MACHINE_BITMASK;
  let current: ScalarFact = bounded_interval(
    integer_minimum(range),
    integer_maximum(range),
  );
  if (fact !== undefined) current = fact;
  const witnesses = machine_bitmask_witnesses(
    current,
    bitmask,
    range,
    domain.exclusions.get(value),
  );
  if (witnesses.length === 1) {
    return machine_bitmask_from_value(witnesses[0], range);
  }
  return bitmask;
}

function clone_machine_domain(domain: MachineFactDomain): MachineFactDomain {
  const evidence = new Map<ValueId, readonly FactEvidence[]>();
  for (const [value, entries] of domain.evidence) {
    evidence.set(value, Object.freeze([...entries]));
  }
  const exclusions = new Map<ValueId, readonly bigint[]>();
  for (const [value, entries] of domain.exclusions) {
    exclusions.set(value, Object.freeze([...entries]));
  }
  const congruences = new Map<ValueId, readonly MachineCongruence[]>();
  for (const [value, entries] of domain.congruences) {
    congruences.set(value, Object.freeze([...entries]));
  }
  const bitmasks = new Map<ValueId, MachineBitmask>();
  for (const [value, bitmask] of domain.bitmasks) {
    bitmasks.set(value, bitmask);
  }
  return new MachineFactDomain(
    MACHINE_DOMAIN_TOKEN,
    domain.reachable,
    domain.facts,
    domain.ranges,
    evidence,
    exclusions,
    congruences,
    bitmasks,
  );
}

function assert_machine_domain(domain: MachineFactDomain): void {
  if (!TRUSTED_MACHINE_DOMAINS.has(domain as object)) {
    throw new Error("MachineFactDomain was not created by FactGraph.");
  }
}

function snapshot_machine_ranges(
  ranges: ReadonlyMap<ValueId, MachineInteger>,
): ReadonlyMap<ValueId, MachineInteger> {
  const snapshots = new Map<ValueId, MachineInteger>();
  for (const [value, range] of ranges) {
    validate_machine_integer(range);
    snapshots.set(value, Object.freeze({ ...range }));
  }
  return immutable_map(snapshots);
}

function same_machine_ranges(
  left: ReadonlyMap<ValueId, MachineInteger>,
  right: ReadonlyMap<ValueId, MachineInteger>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [value, left_range] of left) {
    validate_machine_integer(left_range);
    const right_range = right.get(value);
    if (right_range === undefined) return false;
    validate_machine_integer(right_range);
    if (
      left_range.width !== right_range.width ||
      left_range.signed !== right_range.signed
    ) {
      return false;
    }
  }
  return true;
}

function snapshot_machine_evidence(
  evidence: ReadonlyMap<ValueId, readonly FactEvidence[]>,
): ReadonlyMap<ValueId, readonly FactEvidence[]> {
  const snapshots = new Map<ValueId, readonly FactEvidence[]>();
  for (const [value, entries] of evidence) {
    snapshots.set(value, Object.freeze([...entries]));
  }
  return immutable_map(snapshots);
}

function snapshot_machine_exclusions(
  exclusions: ReadonlyMap<ValueId, readonly bigint[]>,
): ReadonlyMap<ValueId, readonly bigint[]> {
  const snapshots = new Map<ValueId, readonly bigint[]>();
  for (const [value, entries] of exclusions) {
    snapshots.set(value, Object.freeze([...entries]));
  }
  return immutable_map(snapshots);
}

function snapshot_machine_congruences(
  congruences: ReadonlyMap<ValueId, readonly MachineCongruence[]>,
): ReadonlyMap<ValueId, readonly MachineCongruence[]> {
  const snapshots = new Map<ValueId, readonly MachineCongruence[]>();
  for (const [value, entries] of congruences) {
    if (
      entries.length > proof_limits.maximum_congruences_per_value
    ) {
      throw new Error(`Machine congruence budget exceeded for ${value}.`);
    }
    snapshots.set(
      value,
      Object.freeze(
        entries.map((entry) =>
          Object.freeze(
            canonical_machine_congruence(entry.modulus, entry.residue),
          )
        ),
      ),
    );
  }
  return immutable_map(snapshots);
}

function snapshot_machine_bitmasks(
  bitmasks: ReadonlyMap<ValueId, MachineBitmask>,
): ReadonlyMap<ValueId, MachineBitmask> {
  const snapshots = new Map<ValueId, MachineBitmask>();
  for (const [value, bitmask] of bitmasks) {
    snapshots.set(value, Object.freeze({ ...bitmask }));
  }
  return immutable_map(snapshots);
}

function unreachable_machine_domain(
  domain: MachineFactDomain,
  value: ValueId,
): MachineFactDomain {
  const facts = new Map(domain.facts);
  facts.set(value, { tag: "bottom" });
  return new MachineFactDomain(
    MACHINE_DOMAIN_TOKEN,
    false,
    facts,
    domain.ranges,
    domain.evidence,
    domain.exclusions,
    domain.congruences,
    domain.bitmasks,
  );
}

export function machine_fact_evidence(
  domain: MachineFactDomain,
  value: ValueId,
): readonly FactEvidence[] {
  assert_machine_domain(domain);
  const evidence = domain.evidence.get(value);
  if (evidence === undefined) return EMPTY_EVIDENCE;
  return evidence;
}

export function widen_machine_facts(
  previous: ScalarFact,
  next: ScalarFact,
  range: MachineInteger,
): ScalarFact {
  const bounds = machine_range(range);
  const prior = clip_machine_fact(canonical_fact(previous), bounds);
  const following = clip_machine_fact(canonical_fact(next), bounds);
  if (prior.tag === "bottom") return freeze_fact(following);
  if (following.tag === "bottom") return freeze_fact(prior);
  if (prior.tag === "unknown" || following.tag === "unknown") {
    return unknown_fact;
  }
  const prior_bounds = fact_bounds(prior);
  const following_bounds = fact_bounds(following);
  let minimum = min_bigint(prior_bounds.minimum, following_bounds.minimum);
  let maximum = max_bigint(prior_bounds.maximum, following_bounds.maximum);
  if (following_bounds.minimum < prior_bounds.minimum) minimum = bounds.minimum;
  if (following_bounds.maximum > prior_bounds.maximum) maximum = bounds.maximum;
  if (minimum > maximum) return freeze_fact({ tag: "bottom" });
  if (minimum === maximum) return freeze_fact({ tag: "exact", value: minimum });
  return freeze_fact({ tag: "interval", minimum, maximum });
}

function clip_machine_fact(
  fact: ScalarFact,
  bounds: { minimum: bigint; maximum: bigint },
): ScalarFact {
  if (fact.tag === "bottom" || fact.tag === "unknown") return fact;
  const fact_bounds_value = fact_bounds(fact);
  return bounded_interval(
    max_bigint(bounds.minimum, fact_bounds_value.minimum),
    min_bigint(bounds.maximum, fact_bounds_value.maximum),
  );
}

function machine_proposition_fact(
  proposition: FactProposition,
  type: MachineInteger,
): ScalarFact {
  const bounds = machine_range(type);
  switch (proposition.tag) {
    case "equal":
      if (
        proposition.expected < bounds.minimum ||
        proposition.expected > bounds.maximum
      ) {
        return { tag: "bottom" };
      }
      return { tag: "exact", value: proposition.expected };
    case "less_than":
      return bounded_interval(
        bounds.minimum,
        min_bigint(bounds.maximum, proposition.bound - 1n),
      );
    case "less_equal":
      return bounded_interval(
        bounds.minimum,
        min_bigint(bounds.maximum, proposition.bound),
      );
    case "greater_than":
      return bounded_interval(
        max_bigint(bounds.minimum, proposition.bound + 1n),
        bounds.maximum,
      );
    case "greater_equal":
      return bounded_interval(
        max_bigint(bounds.minimum, proposition.bound),
        bounds.maximum,
      );
  }
}

function bounded_interval(minimum: bigint, maximum: bigint): ScalarFact {
  if (minimum > maximum) return { tag: "bottom" };
  if (minimum === maximum) return { tag: "exact", value: minimum };
  return { tag: "interval", minimum, maximum };
}

function establish_bounded_fact(
  proposition: FactProposition,
  fact: ScalarFact,
): FactEvidence {
  const evidence = establish_fact(proposition);
  return Object.freeze({ ...evidence, fact: freeze_fact(fact) });
}

function validate_machine_integer(type: MachineInteger): void {
  if (
    !Number.isSafeInteger(type.width) || type.width < 1 || type.width > 128 ||
    typeof type.signed !== "boolean"
  ) {
    throw new Error(`Invalid machine integer width ${String(type.width)}.`);
  }
}

function canonical_machine_bitmask(
  range: MachineInteger,
  known_zero: bigint,
  known_one: bigint,
): MachineBitmask {
  if (typeof known_zero !== "bigint" || typeof known_one !== "bigint") {
    throw new Error("Machine bitmask components must be integers.");
  }
  const width_mask = machine_width_mask(range);
  if (
    known_zero < 0n || known_one < 0n ||
    known_zero > width_mask || known_one > width_mask
  ) {
    throw new Error(
      `Machine bitmask ${known_zero}/${known_one} exceeds U${range.width}.`,
    );
  }
  return Object.freeze({ known_zero, known_one });
}

function machine_bitmask_from_value(
  value: bigint,
  range: MachineInteger,
): MachineBitmask {
  const width_mask = machine_width_mask(range);
  const bits = machine_value_bits(value, range);
  return canonical_machine_bitmask(
    range,
    width_mask ^ bits,
    bits,
  );
}

function machine_congruence_bitmask(
  congruence: MachineCongruence,
  range: MachineInteger,
): MachineBitmask {
  let divisor = congruence.modulus;
  let fixed_bits = 0;
  while (fixed_bits < range.width && divisor % 2n === 0n) {
    fixed_bits += 1;
    divisor /= 2n;
  }
  if (fixed_bits === 0) return EMPTY_MACHINE_BITMASK;
  const fixed_mask = (1n << BigInt(fixed_bits)) - 1n;
  const known_one = congruence.residue & fixed_mask;
  return canonical_machine_bitmask(
    range,
    fixed_mask ^ known_one,
    known_one,
  );
}

function machine_bitmasks_are_compatible(
  left: MachineBitmask,
  right: MachineBitmask,
): boolean {
  return (left.known_zero & right.known_one) === 0n &&
    (left.known_one & right.known_zero) === 0n;
}

function machine_value_matches_bitmask(
  value: bigint,
  bitmask: MachineBitmask,
  range: MachineInteger,
): boolean {
  const bits = machine_value_bits(value, range);
  return (bits & bitmask.known_zero) === 0n &&
    (bits & bitmask.known_one) === bitmask.known_one;
}

function machine_value_bits(value: bigint, range: MachineInteger): bigint {
  const normalized = normalize_integer(range, value);
  if (normalized >= 0n) return normalized;
  return normalized + (1n << BigInt(range.width));
}

function machine_width_mask(range: MachineInteger): bigint {
  return (1n << BigInt(range.width)) - 1n;
}

function machine_bitmask_witnesses(
  fact: ScalarFact,
  bitmask: MachineBitmask,
  range: MachineInteger,
  exclusions: readonly bigint[] | undefined,
): readonly bigint[] {
  const intervals = machine_fact_unsigned_intervals(fact, range);
  if (intervals.length === 0) return EMPTY_MACHINE_WITNESSES;
  const witnesses: bigint[] = [];
  for (const interval of intervals) {
    let lower = interval.minimum;
    while (lower <= interval.maximum && witnesses.length < 2) {
      const bits = minimum_matching_bitmask(
        lower,
        bitmask,
        range.width,
      );
      if (bits === undefined || bits > interval.maximum) break;
      const value = machine_value_from_bits(bits, range);
      if (exclusions === undefined || !exclusions.includes(value)) {
        witnesses.push(value);
      }
      lower = bits + 1n;
    }
    if (witnesses.length === 2) break;
  }
  return Object.freeze(witnesses);
}

function machine_reduced_product_witness(
  fact: ScalarFact,
  bitmask: MachineBitmask,
  congruences: readonly MachineCongruence[],
  range: MachineInteger,
  exclusions: readonly bigint[] | undefined,
): MachineWitnessSearch {
  const intervals = machine_fact_unsigned_intervals(fact, range);
  if (intervals.length === 0) return NO_MACHINE_WITNESS;
  let steps = 0;
  for (const interval of intervals) {
    let lower = interval.minimum;
    while (lower <= interval.maximum) {
      const bits = minimum_matching_bitmask(
        lower,
        bitmask,
        range.width,
      );
      if (bits === undefined || bits > interval.maximum) break;
      if (
        steps + range.width >
          proof_limits.compiler_search_steps
      ) {
        return UNKNOWN_MACHINE_WITNESS;
      }
      steps += range.width;
      const value = machine_value_from_bits(bits, range);
      let congruent = true;
      for (const congruence of congruences) {
        if (
          canonical_residue(value, congruence.modulus) !== congruence.residue
        ) {
          congruent = false;
          break;
        }
      }
      if (
        congruent &&
        (exclusions === undefined || !exclusions.includes(value))
      ) {
        return { tag: "found", value };
      }
      lower = bits + 1n;
    }
  }
  return NO_MACHINE_WITNESS;
}

function machine_fact_unsigned_intervals(
  fact: ScalarFact,
  range: MachineInteger,
): readonly { minimum: bigint; maximum: bigint }[] {
  const canonical = canonical_fact(fact);
  if (canonical.tag === "bottom") return EMPTY_MACHINE_INTERVALS;
  let minimum = integer_minimum(range);
  let maximum = integer_maximum(range);
  if (canonical.tag === "exact") {
    minimum = canonical.value;
    maximum = canonical.value;
  } else if (canonical.tag === "interval") {
    minimum = canonical.minimum;
    maximum = canonical.maximum;
  }
  minimum = max_bigint(minimum, integer_minimum(range));
  maximum = min_bigint(maximum, integer_maximum(range));
  if (minimum > maximum) return EMPTY_MACHINE_INTERVALS;
  return machine_unsigned_intervals(minimum, maximum, range);
}

function machine_unsigned_intervals(
  minimum: bigint,
  maximum: bigint,
  range: MachineInteger,
): readonly { minimum: bigint; maximum: bigint }[] {
  if (!range.signed || minimum >= 0n) {
    return [{ minimum, maximum }];
  }
  const modulus = 1n << BigInt(range.width);
  if (maximum < 0n) {
    return [{
      minimum: minimum + modulus,
      maximum: maximum + modulus,
    }];
  }
  return [
    { minimum: minimum + modulus, maximum: modulus - 1n },
    { minimum: 0n, maximum },
  ];
}

function minimum_matching_bitmask(
  lower: bigint,
  bitmask: MachineBitmask,
  width: number,
): bigint | undefined {
  const equal_results = new Map<number, bigint | undefined>();
  const greater_results = new Map<number, bigint | undefined>();
  const search = (
    bit: number,
    greater: boolean,
  ): bigint | undefined => {
    if (bit < 0) return 0n;
    let results = equal_results;
    if (greater) results = greater_results;
    if (results.has(bit)) return results.get(bit);
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
      if (!greater && digit < lower_digit) continue;
      const suffix = search(bit - 1, greater || digit > lower_digit);
      if (suffix === undefined) continue;
      const result = digit * bit_value + suffix;
      results.set(bit, result);
      return result;
    }
    results.set(bit, undefined);
    return undefined;
  };
  return search(width - 1, false);
}

function machine_value_from_bits(
  bits: bigint,
  range: MachineInteger,
): bigint {
  if (!range.signed) return bits;
  const sign = 1n << BigInt(range.width - 1);
  if (bits < sign) return bits;
  return bits - (1n << BigInt(range.width));
}

function canonical_machine_congruence(
  modulus: bigint,
  residue: bigint,
): MachineCongruence {
  if (typeof modulus !== "bigint" || modulus <= 0n) {
    throw new Error(
      `Machine congruence modulus must be positive: ${String(modulus)}.`,
    );
  }
  if (typeof residue !== "bigint") {
    throw new Error(
      `Machine congruence residue must be an integer: ${String(residue)}.`,
    );
  }
  return Object.freeze({
    modulus,
    residue: canonical_residue(residue, modulus),
  });
}

function canonical_residue(value: bigint, modulus: bigint): bigint {
  const residue = value % modulus;
  if (residue >= 0n) return residue;
  return residue + modulus;
}

function machine_congruence_implies(
  premise: MachineCongruence,
  goal: MachineCongruence,
): boolean {
  return premise.modulus % goal.modulus === 0n &&
    canonical_residue(premise.residue, goal.modulus) === goal.residue;
}

function machine_congruences_are_compatible(
  left: MachineCongruence,
  right: MachineCongruence,
): boolean {
  const divisor = greatest_common_divisor(left.modulus, right.modulus);
  return canonical_residue(left.residue - right.residue, divisor) === 0n;
}

function combine_machine_congruences(
  congruences: readonly MachineCongruence[],
): MachineCongruence | undefined {
  let combined: MachineCongruence | undefined;
  for (const congruence of congruences) {
    if (combined === undefined) {
      combined = congruence;
      continue;
    }
    const divisor = greatest_common_divisor(
      combined.modulus,
      congruence.modulus,
    );
    const difference = congruence.residue - combined.residue;
    if (canonical_residue(difference, divisor) !== 0n) return undefined;
    const left = combined.modulus / divisor;
    const right = congruence.modulus / divisor;
    let multiplier = 0n;
    if (right !== 1n) {
      multiplier = canonical_residue(
        (difference / divisor) * modular_inverse(left, right),
        right,
      );
    }
    combined = canonical_machine_congruence(
      combined.modulus * right,
      combined.residue + combined.modulus * multiplier,
    );
  }
  return combined;
}

function modular_inverse(value: bigint, modulus: bigint): bigint {
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
  if (previous_remainder !== 1n) {
    throw new Error(
      `Machine congruence inverse does not exist for ${value} modulo ${modulus}.`,
    );
  }
  return canonical_residue(previous_coefficient, modulus);
}

function fact_allows_congruence(
  fact: ScalarFact,
  congruence: MachineCongruence,
  exclusions: readonly bigint[] | undefined = undefined,
): boolean {
  const canonical = canonical_fact(fact);
  if (canonical.tag === "unknown") return true;
  if (canonical.tag === "bottom") return false;
  if (canonical.tag === "exact") {
    if (
      canonical_residue(canonical.value, congruence.modulus) !==
        congruence.residue
    ) {
      return false;
    }
    return exclusions === undefined || !exclusions.includes(canonical.value);
  }
  const first = canonical.minimum +
    canonical_residue(
      congruence.residue - canonical.minimum,
      congruence.modulus,
    );
  if (first > canonical.maximum) return false;
  if (exclusions === undefined || exclusions.length === 0) return true;
  const witness_count = (canonical.maximum - first) / congruence.modulus + 1n;
  if (witness_count > BigInt(exclusions.length)) return true;
  for (
    let candidate = first;
    candidate <= canonical.maximum;
    candidate += congruence.modulus
  ) {
    if (!exclusions.includes(candidate)) return true;
  }
  return false;
}

function greatest_common_divisor(left: bigint, right: bigint): bigint {
  let dividend = absolute_bigint(left);
  let divisor = absolute_bigint(right);
  while (divisor !== 0n) {
    const remainder = dividend % divisor;
    dividend = divisor;
    divisor = remainder;
  }
  return dividend;
}

function is_power_of_two(value: bigint): boolean {
  return value > 0n && (value & (value - 1n)) === 0n;
}

function absolute_bigint(value: bigint): bigint {
  if (value < 0n) return -value;
  return value;
}

export const unknown_fact: ScalarFact = Object.freeze({ tag: "unknown" });

const EMPTY_EVIDENCE: readonly FactEvidence[] = Object.freeze([]);
const EMPTY_CONGRUENCES: readonly MachineCongruence[] = Object.freeze([]);
const EMPTY_MACHINE_WITNESSES: readonly bigint[] = Object.freeze([]);
const EMPTY_MACHINE_INTERVALS: readonly {
  minimum: bigint;
  maximum: bigint;
}[] = Object.freeze([]);
const EMPTY_MACHINE_BITMASK: MachineBitmask = Object.freeze({
  known_zero: 0n,
  known_one: 0n,
});
const NO_MACHINE_WITNESS: MachineWitnessSearch = Object.freeze({
  tag: "none",
});
const UNKNOWN_MACHINE_WITNESS: MachineWitnessSearch = Object.freeze({
  tag: "unknown",
});

export const reachable_state: FactState = {
  reachable: true,
  facts: immutable_environment([]),
};

export const unreachable_state: FactState = {
  reachable: false,
  facts: immutable_environment([]),
};

export function assume_state(
  state: FactState,
  proposition: FactProposition,
): FactState {
  if (!state.reachable) return unreachable_state;
  const facts = assume_fact(state.facts, proposition);
  const fact = facts.get(proposition.value);
  if (fact !== undefined && fact.tag === "bottom") return unreachable_state;
  return { reachable: true, facts };
}

export function join_states(left: FactState, right: FactState): FactState {
  if (!left.reachable) {
    return {
      reachable: right.reachable,
      facts: immutable_environment(right.facts),
    };
  }
  if (!right.reachable) {
    return {
      reachable: left.reachable,
      facts: immutable_environment(left.facts),
    };
  }
  return { reachable: true, facts: join_environments(left.facts, right.facts) };
}

export function meet_facts(left: ScalarFact, right: ScalarFact): ScalarFact {
  left = canonical_fact(left);
  right = canonical_fact(right);
  if (left.tag === "bottom" || right.tag === "bottom") return { tag: "bottom" };
  if (left.tag === "unknown") return right;
  if (right.tag === "unknown") return left;
  const left_bounds = fact_bounds(left);
  const right_bounds = fact_bounds(right);
  const minimum = max_bigint(left_bounds.minimum, right_bounds.minimum);
  const maximum = min_bigint(left_bounds.maximum, right_bounds.maximum);
  if (minimum > maximum) return { tag: "bottom" };
  if (minimum === maximum) return { tag: "exact", value: minimum };
  return { tag: "interval", minimum, maximum };
}

export function join_facts(left: ScalarFact, right: ScalarFact): ScalarFact {
  left = canonical_fact(left);
  right = canonical_fact(right);
  if (left.tag === "bottom") return right;
  if (right.tag === "bottom") return left;
  if (left.tag === "unknown" || right.tag === "unknown") return unknown_fact;
  const left_bounds = fact_bounds(left);
  const right_bounds = fact_bounds(right);
  const minimum = min_bigint(left_bounds.minimum, right_bounds.minimum);
  const maximum = max_bigint(left_bounds.maximum, right_bounds.maximum);
  if (minimum === maximum) return { tag: "exact", value: minimum };
  return { tag: "interval", minimum, maximum };
}

export function assume_fact(
  environment: FactEnvironment,
  proposition: FactProposition,
): FactEnvironment {
  const current = environment.get(proposition.value);
  let existing = unknown_fact;
  if (current !== undefined) existing = current;
  const assumption = proposition_fact(proposition);
  const result = new Map(environment);
  result.set(proposition.value, meet_facts(existing, assumption));
  return immutable_environment(result);
}

export function implies_fact(
  environment: FactEnvironment,
  proposition: FactProposition,
): boolean {
  const current = environment.get(proposition.value);
  if (current === undefined) return false;
  return fact_implies(current, proposition_fact(proposition));
}

export function exclude_fact(
  environment: FactEnvironment,
  proposition: FactProposition,
): FactEnvironment {
  const current = environment.get(proposition.value);
  if (proposition.tag !== "equal") {
    const complement = complementary_proposition(proposition);
    return assume_fact(environment, complement);
  }
  if (current === undefined) return immutable_environment(environment);
  if (current.tag === "exact" && current.value === proposition.expected) {
    const result = new Map(environment);
    result.set(proposition.value, { tag: "bottom" });
    return immutable_environment(result);
  }
  return immutable_environment(environment);
}

export function exclude_state(
  state: FactState,
  proposition: FactProposition,
): FactState {
  if (!state.reachable) return unreachable_state;
  const facts = exclude_fact(state.facts, proposition);
  const fact = facts.get(proposition.value);
  if (fact !== undefined && fact.tag === "bottom") return unreachable_state;
  return { reachable: true, facts };
}

export function join_environments(
  left: FactEnvironment,
  right: FactEnvironment,
): FactEnvironment {
  const result = new Map<ValueId, ScalarFact>();
  const values = new Set([...left.keys(), ...right.keys()]);
  for (const value of values) {
    const left_fact = left.get(value);
    const right_fact = right.get(value);
    if (left_fact === undefined || right_fact === undefined) continue;
    result.set(value, join_facts(left_fact, right_fact));
  }
  return immutable_environment(result);
}

export function widen_facts(
  previous: ScalarFact,
  next: ScalarFact,
): ScalarFact {
  previous = canonical_fact(previous);
  next = canonical_fact(next);
  if (previous.tag === "bottom") return next;
  if (next.tag === "bottom") return previous;
  if (previous.tag === "unknown" || next.tag === "unknown") return unknown_fact;
  const previous_bounds = fact_bounds(previous);
  const next_bounds = fact_bounds(next);
  let minimum = min_bigint(previous_bounds.minimum, next_bounds.minimum);
  let maximum = max_bigint(previous_bounds.maximum, next_bounds.maximum);
  if (next_bounds.minimum < previous_bounds.minimum) minimum = -MAX_INTEGER;
  if (next_bounds.maximum > previous_bounds.maximum) maximum = MAX_INTEGER;
  if (minimum === maximum) return { tag: "exact", value: minimum };
  return { tag: "interval", minimum, maximum };
}

export function fact_implies(left: ScalarFact, right: ScalarFact): boolean {
  left = canonical_fact(left);
  right = canonical_fact(right);
  if (left.tag === "bottom") return true;
  if (left.tag === "unknown") return false;
  if (right.tag === "unknown") return true;
  const left_bounds = fact_bounds(left);
  const right_bounds = fact_bounds(right);
  return left_bounds.minimum >= right_bounds.minimum &&
    left_bounds.maximum <= right_bounds.maximum;
}

function proposition_fact(proposition: FactProposition): ScalarFact {
  switch (proposition.tag) {
    case "equal":
      return { tag: "exact", value: proposition.expected };
    case "less_than":
      if (proposition.bound <= -MAX_INTEGER) return { tag: "bottom" };
      return {
        tag: "interval",
        minimum: -MAX_INTEGER,
        maximum: proposition.bound - 1n,
      };
    case "less_equal":
      if (proposition.bound < -MAX_INTEGER) return { tag: "bottom" };
      return {
        tag: "interval",
        minimum: -MAX_INTEGER,
        maximum: proposition.bound,
      };
    case "greater_than":
      if (proposition.bound >= MAX_INTEGER) return { tag: "bottom" };
      return {
        tag: "interval",
        minimum: proposition.bound + 1n,
        maximum: MAX_INTEGER,
      };
    case "greater_equal":
      if (proposition.bound > MAX_INTEGER) return { tag: "bottom" };
      return {
        tag: "interval",
        minimum: proposition.bound,
        maximum: MAX_INTEGER,
      };
  }
}

function complementary_proposition(
  proposition: Exclude<FactProposition, { tag: "equal" }>,
): FactProposition {
  switch (proposition.tag) {
    case "less_than":
      return {
        tag: "greater_equal",
        value: proposition.value,
        bound: proposition.bound,
      };
    case "less_equal":
      return {
        tag: "greater_than",
        value: proposition.value,
        bound: proposition.bound,
      };
    case "greater_than":
      return {
        tag: "less_equal",
        value: proposition.value,
        bound: proposition.bound,
      };
    case "greater_equal":
      return {
        tag: "less_than",
        value: proposition.value,
        bound: proposition.bound,
      };
  }
}

function fact_bounds(
  fact: Exclude<ScalarFact, { tag: "unknown" }>,
): { minimum: bigint; maximum: bigint } {
  if (fact.tag === "bottom") return { minimum: 1n, maximum: 0n };
  if (fact.tag === "exact") return { minimum: fact.value, maximum: fact.value };
  return { minimum: fact.minimum, maximum: fact.maximum };
}

function canonical_fact(fact: ScalarFact): ScalarFact {
  if (fact.tag !== "interval") return fact;
  if (fact.minimum > fact.maximum) return { tag: "bottom" };
  if (fact.minimum === fact.maximum) {
    return { tag: "exact", value: fact.minimum };
  }
  return fact;
}

function min_bigint(left: bigint, right: bigint): bigint {
  if (left < right) return left;
  return right;
}

function max_bigint(left: bigint, right: bigint): bigint {
  if (left > right) return left;
  return right;
}

function immutable_environment(
  entries: Iterable<readonly [ValueId, ScalarFact]>,
): FactEnvironment {
  return immutable_map(
    Array.from(entries, ([value, fact]) => [value, freeze_fact(fact)] as const),
  );
}

function immutable_map<Key, Value>(
  entries: Iterable<readonly [Key, Value]>,
): ReadonlyMap<Key, Value> {
  const map = new Map(entries);
  const environment = {
    get size(): number {
      return map.size;
    },
    get(value: Key): Value | undefined {
      return map.get(value);
    },
    has(value: Key): boolean {
      return map.has(value);
    },
    keys(): MapIterator<Key> {
      return map.keys();
    },
    values(): MapIterator<Value> {
      return map.values();
    },
    entries(): MapIterator<[Key, Value]> {
      return map.entries();
    },
    forEach(
      callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void,
      this_arg?: unknown,
    ): void {
      for (const [key, value] of map) {
        callback.call(this_arg, value, key, environment);
      }
    },
    [Symbol.iterator](): MapIterator<[Key, Value]> {
      return map[Symbol.iterator]();
    },
  };
  return Object.freeze(environment) as ReadonlyMap<Key, Value>;
}

function freeze_fact(fact: ScalarFact): ScalarFact {
  if (fact.tag === "interval") return Object.freeze({ ...fact });
  if (fact.tag === "exact") return Object.freeze({ ...fact });
  return Object.freeze({ ...fact });
}

const MAX_INTEGER = (1n << 127n) - 1n;
