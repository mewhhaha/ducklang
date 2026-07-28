import { assert_equals, assert_throws } from "../assert.ts";
import {
  check_certificate,
  check_proof,
  type Proposition,
  proposition_equal,
} from "./proof_kernel.ts";

const atom: Proposition = { tag: "atom", name: "P" };

Deno.test("kernel checks reflexive equality", () => {
  const certificate = check_proof(
    { tag: "refl", term: "value" },
    { tag: "equal", left: "value", right: "value" },
  );

  assert_equals(certificate.safety, { tag: "safe" });
});

Deno.test("kernel checks equality congruence", () => {
  const certificate = check_proof(
    {
      tag: "congr",
      function: "wrap",
      proof: { tag: "refl", term: "value" },
    },
    { tag: "equal", left: "wrap(value)", right: "wrap(value)" },
  );
  assert_equals(certificate.safety, { tag: "safe" });
});

Deno.test("kernel congruence preserves non-reflexive equality sides", () => {
  const certificate = check_proof(
    {
      tag: "congr",
      function: "wrap",
      proof: {
        tag: "unsafe_assume",
        proposition: { tag: "equal", left: "x", right: "y" },
      },
    },
    { tag: "equal", left: "wrap(x)", right: "wrap(y)" },
    { allow_unsafe: true },
  );
  assert_equals(certificate.safety.tag, "unsafe");
});

Deno.test("kernel congruence rejects non-equality proofs", () => {
  assert_throws(
    () =>
      check_proof({
        tag: "congr",
        function: "wrap",
        proof: { tag: "true_intro" },
      }, {
        tag: "equal",
        left: "wrap(x)",
        right: "wrap(y)",
      }),
    "Congruence requires an equality proof.",
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
      other: { tag: "atom" as const, name: "Q" },
    },
  };
  const certificate = check_proof(proof, {
    tag: "implies",
    premise: atom,
    conclusion: {
      tag: "or",
      left: atom,
      right: { tag: "atom", name: "Q" },
    },
  });
  assert_equals(certificate.safety, { tag: "safe" });
});

Deno.test("kernel checks disjunction elimination", () => {
  const disjunction = {
    tag: "or" as const,
    left: atom,
    right: { tag: "atom" as const, name: "Q" },
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
        other: { tag: "atom" as const, name: "Q" },
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
      check_proof({ tag: "refl", term: "" }, {
        tag: "equal",
        left: "",
        right: "",
      }),
    "Equality left term must not be empty.",
  );
  assert_throws(
    () => check_proof({ tag: "bogus" } as never, atom),
    "Invalid proof term tag.",
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
    origins: ["unsafe assumption"],
  });
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
    { tag: "refl", term: "value" },
    { tag: "equal", left: "value", right: "value" },
  );
  const proposition = certificate.proposition;

  assert_throws(
    () => {
      (proposition as { left: string }).left = "forged";
    },
    "Cannot assign to read only property",
  );
});

Deno.test("kernel certificate consumers reject forged certificates", () => {
  const certificate = check_proof(
    { tag: "refl", term: "value" },
    { tag: "equal", left: "value", right: "value" },
  );
  assert_equals(
    check_certificate(certificate, certificate.proposition),
    certificate,
  );
  assert_throws(
    () =>
      check_certificate(
        { proposition: certificate.proposition, safety: { tag: "safe" } },
        certificate.proposition,
      ),
    "Kernel certificate is not sealed by the proof kernel.",
  );
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
