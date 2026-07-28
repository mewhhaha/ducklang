import { assert_throws } from "../assert.ts";
import { check_proof, true_proposition, type Proposition } from "./proof_kernel.ts";
import {
  check_contract_compatibility,
  type ContractCompatibilityCertificates,
  type ContractFunction,
} from "./function_summary.ts";

function identity_implication(proposition: Proposition) {
  return check_proof(
    {
      tag: "implies_intro",
      premise: proposition,
      body: { tag: "assumption", index: 0 },
    },
    { tag: "implies", premise: proposition, conclusion: proposition },
  );
}

function nested_identity(left: Proposition, right: Proposition) {
  return check_proof(
    {
      tag: "implies_intro",
      premise: left,
      body: {
        tag: "implies_intro",
        premise: right,
        body: { tag: "assumption", index: 0 },
      },
    },
    {
      tag: "implies",
      premise: left,
      conclusion: { tag: "implies", premise: right, conclusion: right },
    },
  );
}

function implies_true(premise: Proposition) {
  return check_proof(
    {
      tag: "implies_intro",
      premise,
      body: { tag: "true_intro" },
    },
    { tag: "implies", premise, conclusion: true_proposition },
  );
}

function function_contract(overrides: Partial<ContractFunction> = {}): ContractFunction {
  const summary = {
    requires: true_proposition,
    ensures: true_proposition,
    ensures_when_true: true_proposition,
    ensures_when_false: true_proposition,
    total: false,
    safety: { tag: "safe" as const },
    certificate: summary_certificate(true_proposition, true_proposition, true_proposition),
  };
  return {
    parameters: [{ name: "value", type: "I32" }],
    result: "I32",
    summary,
    ...overrides,
  };
}

function summary_certificate(
  ensures: Proposition,
  ensures_when_true: Proposition,
  ensures_when_false: Proposition,
) {
  const goal: Proposition = {
    tag: "and",
    left: ensures,
    right: { tag: "and", left: ensures_when_true, right: ensures_when_false },
  };
  return check_proof(
    {
      tag: "and_intro",
      left: { tag: "true_intro" },
      right: {
        tag: "and_intro",
        left: { tag: "true_intro" },
        right: { tag: "true_intro" },
      },
    },
    goal,
  );
}

function compatibility_certificates(): ContractCompatibilityCertificates {
  return {
    requires: identity_implication(true_proposition),
    ensures: nested_identity(true_proposition, true_proposition),
    ensures_when_true: nested_identity(true_proposition, true_proposition),
    ensures_when_false: nested_identity(true_proposition, true_proposition),
  };
}

Deno.test("contract compatibility checks kernel-backed variance obligations", () => {
  check_contract_compatibility(
    function_contract(),
    function_contract(),
    compatibility_certificates(),
  );
});

Deno.test("contract compatibility rejects unsafe actual functions", () => {
  const expected = function_contract({
    summary: {
      ...function_contract().summary,
      safety: { tag: "safe" },
    },
  });
  const actual = function_contract({
    summary: {
      ...function_contract().summary,
      safety: { tag: "unsafe", origins: ["test"] },
    },
  });
  assert_throws(
    () => check_contract_compatibility(expected, actual, compatibility_certificates()),
    "A safe contract cannot accept an unsafe function.",
  );
});

Deno.test("contract requirements are checked from expected to actual", () => {
  const required = { tag: "atom" as const, name: "nonzero" };
  const expected = function_contract({
    summary: { ...function_contract().summary, requires: required },
  });
  const actual = function_contract();
  check_contract_compatibility(expected, actual, {
    requires: implies_true(required),
    ensures: nested_identity(required, true_proposition),
    ensures_when_true: nested_identity(required, true_proposition),
    ensures_when_false: nested_identity(required, true_proposition),
  });
});

Deno.test("contract compatibility requires total actual functions", () => {
  const expected = function_contract({
    summary: { ...function_contract().summary, total: true },
  });
  assert_throws(
    () => check_contract_compatibility(expected, function_contract(), compatibility_certificates()),
    "A total contract requires a total function.",
  );
});

Deno.test("contract summaries reject unsafe guarantee certificates marked safe", () => {
  const proposition: Proposition = { tag: "atom", name: "established" };
  const unsafe_goal: Proposition = {
    tag: "and",
    left: proposition,
    right: { tag: "and", left: true_proposition, right: true_proposition },
  };
  const unsafe_certificate = check_proof(
    { tag: "unsafe_assume", proposition: unsafe_goal },
    unsafe_goal,
    { allow_unsafe: true },
  );
  const actual = function_contract({
    summary: {
      ...function_contract().summary,
      ensures: proposition,
      certificate: unsafe_certificate,
    },
  });
  assert_throws(
    () => check_contract_compatibility(function_contract(), actual, compatibility_certificates()),
    "Kernel certificate depends on unsafe evidence.",
  );
});

Deno.test("contract summaries require certificates for both result branches", () => {
  const proposition: Proposition = { tag: "atom", name: "true_branch_fact" };
  const actual = function_contract({
    summary: {
      ...function_contract().summary,
      ensures_when_true: proposition,
    },
  });
  assert_throws(
    () => check_contract_compatibility(function_contract(), actual, compatibility_certificates()),
    "Kernel certificate does not establish the requested proposition.",
  );
});

Deno.test("contract validation does not trust array iteration hooks", () => {
  const original_iterator = Array.prototype[Symbol.iterator];
  try {
    Array.prototype[Symbol.iterator] = function empty_iterator() {
      return { next: () => ({ done: true, value: undefined }) };
    } as unknown as typeof original_iterator;
    const parameters = [{ name: "value", type: "I32" }];
    Object.defineProperty(parameters, Symbol.iterator, {
      value: function empty_parameters() {
        return { next: () => ({ done: true, value: undefined }) };
      },
    });
    assert_throws(
      () => check_contract_compatibility(
        function_contract({ parameters }),
        function_contract({ parameters: [] }),
        compatibility_certificates(),
      ),
      "Contract parameters cannot contain symbol properties.",
    );
  } finally {
    Array.prototype[Symbol.iterator] = original_iterator;
  }
});
