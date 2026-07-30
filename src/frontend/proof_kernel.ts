import { expect } from "../expect.ts";
import {
  check_term as check_kernel_term,
  check_term_sequence,
  check_type,
  infer_term,
  kernel_context_equal,
  type KernelContext,
  KernelEnvironment,
  type KernelTerm,
  type KernelType,
  MAX_KERNEL_TERM_SEQUENCE_LENGTH,
  shift_kernel_term_variables,
  shift_kernel_type_variables,
  snapshot_kernel_context,
  snapshot_kernel_term,
  snapshot_kernel_type,
  substitute_kernel_term_variable,
  substitute_kernel_type_variable,
  term_equal,
  term_sequences_equal,
  type_equal,
} from "./kernel_terms.ts";

const MAP_CONSTRUCTOR = Map;
const ARRAY_CONSTRUCTOR = Array;
const ARRAY_IS_ARRAY = Array.isArray;
const ARRAY_PROTOTYPE = Array.prototype;
const NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const OBJECT_FREEZE = Object.freeze;
const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const OBJECT_PROTOTYPE = Object.prototype;
const REFLECT_APPLY = Reflect.apply;
const REFLECT_OWN_KEYS = Reflect.ownKeys;
const STRING_CONSTRUCTOR = String;
const WEAK_MAP_CONSTRUCTOR = WeakMap;
const WEAK_SET_CONSTRUCTOR = WeakSet;
const MAP_GET = MAP_CONSTRUCTOR.prototype.get;
const MAP_HAS = MAP_CONSTRUCTOR.prototype.has;
const MAP_SET = MAP_CONSTRUCTOR.prototype.set;
const WEAK_MAP_GET = WEAK_MAP_CONSTRUCTOR.prototype.get;
const WEAK_MAP_SET = WEAK_MAP_CONSTRUCTOR.prototype.set;
const WEAK_SET_ADD = WEAK_SET_CONSTRUCTOR.prototype.add;
const WEAK_SET_DELETE = WEAK_SET_CONSTRUCTOR.prototype.delete;
const WEAK_SET_HAS = WEAK_SET_CONSTRUCTOR.prototype.has;

export type Proposition =
  | { tag: "true" }
  | { tag: "false" }
  | { tag: "atom"; name: string; arguments: readonly KernelTerm[] }
  | {
    tag: "equal";
    type: KernelType;
    left: KernelTerm;
    right: KernelTerm;
  }
  | { tag: "and"; left: Proposition; right: Proposition }
  | { tag: "or"; left: Proposition; right: Proposition }
  | { tag: "implies"; premise: Proposition; conclusion: Proposition }
  | { tag: "not"; proposition: Proposition }
  | { tag: "forall"; domain: KernelType; body: Proposition }
  | { tag: "exists"; domain: KernelType; body: Proposition };

export type ProofTerm =
  | { tag: "assumption"; index: number }
  | { tag: "true_intro" }
  | { tag: "refl"; type: KernelType; term: KernelTerm }
  | { tag: "congr"; function: KernelTerm; proof: ProofTerm }
  | { tag: "symm"; proof: ProofTerm }
  | { tag: "trans"; left: ProofTerm; right: ProofTerm }
  | { tag: "and_intro"; left: ProofTerm; right: ProofTerm }
  | { tag: "and_left"; proof: ProofTerm }
  | { tag: "and_right"; proof: ProofTerm }
  | { tag: "or_left"; proof: ProofTerm; other: Proposition }
  | { tag: "or_right"; other: Proposition; proof: ProofTerm }
  | {
    tag: "or_cases";
    proof: ProofTerm;
    left_body: ProofTerm;
    right_body: ProofTerm;
  }
  | { tag: "not_intro"; premise: Proposition; body: ProofTerm }
  | { tag: "implies_intro"; premise: Proposition; body: ProofTerm }
  | { tag: "implies_apply"; function: ProofTerm; argument: ProofTerm }
  | { tag: "forall_intro"; domain: KernelType; body: ProofTerm }
  | { tag: "forall_apply"; proof: ProofTerm; argument: KernelTerm }
  | {
    tag: "exists_intro";
    domain: KernelType;
    body: Proposition;
    witness: KernelTerm;
    proof: ProofTerm;
  }
  | {
    tag: "exists_elim";
    proof: ProofTerm;
    target: Proposition;
    body: ProofTerm;
  }
  | {
    tag: "transport";
    equality: ProofTerm;
    motive: Proposition;
    proof: ProofTerm;
  }
  | { tag: "false_elim"; proof: ProofTerm; target: Proposition }
  | { tag: "unsafe_assume"; proposition: Proposition };

export type ProofSafety =
  | { tag: "safe" }
  | { tag: "unsafe"; origins: readonly string[] };

type KernelResult = {
  proposition: Proposition;
  safety: ProofSafety;
};

const MAX_SNAPSHOT_DEPTH = 256;
const MAX_SNAPSHOT_NODES = 20_000;

type SnapshotBudget = {
  nodes: number;
};

export type KernelCertificate = KernelResult & {
  readonly __kernel_certificate: unique symbol;
};

export type KernelCheckOptions = {
  allow_unsafe: boolean;
  require_safe?: boolean;
  environment?: KernelEnvironment;
  term_context?: KernelContext;
};

export type KernelCertificateCheckOptions = {
  require_safe?: boolean;
  environment?: KernelEnvironment;
  term_context?: KernelContext;
};

export type PropositionEqualityOptions = {
  environment?: KernelEnvironment;
  term_context?: KernelContext;
};

export type PropositionFormationOptions = PropositionEqualityOptions;

export const true_proposition: Proposition = OBJECT_FREEZE({ tag: "true" });
export const false_proposition: Proposition = OBJECT_FREEZE({ tag: "false" });

export function proposition_equal(
  left: Proposition,
  right: Proposition,
  options: PropositionEqualityOptions = {},
): boolean {
  const stable_options = snapshot_equality_options(options);
  const budget: SnapshotBudget = { nodes: 0 };
  const stable_left = snapshot_proposition(
    left,
    0,
    new WEAK_SET_CONSTRUCTOR<object>(),
    budget,
  );
  const stable_right = snapshot_proposition(
    right,
    0,
    new WEAK_SET_CONSTRUCTOR<object>(),
    budget,
  );
  check_proposition(
    stable_left,
    stable_options.term_context,
    stable_options.environment,
  );
  check_proposition(
    stable_right,
    stable_options.term_context,
    stable_options.environment,
  );
  return proposition_equal_at(
    stable_left,
    stable_right,
    stable_options.term_context,
    stable_options.environment,
  );
}

export function check_proposition_formation(
  proposition: Proposition,
  options: PropositionFormationOptions = {},
): Proposition {
  const stable_options = snapshot_equality_options(options);
  const stable = freeze_proposition(snapshot_proposition(proposition));
  check_proposition(
    stable,
    stable_options.term_context,
    stable_options.environment,
  );
  return stable;
}

export function instantiate_proposition(
  proposition: Proposition,
  argument: KernelTerm,
): Proposition {
  const budget: SnapshotBudget = { nodes: 0 };
  const stable_proposition = snapshot_proposition(
    proposition,
    0,
    new WEAK_SET_CONSTRUCTOR<object>(),
    budget,
  );
  const stable_argument = snapshot_kernel_term(argument);
  charge_kernel_term(stable_argument, budget);
  return freeze_proposition(
    substitute_proposition_variable(
      stable_proposition,
      stable_argument,
      0,
      budget,
    ),
  );
}

export function lift_proposition(proposition: Proposition): Proposition {
  const budget: SnapshotBudget = { nodes: 0 };
  const stable = snapshot_proposition(
    proposition,
    0,
    new WEAK_SET_CONSTRUCTOR<object>(),
    budget,
  );
  return freeze_proposition(
    shift_proposition_variables(stable, 1, 0, budget),
  );
}

function proposition_equal_at(
  left: Proposition,
  right: Proposition,
  context: KernelContext,
  environment: KernelEnvironment,
): boolean {
  if (left.tag !== right.tag) return false;
  switch (left.tag) {
    case "true":
    case "false":
      return true;
    case "atom": {
      const other = right as Extract<Proposition, { tag: "atom" }>;
      if (left.name !== other.name) return false;
      return term_sequences_equal(
        left.arguments,
        other.arguments,
        context,
        environment,
      );
    }
    case "equal": {
      const other = right as Extract<Proposition, { tag: "equal" }>;
      return type_equal(left.type, other.type, environment) &&
        term_equal(left.left, other.left, context, environment) &&
        term_equal(left.right, other.right, context, environment);
    }
    case "and":
    case "or": {
      const other = right as Extract<Proposition, { tag: typeof left.tag }>;
      return proposition_equal_at(
        left.left,
        other.left,
        context,
        environment,
      ) &&
        proposition_equal_at(left.right, other.right, context, environment);
    }
    case "implies": {
      const other = right as Extract<Proposition, { tag: "implies" }>;
      return proposition_equal_at(
        left.premise,
        other.premise,
        context,
        environment,
      ) &&
        proposition_equal_at(
          left.conclusion,
          other.conclusion,
          context,
          environment,
        );
    }
    case "not":
      return proposition_equal_at(
        left.proposition,
        (right as Extract<Proposition, { tag: "not" }>).proposition,
        context,
        environment,
      );
    case "forall":
    case "exists": {
      const other = right as Extract<Proposition, { tag: typeof left.tag }>;
      if (!type_equal(left.domain, other.domain, environment)) return false;
      return proposition_equal_at(
        left.body,
        other.body,
        extend_term_context(left.domain, context),
        environment,
      );
    }
  }
}

export function check_proof(
  proof: ProofTerm,
  goal: Proposition,
  options: KernelCheckOptions = { allow_unsafe: false },
): KernelCertificate {
  const stable_options = snapshot_check_options(options);
  const budget: SnapshotBudget = { nodes: 0 };
  const stable_goal = freeze_proposition(
    snapshot_proposition(
      goal,
      0,
      new WEAK_SET_CONSTRUCTOR<object>(),
      budget,
    ),
  );
  const stable_proof = snapshot_proof(
    proof,
    0,
    new WEAK_SET_CONSTRUCTOR<object>(),
    budget,
  );
  check_proposition(
    stable_goal,
    stable_options.term_context,
    stable_options.environment,
  );
  const checked = check_proof_against(
    stable_proof,
    stable_goal,
    [],
    stable_options.term_context,
    stable_options.environment,
    stable_options,
  );
  if (stable_options.require_safe) {
    expect(
      checked.safety.tag === "safe",
      "Safe proof depends on unsafe evidence.",
    );
  }
  return seal_certificate(
    checked,
    stable_options.term_context,
    stable_options.environment,
  );
}

export function check_certificate(
  certificate: unknown,
  goal: Proposition,
  options: KernelCertificateCheckOptions = {},
): KernelCertificate {
  const checked = require_certificate(certificate, options);
  expect(
    certificate_establishes_at(checked, goal),
    "Kernel certificate does not establish the requested proposition.",
  );
  return checked;
}

export function certificate_establishes(
  certificate: unknown,
  goal: Proposition,
  options: KernelCertificateCheckOptions = {},
): boolean {
  const checked = require_certificate(certificate, options);
  return certificate_establishes_at(checked, goal);
}

function require_certificate(
  certificate: unknown,
  options: KernelCertificateCheckOptions,
): KernelCertificate {
  const stable_options = snapshot_certificate_options(options);
  expect(
    certificate !== null && typeof certificate === "object" &&
      REFLECT_APPLY(WEAK_SET_HAS, trusted_certificates, [certificate]),
    "Kernel certificate is not sealed by the proof kernel.",
  );
  const checked = certificate as KernelCertificate;
  const certificate_context = REFLECT_APPLY(
    WEAK_MAP_GET,
    trusted_certificate_contexts,
    [checked],
  );
  expect(
    certificate_context !== undefined,
    "Kernel certificate is missing its checked context.",
  );
  expect(
    certificate_context.environment === stable_options.environment,
    "Kernel certificate belongs to a different environment.",
  );
  expect(
    kernel_context_equal(
      certificate_context.term_context,
      stable_options.term_context,
      stable_options.environment,
    ),
    "Kernel certificate belongs to a different term context.",
  );
  if (stable_options.require_safe) {
    expect(
      checked.safety.tag === "safe",
      "Kernel certificate depends on unsafe evidence.",
    );
  }
  return checked;
}

function certificate_establishes_at(
  checked: KernelCertificate,
  goal: Proposition,
): boolean {
  const certificate_context = REFLECT_APPLY(
    WEAK_MAP_GET,
    trusted_certificate_contexts,
    [checked],
  );
  expect(
    certificate_context !== undefined,
    "Kernel certificate is missing its checked context.",
  );
  const stable_goal = freeze_proposition(snapshot_proposition(goal));
  check_proposition(
    stable_goal,
    certificate_context.term_context,
    certificate_context.environment,
  );
  return proposition_equal_at(
    checked.proposition,
    stable_goal,
    certificate_context.term_context,
    certificate_context.environment,
  );
}

function snapshot_proposition(
  proposition: Proposition,
  depth = 0,
  active = new WEAK_SET_CONSTRUCTOR<object>(),
  budget: SnapshotBudget = { nodes: 0 },
): Proposition {
  expect(depth <= MAX_SNAPSHOT_DEPTH, "Proposition structure is too deep.");
  budget.nodes += 1;
  expect(
    budget.nodes <= MAX_SNAPSHOT_NODES,
    `Proof snapshot exceeded ${MAX_SNAPSHOT_NODES} nodes.`,
  );
  expect(
    proposition !== null && typeof proposition === "object",
    "Invalid proposition node.",
  );
  if (REFLECT_APPLY(WEAK_SET_HAS, active, [proposition])) {
    throw new Error("Proposition graph must be acyclic.");
  }
  REFLECT_APPLY(WEAK_SET_ADD, active, [proposition]);
  const properties = own_data_properties(proposition, "Proposition");
  const tag = required_property<Proposition["tag"]>(
    properties,
    "tag",
    "Proposition",
  );
  let snapshot: Proposition;
  switch (tag) {
    case "true":
      snapshot = { tag: "true" };
      break;
    case "false":
      snapshot = { tag: "false" };
      break;
    case "atom":
      snapshot = {
        tag: "atom",
        name: valid_text(
          required_property(properties, "name", "Proposition atom"),
          "Proposition atom name",
        ),
        arguments: snapshot_predicate_arguments(
          required_property(properties, "arguments", "Proposition atom"),
          budget,
        ),
      };
      break;
    case "equal": {
      const type = snapshot_kernel_type(
        required_property(properties, "type", "Equality proposition"),
      );
      const left = snapshot_kernel_term(
        required_property(properties, "left", "Equality proposition"),
      );
      const right = snapshot_kernel_term(
        required_property(properties, "right", "Equality proposition"),
      );
      charge_kernel_type(type, budget);
      charge_kernel_term(left, budget);
      charge_kernel_term(right, budget);
      snapshot = {
        tag: "equal",
        type,
        left,
        right,
      };
      break;
    }
    case "and":
    case "or":
      snapshot = {
        tag,
        left: snapshot_proposition(
          required_property(properties, "left", "Logical proposition"),
          depth + 1,
          active,
          budget,
        ),
        right: snapshot_proposition(
          required_property(properties, "right", "Logical proposition"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    case "implies":
      snapshot = {
        tag: "implies",
        premise: snapshot_proposition(
          required_property(properties, "premise", "Implication"),
          depth + 1,
          active,
          budget,
        ),
        conclusion: snapshot_proposition(
          required_property(properties, "conclusion", "Implication"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    case "not":
      snapshot = {
        tag: "not",
        proposition: snapshot_proposition(
          required_property(properties, "proposition", "Negation"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    case "forall":
    case "exists": {
      const domain = snapshot_kernel_type(
        required_property(properties, "domain", "Quantified proposition"),
      );
      charge_kernel_type(domain, budget);
      snapshot = {
        tag,
        domain,
        body: snapshot_proposition(
          required_property(properties, "body", "Quantified proposition"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    }
    default:
      throw new Error(
        `Invalid proposition tag ${STRING_CONSTRUCTOR(tag)}.`,
      );
  }
  REFLECT_APPLY(WEAK_SET_DELETE, active, [proposition]);
  return snapshot;
}

function snapshot_proof(
  proof: ProofTerm,
  depth = 0,
  active = new WEAK_SET_CONSTRUCTOR<object>(),
  budget: SnapshotBudget = { nodes: 0 },
): ProofTerm {
  expect(depth <= MAX_SNAPSHOT_DEPTH, "Proof structure is too deep.");
  budget.nodes += 1;
  expect(
    budget.nodes <= MAX_SNAPSHOT_NODES,
    `Proof snapshot exceeded ${MAX_SNAPSHOT_NODES} nodes.`,
  );
  expect(
    proof !== null && typeof proof === "object",
    "Invalid proof node.",
  );
  if (REFLECT_APPLY(WEAK_SET_HAS, active, [proof])) {
    throw new Error("Proof graph must be acyclic.");
  }
  REFLECT_APPLY(WEAK_SET_ADD, active, [proof]);
  const properties = own_data_properties(proof, "Proof");
  const tag = required_property<ProofTerm["tag"]>(
    properties,
    "tag",
    "Proof",
  );
  let snapshot: ProofTerm;
  switch (tag) {
    case "assumption": {
      const index = required_property<number>(
        properties,
        "index",
        "Proof assumption",
      );
      expect(
        NUMBER_IS_SAFE_INTEGER(index) && index >= 0,
        `Invalid proof assumption index ${STRING_CONSTRUCTOR(index)}.`,
      );
      snapshot = { tag: "assumption", index };
      break;
    }
    case "true_intro":
      snapshot = { tag: "true_intro" };
      break;
    case "refl": {
      const type = snapshot_kernel_type(
        required_property(properties, "type", "Reflexivity proof"),
      );
      const term = snapshot_kernel_term(
        required_property(properties, "term", "Reflexivity proof"),
      );
      charge_kernel_type(type, budget);
      charge_kernel_term(term, budget);
      snapshot = {
        tag: "refl",
        type,
        term,
      };
      break;
    }
    case "congr": {
      const function_term = snapshot_kernel_term(
        required_property(properties, "function", "Congruence proof"),
      );
      charge_kernel_term(function_term, budget);
      snapshot = {
        tag: "congr",
        function: function_term,
        proof: snapshot_proof(
          required_property(properties, "proof", "Congruence proof"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    }
    case "symm":
      snapshot = {
        tag: "symm",
        proof: snapshot_proof(
          required_property(properties, "proof", "Symmetry proof"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    case "trans":
      snapshot = {
        tag: "trans",
        left: snapshot_proof(
          required_property(properties, "left", "Transitivity proof"),
          depth + 1,
          active,
          budget,
        ),
        right: snapshot_proof(
          required_property(properties, "right", "Transitivity proof"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    case "and_intro":
      snapshot = {
        tag: "and_intro",
        left: snapshot_proof(
          required_property(properties, "left", "Conjunction proof"),
          depth + 1,
          active,
          budget,
        ),
        right: snapshot_proof(
          required_property(properties, "right", "Conjunction proof"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    case "and_left":
      snapshot = {
        tag: "and_left",
        proof: snapshot_proof(
          required_property(properties, "proof", "Conjunction elimination"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    case "and_right":
      snapshot = {
        tag: "and_right",
        proof: snapshot_proof(
          required_property(properties, "proof", "Conjunction elimination"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    case "or_left":
      snapshot = {
        tag: "or_left",
        proof: snapshot_proof(
          required_property(properties, "proof", "Disjunction introduction"),
          depth + 1,
          active,
          budget,
        ),
        other: snapshot_proposition(
          required_property(properties, "other", "Disjunction introduction"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    case "or_right":
      snapshot = {
        tag: "or_right",
        other: snapshot_proposition(
          required_property(properties, "other", "Disjunction introduction"),
          depth + 1,
          active,
          budget,
        ),
        proof: snapshot_proof(
          required_property(properties, "proof", "Disjunction introduction"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    case "or_cases":
      snapshot = {
        tag: "or_cases",
        proof: snapshot_proof(
          required_property(properties, "proof", "Disjunction elimination"),
          depth + 1,
          active,
          budget,
        ),
        left_body: snapshot_proof(
          required_property(
            properties,
            "left_body",
            "Disjunction elimination",
          ),
          depth + 1,
          active,
          budget,
        ),
        right_body: snapshot_proof(
          required_property(
            properties,
            "right_body",
            "Disjunction elimination",
          ),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    case "not_intro":
      snapshot = {
        tag: "not_intro",
        premise: snapshot_proposition(
          required_property(properties, "premise", "Negation proof"),
          depth + 1,
          active,
          budget,
        ),
        body: snapshot_proof(
          required_property(properties, "body", "Negation proof"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    case "implies_intro":
      snapshot = {
        tag: "implies_intro",
        premise: snapshot_proposition(
          required_property(properties, "premise", "Implication proof"),
          depth + 1,
          active,
          budget,
        ),
        body: snapshot_proof(
          required_property(properties, "body", "Implication proof"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    case "implies_apply":
      snapshot = {
        tag: "implies_apply",
        function: snapshot_proof(
          required_property(properties, "function", "Implication application"),
          depth + 1,
          active,
          budget,
        ),
        argument: snapshot_proof(
          required_property(properties, "argument", "Implication application"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    case "forall_intro": {
      const domain = snapshot_kernel_type(
        required_property(properties, "domain", "Universal introduction"),
      );
      charge_kernel_type(domain, budget);
      snapshot = {
        tag: "forall_intro",
        domain,
        body: snapshot_proof(
          required_property(properties, "body", "Universal introduction"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    }
    case "forall_apply": {
      const argument = snapshot_kernel_term(
        required_property(properties, "argument", "Universal application"),
      );
      charge_kernel_term(argument, budget);
      snapshot = {
        tag: "forall_apply",
        proof: snapshot_proof(
          required_property(properties, "proof", "Universal application"),
          depth + 1,
          active,
          budget,
        ),
        argument,
      };
      break;
    }
    case "exists_intro": {
      const domain = snapshot_kernel_type(
        required_property(properties, "domain", "Existential introduction"),
      );
      const witness = snapshot_kernel_term(
        required_property(properties, "witness", "Existential introduction"),
      );
      charge_kernel_type(domain, budget);
      charge_kernel_term(witness, budget);
      snapshot = {
        tag: "exists_intro",
        domain,
        body: snapshot_proposition(
          required_property(properties, "body", "Existential introduction"),
          depth + 1,
          active,
          budget,
        ),
        witness,
        proof: snapshot_proof(
          required_property(properties, "proof", "Existential introduction"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    }
    case "exists_elim":
      snapshot = {
        tag: "exists_elim",
        proof: snapshot_proof(
          required_property(properties, "proof", "Existential elimination"),
          depth + 1,
          active,
          budget,
        ),
        target: snapshot_proposition(
          required_property(properties, "target", "Existential elimination"),
          depth + 1,
          active,
          budget,
        ),
        body: snapshot_proof(
          required_property(properties, "body", "Existential elimination"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    case "transport":
      snapshot = {
        tag: "transport",
        equality: snapshot_proof(
          required_property(properties, "equality", "Equality transport"),
          depth + 1,
          active,
          budget,
        ),
        motive: snapshot_proposition(
          required_property(properties, "motive", "Equality transport"),
          depth + 1,
          active,
          budget,
        ),
        proof: snapshot_proof(
          required_property(properties, "proof", "Equality transport"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    case "false_elim":
      snapshot = {
        tag: "false_elim",
        proof: snapshot_proof(
          required_property(properties, "proof", "False elimination"),
          depth + 1,
          active,
          budget,
        ),
        target: snapshot_proposition(
          required_property(properties, "target", "False elimination"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    case "unsafe_assume":
      snapshot = {
        tag: "unsafe_assume",
        proposition: snapshot_proposition(
          required_property(properties, "proposition", "Unsafe assumption"),
          depth + 1,
          active,
          budget,
        ),
      };
      break;
    default:
      throw new Error(`Invalid proof term tag ${STRING_CONSTRUCTOR(tag)}.`);
  }
  REFLECT_APPLY(WEAK_SET_DELETE, active, [proof]);
  return snapshot;
}

function charge_kernel_type(
  type: KernelType,
  budget: SnapshotBudget,
): void {
  budget.nodes += 1;
  expect(
    budget.nodes <= MAX_SNAPSHOT_NODES,
    `Proof snapshot exceeded ${MAX_SNAPSHOT_NODES} nodes.`,
  );
  switch (type.tag) {
    case "sort":
    case "var":
    case "constant":
      return;
    case "pi":
      charge_kernel_type(type.domain, budget);
      charge_kernel_type(type.codomain, budget);
      return;
    case "lam":
      charge_kernel_type(type.domain, budget);
      charge_kernel_type(type.body, budget);
      return;
    case "app":
      charge_kernel_type(type.function, budget);
      charge_kernel_type(type.argument, budget);
      return;
  }
}

function charge_kernel_term(
  term: KernelTerm,
  budget: SnapshotBudget,
): void {
  budget.nodes += 1;
  expect(
    budget.nodes <= MAX_SNAPSHOT_NODES,
    `Proof snapshot exceeded ${MAX_SNAPSHOT_NODES} nodes.`,
  );
  switch (term.tag) {
    case "var":
      return;
    case "constant":
      charge_kernel_type(term.type, budget);
      return;
    case "lam":
      charge_kernel_type(term.domain, budget);
      charge_kernel_term(term.body, budget);
      return;
    case "app":
      charge_kernel_term(term.function, budget);
      charge_kernel_term(term.argument, budget);
      return;
  }
}

type StableKernelCheckOptions = {
  allow_unsafe: boolean;
  require_safe: boolean;
  environment: KernelEnvironment;
  term_context: KernelContext;
};

type StablePropositionEqualityOptions = {
  environment: KernelEnvironment;
  term_context: KernelContext;
};

function snapshot_check_options(
  options: KernelCheckOptions,
): StableKernelCheckOptions {
  const properties = own_data_properties(options, "Kernel check options");
  const allow_unsafe = required_property<boolean>(
    properties,
    "allow_unsafe",
    "Kernel check options",
  );
  expect(
    typeof allow_unsafe === "boolean",
    "Kernel check allow_unsafe must be boolean.",
  );
  let require_safe = false;
  if (REFLECT_APPLY(MAP_HAS, properties, ["require_safe"])) {
    const requested = REFLECT_APPLY(MAP_GET, properties, ["require_safe"]);
    expect(
      typeof requested === "boolean",
      "Kernel check require_safe must be boolean.",
    );
    require_safe = requested;
  }
  let environment = KernelEnvironment.empty();
  if (REFLECT_APPLY(MAP_HAS, properties, ["environment"])) {
    environment = REFLECT_APPLY(MAP_GET, properties, [
      "environment",
    ]) as KernelEnvironment;
  }
  let term_context: KernelContext = [];
  if (REFLECT_APPLY(MAP_HAS, properties, ["term_context"])) {
    term_context = snapshot_kernel_context(
      REFLECT_APPLY(MAP_GET, properties, ["term_context"]) as KernelContext,
    );
  }
  return {
    allow_unsafe,
    require_safe,
    environment,
    term_context,
  };
}

function snapshot_certificate_options(
  options: KernelCertificateCheckOptions,
): {
  require_safe: boolean;
  environment: KernelEnvironment;
  term_context: KernelContext;
} {
  const properties = own_data_properties(
    options,
    "Kernel certificate options",
  );
  let require_safe = false;
  if (REFLECT_APPLY(MAP_HAS, properties, ["require_safe"])) {
    const requested = REFLECT_APPLY(MAP_GET, properties, ["require_safe"]);
    expect(
      typeof requested === "boolean",
      "Kernel certificate require_safe must be boolean.",
    );
    require_safe = requested;
  }
  let environment = KernelEnvironment.empty();
  if (REFLECT_APPLY(MAP_HAS, properties, ["environment"])) {
    environment = REFLECT_APPLY(MAP_GET, properties, [
      "environment",
    ]) as KernelEnvironment;
  }
  let term_context: KernelContext = [];
  if (REFLECT_APPLY(MAP_HAS, properties, ["term_context"])) {
    term_context = snapshot_kernel_context(
      REFLECT_APPLY(MAP_GET, properties, ["term_context"]) as KernelContext,
    );
  }
  return { require_safe, environment, term_context };
}

function snapshot_equality_options(
  options: PropositionEqualityOptions,
): StablePropositionEqualityOptions {
  const properties = own_data_properties(
    options,
    "Proposition equality options",
  );
  let environment = KernelEnvironment.empty();
  if (REFLECT_APPLY(MAP_HAS, properties, ["environment"])) {
    environment = REFLECT_APPLY(MAP_GET, properties, [
      "environment",
    ]) as KernelEnvironment;
  }
  let term_context: KernelContext = [];
  if (REFLECT_APPLY(MAP_HAS, properties, ["term_context"])) {
    term_context = snapshot_kernel_context(
      REFLECT_APPLY(MAP_GET, properties, ["term_context"]) as KernelContext,
    );
  }
  return { environment, term_context };
}

function own_data_properties(
  value: object,
  label: string,
): ReadonlyMap<string, unknown> {
  expect(
    value !== null && typeof value === "object",
    `${label} must be an object.`,
  );
  const prototype = OBJECT_GET_PROTOTYPE_OF(value);
  expect(
    prototype === OBJECT_PROTOTYPE || prototype === null,
    `${label} must be a plain record.`,
  );
  const properties = new MAP_CONSTRUCTOR<string, unknown>();
  const keys = REFLECT_OWN_KEYS(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    expect(key !== undefined, `${label} property ${index} is missing.`);
    expect(typeof key === "string", `${label} cannot contain symbols.`);
    const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
    expect(
      descriptor !== undefined &&
        descriptor.get === undefined &&
        descriptor.set === undefined,
      `${label} properties must be own data properties.`,
    );
    REFLECT_APPLY(MAP_SET, properties, [key, descriptor.value]);
  }
  return properties;
}

function required_property<Value>(
  properties: ReadonlyMap<string, unknown>,
  key: string,
  label: string,
): Value {
  expect(
    REFLECT_APPLY(MAP_HAS, properties, [key]),
    `${label} is missing ${key}.`,
  );
  return REFLECT_APPLY(MAP_GET, properties, [key]) as Value;
}

function valid_text(value: string, label: string): string {
  expect(
    typeof value === "string" && value.length > 0,
    `${label} must not be empty.`,
  );
  return value;
}

function snapshot_predicate_arguments(
  value: unknown,
  budget: SnapshotBudget,
): readonly KernelTerm[] {
  expect(
    value !== null && typeof value === "object" &&
      REFLECT_APPLY(ARRAY_IS_ARRAY, ARRAY_CONSTRUCTOR, [value]),
    "Predicate arguments must be an array.",
  );
  expect(
    OBJECT_GET_PROTOTYPE_OF(value) === ARRAY_PROTOTYPE,
    "Predicate arguments must be an ordinary array.",
  );
  const length_descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, "length");
  expect(
    length_descriptor !== undefined &&
      length_descriptor.get === undefined &&
      length_descriptor.set === undefined &&
      NUMBER_IS_SAFE_INTEGER(length_descriptor.value) &&
      length_descriptor.value >= 0,
    "Predicate arguments have an invalid length.",
  );
  const length = length_descriptor.value as number;
  expect(
    length <= MAX_KERNEL_TERM_SEQUENCE_LENGTH,
    `Predicate arguments exceed ${MAX_KERNEL_TERM_SEQUENCE_LENGTH} entries.`,
  );
  const keys = REFLECT_OWN_KEYS(value);
  expect(
    keys.length === length + 1,
    "Predicate arguments cannot contain holes or extra properties.",
  );
  budget.nodes += 1;
  expect(
    budget.nodes <= MAX_SNAPSHOT_NODES,
    `Proof snapshot exceeded ${MAX_SNAPSHOT_NODES} nodes.`,
  );
  const arguments_: KernelTerm[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
      value,
      STRING_CONSTRUCTOR(index),
    );
    expect(
      descriptor !== undefined &&
        descriptor.get === undefined &&
        descriptor.set === undefined,
      `Predicate argument ${index} must be an own data property.`,
    );
    const argument = snapshot_kernel_term(descriptor.value as KernelTerm);
    charge_kernel_term(argument, budget);
    OBJECT_DEFINE_PROPERTY(arguments_, index, {
      value: argument,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return OBJECT_FREEZE(arguments_);
}

type KernelHypothesis = KernelResult;

function kernel_hypothesis(proposition: Proposition): KernelHypothesis {
  return { proposition, safety: { tag: "safe" } };
}

function extend_term_context(
  type: KernelType,
  context: KernelContext,
): KernelContext {
  const extended: KernelType[] = [type];
  for (let index = 0; index < context.length; index += 1) {
    const entry = context[index];
    expect(entry !== undefined, `Kernel context entry ${index} is missing.`);
    OBJECT_DEFINE_PROPERTY(extended, index + 1, {
      value: entry,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return OBJECT_FREEZE(extended);
}

function substitute_proposition_variable(
  proposition: Proposition,
  argument: KernelTerm,
  index = 0,
  budget: SnapshotBudget = { nodes: 0 },
): Proposition {
  budget.nodes += 1;
  expect(
    budget.nodes <= MAX_SNAPSHOT_NODES,
    `Proof proposition transform exceeded ${MAX_SNAPSHOT_NODES} nodes.`,
  );
  switch (proposition.tag) {
    case "true":
    case "false":
      return proposition;
    case "atom": {
      const arguments_: KernelTerm[] = [];
      for (
        let argument_index = 0;
        argument_index < proposition.arguments.length;
        argument_index += 1
      ) {
        const current = proposition.arguments[argument_index];
        expect(
          current !== undefined,
          `Predicate argument ${argument_index} is missing.`,
        );
        const substituted = substitute_kernel_term_variable(
          current,
          argument,
          index,
        );
        charge_kernel_term(substituted, budget);
        OBJECT_DEFINE_PROPERTY(arguments_, argument_index, {
          value: substituted,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      return {
        tag: "atom",
        name: proposition.name,
        arguments: arguments_,
      };
    }
    case "equal": {
      const type = substitute_kernel_type_variable(
        proposition.type,
        argument,
        index,
      );
      const left = substitute_kernel_term_variable(
        proposition.left,
        argument,
        index,
      );
      const right = substitute_kernel_term_variable(
        proposition.right,
        argument,
        index,
      );
      charge_kernel_type(type, budget);
      charge_kernel_term(left, budget);
      charge_kernel_term(right, budget);
      return {
        tag: "equal",
        type,
        left,
        right,
      };
    }
    case "and":
    case "or":
      return {
        tag: proposition.tag,
        left: substitute_proposition_variable(
          proposition.left,
          argument,
          index,
          budget,
        ),
        right: substitute_proposition_variable(
          proposition.right,
          argument,
          index,
          budget,
        ),
      };
    case "implies":
      return {
        tag: "implies",
        premise: substitute_proposition_variable(
          proposition.premise,
          argument,
          index,
          budget,
        ),
        conclusion: substitute_proposition_variable(
          proposition.conclusion,
          argument,
          index,
          budget,
        ),
      };
    case "not":
      return {
        tag: "not",
        proposition: substitute_proposition_variable(
          proposition.proposition,
          argument,
          index,
          budget,
        ),
      };
    case "forall":
    case "exists": {
      const domain = substitute_kernel_type_variable(
        proposition.domain,
        argument,
        index,
      );
      charge_kernel_type(domain, budget);
      return {
        tag: proposition.tag,
        domain,
        body: substitute_proposition_variable(
          proposition.body,
          argument,
          index + 1,
          budget,
        ),
      };
    }
  }
}

function shift_proposition_variables(
  proposition: Proposition,
  amount: number,
  cutoff = 0,
  budget: SnapshotBudget = { nodes: 0 },
): Proposition {
  budget.nodes += 1;
  expect(
    budget.nodes <= MAX_SNAPSHOT_NODES,
    `Proof proposition transform exceeded ${MAX_SNAPSHOT_NODES} nodes.`,
  );
  switch (proposition.tag) {
    case "true":
    case "false":
      return proposition;
    case "atom": {
      const arguments_: KernelTerm[] = [];
      for (
        let argument_index = 0;
        argument_index < proposition.arguments.length;
        argument_index += 1
      ) {
        const current = proposition.arguments[argument_index];
        expect(
          current !== undefined,
          `Predicate argument ${argument_index} is missing.`,
        );
        const argument = shift_kernel_term_variables(
          current,
          amount,
          cutoff,
        );
        charge_kernel_term(argument, budget);
        OBJECT_DEFINE_PROPERTY(arguments_, argument_index, {
          value: argument,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      return {
        tag: "atom",
        name: proposition.name,
        arguments: arguments_,
      };
    }
    case "equal": {
      const type = shift_kernel_type_variables(
        proposition.type,
        amount,
        cutoff,
      );
      const left = shift_kernel_term_variables(
        proposition.left,
        amount,
        cutoff,
      );
      const right = shift_kernel_term_variables(
        proposition.right,
        amount,
        cutoff,
      );
      charge_kernel_type(type, budget);
      charge_kernel_term(left, budget);
      charge_kernel_term(right, budget);
      return {
        tag: "equal",
        type,
        left,
        right,
      };
    }
    case "and":
    case "or":
      return {
        tag: proposition.tag,
        left: shift_proposition_variables(
          proposition.left,
          amount,
          cutoff,
          budget,
        ),
        right: shift_proposition_variables(
          proposition.right,
          amount,
          cutoff,
          budget,
        ),
      };
    case "implies":
      return {
        tag: "implies",
        premise: shift_proposition_variables(
          proposition.premise,
          amount,
          cutoff,
          budget,
        ),
        conclusion: shift_proposition_variables(
          proposition.conclusion,
          amount,
          cutoff,
          budget,
        ),
      };
    case "not":
      return {
        tag: "not",
        proposition: shift_proposition_variables(
          proposition.proposition,
          amount,
          cutoff,
          budget,
        ),
      };
    case "forall":
    case "exists": {
      const domain = shift_kernel_type_variables(
        proposition.domain,
        amount,
        cutoff,
      );
      charge_kernel_type(domain, budget);
      return {
        tag: proposition.tag,
        domain,
        body: shift_proposition_variables(
          proposition.body,
          amount,
          cutoff + 1,
          budget,
        ),
      };
    }
  }
}

function shift_proof_context_variables(
  context: readonly KernelHypothesis[],
  amount: number,
): KernelHypothesis[] {
  const shifted: KernelHypothesis[] = [];
  for (let index = 0; index < context.length; index += 1) {
    const hypothesis = context[index];
    expect(
      hypothesis !== undefined,
      `Proof context entry ${index} is missing.`,
    );
    OBJECT_DEFINE_PROPERTY(shifted, index, {
      value: {
        proposition: shift_proposition_variables(
          hypothesis.proposition,
          amount,
        ),
        safety: hypothesis.safety,
      },
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return shifted;
}

function extend_proof_context(
  hypothesis: KernelHypothesis,
  context: readonly KernelHypothesis[],
): KernelHypothesis[] {
  const extended: KernelHypothesis[] = [hypothesis];
  for (let index = 0; index < context.length; index += 1) {
    const entry = context[index];
    expect(entry !== undefined, `Proof context entry ${index} is missing.`);
    OBJECT_DEFINE_PROPERTY(extended, index + 1, {
      value: entry,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return extended;
}

const trusted_certificates = new WEAK_SET_CONSTRUCTOR<object>();
const trusted_certificate_contexts = new WEAK_MAP_CONSTRUCTOR<
  object,
  { environment: KernelEnvironment; term_context: KernelContext }
>();

function seal_certificate(
  result: KernelResult,
  term_context: KernelContext,
  environment: KernelEnvironment,
): KernelCertificate {
  const certificate = OBJECT_FREEZE({
    proposition: freeze_proposition(snapshot_proposition(result.proposition)),
    safety: freeze_safety(result.safety),
  }) as unknown as KernelCertificate;
  REFLECT_APPLY(WEAK_SET_ADD, trusted_certificates, [certificate]);
  REFLECT_APPLY(WEAK_MAP_SET, trusted_certificate_contexts, [
    certificate,
    {
      environment,
      term_context,
    },
  ]);
  return certificate;
}

function freeze_proposition(proposition: Proposition): Proposition {
  switch (proposition.tag) {
    case "true":
      return OBJECT_FREEZE({ tag: "true" });
    case "false":
      return OBJECT_FREEZE({ tag: "false" });
    case "atom":
      return OBJECT_FREEZE({
        tag: "atom",
        name: proposition.name,
        arguments: OBJECT_FREEZE(proposition.arguments),
      });
    case "equal":
      return OBJECT_FREEZE({
        tag: "equal",
        type: proposition.type,
        left: proposition.left,
        right: proposition.right,
      });
    case "and":
    case "or":
      return OBJECT_FREEZE({
        tag: proposition.tag,
        left: freeze_proposition(proposition.left),
        right: freeze_proposition(proposition.right),
      });
    case "implies":
      return OBJECT_FREEZE({
        tag: "implies",
        premise: freeze_proposition(proposition.premise),
        conclusion: freeze_proposition(proposition.conclusion),
      });
    case "not":
      return OBJECT_FREEZE({
        tag: "not",
        proposition: freeze_proposition(proposition.proposition),
      });
    case "forall":
    case "exists":
      return OBJECT_FREEZE({
        tag: proposition.tag,
        domain: proposition.domain,
        body: freeze_proposition(proposition.body),
      });
  }
}

function freeze_safety(safety: ProofSafety): ProofSafety {
  if (safety.tag === "safe") return OBJECT_FREEZE({ tag: "safe" });
  const origins: string[] = [];
  for (let index = 0; index < safety.origins.length; index += 1) {
    const origin = safety.origins[index];
    expect(origin !== undefined, `Unsafe origin ${index} is missing.`);
    OBJECT_DEFINE_PROPERTY(origins, index, {
      value: origin,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return OBJECT_FREEZE({
    tag: "unsafe",
    origins: OBJECT_FREEZE(origins),
  });
}

function check_proposition(
  proposition: Proposition,
  context: KernelContext,
  environment: KernelEnvironment,
): void {
  switch (proposition.tag) {
    case "true":
    case "false":
      return;
    case "atom":
      check_term_sequence(proposition.arguments, context, environment);
      return;
    case "equal":
      check_type(proposition.type, context, environment);
      check_kernel_term(
        proposition.left,
        proposition.type,
        context,
        environment,
      );
      check_kernel_term(
        proposition.right,
        proposition.type,
        context,
        environment,
      );
      return;
    case "and":
    case "or":
      check_proposition(proposition.left, context, environment);
      check_proposition(proposition.right, context, environment);
      return;
    case "implies":
      check_proposition(proposition.premise, context, environment);
      check_proposition(proposition.conclusion, context, environment);
      return;
    case "not":
      check_proposition(proposition.proposition, context, environment);
      return;
    case "forall":
    case "exists":
      check_type(proposition.domain, context, environment);
      check_proposition(
        proposition.body,
        extend_term_context(proposition.domain, context),
        environment,
      );
      return;
  }
}

function check_proof_against(
  proof: ProofTerm,
  goal: Proposition,
  context: KernelHypothesis[],
  term_context: KernelContext,
  environment: KernelEnvironment,
  options: StableKernelCheckOptions,
): KernelResult {
  if (proof.tag === "refl" && goal.tag === "equal") {
    expect(
      type_equal(proof.type, goal.type, environment),
      "Reflexivity proof has a different equality carrier.",
    );
    check_kernel_term(proof.term, goal.type, term_context, environment);
    expect(
      term_equal(proof.term, goal.left, term_context, environment) &&
        term_equal(proof.term, goal.right, term_context, environment),
      "Reflexivity term does not match both equality sides.",
    );
    return { proposition: goal, safety: { tag: "safe" } };
  }
  if (proof.tag === "and_intro" && goal.tag === "and") {
    const left = check_proof_against(
      proof.left,
      goal.left,
      context,
      term_context,
      environment,
      options,
    );
    const right = check_proof_against(
      proof.right,
      goal.right,
      context,
      term_context,
      environment,
      options,
    );
    return {
      proposition: goal,
      safety: merge_safety(left.safety, right.safety),
    };
  }
  if (proof.tag === "implies_intro" && goal.tag === "implies") {
    expect(
      proposition_equal_at(
        proof.premise,
        goal.premise,
        term_context,
        environment,
      ),
      "Implication proof introduces a different premise.",
    );
    const body = check_proof_against(
      proof.body,
      goal.conclusion,
      extend_proof_context(kernel_hypothesis(goal.premise), context),
      term_context,
      environment,
      options,
    );
    return { proposition: goal, safety: body.safety };
  }
  if (proof.tag === "not_intro" && goal.tag === "not") {
    expect(
      proposition_equal_at(
        proof.premise,
        goal.proposition,
        term_context,
        environment,
      ),
      "Negation proof introduces a different premise.",
    );
    const body = check_proof_against(
      proof.body,
      false_proposition,
      extend_proof_context(
        kernel_hypothesis(goal.proposition),
        context,
      ),
      term_context,
      environment,
      options,
    );
    return { proposition: goal, safety: body.safety };
  }
  if (proof.tag === "forall_intro" && goal.tag === "forall") {
    check_type(proof.domain, term_context, environment);
    expect(
      type_equal(proof.domain, goal.domain, environment),
      "Universal proof introduces a different domain.",
    );
    const extended_term_context = extend_term_context(
      goal.domain,
      term_context,
    );
    const body = check_proof_against(
      proof.body,
      goal.body,
      shift_proof_context_variables(context, 1),
      extended_term_context,
      environment,
      options,
    );
    return { proposition: goal, safety: body.safety };
  }
  if (proof.tag === "exists_intro" && goal.tag === "exists") {
    check_type(proof.domain, term_context, environment);
    expect(
      type_equal(proof.domain, goal.domain, environment),
      "Existential proof introduces a different domain.",
    );
    const body_context = extend_term_context(goal.domain, term_context);
    check_proposition(proof.body, body_context, environment);
    expect(
      proposition_equal_at(
        proof.body,
        goal.body,
        body_context,
        environment,
      ),
      "Existential proof introduces a different proposition.",
    );
    check_kernel_term(
      proof.witness,
      goal.domain,
      term_context,
      environment,
    );
    const instantiated = substitute_proposition_variable(
      goal.body,
      proof.witness,
    );
    const checked = check_proof_against(
      proof.proof,
      instantiated,
      context,
      term_context,
      environment,
      options,
    );
    return { proposition: goal, safety: checked.safety };
  }
  if (proof.tag === "or_left" && goal.tag === "or") {
    expect(
      proposition_equal_at(
        proof.other,
        goal.right,
        term_context,
        environment,
      ),
      "Disjunction proof introduces a different right proposition.",
    );
    const checked = check_proof_against(
      proof.proof,
      goal.left,
      context,
      term_context,
      environment,
      options,
    );
    return { proposition: goal, safety: checked.safety };
  }
  if (proof.tag === "or_right" && goal.tag === "or") {
    expect(
      proposition_equal_at(
        proof.other,
        goal.left,
        term_context,
        environment,
      ),
      "Disjunction proof introduces a different left proposition.",
    );
    const checked = check_proof_against(
      proof.proof,
      goal.right,
      context,
      term_context,
      environment,
      options,
    );
    return { proposition: goal, safety: checked.safety };
  }
  if (proof.tag === "or_cases") {
    const disjunction = check_proof_term(
      proof.proof,
      context,
      term_context,
      environment,
      options,
    );
    expect(
      disjunction.proposition.tag === "or",
      "Disjunction elimination requires a disjunction proof.",
    );
    const left = check_proof_against(
      proof.left_body,
      goal,
      extend_proof_context(
        kernel_hypothesis(disjunction.proposition.left),
        context,
      ),
      term_context,
      environment,
      options,
    );
    const right = check_proof_against(
      proof.right_body,
      goal,
      extend_proof_context(
        kernel_hypothesis(disjunction.proposition.right),
        context,
      ),
      term_context,
      environment,
      options,
    );
    return {
      proposition: goal,
      safety: merge_safety(
        disjunction.safety,
        merge_safety(left.safety, right.safety),
      ),
    };
  }
  const checked = check_proof_term(
    proof,
    context,
    term_context,
    environment,
    options,
  );
  expect(
    proposition_equal_at(
      checked.proposition,
      goal,
      term_context,
      environment,
    ),
    `Proof establishes ${format_proposition(checked.proposition)}, not ${
      format_proposition(goal)
    }.`,
  );
  return checked;
}

function check_proof_term(
  proof: ProofTerm,
  context: KernelHypothesis[],
  term_context: KernelContext,
  environment: KernelEnvironment,
  options: StableKernelCheckOptions,
): KernelResult {
  switch (proof.tag) {
    case "assumption": {
      const hypothesis = context[proof.index];
      expect(
        hypothesis !== undefined,
        `Proof assumption ${proof.index} is out of scope.`,
      );
      return hypothesis;
    }
    case "true_intro":
      return { proposition: { tag: "true" }, safety: { tag: "safe" } };
    case "refl": {
      check_type(proof.type, term_context, environment);
      check_kernel_term(
        proof.term,
        proof.type,
        term_context,
        environment,
      );
      return {
        proposition: {
          tag: "equal",
          type: proof.type,
          left: proof.term,
          right: proof.term,
        },
        safety: { tag: "safe" },
      };
    }
    case "congr": {
      const checked = check_proof_term(
        proof.proof,
        context,
        term_context,
        environment,
        options,
      );
      expect(
        checked.proposition.tag === "equal",
        "Congruence requires an equality proof.",
      );
      const left: KernelTerm = {
        tag: "app",
        function: proof.function,
        argument: checked.proposition.left,
      };
      const right: KernelTerm = {
        tag: "app",
        function: proof.function,
        argument: checked.proposition.right,
      };
      const left_type = infer_term(left, term_context, environment);
      const right_type = infer_term(right, term_context, environment);
      expect(
        type_equal(left_type, right_type, environment),
        "Congruence applications have different result types.",
      );
      return {
        proposition: {
          tag: "equal",
          type: left_type,
          left,
          right,
        },
        safety: checked.safety,
      };
    }
    case "symm": {
      const checked = check_proof_term(
        proof.proof,
        context,
        term_context,
        environment,
        options,
      );
      expect(
        checked.proposition.tag === "equal",
        "Symmetry requires an equality proof.",
      );
      return {
        proposition: {
          tag: "equal",
          type: checked.proposition.type,
          left: checked.proposition.right,
          right: checked.proposition.left,
        },
        safety: checked.safety,
      };
    }
    case "trans": {
      const left = check_proof_term(
        proof.left,
        context,
        term_context,
        environment,
        options,
      );
      const right = check_proof_term(
        proof.right,
        context,
        term_context,
        environment,
        options,
      );
      expect(
        left.proposition.tag === "equal",
        "Transitivity requires equality proofs.",
      );
      expect(
        right.proposition.tag === "equal",
        "Transitivity requires equality proofs.",
      );
      expect(
        type_equal(
          left.proposition.type,
          right.proposition.type,
          environment,
        ),
        "Equality proofs have different carrier types.",
      );
      expect(
        term_equal(
          left.proposition.right,
          right.proposition.left,
          term_context,
          environment,
        ),
        "Equality proofs do not compose.",
      );
      return {
        proposition: {
          tag: "equal",
          type: left.proposition.type,
          left: left.proposition.left,
          right: right.proposition.right,
        },
        safety: merge_safety(left.safety, right.safety),
      };
    }
    case "and_intro": {
      const left = check_proof_term(
        proof.left,
        context,
        term_context,
        environment,
        options,
      );
      const right = check_proof_term(
        proof.right,
        context,
        term_context,
        environment,
        options,
      );
      return {
        proposition: {
          tag: "and",
          left: left.proposition,
          right: right.proposition,
        },
        safety: merge_safety(left.safety, right.safety),
      };
    }
    case "and_left": {
      const checked = check_proof_term(
        proof.proof,
        context,
        term_context,
        environment,
        options,
      );
      expect(
        checked.proposition.tag === "and",
        "Conjunction elimination requires a conjunction proof.",
      );
      return { proposition: checked.proposition.left, safety: checked.safety };
    }
    case "and_right": {
      const checked = check_proof_term(
        proof.proof,
        context,
        term_context,
        environment,
        options,
      );
      expect(
        checked.proposition.tag === "and",
        "Conjunction elimination requires a conjunction proof.",
      );
      return { proposition: checked.proposition.right, safety: checked.safety };
    }
    case "or_left": {
      const checked = check_proof_term(
        proof.proof,
        context,
        term_context,
        environment,
        options,
      );
      check_proposition(proof.other, term_context, environment);
      return {
        proposition: {
          tag: "or",
          left: checked.proposition,
          right: proof.other,
        },
        safety: checked.safety,
      };
    }
    case "or_right": {
      const checked = check_proof_term(
        proof.proof,
        context,
        term_context,
        environment,
        options,
      );
      check_proposition(proof.other, term_context, environment);
      return {
        proposition: {
          tag: "or",
          left: proof.other,
          right: checked.proposition,
        },
        safety: checked.safety,
      };
    }
    case "or_cases": {
      const checked = check_proof_term(
        proof.proof,
        context,
        term_context,
        environment,
        options,
      );
      expect(
        checked.proposition.tag === "or",
        "Disjunction elimination requires a disjunction proof.",
      );
      const left = check_proof_term(
        proof.left_body,
        extend_proof_context(
          kernel_hypothesis(checked.proposition.left),
          context,
        ),
        term_context,
        environment,
        options,
      );
      const right = check_proof_term(
        proof.right_body,
        extend_proof_context(
          kernel_hypothesis(checked.proposition.right),
          context,
        ),
        term_context,
        environment,
        options,
      );
      expect(
        proposition_equal_at(
          left.proposition,
          right.proposition,
          term_context,
          environment,
        ),
        "Disjunction branches establish different propositions.",
      );
      return {
        proposition: left.proposition,
        safety: merge_safety(
          checked.safety,
          merge_safety(left.safety, right.safety),
        ),
      };
    }
    case "not_intro": {
      check_proposition(proof.premise, term_context, environment);
      const body = check_proof_term(
        proof.body,
        extend_proof_context(kernel_hypothesis(proof.premise), context),
        term_context,
        environment,
        options,
      );
      expect(
        body.proposition.tag === "false",
        "Negation introduction requires a proof of False.",
      );
      return {
        proposition: { tag: "not", proposition: proof.premise },
        safety: body.safety,
      };
    }
    case "implies_intro": {
      check_proposition(proof.premise, term_context, environment);
      const body = check_proof_term(
        proof.body,
        extend_proof_context(kernel_hypothesis(proof.premise), context),
        term_context,
        environment,
        options,
      );
      return {
        proposition: {
          tag: "implies",
          premise: proof.premise,
          conclusion: body.proposition,
        },
        safety: body.safety,
      };
    }
    case "implies_apply": {
      const function_proof = check_proof_term(
        proof.function,
        context,
        term_context,
        environment,
        options,
      );
      const argument = check_proof_term(
        proof.argument,
        context,
        term_context,
        environment,
        options,
      );
      expect(
        function_proof.proposition.tag === "implies",
        "Application requires an implication proof.",
      );
      expect(
        proposition_equal_at(
          function_proof.proposition.premise,
          argument.proposition,
          term_context,
          environment,
        ),
        "Implication premise does not match argument.",
      );
      return {
        proposition: function_proof.proposition.conclusion,
        safety: merge_safety(function_proof.safety, argument.safety),
      };
    }
    case "forall_intro": {
      check_type(proof.domain, term_context, environment);
      const extended_term_context = extend_term_context(
        proof.domain,
        term_context,
      );
      const body = check_proof_term(
        proof.body,
        shift_proof_context_variables(context, 1),
        extended_term_context,
        environment,
        options,
      );
      return {
        proposition: {
          tag: "forall",
          domain: proof.domain,
          body: body.proposition,
        },
        safety: body.safety,
      };
    }
    case "forall_apply": {
      const universal = check_proof_term(
        proof.proof,
        context,
        term_context,
        environment,
        options,
      );
      expect(
        universal.proposition.tag === "forall",
        "Universal application requires a universal proof.",
      );
      check_kernel_term(
        proof.argument,
        universal.proposition.domain,
        term_context,
        environment,
      );
      const proposition = substitute_proposition_variable(
        universal.proposition.body,
        proof.argument,
      );
      check_proposition(proposition, term_context, environment);
      return { proposition, safety: universal.safety };
    }
    case "exists_intro": {
      check_type(proof.domain, term_context, environment);
      const body_context = extend_term_context(proof.domain, term_context);
      check_proposition(proof.body, body_context, environment);
      check_kernel_term(
        proof.witness,
        proof.domain,
        term_context,
        environment,
      );
      const instantiated = substitute_proposition_variable(
        proof.body,
        proof.witness,
      );
      const checked = check_proof_against(
        proof.proof,
        instantiated,
        context,
        term_context,
        environment,
        options,
      );
      return {
        proposition: {
          tag: "exists",
          domain: proof.domain,
          body: proof.body,
        },
        safety: checked.safety,
      };
    }
    case "exists_elim": {
      const existential = check_proof_term(
        proof.proof,
        context,
        term_context,
        environment,
        options,
      );
      expect(
        existential.proposition.tag === "exists",
        "Existential elimination requires an existential proof.",
      );
      check_proposition(proof.target, term_context, environment);
      const body_term_context = extend_term_context(
        existential.proposition.domain,
        term_context,
      );
      const body_proof_context = extend_proof_context(
        kernel_hypothesis(existential.proposition.body),
        shift_proof_context_variables(context, 1),
      );
      const lifted_target = shift_proposition_variables(proof.target, 1);
      const body = check_proof_against(
        proof.body,
        lifted_target,
        body_proof_context,
        body_term_context,
        environment,
        options,
      );
      return {
        proposition: proof.target,
        safety: merge_safety(existential.safety, body.safety),
      };
    }
    case "transport": {
      const equality = check_proof_term(
        proof.equality,
        context,
        term_context,
        environment,
        options,
      );
      expect(
        equality.proposition.tag === "equal",
        "Equality transport requires an equality proof.",
      );
      const motive_context = extend_term_context(
        equality.proposition.type,
        term_context,
      );
      check_proposition(proof.motive, motive_context, environment);
      const source = substitute_proposition_variable(
        proof.motive,
        equality.proposition.left,
      );
      const target = substitute_proposition_variable(
        proof.motive,
        equality.proposition.right,
      );
      const transported = check_proof_against(
        proof.proof,
        source,
        context,
        term_context,
        environment,
        options,
      );
      check_proposition(target, term_context, environment);
      return {
        proposition: target,
        safety: merge_safety(equality.safety, transported.safety),
      };
    }
    case "false_elim": {
      const checked = check_proof_term(
        proof.proof,
        context,
        term_context,
        environment,
        options,
      );
      expect(
        checked.proposition.tag === "false",
        "False elimination requires a proof of False.",
      );
      check_proposition(proof.target, term_context, environment);
      return { proposition: proof.target, safety: checked.safety };
    }
    case "unsafe_assume":
      expect(
        options.allow_unsafe === true,
        "Unsafe proof assumption requires an unsafe context.",
      );
      check_proposition(proof.proposition, term_context, environment);
      return {
        proposition: proof.proposition,
        safety: { tag: "unsafe", origins: ["unsafe assumption"] },
      };
  }
}

function merge_safety(left: ProofSafety, right: ProofSafety): ProofSafety {
  if (left.tag === "safe" && right.tag === "safe") return { tag: "safe" };
  const origins: string[] = [];
  let index = 0;
  if (left.tag === "unsafe") {
    for (
      let origin_index = 0;
      origin_index < left.origins.length;
      origin_index += 1
    ) {
      const origin = left.origins[origin_index];
      expect(origin !== undefined, `Unsafe origin ${origin_index} is missing.`);
      OBJECT_DEFINE_PROPERTY(origins, index, {
        value: origin,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      index += 1;
    }
  }
  if (right.tag === "unsafe") {
    for (
      let origin_index = 0;
      origin_index < right.origins.length;
      origin_index += 1
    ) {
      const origin = right.origins[origin_index];
      expect(origin !== undefined, `Unsafe origin ${origin_index} is missing.`);
      OBJECT_DEFINE_PROPERTY(origins, index, {
        value: origin,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      index += 1;
    }
  }
  return { tag: "unsafe", origins };
}

export function format_proposition(proposition: Proposition): string {
  return format_proposition_at(snapshot_proposition(proposition));
}

function format_proposition_at(proposition: Proposition): string {
  switch (proposition.tag) {
    case "true":
      return "True";
    case "false":
      return "False";
    case "atom": {
      if (proposition.arguments.length === 0) return proposition.name;
      let formatted = proposition.name + "(";
      for (let index = 0; index < proposition.arguments.length; index += 1) {
        const argument = proposition.arguments[index];
        expect(
          argument !== undefined,
          `Predicate argument ${index} is missing.`,
        );
        if (index > 0) formatted += ", ";
        formatted += format_kernel_term(argument);
      }
      return formatted + ")";
    }
    case "equal":
      return format_kernel_term(proposition.left) + " = " +
        format_kernel_term(proposition.right);
    case "and":
      return "(" + format_proposition_at(proposition.left) + " and " +
        format_proposition_at(proposition.right) + ")";
    case "or":
      return "(" + format_proposition_at(proposition.left) + " or " +
        format_proposition_at(proposition.right) + ")";
    case "implies":
      return "(" + format_proposition_at(proposition.premise) + " implies " +
        format_proposition_at(proposition.conclusion) + ")";
    case "not":
      return "not " + format_proposition_at(proposition.proposition);
    case "forall":
      return "(forall " + format_kernel_type(proposition.domain) + ". " +
        format_proposition_at(proposition.body) + ")";
    case "exists":
      return "(exists " + format_kernel_type(proposition.domain) + ". " +
        format_proposition_at(proposition.body) + ")";
  }
}

function format_kernel_term(term: KernelTerm): string {
  switch (term.tag) {
    case "var":
      return "#" + STRING_CONSTRUCTOR(term.index);
    case "constant":
      return term.name;
    case "lam":
      return "(lambda: " + format_kernel_type(term.domain) + ". " +
        format_kernel_term(term.body) + ")";
    case "app":
      return format_kernel_term(term.function) + "(" +
        format_kernel_term(term.argument) + ")";
  }
}

function format_kernel_type(type: KernelType): string {
  switch (type.tag) {
    case "sort":
      if (type.universe.tag === "prop") return "Prop";
      return "Type " + STRING_CONSTRUCTOR(type.universe.level);
    case "var":
      return "#" + STRING_CONSTRUCTOR(type.index);
    case "constant":
      return type.name;
    case "pi":
      return "(" + format_kernel_type(type.domain) + " -> " +
        format_kernel_type(type.codomain) + ")";
    case "lam":
      return "(lambda: " + format_kernel_type(type.domain) + ". " +
        format_kernel_type(type.body) + ")";
    case "app":
      return format_kernel_type(type.function) + "(" +
        format_kernel_type(type.argument) + ")";
  }
}
