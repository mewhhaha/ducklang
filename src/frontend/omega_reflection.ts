import type { IntegerType } from "../integer.ts";
import { proof_limits } from "./proof_limits.ts";
import type { Proposition } from "./proposition.ts";
import {
  type KernelContext,
  KernelEnvironment,
  type KernelTerm,
  type KernelType,
} from "./kernel_terms.ts";

export type OmegaHypothesis = {
  index: number;
  proposition: Proposition;
};

export type OmegaReflectionResult =
  | { tag: "proved"; hypotheses: readonly number[]; steps: number }
  | { tag: "unknown"; steps: number }
  | { tag: "budget_exhausted"; steps: number };

export class OmegaReflectionInvariantError extends Error {}

type MachineExpression =
  | { tag: "variable"; index: number; type: IntegerType }
  | { tag: "literal"; value: bigint; type: IntegerType }
  | { tag: "negate"; operand: MachineExpression; type: IntegerType }
  | {
    tag: "binary";
    operation: "add" | "subtract" | "multiply" | "remainder";
    left: MachineExpression;
    right: MachineExpression;
    type: IntegerType;
  };

type MachineDomain = {
  type: IntegerType;
  minimum: bigint;
  maximum: bigint;
  exclusions: Set<bigint>;
};

type SearchBudget = {
  maximum: number;
  steps: number;
  exhausted: boolean;
};

type DifferenceTerm = number | "zero";

type DifferenceConstraint = {
  type: IntegerType;
  left: DifferenceTerm;
  right: DifferenceTerm;
  maximum: bigint;
};

type DifferenceGoal =
  | { tag: "all"; constraints: readonly DifferenceConstraint[] }
  | {
    tag: "either";
    left: DifferenceConstraint;
    right: DifferenceConstraint;
  };

const MACHINE_LITERAL_PATTERN = /^literal:([IU][1-9][0-9]*):(-?[0-9]+)$/;
const MACHINE_OPERATION_PATTERN =
  /^primitive:(add|subtract|multiply|remainder):([IU][1-9][0-9]*)$/;
const MACHINE_TYPE_PATTERN = /^([IU])([1-9][0-9]*)$/;
const REGEXP_EXEC = RegExp.prototype.exec;
const REFLECT_APPLY = Reflect.apply;
const NUMBER_CONSTRUCTOR = Number;
const NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const BIGINT_CONSTRUCTOR = BigInt;
const STRING_CONSTRUCTOR = String;
const MAP_CONSTRUCTOR = Map;
const SET_CONSTRUCTOR = Set;
const ARRAY_CONSTRUCTOR = Array;
const MAP_GET = MAP_CONSTRUCTOR.prototype.get;
const MAP_SET = MAP_CONSTRUCTOR.prototype.set;
const MAP_FOR_EACH = MAP_CONSTRUCTOR.prototype.forEach;
const SET_ADD = SET_CONSTRUCTOR.prototype.add;
const SET_HAS = SET_CONSTRUCTOR.prototype.has;
const SET_FOR_EACH = SET_CONSTRUCTOR.prototype.forEach;
const ARRAY_CONCAT = ARRAY_CONSTRUCTOR.prototype.concat;
const ARRAY_FILTER = ARRAY_CONSTRUCTOR.prototype.filter;
const ARRAY_INDEX_OF = ARRAY_CONSTRUCTOR.prototype.indexOf;
const ARRAY_MAP = ARRAY_CONSTRUCTOR.prototype.map;
const ARRAY_PUSH = ARRAY_CONSTRUCTOR.prototype.push;
const ARRAY_SLICE = ARRAY_CONSTRUCTOR.prototype.slice;
const ARRAY_SORT = ARRAY_CONSTRUCTOR.prototype.sort;
const STRING_SLICE = String.prototype.slice;
const STRING_STARTS_WITH = String.prototype.startsWith;
const KERNEL_ENVIRONMENT_IS_DECLARATION =
  KernelEnvironment.prototype.is_declaration;

export function infer_omega_reflection(
  goal: Proposition,
  hypotheses: readonly OmegaHypothesis[],
  term_context: KernelContext,
  environment: KernelEnvironment,
  maximum_steps: number,
): OmegaReflectionResult {
  if (!NUMBER_IS_SAFE_INTEGER(maximum_steps) || maximum_steps < 0) {
    return { tag: "budget_exhausted", steps: 0 };
  }
  const selection = relevant_hypotheses(
    goal,
    hypotheses,
    term_context,
    maximum_steps,
  );
  if (selection === undefined) {
    return { tag: "budget_exhausted", steps: maximum_steps + 1 };
  }
  let steps = selection.steps;
  const selected = REFLECT_APPLY(ARRAY_SLICE, selection.hypotheses, [
    0,
    proof_limits.maximum_relational_terms_per_function,
  ]);
  const result = verify_omega_reflection(
    goal,
    REFLECT_APPLY(ARRAY_MAP, selected, [
      (hypothesis: OmegaHypothesis) => hypothesis.proposition,
    ]),
    term_context,
    environment,
    maximum_steps - steps,
  );
  steps += result.steps;
  if (result.tag !== "proved") return { tag: result.tag, steps };
  return {
    tag: "proved",
    hypotheses: REFLECT_APPLY(ARRAY_MAP, selected, [
      (hypothesis: OmegaHypothesis) => hypothesis.index,
    ]),
    steps,
  };
}

export function verify_omega_reflection(
  goal: Proposition,
  hypotheses: readonly Proposition[],
  term_context: KernelContext,
  environment: KernelEnvironment,
  maximum_steps: number,
): Exclude<OmegaReflectionResult, { tag: "proved" }> | {
  tag: "proved";
  steps: number;
} {
  if (!NUMBER_IS_SAFE_INTEGER(maximum_steps) || maximum_steps < 0) {
    return { tag: "budget_exhausted", steps: 0 };
  }
  const budget: SearchBudget = {
    maximum: maximum_steps,
    steps: 0,
    exhausted: false,
  };
  if (!omega_proposition_is_supported(goal, environment, budget, 0)) {
    return reflection_failure(budget);
  }
  for (let index = 0; index < hypotheses.length; index += 1) {
    const hypothesis = hypotheses[index];
    if (hypothesis === undefined) return reflection_failure(budget);
    if (!omega_proposition_is_supported(hypothesis, environment, budget, 0)) {
      return reflection_failure(budget);
    }
  }
  const variables = new MAP_CONSTRUCTOR<number, IntegerType>();
  if (!collect_proposition_variables(goal, term_context, variables, budget)) {
    return reflection_failure(budget);
  }
  for (let index = 0; index < hypotheses.length; index += 1) {
    const hypothesis = hypotheses[index];
    if (hypothesis === undefined) return reflection_failure(budget);
    if (
      !collect_proposition_variables(
        hypothesis,
        term_context,
        variables,
        budget,
      )
    ) {
      return reflection_failure(budget);
    }
  }
  if (
    verify_zero_remainder_reflection(goal, hypotheses, term_context, budget)
  ) {
    return { tag: "proved", steps: budget.steps };
  }
  if (budget.exhausted) return reflection_failure(budget);
  const difference = verify_difference_reflection(
    goal,
    hypotheses,
    term_context,
    budget,
  );
  if (difference === "proved") {
    return { tag: "proved", steps: budget.steps };
  }
  if (budget.exhausted) return reflection_failure(budget);
  const domains = new MAP_CONSTRUCTOR<number, MachineDomain>();
  REFLECT_APPLY(MAP_FOR_EACH, variables, [(
    type: IntegerType,
    index: number,
  ) => {
    REFLECT_APPLY(MAP_SET, domains, [index, {
      type,
      minimum: integer_minimum(type),
      maximum: integer_maximum(type),
      exclusions: new SET_CONSTRUCTOR<bigint>(),
    }]);
  }]);
  for (let index = 0; index < hypotheses.length; index += 1) {
    const hypothesis = hypotheses[index];
    if (hypothesis === undefined) return reflection_failure(budget);
    narrow_domains(hypothesis, domains, term_context, environment, budget);
    if (budget.exhausted) return reflection_failure(budget);
  }
  const ordered_domains = map_entries(domains);
  REFLECT_APPLY(ARRAY_SORT, ordered_domains, [
    (left: [number, MachineDomain], right: [number, MachineDomain]) =>
      left[0] - right[0],
  ]);
  let assignment_count = 1n;
  for (let index = 0; index < ordered_domains.length; index += 1) {
    const entry = ordered_domains[index];
    if (entry === undefined) return reflection_failure(budget);
    const domain = entry[1];
    let excluded = 0n;
    const exclusions = set_values(domain.exclusions);
    for (
      let exclusion_index = 0;
      exclusion_index < exclusions.length;
      exclusion_index += 1
    ) {
      const value = exclusions[exclusion_index];
      if (value === undefined) return reflection_failure(budget);
      if (value >= domain.minimum && value <= domain.maximum) excluded += 1n;
    }
    const width = domain.maximum - domain.minimum + 1n - excluded;
    if (width <= 0n) {
      return { tag: "proved", steps: budget.steps };
    }
    assignment_count *= width;
    if (
      assignment_count > BIGINT_CONSTRUCTOR(maximum_steps - budget.steps)
    ) {
      return { tag: "budget_exhausted", steps: budget.steps };
    }
  }
  const assignments = new MAP_CONSTRUCTOR<number, bigint>();
  for (let index = 0; index < ordered_domains.length; index += 1) {
    const entry = ordered_domains[index];
    if (entry === undefined) return reflection_failure(budget);
    const variable = entry[0];
    const domain = entry[1];
    const first = first_domain_value(domain);
    if (first === undefined) {
      return { tag: "proved", steps: budget.steps };
    }
    REFLECT_APPLY(MAP_SET, assignments, [variable, first]);
  }
  let counterexample = false;
  let searching = true;
  while (searching && !counterexample && !budget.exhausted) {
    if (!charge(budget)) break;
    let premises_hold = true;
    for (let index = 0; index < hypotheses.length; index += 1) {
      const hypothesis = hypotheses[index];
      if (hypothesis === undefined) {
        budget.exhausted = true;
        break;
      }
      const holds = evaluate_proposition(
        hypothesis,
        assignments,
        term_context,
        environment,
        budget,
      );
      if (holds === undefined) {
        budget.exhausted = true;
        break;
      }
      if (!holds) {
        premises_hold = false;
        break;
      }
    }
    if (premises_hold && !budget.exhausted) {
      const conclusion = evaluate_proposition(
        goal,
        assignments,
        term_context,
        environment,
        budget,
      );
      if (conclusion === undefined) budget.exhausted = true;
      else if (!conclusion) counterexample = true;
    }
    let position = ordered_domains.length - 1;
    while (position >= 0 && !counterexample && !budget.exhausted) {
      const entry = ordered_domains[position];
      if (entry === undefined) {
        budget.exhausted = true;
        break;
      }
      const variable = entry[0];
      const domain = entry[1];
      const current = REFLECT_APPLY(MAP_GET, assignments, [variable]);
      if (current === undefined) {
        budget.exhausted = true;
        break;
      }
      const next = next_domain_value(domain, current);
      if (next !== undefined) {
        REFLECT_APPLY(MAP_SET, assignments, [variable, next]);
        break;
      }
      const first = first_domain_value(domain);
      if (first === undefined) {
        budget.exhausted = true;
        break;
      }
      REFLECT_APPLY(MAP_SET, assignments, [variable, first]);
      position -= 1;
    }
    if (ordered_domains.length === 0 || position < 0) searching = false;
  }
  if (budget.exhausted) return reflection_failure(budget);
  if (counterexample) return { tag: "unknown", steps: budget.steps };
  return { tag: "proved", steps: budget.steps };
}

function omega_proposition_is_supported(
  proposition: Proposition,
  environment: KernelEnvironment,
  budget: SearchBudget,
  depth: number,
): boolean {
  if (!charge(budget) || depth > proof_limits.compiler_search_depth) {
    return false;
  }
  if (proposition.tag === "true" || proposition.tag === "false") return true;
  if (proposition.tag === "equal") {
    return omega_term_is_supported(
      proposition.left,
      environment,
      budget,
      depth + 1,
    ) && omega_term_is_supported(
      proposition.right,
      environment,
      budget,
      depth + 1,
    );
  }
  if (proposition.tag === "atom") {
    if (
      proposition.name !== "builtin:less" &&
      proposition.name !== "builtin:less_equal"
    ) {
      return false;
    }
    if (proposition.arguments.length !== 2) return false;
    const left = proposition.arguments[0];
    const right = proposition.arguments[1];
    if (left === undefined || right === undefined) return false;
    return omega_term_is_supported(left, environment, budget, depth + 1) &&
      omega_term_is_supported(right, environment, budget, depth + 1);
  }
  if (proposition.tag === "and" || proposition.tag === "or") {
    return omega_proposition_is_supported(
      proposition.left,
      environment,
      budget,
      depth + 1,
    ) && omega_proposition_is_supported(
      proposition.right,
      environment,
      budget,
      depth + 1,
    );
  }
  if (proposition.tag === "implies") {
    return omega_proposition_is_supported(
      proposition.premise,
      environment,
      budget,
      depth + 1,
    ) && omega_proposition_is_supported(
      proposition.conclusion,
      environment,
      budget,
      depth + 1,
    );
  }
  if (proposition.tag === "not") {
    return omega_proposition_is_supported(
      proposition.proposition,
      environment,
      budget,
      depth + 1,
    );
  }
  return false;
}

function omega_term_is_supported(
  term: KernelTerm,
  environment: KernelEnvironment,
  budget: SearchBudget,
  depth: number,
): boolean {
  if (!charge(budget) || depth > proof_limits.compiler_search_depth) {
    return false;
  }
  if (term.tag === "var") return true;
  if (term.tag === "constant") {
    return REFLECT_APPLY(KERNEL_ENVIRONMENT_IS_DECLARATION, environment, [
      term.name,
    ]);
  }
  if (term.tag !== "app") return false;
  return omega_term_is_supported(
    term.function,
    environment,
    budget,
    depth + 1,
  ) && omega_term_is_supported(
    term.argument,
    environment,
    budget,
    depth + 1,
  );
}

type ZeroRemainder = {
  variable: number;
  modulus: bigint;
  type: IntegerType;
};

function verify_zero_remainder_reflection(
  goal: Proposition,
  hypotheses: readonly Proposition[],
  term_context: KernelContext,
  budget: SearchBudget,
): boolean {
  const conclusion = zero_remainder(goal, term_context, budget);
  if (conclusion === undefined) return false;
  for (let index = 0; index < hypotheses.length; index += 1) {
    const hypothesis = hypotheses[index];
    if (hypothesis === undefined) return false;
    const premise = zero_remainder(hypothesis, term_context, budget);
    if (premise === undefined) continue;
    if (
      premise.variable === conclusion.variable &&
      same_integer_type(premise.type, conclusion.type) &&
      premise.modulus % conclusion.modulus === 0n
    ) {
      return true;
    }
  }
  return false;
}

function zero_remainder(
  proposition: Proposition,
  term_context: KernelContext,
  budget: SearchBudget,
): ZeroRemainder | undefined {
  if (!charge(budget) || proposition.tag !== "equal") return undefined;
  const left = machine_expression(proposition.left, term_context, budget);
  const right = machine_expression(proposition.right, term_context, budget);
  if (left === undefined || right === undefined) return undefined;
  let remainder: Extract<MachineExpression, { tag: "binary" }> | undefined;
  let residue: Extract<MachineExpression, { tag: "literal" }> | undefined;
  if (
    left.tag === "binary" && left.operation === "remainder" &&
    right.tag === "literal"
  ) {
    remainder = left;
    residue = right;
  }
  if (
    right.tag === "binary" && right.operation === "remainder" &&
    left.tag === "literal"
  ) {
    remainder = right;
    residue = left;
  }
  if (
    remainder === undefined || residue === undefined ||
    residue.value !== 0n || remainder.left.tag !== "variable" ||
    remainder.right.tag !== "literal" || remainder.right.value <= 0n ||
    !same_integer_type(remainder.type, residue.type)
  ) {
    return undefined;
  }
  return {
    variable: remainder.left.index,
    modulus: remainder.right.value,
    type: remainder.type,
  };
}

function first_domain_value(domain: MachineDomain): bigint | undefined {
  return next_domain_value(domain, domain.minimum - 1n);
}

function next_domain_value(
  domain: MachineDomain,
  current: bigint,
): bigint | undefined {
  let candidate = current + 1n;
  while (candidate <= domain.maximum) {
    if (!REFLECT_APPLY(SET_HAS, domain.exclusions, [candidate])) {
      return candidate;
    }
    candidate += 1n;
  }
  return undefined;
}

function verify_difference_reflection(
  goal: Proposition,
  hypotheses: readonly Proposition[],
  term_context: KernelContext,
  budget: SearchBudget,
): "proved" | "unknown" {
  const constraints: DifferenceConstraint[] = [];
  for (let index = 0; index < hypotheses.length; index += 1) {
    const hypothesis = hypotheses[index];
    if (hypothesis === undefined) return "unknown";
    collect_difference_constraints(
      hypothesis,
      term_context,
      constraints,
      budget,
    );
    if (budget.exhausted) return "unknown";
  }
  const difference_goal = difference_goal_from_proposition(
    goal,
    term_context,
    budget,
  );
  if (difference_goal === undefined && constraints.length === 0) {
    return "unknown";
  }
  const grouped = new MAP_CONSTRUCTOR<string, DifferenceConstraint[]>();
  const install = (constraint: DifferenceConstraint): void => {
    const key = integer_type_name(constraint.type);
    let existing = REFLECT_APPLY(MAP_GET, grouped, [key]);
    if (existing === undefined) {
      existing = [];
      REFLECT_APPLY(MAP_SET, grouped, [key, existing]);
    }
    REFLECT_APPLY(ARRAY_PUSH, existing, [constraint]);
  };
  for (let index = 0; index < constraints.length; index += 1) {
    const constraint = constraints[index];
    if (constraint === undefined) return "unknown";
    install(constraint);
  }
  if (difference_goal?.tag === "all") {
    for (
      let index = 0;
      index < difference_goal.constraints.length;
      index += 1
    ) {
      const constraint = difference_goal.constraints[index];
      if (constraint === undefined) return "unknown";
      install(constraint);
    }
  }
  if (difference_goal?.tag === "either") {
    install(difference_goal.left);
    install(difference_goal.right);
  }
  const closures = new MAP_CONSTRUCTOR<string, DifferenceClosure>();
  const groups = map_entries(grouped);
  for (let group_index = 0; group_index < groups.length; group_index += 1) {
    const entry = groups[group_index];
    if (entry === undefined) return "unknown";
    const key = entry[0];
    const group = entry[1];
    const matching = REFLECT_APPLY(ARRAY_FILTER, constraints, [
      (constraint: DifferenceConstraint) =>
        integer_type_name(constraint.type) === key,
    ]);
    const premise_count = matching.length;
    const representative = group[0];
    if (representative === undefined) {
      return "unknown";
    }
    const closure = difference_closure(
      REFLECT_APPLY(ARRAY_SLICE, group, [0, premise_count]),
      group,
      representative.type,
      budget,
    );
    if (closure === undefined) {
      return "unknown";
    }
    if (closure.contradiction) {
      return "proved";
    }
    REFLECT_APPLY(MAP_SET, closures, [key, closure]);
  }
  if (difference_goal === undefined) return "unknown";
  if (difference_goal.tag === "all") {
    for (
      let index = 0;
      index < difference_goal.constraints.length;
      index += 1
    ) {
      const constraint = difference_goal.constraints[index];
      if (constraint === undefined) return "unknown";
      const closure = REFLECT_APPLY(MAP_GET, closures, [
        integer_type_name(constraint.type),
      ]);
      if (closure === undefined || !closure_implies(closure, constraint)) {
        return "unknown";
      }
    }
    return "proved";
  }
  const left_closure = REFLECT_APPLY(MAP_GET, closures, [
    integer_type_name(difference_goal.left.type),
  ]);
  if (
    left_closure !== undefined &&
    closure_implies(left_closure, difference_goal.left)
  ) {
    return "proved";
  }
  const right_closure = REFLECT_APPLY(MAP_GET, closures, [
    integer_type_name(difference_goal.right.type),
  ]);
  if (
    right_closure !== undefined &&
    closure_implies(right_closure, difference_goal.right)
  ) {
    return "proved";
  }
  return "unknown";
}

type DifferenceClosure = {
  terms: readonly DifferenceTerm[];
  bounds: readonly (readonly (bigint | undefined)[])[];
  contradiction: boolean;
};

function difference_closure(
  constraints: readonly DifferenceConstraint[],
  referenced: readonly DifferenceConstraint[],
  type: IntegerType,
  budget: SearchBudget,
): DifferenceClosure | undefined {
  const term_set = new SET_CONSTRUCTOR<DifferenceTerm>();
  REFLECT_APPLY(SET_ADD, term_set, ["zero"]);
  for (let index = 0; index < referenced.length; index += 1) {
    const constraint = referenced[index];
    if (constraint === undefined) return undefined;
    REFLECT_APPLY(SET_ADD, term_set, [constraint.left]);
    REFLECT_APPLY(SET_ADD, term_set, [constraint.right]);
  }
  const terms = set_values(term_set);
  REFLECT_APPLY(ARRAY_SORT, terms, [compare_difference_terms]);
  if (terms.length > proof_limits.maximum_relational_terms_per_function + 1) {
    budget.exhausted = true;
    return undefined;
  }
  const indices = new MAP_CONSTRUCTOR<DifferenceTerm, number>();
  for (let index = 0; index < terms.length; index += 1) {
    const term = terms[index];
    if (term === undefined) return undefined;
    REFLECT_APPLY(MAP_SET, indices, [term, index]);
  }
  const bounds = REFLECT_APPLY(ARRAY_MAP, terms, [
    (_: DifferenceTerm, row: number) =>
      REFLECT_APPLY(ARRAY_MAP, terms, [
        (__: DifferenceTerm, column: number) => {
          if (row === column) return 0n;
          return undefined;
        },
      ]),
  ]) as (bigint | undefined)[][];
  for (let index = 0; index < constraints.length; index += 1) {
    const constraint = constraints[index];
    if (constraint === undefined) return undefined;
    const left = REFLECT_APPLY(MAP_GET, indices, [constraint.left]);
    const right = REFLECT_APPLY(MAP_GET, indices, [constraint.right]);
    if (left === undefined || right === undefined) return undefined;
    const existing = bounds[left]?.[right];
    if (existing === undefined || constraint.maximum < existing) {
      const row = bounds[left];
      if (row === undefined) return undefined;
      row[right] = constraint.maximum;
    }
  }
  const zero = REFLECT_APPLY(MAP_GET, indices, ["zero"]);
  if (zero === undefined) return undefined;
  for (let index = 0; index < terms.length; index += 1) {
    const term = terms[index];
    if (term === undefined) return undefined;
    if (term === "zero") continue;
    const variable = REFLECT_APPLY(MAP_GET, indices, [term]);
    if (variable === undefined) return undefined;
    const upper_row = bounds[variable];
    const lower_row = bounds[zero];
    if (upper_row === undefined || lower_row === undefined) return undefined;
    const maximum = integer_maximum(type);
    const existing_upper = upper_row[zero];
    if (existing_upper === undefined || maximum < existing_upper) {
      upper_row[zero] = maximum;
    }
    const minimum = -integer_minimum(type);
    const existing_lower = lower_row[variable];
    if (existing_lower === undefined || minimum < existing_lower) {
      lower_row[variable] = minimum;
    }
  }
  for (let middle = 0; middle < terms.length; middle += 1) {
    for (let left = 0; left < terms.length; left += 1) {
      const left_middle = bounds[left]?.[middle];
      if (left_middle === undefined) continue;
      for (let right = 0; right < terms.length; right += 1) {
        if (!charge(budget)) return undefined;
        const middle_right = bounds[middle]?.[right];
        if (middle_right === undefined) continue;
        const candidate = left_middle + middle_right;
        const row = bounds[left];
        if (row === undefined) return undefined;
        const existing = row[right];
        if (existing === undefined || candidate < existing) {
          row[right] = candidate;
        }
      }
    }
  }
  let contradiction = false;
  for (let index = 0; index < terms.length; index += 1) {
    const self = bounds[index]?.[index];
    if (self !== undefined && self < 0n) contradiction = true;
  }
  return { terms, bounds, contradiction };
}

function closure_implies(
  closure: DifferenceClosure,
  constraint: DifferenceConstraint,
): boolean {
  const left = REFLECT_APPLY(ARRAY_INDEX_OF, closure.terms, [constraint.left]);
  const right = REFLECT_APPLY(ARRAY_INDEX_OF, closure.terms, [
    constraint.right,
  ]);
  if (left < 0 || right < 0) return false;
  const maximum = closure.bounds[left]?.[right];
  return maximum !== undefined && maximum <= constraint.maximum;
}

function compare_difference_terms(
  left: DifferenceTerm,
  right: DifferenceTerm,
): number {
  if (left === right) return 0;
  if (left === "zero") return -1;
  if (right === "zero") return 1;
  return left - right;
}

function collect_difference_constraints(
  proposition: Proposition,
  term_context: KernelContext,
  constraints: DifferenceConstraint[],
  budget: SearchBudget,
  negated = false,
): void {
  if (!charge(budget)) return;
  if (proposition.tag === "and" && !negated) {
    collect_difference_constraints(
      proposition.left,
      term_context,
      constraints,
      budget,
    );
    collect_difference_constraints(
      proposition.right,
      term_context,
      constraints,
      budget,
    );
    return;
  }
  if (proposition.tag === "not") {
    collect_difference_constraints(
      proposition.proposition,
      term_context,
      constraints,
      budget,
      !negated,
    );
    return;
  }
  const relation = difference_relation_from_proposition(
    proposition,
    term_context,
    budget,
    negated,
  );
  if (relation?.tag !== "all") return;
  for (let index = 0; index < relation.constraints.length; index += 1) {
    const constraint = relation.constraints[index];
    if (constraint === undefined) return;
    REFLECT_APPLY(ARRAY_PUSH, constraints, [constraint]);
  }
}

function difference_goal_from_proposition(
  proposition: Proposition,
  term_context: KernelContext,
  budget: SearchBudget,
): DifferenceGoal | undefined {
  if (!charge(budget)) return undefined;
  if (proposition.tag === "and") {
    const left = difference_goal_from_proposition(
      proposition.left,
      term_context,
      budget,
    );
    const right = difference_goal_from_proposition(
      proposition.right,
      term_context,
      budget,
    );
    if (left?.tag !== "all" || right?.tag !== "all") return undefined;
    return {
      tag: "all",
      constraints: REFLECT_APPLY(ARRAY_CONCAT, left.constraints, [
        right.constraints,
      ]),
    };
  }
  if (proposition.tag === "not") {
    return difference_relation_from_proposition(
      proposition.proposition,
      term_context,
      budget,
      true,
    );
  }
  return difference_relation_from_proposition(
    proposition,
    term_context,
    budget,
    false,
  );
}

function difference_relation_from_proposition(
  proposition: Proposition,
  term_context: KernelContext,
  budget: SearchBudget,
  negated: boolean,
): DifferenceGoal | undefined {
  if (proposition.tag === "equal") {
    const operands = simple_difference_operands(
      proposition.left,
      proposition.right,
      term_context,
      budget,
    );
    if (operands === undefined) return undefined;
    const forward = difference_constraint(operands.left, operands.right, 0n);
    const reverse = difference_constraint(operands.right, operands.left, 0n);
    if (forward === undefined || reverse === undefined) return undefined;
    if (negated) {
      const left = difference_constraint(operands.left, operands.right, -1n);
      const right = difference_constraint(operands.right, operands.left, -1n);
      if (left === undefined || right === undefined) return undefined;
      return { tag: "either", left, right };
    }
    return { tag: "all", constraints: [forward, reverse] };
  }
  if (
    proposition.tag !== "atom" ||
    (proposition.name !== "builtin:less" &&
      proposition.name !== "builtin:less_equal")
  ) {
    return undefined;
  }
  const left_term = proposition.arguments[0];
  const right_term = proposition.arguments[1];
  if (left_term === undefined || right_term === undefined) return undefined;
  let left = left_term;
  let right = right_term;
  let strict = proposition.name === "builtin:less";
  if (negated) {
    left = right_term;
    right = left_term;
    strict = !strict;
  }
  const operands = simple_difference_operands(
    left,
    right,
    term_context,
    budget,
  );
  if (operands === undefined) return undefined;
  let maximum = 0n;
  if (strict) maximum = -1n;
  const constraint = difference_constraint(
    operands.left,
    operands.right,
    maximum,
  );
  if (constraint === undefined) return undefined;
  return { tag: "all", constraints: [constraint] };
}

type SimpleDifferenceOperand = {
  term: DifferenceTerm;
  constant: bigint;
  type: IntegerType;
};

function simple_difference_operands(
  left: KernelTerm,
  right: KernelTerm,
  term_context: KernelContext,
  budget: SearchBudget,
):
  | { left: SimpleDifferenceOperand; right: SimpleDifferenceOperand }
  | undefined {
  const left_expression = machine_expression(left, term_context, budget);
  const right_expression = machine_expression(right, term_context, budget);
  if (left_expression === undefined || right_expression === undefined) {
    return undefined;
  }
  const left_operand = simple_difference_operand(left_expression);
  const right_operand = simple_difference_operand(right_expression);
  if (left_operand === undefined || right_operand === undefined) {
    return undefined;
  }
  if (!same_integer_type(left_operand.type, right_operand.type)) {
    return undefined;
  }
  return { left: left_operand, right: right_operand };
}

function simple_difference_operand(
  expression: MachineExpression,
): SimpleDifferenceOperand | undefined {
  if (expression.tag === "variable") {
    return { term: expression.index, constant: 0n, type: expression.type };
  }
  if (expression.tag === "literal") {
    return { term: "zero", constant: expression.value, type: expression.type };
  }
  return undefined;
}

function difference_constraint(
  left: SimpleDifferenceOperand,
  right: SimpleDifferenceOperand,
  maximum: bigint,
): DifferenceConstraint | undefined {
  if (!same_integer_type(left.type, right.type)) return undefined;
  return {
    type: left.type,
    left: left.term,
    right: right.term,
    maximum: maximum - left.constant + right.constant,
  };
}

function relevant_hypotheses(
  goal: Proposition,
  hypotheses: readonly OmegaHypothesis[],
  term_context: KernelContext,
  maximum_steps: number,
): { hypotheses: readonly OmegaHypothesis[]; steps: number } | undefined {
  const budget: SearchBudget = {
    maximum: maximum_steps,
    steps: 0,
    exhausted: false,
  };
  const goal_variables = new MAP_CONSTRUCTOR<number, IntegerType>();
  collect_proposition_variables(goal, term_context, goal_variables, budget);
  if (budget.exhausted) return undefined;
  const supported: {
    hypothesis: OmegaHypothesis;
    variables: ReadonlySet<number>;
  }[] = [];
  for (const hypothesis of hypotheses) {
    const variables = new MAP_CONSTRUCTOR<number, IntegerType>();
    const recognized = collect_proposition_variables(
      hypothesis.proposition,
      term_context,
      variables,
      budget,
    );
    if (budget.exhausted) return undefined;
    if (!recognized) continue;
    REFLECT_APPLY(ARRAY_PUSH, supported, [{
      hypothesis,
      variables: set_from_values(map_keys(variables)),
    }]);
  }
  REFLECT_APPLY(ARRAY_SORT, supported, [(
    left: { hypothesis: OmegaHypothesis },
    right: { hypothesis: OmegaHypothesis },
  ) => left.hypothesis.index - right.hypothesis.index]);
  if (goal.tag === "false") {
    return {
      hypotheses: REFLECT_APPLY(ARRAY_MAP, supported, [
        (entry: { hypothesis: OmegaHypothesis }) => entry.hypothesis,
      ]),
      steps: budget.steps,
    };
  }
  const relevant = set_from_values(map_keys(goal_variables));
  const selected = new SET_CONSTRUCTOR<number>();
  let changed = true;
  while (changed) {
    if (!charge(budget)) return undefined;
    changed = false;
    for (let index = 0; index < supported.length; index += 1) {
      const entry = supported[index];
      if (entry === undefined) return undefined;
      if (!charge(budget)) return undefined;
      const hypothesis = entry.hypothesis;
      if (REFLECT_APPLY(SET_HAS, selected, [hypothesis.index])) continue;
      let intersects = false;
      const variables = set_values(entry.variables);
      for (
        let variable_index = 0;
        variable_index < variables.length;
        variable_index += 1
      ) {
        const variable = variables[variable_index];
        if (variable === undefined) return undefined;
        if (!charge(budget)) return undefined;
        if (REFLECT_APPLY(SET_HAS, relevant, [variable])) intersects = true;
      }
      if (!intersects) continue;
      REFLECT_APPLY(SET_ADD, selected, [hypothesis.index]);
      for (
        let variable_index = 0;
        variable_index < variables.length;
        variable_index += 1
      ) {
        const variable = variables[variable_index];
        if (variable === undefined) return undefined;
        REFLECT_APPLY(SET_ADD, relevant, [variable]);
      }
      changed = true;
    }
  }
  return {
    hypotheses: REFLECT_APPLY(
      ARRAY_MAP,
      REFLECT_APPLY(ARRAY_FILTER, supported, [
        (entry: { hypothesis: OmegaHypothesis }) =>
          REFLECT_APPLY(SET_HAS, selected, [entry.hypothesis.index]),
      ]),
      [(entry: { hypothesis: OmegaHypothesis }) => entry.hypothesis],
    ),
    steps: budget.steps,
  };
}

function collect_proposition_variables(
  proposition: Proposition,
  term_context: KernelContext,
  variables: Map<number, IntegerType>,
  budget: SearchBudget,
): boolean {
  if (!charge(budget)) return false;
  if (proposition.tag === "true" || proposition.tag === "false") return true;
  if (proposition.tag === "equal") {
    return collect_expression_variables(
      proposition.left,
      term_context,
      variables,
      budget,
    ) && collect_expression_variables(
      proposition.right,
      term_context,
      variables,
      budget,
    );
  }
  if (proposition.tag === "atom") {
    if (
      proposition.name !== "builtin:less" &&
      proposition.name !== "builtin:less_equal"
    ) {
      return false;
    }
    const left = proposition.arguments[0];
    const right = proposition.arguments[1];
    if (
      left === undefined || right === undefined ||
      proposition.arguments.length !== 2
    ) {
      return false;
    }
    return collect_expression_variables(
      left,
      term_context,
      variables,
      budget,
    ) &&
      collect_expression_variables(right, term_context, variables, budget);
  }
  if (proposition.tag === "and" || proposition.tag === "or") {
    return collect_proposition_variables(
      proposition.left,
      term_context,
      variables,
      budget,
    ) && collect_proposition_variables(
      proposition.right,
      term_context,
      variables,
      budget,
    );
  }
  if (proposition.tag === "implies") {
    return collect_proposition_variables(
      proposition.premise,
      term_context,
      variables,
      budget,
    ) && collect_proposition_variables(
      proposition.conclusion,
      term_context,
      variables,
      budget,
    );
  }
  if (proposition.tag === "not") {
    return collect_proposition_variables(
      proposition.proposition,
      term_context,
      variables,
      budget,
    );
  }
  return false;
}

function collect_expression_variables(
  term: KernelTerm,
  term_context: KernelContext,
  variables: Map<number, IntegerType>,
  budget: SearchBudget,
): boolean {
  const expression = machine_expression(term, term_context, budget);
  if (expression === undefined) return false;
  const visit = (current: MachineExpression): void => {
    if (current.tag === "variable") {
      const existing = REFLECT_APPLY(MAP_GET, variables, [current.index]);
      if (
        existing !== undefined &&
        (existing.signed !== current.type.signed ||
          existing.width !== current.type.width)
      ) {
        budget.exhausted = true;
        return;
      }
      REFLECT_APPLY(MAP_SET, variables, [current.index, current.type]);
      if (
        variables.size > proof_limits.maximum_relational_terms_per_function
      ) {
        budget.exhausted = true;
      }
      return;
    }
    if (current.tag === "literal") return;
    if (current.tag === "negate") {
      visit(current.operand);
      return;
    }
    visit(current.left);
    visit(current.right);
  };
  visit(expression);
  return !budget.exhausted;
}

function narrow_domains(
  proposition: Proposition,
  domains: Map<number, MachineDomain>,
  term_context: KernelContext,
  environment: KernelEnvironment,
  budget: SearchBudget,
  negated = false,
): void {
  if (!charge(budget)) return;
  if (proposition.tag === "and" && !negated) {
    narrow_domains(
      proposition.left,
      domains,
      term_context,
      environment,
      budget,
    );
    narrow_domains(
      proposition.right,
      domains,
      term_context,
      environment,
      budget,
    );
    return;
  }
  if (proposition.tag === "not") {
    narrow_domains(
      proposition.proposition,
      domains,
      term_context,
      environment,
      budget,
      !negated,
    );
    return;
  }
  if (proposition.tag === "equal") {
    narrow_equality(
      proposition.left,
      proposition.right,
      negated,
      domains,
      term_context,
      environment,
      budget,
    );
    return;
  }
  if (
    proposition.tag !== "atom" ||
    (proposition.name !== "builtin:less" &&
      proposition.name !== "builtin:less_equal")
  ) {
    return;
  }
  const left = proposition.arguments[0];
  const right = proposition.arguments[1];
  if (left === undefined || right === undefined) return;
  const left_expression = machine_expression(left, term_context, budget);
  const right_expression = machine_expression(right, term_context, budget);
  if (left_expression === undefined || right_expression === undefined) return;
  if (!same_integer_type(left_expression.type, right_expression.type)) return;
  let strict = proposition.name === "builtin:less";
  if (negated) strict = !strict;
  if (
    left_expression.tag === "variable" &&
    right_expression.tag === "literal"
  ) {
    const domain = REFLECT_APPLY(MAP_GET, domains, [left_expression.index]);
    if (domain === undefined) return;
    if (!negated) {
      let maximum = right_expression.value;
      if (strict) maximum -= 1n;
      if (maximum < domain.maximum) domain.maximum = maximum;
      return;
    }
    let minimum = right_expression.value;
    if (strict) minimum += 1n;
    if (minimum > domain.minimum) domain.minimum = minimum;
    return;
  }
  if (
    left_expression.tag === "literal" &&
    right_expression.tag === "variable"
  ) {
    const domain = REFLECT_APPLY(MAP_GET, domains, [right_expression.index]);
    if (domain === undefined) return;
    if (!negated) {
      let minimum = left_expression.value;
      if (strict) minimum += 1n;
      if (minimum > domain.minimum) domain.minimum = minimum;
      return;
    }
    let maximum = left_expression.value;
    if (strict) maximum -= 1n;
    if (maximum < domain.maximum) domain.maximum = maximum;
  }
}

function narrow_equality(
  left: KernelTerm,
  right: KernelTerm,
  negated: boolean,
  domains: Map<number, MachineDomain>,
  term_context: KernelContext,
  _environment: KernelEnvironment,
  budget: SearchBudget,
): void {
  const left_expression = machine_expression(left, term_context, budget);
  const right_expression = machine_expression(right, term_context, budget);
  if (left_expression === undefined || right_expression === undefined) return;
  let variable: Extract<MachineExpression, { tag: "variable" }> | undefined;
  let literal: Extract<MachineExpression, { tag: "literal" }> | undefined;
  if (
    left_expression.tag === "variable" &&
    right_expression.tag === "literal"
  ) {
    variable = left_expression;
    literal = right_expression;
  }
  if (
    left_expression.tag === "literal" &&
    right_expression.tag === "variable"
  ) {
    variable = right_expression;
    literal = left_expression;
  }
  if (variable === undefined || literal === undefined) return;
  const domain = REFLECT_APPLY(MAP_GET, domains, [variable.index]);
  if (domain === undefined) return;
  if (negated) {
    REFLECT_APPLY(SET_ADD, domain.exclusions, [literal.value]);
    return;
  }
  domain.minimum = literal.value;
  domain.maximum = literal.value;
}

function evaluate_proposition(
  proposition: Proposition,
  assignments: ReadonlyMap<number, bigint>,
  term_context: KernelContext,
  environment: KernelEnvironment,
  budget: SearchBudget,
): boolean | undefined {
  if (!charge(budget)) return undefined;
  if (proposition.tag === "true") return true;
  if (proposition.tag === "false") return false;
  if (proposition.tag === "equal") {
    const left = evaluate_expression(
      proposition.left,
      assignments,
      term_context,
      environment,
      budget,
    );
    const right = evaluate_expression(
      proposition.right,
      assignments,
      term_context,
      environment,
      budget,
    );
    if (left === undefined || right === undefined) return undefined;
    return left.type.signed === right.type.signed &&
      left.type.width === right.type.width && left.value === right.value;
  }
  if (proposition.tag === "atom") {
    if (
      proposition.name !== "builtin:less" &&
      proposition.name !== "builtin:less_equal"
    ) {
      return undefined;
    }
    const left_term = proposition.arguments[0];
    const right_term = proposition.arguments[1];
    if (left_term === undefined || right_term === undefined) return undefined;
    const left = evaluate_expression(
      left_term,
      assignments,
      term_context,
      environment,
      budget,
    );
    const right = evaluate_expression(
      right_term,
      assignments,
      term_context,
      environment,
      budget,
    );
    if (left === undefined || right === undefined) return undefined;
    if (
      left.type.signed !== right.type.signed ||
      left.type.width !== right.type.width
    ) {
      return undefined;
    }
    if (proposition.name === "builtin:less") {
      return left.value < right.value;
    }
    return left.value <= right.value;
  }
  if (proposition.tag === "not") {
    const inner = evaluate_proposition(
      proposition.proposition,
      assignments,
      term_context,
      environment,
      budget,
    );
    if (inner === undefined) return undefined;
    return !inner;
  }
  if (proposition.tag === "and" || proposition.tag === "or") {
    const left = evaluate_proposition(
      proposition.left,
      assignments,
      term_context,
      environment,
      budget,
    );
    const right = evaluate_proposition(
      proposition.right,
      assignments,
      term_context,
      environment,
      budget,
    );
    if (left === undefined || right === undefined) return undefined;
    if (proposition.tag === "and") return left && right;
    return left || right;
  }
  if (proposition.tag === "implies") {
    const premise = evaluate_proposition(
      proposition.premise,
      assignments,
      term_context,
      environment,
      budget,
    );
    const conclusion = evaluate_proposition(
      proposition.conclusion,
      assignments,
      term_context,
      environment,
      budget,
    );
    if (premise === undefined || conclusion === undefined) return undefined;
    return !premise || conclusion;
  }
  return undefined;
}

function evaluate_expression(
  term: KernelTerm,
  assignments: ReadonlyMap<number, bigint>,
  term_context: KernelContext,
  environment: KernelEnvironment,
  budget: SearchBudget,
): { value: bigint; type: IntegerType } | undefined {
  const expression = machine_expression(term, term_context, budget);
  if (expression === undefined) return undefined;
  const evaluate = (
    current: MachineExpression,
  ): { value: bigint; type: IntegerType } | undefined => {
    if (!charge(budget)) return undefined;
    if (current.tag === "variable") {
      const value = REFLECT_APPLY(MAP_GET, assignments, [current.index]);
      if (value === undefined) return undefined;
      return { value, type: current.type };
    }
    if (current.tag === "literal") {
      return { value: current.value, type: current.type };
    }
    if (current.tag === "negate") {
      const operand = evaluate(current.operand);
      if (operand === undefined) return undefined;
      return {
        value: normalize_integer(current.type, -operand.value),
        type: current.type,
      };
    }
    const left = evaluate(current.left);
    const right = evaluate(current.right);
    if (left === undefined || right === undefined) return undefined;
    let value: bigint;
    if (current.operation === "add") value = left.value + right.value;
    else if (current.operation === "subtract") {
      value = left.value - right.value;
    } else if (current.operation === "multiply") {
      value = left.value * right.value;
    } else {
      if (right.value === 0n) return undefined;
      value = left.value % right.value;
    }
    return {
      value: normalize_integer(current.type, value),
      type: current.type,
    };
  };
  const result = evaluate(expression);
  if (result === undefined) return undefined;
  if (
    !REFLECT_APPLY(KERNEL_ENVIRONMENT_IS_DECLARATION, environment, [
      integer_type_name(result.type),
    ])
  ) {
    return undefined;
  }
  return result;
}

function machine_expression(
  term: KernelTerm,
  term_context: KernelContext,
  budget: SearchBudget,
): MachineExpression | undefined {
  if (!charge(budget)) return undefined;
  if (term.tag === "var") {
    const type = term_context[term.index];
    if (type?.tag !== "constant") return undefined;
    const integer_type = omega_integer_type_from_name(type.name);
    if (integer_type === undefined) return undefined;
    return { tag: "variable", index: term.index, type: integer_type };
  }
  if (term.tag === "constant") {
    if (term.type.tag !== "constant") return undefined;
    const match = REFLECT_APPLY(REGEXP_EXEC, MACHINE_LITERAL_PATTERN, [
      term.name,
    ]);
    if (match === null) return undefined;
    const type_name = match[1];
    const value_text = match[2];
    if (type_name === undefined || value_text === undefined) return undefined;
    if (term.type.name !== type_name) return undefined;
    const type = omega_integer_type_from_name(type_name);
    if (type === undefined) return undefined;
    const value = BIGINT_CONSTRUCTOR(value_text);
    if (normalize_integer(type, value) !== value) return undefined;
    return { tag: "literal", value, type };
  }
  const binary = binary_application(term);
  if (binary !== undefined) {
    const match = REFLECT_APPLY(REGEXP_EXEC, MACHINE_OPERATION_PATTERN, [
      binary.name,
    ]);
    if (match === null) return undefined;
    const operation_text = match[1];
    const type_name = match[2];
    if (operation_text === undefined || type_name === undefined) {
      return undefined;
    }
    let operation: "add" | "subtract" | "multiply" | "remainder";
    if (operation_text === "add") operation = "add";
    else if (operation_text === "subtract") operation = "subtract";
    else if (operation_text === "multiply") operation = "multiply";
    else if (operation_text === "remainder") operation = "remainder";
    else return undefined;
    const type = omega_integer_type_from_name(type_name);
    if (type === undefined) return undefined;
    if (!kernel_primitive_type_matches(binary.type, type_name, 2)) {
      return undefined;
    }
    const left = machine_expression(binary.left, term_context, budget);
    const right = machine_expression(binary.right, term_context, budget);
    if (left === undefined || right === undefined) return undefined;
    if (
      !same_integer_type(left.type, type) ||
      !same_integer_type(right.type, type)
    ) {
      return undefined;
    }
    return { tag: "binary", operation, left, right, type };
  }
  if (
    term.tag === "app" &&
    term.function.tag === "constant" &&
    REFLECT_APPLY(STRING_STARTS_WITH, term.function.name, [
      "primitive:negate:",
    ])
  ) {
    const type_name = REFLECT_APPLY(STRING_SLICE, term.function.name, [
      "primitive:negate:".length,
    ]);
    const type = omega_integer_type_from_name(type_name);
    if (type === undefined) return undefined;
    if (!kernel_primitive_type_matches(term.function.type, type_name, 1)) {
      return undefined;
    }
    const operand = machine_expression(term.argument, term_context, budget);
    if (operand === undefined || !same_integer_type(operand.type, type)) {
      return undefined;
    }
    return { tag: "negate", operand, type };
  }
  return undefined;
}

function binary_application(
  term: KernelTerm,
): {
  name: string;
  type: KernelType;
  left: KernelTerm;
  right: KernelTerm;
} | undefined {
  if (term.tag !== "app" || term.function.tag !== "app") return undefined;
  if (term.function.function.tag !== "constant") return undefined;
  return {
    name: term.function.function.name,
    type: term.function.function.type,
    left: term.function.argument,
    right: term.argument,
  };
}

function kernel_primitive_type_matches(
  type: KernelType,
  type_name: string,
  arity: 1 | 2,
): boolean {
  if (
    type.tag !== "pi" || type.domain.tag !== "constant" ||
    type.domain.name !== type_name
  ) {
    return false;
  }
  if (arity === 1) {
    return type.codomain.tag === "constant" &&
      type.codomain.name === type_name;
  }
  return type.codomain.tag === "pi" &&
    type.codomain.domain.tag === "constant" &&
    type.codomain.domain.name === type_name &&
    type.codomain.codomain.tag === "constant" &&
    type.codomain.codomain.name === type_name;
}

function same_integer_type(left: IntegerType, right: IntegerType): boolean {
  return left.signed === right.signed && left.width === right.width;
}

function omega_integer_type_from_name(name: string): IntegerType | undefined {
  const match = REFLECT_APPLY(REGEXP_EXEC, MACHINE_TYPE_PATTERN, [name]);
  const sign = match?.[1];
  const width_text = match?.[2];
  if (sign === undefined || width_text === undefined) return undefined;
  const width = NUMBER_CONSTRUCTOR(width_text);
  if (!NUMBER_IS_SAFE_INTEGER(width) || width < 1 || width > 128) {
    return undefined;
  }
  return { signed: sign === "I", width };
}

function integer_minimum(type: IntegerType): bigint {
  if (!type.signed) return 0n;
  return -(1n << BIGINT_CONSTRUCTOR(type.width - 1));
}

function integer_maximum(type: IntegerType): bigint {
  if (type.signed) {
    return (1n << BIGINT_CONSTRUCTOR(type.width - 1)) - 1n;
  }
  return (1n << BIGINT_CONSTRUCTOR(type.width)) - 1n;
}

function normalize_integer(type: IntegerType, value: bigint): bigint {
  const modulus = 1n << BIGINT_CONSTRUCTOR(type.width);
  let normalized = value % modulus;
  if (normalized < 0n) normalized += modulus;
  if (type.signed) {
    const sign = 1n << BIGINT_CONSTRUCTOR(type.width - 1);
    if ((normalized & sign) !== 0n) normalized -= modulus;
  }
  return normalized;
}

function integer_type_name(type: IntegerType): string {
  let prefix = "U";
  if (type.signed) prefix = "I";
  return prefix + STRING_CONSTRUCTOR(type.width);
}

function map_entries<Key, Value>(
  map: ReadonlyMap<Key, Value>,
): [Key, Value][] {
  const entries: [Key, Value][] = [];
  REFLECT_APPLY(MAP_FOR_EACH, map, [(
    value: Value,
    key: Key,
  ) => {
    REFLECT_APPLY(ARRAY_PUSH, entries, [[key, value]]);
  }]);
  return entries;
}

function map_keys<Key, Value>(map: ReadonlyMap<Key, Value>): Key[] {
  const keys: Key[] = [];
  REFLECT_APPLY(MAP_FOR_EACH, map, [(_: Value, key: Key) => {
    REFLECT_APPLY(ARRAY_PUSH, keys, [key]);
  }]);
  return keys;
}

function set_values<Value>(set: ReadonlySet<Value>): Value[] {
  const values: Value[] = [];
  REFLECT_APPLY(SET_FOR_EACH, set, [(value: Value) => {
    REFLECT_APPLY(ARRAY_PUSH, values, [value]);
  }]);
  return values;
}

function set_from_values<Value>(values: readonly Value[]): Set<Value> {
  const set = new SET_CONSTRUCTOR<Value>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as Value;
    REFLECT_APPLY(SET_ADD, set, [value]);
  }
  return set;
}

function charge(budget: SearchBudget): boolean {
  budget.steps += 1;
  if (budget.steps <= budget.maximum) return true;
  budget.exhausted = true;
  return false;
}

function reflection_failure(
  budget: SearchBudget,
): { tag: "unknown" | "budget_exhausted"; steps: number } {
  if (budget.exhausted) {
    return { tag: "budget_exhausted", steps: budget.steps };
  }
  return { tag: "unknown", steps: budget.steps };
}
