import type { ValueId } from "./semantic_identity.ts";
import {
  integer_maximum,
  integer_minimum,
  type IntegerType,
  normalize_integer,
} from "../integer.ts";

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

const MACHINE_DOMAIN_TOKEN = Symbol("duck.machine_fact_domain");
const TRUSTED_MACHINE_DOMAINS = new WeakSet<object>();

export class MachineFactDomain {
  readonly #brand = true;
  readonly reachable: boolean;
  readonly facts: FactEnvironment;
  readonly ranges: ReadonlyMap<ValueId, MachineInteger>;
  readonly evidence: ReadonlyMap<ValueId, readonly FactEvidence[]>;
  readonly exclusions: ReadonlyMap<ValueId, readonly bigint[]>;

  constructor(
    token: symbol,
    reachable: boolean,
    facts: FactEnvironment,
    ranges: ReadonlyMap<ValueId, MachineInteger>,
    evidence: ReadonlyMap<ValueId, readonly FactEvidence[]>,
    exclusions: ReadonlyMap<ValueId, readonly bigint[]>,
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
  const current = domain.facts.get(proposition.value);
  if (current === undefined) return false;
  if (current.tag === "bottom") return false;
  if (proposition.tag === "equal") {
    const exclusions = domain.exclusions.get(proposition.value);
    const remaining = remaining_singleton(current, exclusions);
    if (remaining !== undefined) return remaining === proposition.expected;
  }
  return fact_implies(current, machine_proposition_fact(proposition, range));
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
    if (existing.length >= MAX_EXCLUSIONS) return domain;
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
  if (size > BigInt(MAX_EXCLUSIONS)) return canonical;
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
  if (size < 1n || size > BigInt(MAX_EXCLUSIONS)) return undefined;
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
  );
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
  return new MachineFactDomain(
    MACHINE_DOMAIN_TOKEN,
    domain.reachable,
    domain.facts,
    domain.ranges,
    evidence,
    exclusions,
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

export const unknown_fact: ScalarFact = Object.freeze({ tag: "unknown" });

const EMPTY_EVIDENCE: readonly FactEvidence[] = Object.freeze([]);

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
const MAX_EXCLUSIONS = 16;
