import { expect } from "../expect.ts";

export type Proposition =
  | { tag: "true" }
  | { tag: "false" }
  | { tag: "atom"; name: string }
  | { tag: "equal"; left: string; right: string }
  | { tag: "and"; left: Proposition; right: Proposition }
  | { tag: "or"; left: Proposition; right: Proposition }
  | { tag: "implies"; premise: Proposition; conclusion: Proposition }
  | { tag: "not"; proposition: Proposition };

export type ProofTerm =
  | { tag: "assumption"; index: number }
  | { tag: "true_intro" }
  | { tag: "refl"; term: string }
  | { tag: "congr"; function: string; proof: ProofTerm }
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

export type KernelCertificate = KernelResult & {
  readonly __kernel_certificate: unique symbol;
};

export type KernelCheckOptions = {
  allow_unsafe: boolean;
  require_safe?: boolean;
};

export type KernelCertificateCheckOptions = {
  require_safe?: boolean;
};

export const true_proposition: Proposition = Object.freeze({ tag: "true" });
export const false_proposition: Proposition = Object.freeze({ tag: "false" });

export function proposition_equal(
  left: Proposition,
  right: Proposition,
): boolean {
  if (left.tag !== right.tag) return false;
  switch (left.tag) {
    case "true":
    case "false":
      return true;
    case "atom":
      return left.name ===
        (right as Extract<Proposition, { tag: "atom" }>).name;
    case "equal": {
      const other = right as Extract<Proposition, { tag: "equal" }>;
      return left.left === other.left && left.right === other.right;
    }
    case "and":
    case "or": {
      const other = right as Extract<Proposition, { tag: typeof left.tag }>;
      return proposition_equal(left.left, other.left) &&
        proposition_equal(left.right, other.right);
    }
    case "implies": {
      const other = right as Extract<Proposition, { tag: "implies" }>;
      return proposition_equal(left.premise, other.premise) &&
        proposition_equal(left.conclusion, other.conclusion);
    }
    case "not":
      return proposition_equal(
        left.proposition,
        (right as Extract<Proposition, { tag: "not" }>).proposition,
      );
  }
}

export function check_proof(
  proof: ProofTerm,
  goal: Proposition,
  options: KernelCheckOptions = { allow_unsafe: false },
): KernelCertificate {
  const stable_goal = freeze_proposition(snapshot_proposition(goal));
  const stable_proof = snapshot_proof(proof);
  const checked = check_term(stable_proof, [], options);
  expect(
    proposition_equal(checked.proposition, stable_goal),
    `Proof establishes ${format_proposition(checked.proposition)}, not ${
      format_proposition(stable_goal)
    }.`,
  );
  if (options.require_safe === true) {
    expect(
      checked.safety.tag === "safe",
      "Safe proof depends on unsafe evidence.",
    );
  }
  return seal_certificate(checked);
}

export function check_certificate(
  certificate: unknown,
  goal: Proposition,
  options: KernelCertificateCheckOptions = {},
): KernelCertificate {
  expect(
    certificate !== null && typeof certificate === "object" &&
      trusted_certificates.has(certificate),
    "Kernel certificate is not sealed by the proof kernel.",
  );
  const checked = certificate as KernelCertificate;
  const stable_goal = freeze_proposition(snapshot_proposition(goal));
  expect(
    proposition_equal(checked.proposition, stable_goal),
    "Kernel certificate does not establish the requested proposition.",
  );
  if (options.require_safe === true) {
    expect(
      checked.safety.tag === "safe",
      "Kernel certificate depends on unsafe evidence.",
    );
  }
  return checked;
}

function snapshot_proposition(
  proposition: Proposition,
  depth = 0,
): Proposition {
  expect(depth <= MAX_SNAPSHOT_DEPTH, "Proposition structure is too deep.");
  expect(
    proposition !== null && typeof proposition === "object",
    "Invalid proposition node.",
  );
  switch (proposition.tag) {
    case "true":
      return { tag: "true" };
    case "false":
      return { tag: "false" };
    case "atom":
      return {
        tag: "atom",
        name: valid_text(proposition.name, "Proposition atom name"),
      };
    case "equal":
      return {
        tag: "equal",
        left: valid_text(proposition.left, "Equality left term"),
        right: valid_text(proposition.right, "Equality right term"),
      };
    case "and":
    case "or":
      return {
        tag: proposition.tag,
        left: snapshot_proposition(proposition.left, depth + 1),
        right: snapshot_proposition(proposition.right, depth + 1),
      };
    case "implies":
      return {
        tag: "implies",
        premise: snapshot_proposition(proposition.premise, depth + 1),
        conclusion: snapshot_proposition(proposition.conclusion, depth + 1),
      };
    case "not":
      return {
        tag: "not",
        proposition: snapshot_proposition(proposition.proposition, depth + 1),
      };
    default:
      throw new Error("Invalid proposition tag.");
  }
}

function snapshot_proof(proof: ProofTerm, depth = 0): ProofTerm {
  expect(depth <= MAX_SNAPSHOT_DEPTH, "Proof structure is too deep.");
  expect(
    proof !== null && typeof proof === "object",
    "Invalid proof node.",
  );
  switch (proof.tag) {
    case "assumption":
      expect(
        Number.isSafeInteger(proof.index) && proof.index >= 0,
        `Invalid proof assumption index ${String(proof.index)}.`,
      );
      return { tag: "assumption", index: proof.index };
    case "true_intro":
      return { tag: "true_intro" };
    case "refl":
      return { tag: "refl", term: valid_text(proof.term, "Reflexivity term") };
    case "congr":
      return {
        tag: "congr",
        function: valid_text(proof.function, "Congruence function name"),
        proof: snapshot_proof(proof.proof, depth + 1),
      };
    case "symm":
      return { tag: "symm", proof: snapshot_proof(proof.proof, depth + 1) };
    case "trans":
      return {
        tag: "trans",
        left: snapshot_proof(proof.left, depth + 1),
        right: snapshot_proof(proof.right, depth + 1),
      };
    case "and_intro":
      return {
        tag: "and_intro",
        left: snapshot_proof(proof.left, depth + 1),
        right: snapshot_proof(proof.right, depth + 1),
      };
    case "and_left":
      return { tag: "and_left", proof: snapshot_proof(proof.proof, depth + 1) };
    case "and_right":
      return {
        tag: "and_right",
        proof: snapshot_proof(proof.proof, depth + 1),
      };
    case "or_left":
      return {
        tag: "or_left",
        proof: snapshot_proof(proof.proof, depth + 1),
        other: snapshot_proposition(proof.other, depth + 1),
      };
    case "or_right":
      return {
        tag: "or_right",
        other: snapshot_proposition(proof.other, depth + 1),
        proof: snapshot_proof(proof.proof, depth + 1),
      };
    case "or_cases":
      return {
        tag: "or_cases",
        proof: snapshot_proof(proof.proof, depth + 1),
        left_body: snapshot_proof(proof.left_body, depth + 1),
        right_body: snapshot_proof(proof.right_body, depth + 1),
      };
    case "not_intro":
      return {
        tag: "not_intro",
        premise: snapshot_proposition(proof.premise, depth + 1),
        body: snapshot_proof(proof.body, depth + 1),
      };
    case "implies_intro":
      return {
        tag: "implies_intro",
        premise: snapshot_proposition(proof.premise, depth + 1),
        body: snapshot_proof(proof.body, depth + 1),
      };
    case "implies_apply":
      return {
        tag: "implies_apply",
        function: snapshot_proof(proof.function, depth + 1),
        argument: snapshot_proof(proof.argument, depth + 1),
      };
    case "false_elim":
      return {
        tag: "false_elim",
        proof: snapshot_proof(proof.proof, depth + 1),
        target: snapshot_proposition(proof.target, depth + 1),
      };
    case "unsafe_assume":
      return {
        tag: "unsafe_assume",
        proposition: snapshot_proposition(proof.proposition, depth + 1),
      };
    default:
      throw new Error("Invalid proof term tag.");
  }
}

function valid_text(value: string, label: string): string {
  expect(
    typeof value === "string" && value.length > 0,
    `${label} must not be empty.`,
  );
  return value;
}

type KernelHypothesis = KernelResult;

function kernel_hypothesis(proposition: Proposition): KernelHypothesis {
  return { proposition, safety: { tag: "safe" } };
}

const trusted_certificates = new WeakSet<object>();

function seal_certificate(result: KernelResult): KernelCertificate {
  const certificate = Object.freeze({
    proposition: freeze_proposition(result.proposition),
    safety: freeze_safety(result.safety),
  }) as unknown as KernelCertificate;
  trusted_certificates.add(certificate);
  return certificate;
}

function freeze_proposition(proposition: Proposition): Proposition {
  switch (proposition.tag) {
    case "true":
    case "false":
    case "atom":
    case "equal":
      return Object.freeze({ ...proposition });
    case "and":
    case "or":
      return Object.freeze({
        ...proposition,
        left: freeze_proposition(proposition.left),
        right: freeze_proposition(proposition.right),
      });
    case "implies":
      return Object.freeze({
        ...proposition,
        premise: freeze_proposition(proposition.premise),
        conclusion: freeze_proposition(proposition.conclusion),
      });
    case "not":
      return Object.freeze({
        ...proposition,
        proposition: freeze_proposition(proposition.proposition),
      });
  }
}

function freeze_safety(safety: ProofSafety): ProofSafety {
  if (safety.tag === "safe") return Object.freeze({ tag: "safe" });
  return Object.freeze({
    tag: "unsafe",
    origins: Object.freeze([...safety.origins]),
  });
}

function check_term(
  proof: ProofTerm,
  context: KernelHypothesis[],
  options: KernelCheckOptions,
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
    case "refl":
      return {
        proposition: { tag: "equal", left: proof.term, right: proof.term },
        safety: { tag: "safe" },
      };
    case "congr": {
      expect(
        proof.function.length > 0,
        "Congruence function name must not be empty.",
      );
      const checked = check_term(proof.proof, context, options);
      expect(
        checked.proposition.tag === "equal",
        "Congruence requires an equality proof.",
      );
      return {
        proposition: {
          tag: "equal",
          left: `${proof.function}(${checked.proposition.left})`,
          right: `${proof.function}(${checked.proposition.right})`,
        },
        safety: checked.safety,
      };
    }
    case "symm": {
      const checked = check_term(proof.proof, context, options);
      expect(
        checked.proposition.tag === "equal",
        "Symmetry requires an equality proof.",
      );
      return {
        proposition: {
          tag: "equal",
          left: checked.proposition.right,
          right: checked.proposition.left,
        },
        safety: checked.safety,
      };
    }
    case "trans": {
      const left = check_term(proof.left, context, options);
      const right = check_term(proof.right, context, options);
      expect(
        left.proposition.tag === "equal",
        "Transitivity requires equality proofs.",
      );
      expect(
        right.proposition.tag === "equal",
        "Transitivity requires equality proofs.",
      );
      expect(
        left.proposition.right === right.proposition.left,
        "Equality proofs do not compose.",
      );
      return {
        proposition: {
          tag: "equal",
          left: left.proposition.left,
          right: right.proposition.right,
        },
        safety: merge_safety(left.safety, right.safety),
      };
    }
    case "and_intro": {
      const left = check_term(proof.left, context, options);
      const right = check_term(proof.right, context, options);
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
      const checked = check_term(proof.proof, context, options);
      expect(
        checked.proposition.tag === "and",
        "Conjunction elimination requires a conjunction proof.",
      );
      return { proposition: checked.proposition.left, safety: checked.safety };
    }
    case "and_right": {
      const checked = check_term(proof.proof, context, options);
      expect(
        checked.proposition.tag === "and",
        "Conjunction elimination requires a conjunction proof.",
      );
      return { proposition: checked.proposition.right, safety: checked.safety };
    }
    case "or_left": {
      const checked = check_term(proof.proof, context, options);
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
      const checked = check_term(proof.proof, context, options);
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
      const checked = check_term(proof.proof, context, options);
      expect(
        checked.proposition.tag === "or",
        "Disjunction elimination requires a disjunction proof.",
      );
      const left = check_term(
        proof.left_body,
        [kernel_hypothesis(checked.proposition.left), ...context],
        options,
      );
      const right = check_term(
        proof.right_body,
        [kernel_hypothesis(checked.proposition.right), ...context],
        options,
      );
      expect(
        proposition_equal(left.proposition, right.proposition),
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
      const body = check_term(
        proof.body,
        [kernel_hypothesis(proof.premise), ...context],
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
      const body = check_term(
        proof.body,
        [kernel_hypothesis(proof.premise), ...context],
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
      const function_proof = check_term(proof.function, context, options);
      const argument = check_term(proof.argument, context, options);
      expect(
        function_proof.proposition.tag === "implies",
        "Application requires an implication proof.",
      );
      expect(
        proposition_equal(
          function_proof.proposition.premise,
          argument.proposition,
        ),
        "Implication premise does not match argument.",
      );
      return {
        proposition: function_proof.proposition.conclusion,
        safety: merge_safety(function_proof.safety, argument.safety),
      };
    }
    case "false_elim": {
      const checked = check_term(proof.proof, context, options);
      expect(
        checked.proposition.tag === "false",
        "False elimination requires a proof of False.",
      );
      return { proposition: proof.target, safety: checked.safety };
    }
    case "unsafe_assume":
      expect(
        options.allow_unsafe === true,
        "Unsafe proof assumption requires an unsafe context.",
      );
      return {
        proposition: proof.proposition,
        safety: { tag: "unsafe", origins: ["unsafe assumption"] },
      };
  }
}

function merge_safety(left: ProofSafety, right: ProofSafety): ProofSafety {
  if (left.tag === "safe" && right.tag === "safe") return { tag: "safe" };
  const origins: string[] = [];
  if (left.tag === "unsafe") origins.push(...left.origins);
  if (right.tag === "unsafe") origins.push(...right.origins);
  return { tag: "unsafe", origins };
}

export function format_proposition(proposition: Proposition): string {
  switch (proposition.tag) {
    case "true":
      return "True";
    case "false":
      return "False";
    case "atom":
      return proposition.name;
    case "equal":
      return proposition.left + " = " + proposition.right;
    case "and":
      return "(" + format_proposition(proposition.left) + " and " +
        format_proposition(proposition.right) + ")";
    case "or":
      return "(" + format_proposition(proposition.left) + " or " +
        format_proposition(proposition.right) + ")";
    case "implies":
      return "(" + format_proposition(proposition.premise) + " implies " +
        format_proposition(proposition.conclusion) + ")";
    case "not":
      return "not " + format_proposition(proposition.proposition);
  }
}
