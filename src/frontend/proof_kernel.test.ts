import { assert_equals, assert_throws } from "../assert.ts";
import {
  certificate_establishes,
  check_certificate,
  check_proof,
  check_proposition_formation,
  format_proposition,
  instantiate_proposition,
  lift_proposition,
  type ProofTerm,
  type Proposition,
  proposition_equal,
  true_proposition,
} from "./proof_kernel.ts";
import {
  KernelEnvironment,
  type KernelTerm,
  type KernelType,
  MAX_KERNEL_TERM_SEQUENCE_LENGTH,
  type_sort,
} from "./kernel_terms.ts";

const atom: Proposition = { tag: "atom", name: "P", arguments: [] };
const value_type: KernelType = { tag: "constant", name: "Value" };
const environment = KernelEnvironment.from_definitions([
  {
    tag: "declaration",
    name: "Value",
    type: type_sort(0),
  },
  {
    tag: "declaration",
    name: "value",
    type: value_type,
  },
  {
    tag: "declaration",
    name: "x",
    type: value_type,
  },
  {
    tag: "declaration",
    name: "y",
    type: value_type,
  },
  {
    tag: "declaration",
    name: "wrap",
    type: {
      tag: "pi",
      domain: value_type,
      codomain: value_type,
    },
  },
]);

function constant(name: string, type: KernelType = value_type): KernelTerm {
  return { tag: "constant", name, type };
}

function equal(left: KernelTerm, right: KernelTerm): Proposition {
  return { tag: "equal", type: value_type, left, right };
}

function predicate(argument: KernelTerm): Proposition {
  return { tag: "atom", name: "P", arguments: [argument] };
}

function identity_application(argument: KernelTerm): KernelTerm {
  return {
    tag: "app",
    function: {
      tag: "lam",
      domain: value_type,
      body: { tag: "var", index: 0 },
    },
    argument,
  };
}

const safe_options = { allow_unsafe: false, environment };
const cumulative_term = { tag: "var" as const, index: 0 };
const cumulative_goal: Proposition = {
  tag: "equal",
  type: type_sort(1),
  left: cumulative_term,
  right: cumulative_term,
};
const cumulative_options = {
  allow_unsafe: false,
  term_context: [type_sort(0)],
};

function check_cumulative_proof(proof: ProofTerm) {
  return check_proof(proof, cumulative_goal, cumulative_options);
}

Deno.test("kernel checks reflexive equality", () => {
  const certificate = check_proof(
    { tag: "refl", type: value_type, term: constant("value") },
    equal(constant("value"), constant("value")),
    safe_options,
  );

  assert_equals(certificate.safety, { tag: "safe" });
});

Deno.test("kernel checks equality congruence", () => {
  const certificate = check_proof(
    {
      tag: "congr",
      function: constant("wrap", {
        tag: "pi",
        domain: value_type,
        codomain: value_type,
      }),
      proof: { tag: "refl", type: value_type, term: constant("value") },
    },
    equal(
      {
        tag: "app",
        function: constant("wrap", {
          tag: "pi",
          domain: value_type,
          codomain: value_type,
        }),
        argument: constant("value"),
      },
      {
        tag: "app",
        function: constant("wrap", {
          tag: "pi",
          domain: value_type,
          codomain: value_type,
        }),
        argument: constant("value"),
      },
    ),
    safe_options,
  );
  assert_equals(certificate.safety, { tag: "safe" });
});

Deno.test("kernel congruence preserves non-reflexive equality sides", () => {
  const certificate = check_proof(
    {
      tag: "congr",
      function: constant("wrap", {
        tag: "pi",
        domain: value_type,
        codomain: value_type,
      }),
      proof: {
        tag: "unsafe_assume",
        proposition: equal(constant("x"), constant("y")),
      },
    },
    equal(
      {
        tag: "app",
        function: constant("wrap", {
          tag: "pi",
          domain: value_type,
          codomain: value_type,
        }),
        argument: constant("x"),
      },
      {
        tag: "app",
        function: constant("wrap", {
          tag: "pi",
          domain: value_type,
          codomain: value_type,
        }),
        argument: constant("y"),
      },
    ),
    { allow_unsafe: true, environment },
  );
  assert_equals(certificate.safety.tag, "unsafe");
});

Deno.test("kernel congruence rejects non-equality proofs", () => {
  assert_throws(
    () =>
      check_proof(
        {
          tag: "congr",
          function: constant("wrap", {
            tag: "pi",
            domain: value_type,
            codomain: value_type,
          }),
          proof: { tag: "true_intro" },
        },
        equal(constant("x"), constant("y")),
        safe_options,
      ),
    "Congruence requires an equality proof.",
  );
});

Deno.test("kernel equality uses definitional term conversion", () => {
  const certificate = check_proof(
    { tag: "refl", type: value_type, term: constant("x") },
    equal(constant("x"), identity_application(constant("x"))),
    safe_options,
  );

  assert_equals(certificate.safety, { tag: "safe" });
});

Deno.test("kernel reflexivity checks against a cumulative equality carrier", () => {
  const certificate = check_cumulative_proof(
    { tag: "refl", type: type_sort(1), term: cumulative_term },
  );

  assert_equals(certificate.proposition, cumulative_goal);
});

Deno.test("symmetry preserves an explicit cumulative reflexivity carrier", () => {
  const certificate = check_cumulative_proof({
    tag: "symm",
    proof: { tag: "refl", type: type_sort(1), term: cumulative_term },
  });

  assert_equals(certificate.proposition, cumulative_goal);
});

Deno.test("transitivity preserves explicit cumulative reflexivity carriers", () => {
  const reflexivity = {
    tag: "refl" as const,
    type: type_sort(1),
    term: cumulative_term,
  };
  const certificate = check_cumulative_proof({
    tag: "trans",
    left: reflexivity,
    right: reflexivity,
  });

  assert_equals(certificate.proposition, cumulative_goal);
});

Deno.test("conjunction elimination preserves a cumulative equality carrier", () => {
  const certificate = check_cumulative_proof({
    tag: "and_left",
    proof: {
      tag: "and_intro",
      left: { tag: "refl", type: type_sort(1), term: cumulative_term },
      right: { tag: "true_intro" },
    },
  });

  assert_equals(certificate.proposition, cumulative_goal);
});

Deno.test("implication application preserves a cumulative equality carrier", () => {
  const certificate = check_cumulative_proof({
    tag: "implies_apply",
    function: {
      tag: "implies_intro",
      premise: true_proposition,
      body: { tag: "refl", type: type_sort(1), term: cumulative_term },
    },
    argument: { tag: "true_intro" },
  });

  assert_equals(certificate.proposition, cumulative_goal);
});

Deno.test("kernel equality transitivity composes converted middle terms", () => {
  const certificate = check_proof(
    {
      tag: "trans",
      left: {
        tag: "unsafe_assume",
        proposition: equal(
          constant("x"),
          identity_application(constant("x")),
        ),
      },
      right: { tag: "refl", type: value_type, term: constant("x") },
    },
    equal(constant("x"), constant("x")),
    { allow_unsafe: true, environment },
  );

  assert_equals(certificate.safety.tag, "unsafe");
});

Deno.test("kernel rejects equality terms outside their carrier", () => {
  const malformed: Proposition = {
    tag: "equal",
    type: type_sort(0),
    left: constant("x"),
    right: constant("x"),
  };
  assert_throws(
    () =>
      check_proof(
        { tag: "unsafe_assume", proposition: malformed },
        malformed,
        { allow_unsafe: true, environment },
      ),
    "Kernel term does not have the expected type.",
  );
});

Deno.test("kernel checks True introduction", () => {
  const certificate = check_proof({ tag: "true_intro" }, { tag: "true" });
  assert_equals(certificate.safety, { tag: "safe" });
});

Deno.test("kernel checks implication introduction", () => {
  const implication = {
    tag: "implies_intro" as const,
    premise: atom,
    body: { tag: "assumption" as const, index: 0 },
  };
  const certificate = check_proof(implication, {
    tag: "implies",
    premise: atom,
    conclusion: atom,
  });

  assert_equals(
    proposition_equal(certificate.proposition, {
      tag: "implies",
      premise: atom,
      conclusion: atom,
    }),
    true,
  );
});

Deno.test("kernel checks disjunction introduction", () => {
  const proof = {
    tag: "implies_intro" as const,
    premise: atom,
    body: {
      tag: "or_left" as const,
      proof: { tag: "assumption" as const, index: 0 },
      other: { tag: "atom" as const, name: "Q", arguments: [] },
    },
  };
  const certificate = check_proof(proof, {
    tag: "implies",
    premise: atom,
    conclusion: {
      tag: "or",
      left: atom,
      right: { tag: "atom", name: "Q", arguments: [] },
    },
  });
  assert_equals(certificate.safety, { tag: "safe" });
});

Deno.test("kernel checks disjunction elimination", () => {
  const disjunction = {
    tag: "or" as const,
    left: atom,
    right: { tag: "atom" as const, name: "Q", arguments: [] },
  };
  const proof = {
    tag: "implies_intro" as const,
    premise: disjunction,
    body: {
      tag: "or_cases" as const,
      proof: { tag: "assumption" as const, index: 0 },
      left_body: {
        tag: "or_left" as const,
        proof: { tag: "assumption" as const, index: 0 },
        other: { tag: "atom" as const, name: "Q", arguments: [] },
      },
      right_body: {
        tag: "or_right" as const,
        other: atom,
        proof: { tag: "assumption" as const, index: 0 },
      },
    },
  };
  const certificate = check_proof(proof, {
    tag: "implies",
    premise: disjunction,
    conclusion: disjunction,
  });
  assert_equals(certificate.safety, { tag: "safe" });
});

Deno.test("kernel checks negation introduction", () => {
  const certificate = check_proof(
    {
      tag: "not_intro",
      premise: atom,
      body: { tag: "unsafe_assume", proposition: { tag: "false" } },
    },
    { tag: "not", proposition: atom },
    { allow_unsafe: true },
  );
  assert_equals(certificate.safety.tag, "unsafe");
});

Deno.test("kernel rejects out-of-scope assumptions", () => {
  assert_throws(
    () => check_proof({ tag: "assumption", index: 0 }, atom),
    "Proof assumption 0 is out of scope.",
  );
});

Deno.test("kernel rejects malformed proof indices and terms", () => {
  assert_throws(
    () => check_proof({ tag: "assumption", index: -1 }, atom),
    "Invalid proof assumption index -1.",
  );
  assert_throws(
    () =>
      check_proof(
        { tag: "refl", type: value_type, term: null as never },
        equal(constant("value"), constant("value")),
        safe_options,
      ),
    "Invalid kernel term.",
  );
  assert_throws(
    () => check_proof({ tag: "bogus" } as never, atom),
    "Invalid proof term tag bogus.",
  );
});

Deno.test("kernel rejects null proof and proposition nodes", () => {
  assert_throws(
    () => check_proof(null as never, atom),
    "Invalid proof node.",
  );
  assert_throws(
    () =>
      check_proof({ tag: "unsafe_assume", proposition: null } as never, atom, {
        allow_unsafe: true,
      }),
    "Invalid proposition node.",
  );
});

Deno.test("kernel proof boundaries reject accessor-backed inputs", () => {
  const proof = Object.defineProperty({}, "tag", {
    get() {
      return "true_intro";
    },
  });
  const options = Object.defineProperty({}, "allow_unsafe", {
    get() {
      return false;
    },
  });
  assert_throws(
    () => check_proof(proof as never, { tag: "true" }),
    "Proof properties must be own data properties.",
  );
  assert_throws(
    () =>
      check_proof(
        { tag: "true_intro" },
        { tag: "true" },
        options as never,
      ),
    "Kernel check options properties must be own data properties.",
  );
});

Deno.test("kernel proof snapshots reject cycles and oversized dags", () => {
  const cyclic = { tag: "symm" } as {
    tag: "symm";
    proof: typeof cyclic;
  };
  cyclic.proof = cyclic;
  assert_throws(
    () => check_proof(cyclic, { tag: "true" }),
    "Proof graph must be acyclic.",
  );

  let oversized: {
    tag: "true_intro";
  } | {
    tag: "and_intro";
    left: typeof oversized;
    right: typeof oversized;
  } = { tag: "true_intro" };
  for (let depth = 0; depth < 15; depth += 1) {
    oversized = { tag: "and_intro", left: oversized, right: oversized };
  }
  assert_throws(
    () => check_proof(oversized, { tag: "true" }),
    "Proof snapshot exceeded 20000 nodes.",
  );
});

Deno.test("kernel keeps unsafe assumptions explicit", () => {
  assert_throws(
    () => check_proof({ tag: "unsafe_assume", proposition: atom }, atom),
    "Unsafe proof assumption requires an unsafe context.",
  );
  const certificate = check_proof(
    { tag: "unsafe_assume", proposition: atom },
    atom,
    { allow_unsafe: true },
  );
  assert_equals(certificate.safety, {
    tag: "unsafe",
    origins: [{
      tag: "description",
      description: "unsafe assumption",
    }],
  });
  const located = check_proof(
    {
      tag: "unsafe_assume",
      proposition: atom,
      origin: { tag: "source", start: 10, end: 20 },
    },
    atom,
    { allow_unsafe: true },
  );
  assert_equals(located.safety, {
    tag: "unsafe",
    origins: [{ tag: "source", start: 10, end: 20 }],
  });
  if (located.safety.tag !== "unsafe") {
    throw new Error("Expected unsafe proof provenance.");
  }
  assert_equals(Object.isFrozen(located.safety.origins[0]), true);
  assert_throws(
    () =>
      check_proof(
        {
          tag: "unsafe_assume",
          proposition: atom,
          origin: { tag: "description", description: "" },
        },
        atom,
        { allow_unsafe: true },
      ),
    "Unsafe proof origin description must not be empty.",
  );
  assert_throws(
    () =>
      check_proof(
        {
          tag: "unsafe_assume",
          proposition: atom,
          origin: { tag: "source", start: 20, end: 10 },
        },
        atom,
        { allow_unsafe: true },
      ),
    "Unsafe proof origin end must be a safe integer after its start.",
  );
});

Deno.test("kernel eliminates False only into the requested proposition", () => {
  const certificate = check_proof(
    {
      tag: "false_elim",
      proof: { tag: "unsafe_assume", proposition: { tag: "false" } },
      target: atom,
    },
    atom,
    { allow_unsafe: true },
  );

  assert_equals(certificate.proposition, atom);
});

Deno.test("kernel propagates unsafe evidence through elimination", () => {
  const certificate = check_proof(
    {
      tag: "false_elim",
      proof: { tag: "unsafe_assume", proposition: { tag: "false" } },
      target: atom,
    },
    atom,
    { allow_unsafe: true },
  );

  assert_equals(certificate.safety.tag, "unsafe");
});

Deno.test("kernel introduces and applies universal proofs", () => {
  const bound_identity: Proposition = {
    tag: "equal",
    type: value_type,
    left: { tag: "var", index: 0 },
    right: { tag: "var", index: 0 },
  };
  const universal: ProofTerm = {
    tag: "forall_intro",
    domain: value_type,
    body: {
      tag: "refl",
      type: value_type,
      term: { tag: "var", index: 0 },
    },
  };

  const certificate = check_proof(
    {
      tag: "forall_apply",
      proof: universal,
      argument: constant("x"),
    },
    equal(constant("x"), constant("x")),
    safe_options,
  );
  assert_equals(certificate.safety, { tag: "safe" });
  check_proof(
    universal,
    { tag: "forall", domain: value_type, body: bound_identity },
    safe_options,
  );
});

Deno.test("kernel proposition transforms snapshot quantified inputs", () => {
  const bound_identity: Proposition = {
    tag: "equal",
    type: value_type,
    left: { tag: "var", index: 0 },
    right: { tag: "var", index: 0 },
  };

  assert_equals(
    instantiate_proposition(bound_identity, constant("x")),
    equal(constant("x"), constant("x")),
  );
  assert_equals(
    lift_proposition(bound_identity),
    {
      tag: "equal",
      type: value_type,
      left: { tag: "var", index: 1 },
      right: { tag: "var", index: 1 },
    },
  );

  const cyclic = { tag: "not" } as Proposition;
  (cyclic as Extract<Proposition, { tag: "not" }>).proposition = cyclic;
  assert_throws(
    () => lift_proposition(cyclic),
    "Proposition graph must be acyclic",
  );
});

Deno.test("predicate arguments participate in quantified conversion", () => {
  const bound = predicate({ tag: "var", index: 0 });
  assert_equals(
    instantiate_proposition(bound, constant("x")),
    predicate(constant("x")),
  );
  assert_equals(
    lift_proposition(bound),
    predicate({ tag: "var", index: 1 }),
  );
  assert_equals(
    proposition_equal(
      predicate(constant("x")),
      predicate(constant("y")),
      { environment },
    ),
    false,
  );
  assert_equals(format_proposition(predicate(constant("x"))), "P(x)");

  const universal: Proposition = {
    tag: "forall",
    domain: value_type,
    body: bound,
  };
  const goal: Proposition = {
    tag: "implies",
    premise: universal,
    conclusion: predicate(constant("x")),
  };
  const certificate = check_proof(
    {
      tag: "implies_intro",
      premise: universal,
      body: {
        tag: "forall_apply",
        proof: { tag: "assumption", index: 0 },
        argument: constant("x"),
      },
    },
    goal,
    safe_options,
  );
  assert_equals(certificate.proposition, goal);
});

Deno.test("predicate arguments are checked and snapshotted", () => {
  assert_throws(
    () =>
      check_proposition_formation(
        {
          tag: "atom",
          name: "P",
          arguments: [{ tag: "var", index: 0 }],
        },
        { environment },
      ),
    "Kernel variable 0 is out of scope.",
  );

  const source_term = constant("x");
  const source_arguments = [source_term];
  const stable = check_proposition_formation(
    { tag: "atom", name: "P", arguments: source_arguments },
    { environment },
  );
  if (source_term.tag !== "constant") {
    throw new Error("Expected a predicate constant argument.");
  }
  source_term.name = "y";
  source_arguments[0] = constant("y");
  assert_equals(stable, predicate(constant("x")));
  assert_equals(Object.isFrozen(stable), true);
  assert_equals(
    Object.isFrozen(
      (stable as Extract<Proposition, { tag: "atom" }>).arguments,
    ),
    true,
  );

  const sparse = new Array<KernelTerm>(1);
  assert_throws(
    () =>
      check_proposition_formation(
        { tag: "atom", name: "P", arguments: sparse },
        { environment },
      ),
    "Predicate arguments cannot contain holes",
  );

  const accessor = [constant("x")];
  Object.defineProperty(accessor, "0", { get: () => constant("y") });
  assert_throws(
    () =>
      check_proposition_formation(
        { tag: "atom", name: "P", arguments: accessor },
        { environment },
      ),
    "Predicate argument 0 must be an own data property.",
  );

  const maximum_arguments: KernelTerm[] = [];
  for (
    let index = 0;
    index < MAX_KERNEL_TERM_SEQUENCE_LENGTH;
    index += 1
  ) {
    maximum_arguments.push(constant("x"));
  }
  const maximum_predicate: Proposition = {
    tag: "atom",
    name: "P",
    arguments: maximum_arguments,
  };
  assert_equals(
    proposition_equal(
      check_proposition_formation(maximum_predicate, { environment }),
      maximum_predicate,
      { environment },
    ),
    true,
  );

  const oversized_arguments = new Array<KernelTerm>(
    MAX_KERNEL_TERM_SEQUENCE_LENGTH + 1,
  );
  const hostile_arguments = new Proxy(oversized_arguments, {
    ownKeys() {
      throw new Error("Predicate argument keys must not be enumerated.");
    },
  });
  assert_throws(
    () =>
      check_proposition_formation(
        { tag: "atom", name: "P", arguments: hostile_arguments },
        { environment },
      ),
    `Predicate arguments exceed ${MAX_KERNEL_TERM_SEQUENCE_LENGTH} entries.`,
  );
});

Deno.test("universal introduction shifts existing proof hypotheses", () => {
  const outer_identity: Proposition = {
    tag: "equal",
    type: value_type,
    left: { tag: "var", index: 0 },
    right: { tag: "var", index: 0 },
  };
  const lifted_identity: Proposition = {
    tag: "equal",
    type: value_type,
    left: { tag: "var", index: 1 },
    right: { tag: "var", index: 1 },
  };
  const goal: Proposition = {
    tag: "implies",
    premise: outer_identity,
    conclusion: {
      tag: "forall",
      domain: value_type,
      body: lifted_identity,
    },
  };

  const certificate = check_proof(
    {
      tag: "implies_intro",
      premise: outer_identity,
      body: {
        tag: "forall_intro",
        domain: value_type,
        body: { tag: "assumption", index: 0 },
      },
    },
    goal,
    {
      allow_unsafe: false,
      environment,
      term_context: [value_type],
    },
  );

  assert_equals(certificate.safety, { tag: "safe" });
});

Deno.test("universal application substitutes below nested quantifiers", () => {
  const proof: ProofTerm = {
    tag: "forall_apply",
    proof: {
      tag: "forall_intro",
      domain: value_type,
      body: {
        tag: "exists_intro",
        domain: value_type,
        body: {
          tag: "equal",
          type: value_type,
          left: { tag: "var", index: 1 },
          right: { tag: "var", index: 1 },
        },
        witness: { tag: "var", index: 0 },
        proof: {
          tag: "refl",
          type: value_type,
          term: { tag: "var", index: 0 },
        },
      },
    },
    argument: constant("x"),
  };
  const goal: Proposition = {
    tag: "exists",
    domain: value_type,
    body: equal(constant("x"), constant("x")),
  };

  const certificate = check_proof(proof, goal, safe_options);
  assert_equals(certificate.proposition, goal);
});

Deno.test("nested universal substitution weakens ambient arguments", () => {
  const proof: ProofTerm = {
    tag: "forall_apply",
    proof: {
      tag: "forall_intro",
      domain: value_type,
      body: {
        tag: "exists_intro",
        domain: value_type,
        body: {
          tag: "equal",
          type: value_type,
          left: { tag: "var", index: 1 },
          right: { tag: "var", index: 1 },
        },
        witness: { tag: "var", index: 0 },
        proof: {
          tag: "refl",
          type: value_type,
          term: { tag: "var", index: 0 },
        },
      },
    },
    argument: { tag: "var", index: 0 },
  };
  const goal: Proposition = {
    tag: "exists",
    domain: value_type,
    body: {
      tag: "equal",
      type: value_type,
      left: { tag: "var", index: 1 },
      right: { tag: "var", index: 1 },
    },
  };

  const certificate = check_proof(proof, goal, {
    allow_unsafe: false,
    environment,
    term_context: [value_type],
  });
  assert_equals(certificate.proposition, goal);
});

Deno.test("quantified substitution has one aggregate output budget", () => {
  const bound_identity: Proposition = {
    tag: "equal",
    type: value_type,
    left: { tag: "var", index: 0 },
    right: { tag: "var", index: 0 },
  };
  let body: Proposition = bound_identity;
  for (let index = 0; index < 99; index += 1) {
    body = { tag: "and", left: bound_identity, right: body };
  }
  let argument = constant("x");
  for (let index = 0; index < 100; index += 1) {
    argument = {
      tag: "app",
      function: constant("wrap", {
        tag: "pi",
        domain: value_type,
        codomain: value_type,
      }),
      argument,
    };
  }

  assert_throws(
    () =>
      check_proof(
        {
          tag: "forall_apply",
          proof: {
            tag: "unsafe_assume",
            proposition: {
              tag: "forall",
              domain: value_type,
              body,
            },
          },
          argument,
        },
        { tag: "true" },
        { allow_unsafe: true, environment },
      ),
    "Proof snapshot exceeded 20000 nodes.",
  );
});

Deno.test("kernel introduces and eliminates logical existentials", () => {
  const existence: ProofTerm = {
    tag: "exists_intro",
    domain: value_type,
    body: { tag: "true" },
    witness: constant("x"),
    proof: { tag: "true_intro" },
  };
  const goal: Proposition = {
    tag: "exists",
    domain: value_type,
    body: { tag: "true" },
  };

  check_proof(existence, goal, safe_options);
  const certificate = check_proof(
    {
      tag: "exists_elim",
      proof: existence,
      target: { tag: "true" },
      body: { tag: "assumption", index: 0 },
    },
    { tag: "true" },
    safe_options,
  );
  assert_equals(certificate.safety, { tag: "safe" });
});

Deno.test("existential elimination shifts outer goals and hypotheses", () => {
  const outer_identity: Proposition = {
    tag: "equal",
    type: value_type,
    left: { tag: "var", index: 0 },
    right: { tag: "var", index: 0 },
  };
  const existence: ProofTerm = {
    tag: "exists_intro",
    domain: value_type,
    body: { tag: "true" },
    witness: constant("x"),
    proof: { tag: "true_intro" },
  };

  const certificate = check_proof(
    {
      tag: "implies_intro",
      premise: outer_identity,
      body: {
        tag: "exists_elim",
        proof: existence,
        target: outer_identity,
        body: { tag: "assumption", index: 1 },
      },
    },
    {
      tag: "implies",
      premise: outer_identity,
      conclusion: outer_identity,
    },
    {
      allow_unsafe: false,
      environment,
      term_context: [value_type],
    },
  );

  assert_equals(certificate.safety, { tag: "safe" });
});

Deno.test("logical existential witnesses cannot escape elimination", () => {
  assert_throws(
    () =>
      check_proof(
        {
          tag: "exists_elim",
          proof: {
            tag: "exists_intro",
            domain: value_type,
            body: { tag: "true" },
            witness: constant("x"),
            proof: { tag: "true_intro" },
          },
          target: {
            tag: "equal",
            type: value_type,
            left: { tag: "var", index: 0 },
            right: { tag: "var", index: 0 },
          },
          body: {
            tag: "refl",
            type: value_type,
            term: { tag: "var", index: 0 },
          },
        },
        { tag: "true" },
        safe_options,
      ),
    "Kernel variable 0 is out of scope.",
  );
});

Deno.test("equality transport is restricted to propositions", () => {
  const motive: Proposition = {
    tag: "equal",
    type: value_type,
    left: { tag: "var", index: 0 },
    right: constant("x"),
  };
  const goal = equal(constant("y"), constant("x"));
  const certificate = check_proof(
    {
      tag: "transport",
      equality: {
        tag: "unsafe_assume",
        proposition: equal(constant("x"), constant("y")),
      },
      motive,
      proof: {
        tag: "refl",
        type: value_type,
        term: constant("x"),
      },
    },
    goal,
    { allow_unsafe: true, environment },
  );

  assert_equals(certificate.proposition, goal);
  assert_equals(certificate.safety.tag, "unsafe");
});

Deno.test("equality transport rejects non-equality evidence", () => {
  assert_throws(
    () =>
      check_proof(
        {
          tag: "transport",
          equality: { tag: "true_intro" },
          motive: { tag: "true" },
          proof: { tag: "true_intro" },
        },
        { tag: "true" },
        safe_options,
      ),
    "Equality transport requires an equality proof.",
  );
});

Deno.test("quantified proposition bodies cannot reference escaped values", () => {
  assert_throws(
    () =>
      check_proof(
        { tag: "unsafe_assume", proposition: { tag: "true" } },
        {
          tag: "forall",
          domain: value_type,
          body: {
            tag: "equal",
            type: value_type,
            left: { tag: "var", index: 1 },
            right: { tag: "var", index: 1 },
          },
        },
        { allow_unsafe: true, environment },
      ),
    "Kernel variable 1 is out of scope.",
  );
});

Deno.test("kernel rejects assumptions outside an internal binder", () => {
  assert_throws(
    () =>
      check_proof(
        { tag: "assumption", index: 0 },
        atom,
        { allow_unsafe: false },
      ),
    "Proof assumption 0 is out of scope.",
  );
});

Deno.test("safe proof boundaries reject unsafe certificates", () => {
  assert_throws(
    () =>
      check_proof(
        {
          tag: "false_elim",
          proof: { tag: "unsafe_assume", proposition: { tag: "false" } },
          target: atom,
        },
        atom,
        { allow_unsafe: true, require_safe: true },
      ),
    "Safe proof depends on unsafe evidence.",
  );
});

Deno.test("kernel certificates are deeply immutable", () => {
  const certificate = check_proof(
    { tag: "refl", type: value_type, term: constant("value") },
    equal(constant("value"), constant("value")),
    safe_options,
  );
  const proposition = certificate.proposition;

  assert_throws(
    () => {
      (proposition as { left: KernelTerm }).left = constant("x");
    },
    "Cannot assign to read only property",
  );
});

Deno.test("kernel certificate consumers reject forged certificates", () => {
  const certificate = check_proof(
    { tag: "refl", type: value_type, term: constant("value") },
    equal(constant("value"), constant("value")),
    safe_options,
  );
  assert_equals(
    check_certificate(certificate, certificate.proposition, { environment }),
    certificate,
  );
  assert_throws(
    () =>
      check_certificate(
        { proposition: certificate.proposition, safety: { tag: "safe" } },
        certificate.proposition,
        { environment },
      ),
    "Kernel certificate is not sealed by the proof kernel.",
  );
});

Deno.test("kernel certificate sealing ignores monkeypatched weak collections", () => {
  const certificate = check_proof({ tag: "true_intro" }, { tag: "true" });
  const forged = {
    proposition: certificate.proposition,
    safety: certificate.safety,
  };
  const original_has = WeakSet.prototype.has;
  const original_get = WeakMap.prototype.get;
  try {
    WeakSet.prototype.has = () => true;
    WeakMap.prototype.get = () => ({
      environment,
      term_context: [],
    });
    assert_throws(
      () => check_certificate(forged, { tag: "true" }),
      "Kernel certificate is not sealed by the proof kernel.",
    );
    assert_equals(
      check_certificate(certificate, { tag: "true" }),
      certificate,
    );
  } finally {
    WeakSet.prototype.has = original_has;
    WeakMap.prototype.get = original_get;
  }
});

Deno.test("kernel certificate consumers enforce requested safety and goal", () => {
  const unsafe = check_proof(
    { tag: "unsafe_assume", proposition: atom },
    atom,
    { allow_unsafe: true },
  );
  assert_throws(
    () => check_certificate(unsafe, atom, { require_safe: true }),
    "Kernel certificate depends on unsafe evidence.",
  );
  assert_throws(
    () => check_certificate(unsafe, { tag: "false" }),
    "Kernel certificate does not establish the requested proposition.",
  );
});

Deno.test("kernel certificates compare goals in their checked term context", () => {
  const contextual_goal: Proposition = {
    tag: "equal",
    type: type_sort(0),
    left: { tag: "var", index: 0 },
    right: { tag: "var", index: 0 },
  };
  const contextual = check_proof(
    { tag: "refl", type: type_sort(0), term: { tag: "var", index: 0 } },
    contextual_goal,
    {
      allow_unsafe: false,
      term_context: [type_sort(0)],
    },
  );

  const context = { term_context: [type_sort(0)] };
  assert_equals(
    certificate_establishes(contextual, contextual_goal, context),
    true,
  );
  assert_equals(
    certificate_establishes(contextual, { tag: "true" }, context),
    false,
  );
});

Deno.test("kernel certificates cannot cross proof environments", () => {
  function equality_environment(right_value: string) {
    return KernelEnvironment.from_definitions([
      {
        tag: "declaration",
        name: "V",
        type: type_sort(0),
      },
      {
        tag: "declaration",
        name: "a",
        type: { tag: "constant", name: "V" },
      },
      {
        tag: "declaration",
        name: "b",
        type: { tag: "constant", name: "V" },
      },
      {
        tag: "transparent",
        name: "x",
        module: "test",
        type: { tag: "constant", name: "V" },
        value: { tag: "constant", name: "a" },
        total: true,
      },
      {
        tag: "transparent",
        name: "y",
        module: "test",
        type: { tag: "constant", name: "V" },
        value: { tag: "constant", name: right_value },
        total: true,
      },
    ]);
  }
  const first = equality_environment("a");
  const second = equality_environment("b");
  const carrier: KernelType = { tag: "constant", name: "V" };
  const left = constant("x", carrier);
  const right = constant("y", carrier);
  const goal: Proposition = { tag: "equal", type: carrier, left, right };
  const certificate = check_proof(
    { tag: "refl", type: carrier, term: left },
    goal,
    { allow_unsafe: false, environment: first },
  );

  assert_throws(
    () => check_certificate(certificate, goal, { environment: second }),
    "Kernel certificate belongs to a different environment.",
  );
});
