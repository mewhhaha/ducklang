import { assert_equals, assert_throws } from "../assert.ts";
import {
  check_proof,
  type Proposition,
  true_proposition,
} from "./proof_kernel.ts";
import {
  check_contract_compatibility,
  type ContractCompatibilityCertificates,
  type ContractFunction,
  type FunctionFactSummary,
  summary_matches,
} from "./function_summary.ts";
import {
  KernelEnvironment,
  type KernelTerm,
  type KernelType,
  type_sort,
} from "./kernel_terms.ts";

function identity_implication(
  proposition: Proposition,
  environment = KernelEnvironment.empty(),
) {
  return check_proof(
    {
      tag: "implies_intro",
      premise: proposition,
      body: { tag: "assumption", index: 0 },
    },
    { tag: "implies", premise: proposition, conclusion: proposition },
    { allow_unsafe: false, environment },
  );
}

function nested_identity(
  left: Proposition,
  right: Proposition,
  environment = KernelEnvironment.empty(),
) {
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
    { allow_unsafe: false, environment },
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

function function_contract(
  overrides: Partial<ContractFunction> = {},
): ContractFunction {
  const summary = {
    requires: true_proposition,
    ensures: true_proposition,
    ensures_when_true: true_proposition,
    ensures_when_false: true_proposition,
    total: false,
    safety: { tag: "safe" as const },
    certificate: summary_certificate(
      true_proposition,
      true_proposition,
      true_proposition,
    ),
    proof_context: {
      environment: KernelEnvironment.empty(),
      term_context: [],
    },
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
  environment = KernelEnvironment.empty(),
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
    { allow_unsafe: false, environment },
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
      safety: {
        tag: "unsafe",
        origins: [{ tag: "description", description: "test" }],
      },
    },
  });
  assert_throws(
    () =>
      check_contract_compatibility(
        expected,
        actual,
        compatibility_certificates(),
      ),
    "A safe contract cannot accept an unsafe function.",
  );
});

Deno.test("contract requirements are checked from expected to actual", () => {
  const required = {
    tag: "atom" as const,
    name: "nonzero",
    arguments: [],
  };
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

Deno.test("contract binder substitution rewrites predicate arguments", () => {
  const i32: KernelType = { tag: "constant", name: "I32" };
  const expected_term: KernelTerm = {
    tag: "constant",
    name: "expected",
    type: i32,
  };
  const actual_term: KernelTerm = {
    tag: "constant",
    name: "actual",
    type: i32,
  };
  const environment = KernelEnvironment.from_definitions([
    { tag: "declaration", name: "I32", type: type_sort(0) },
    { tag: "declaration", name: "expected", type: i32 },
    { tag: "declaration", name: "actual", type: i32 },
  ]);
  const expected_requirement: Proposition = {
    tag: "atom",
    name: "nonzero",
    arguments: [expected_term],
  };
  const actual_requirement: Proposition = {
    tag: "atom",
    name: "nonzero",
    arguments: [actual_term],
  };
  const guarantee_certificate = nested_identity(
    expected_requirement,
    true_proposition,
    environment,
  );
  const summary = summary_certificate(
    true_proposition,
    true_proposition,
    true_proposition,
    environment,
  );
  const expected: ContractFunction = {
    parameters: [{ name: "expected", type: "I32" }],
    result: "I32",
    summary: {
      requires: expected_requirement,
      ensures: true_proposition,
      ensures_when_true: true_proposition,
      ensures_when_false: true_proposition,
      total: false,
      safety: { tag: "safe" },
      certificate: summary,
      proof_context: { environment, term_context: [] },
    },
  };
  const actual: ContractFunction = {
    parameters: [{ name: "actual", type: "I32" }],
    result: "I32",
    summary: {
      requires: actual_requirement,
      ensures: true_proposition,
      ensures_when_true: true_proposition,
      ensures_when_false: true_proposition,
      total: false,
      safety: { tag: "safe" },
      certificate: summary,
      proof_context: { environment, term_context: [] },
    },
  };

  check_contract_compatibility(expected, actual, {
    requires: identity_implication(expected_requirement, environment),
    ensures: guarantee_certificate,
    ensures_when_true: guarantee_certificate,
    ensures_when_false: guarantee_certificate,
  });
});

Deno.test("contract compatibility requires total actual functions", () => {
  const expected = function_contract({
    summary: { ...function_contract().summary, total: true },
  });
  assert_throws(
    () =>
      check_contract_compatibility(
        expected,
        function_contract(),
        compatibility_certificates(),
      ),
    "A total contract requires a total function.",
  );
});

Deno.test("contract summaries reject unsafe guarantee certificates marked safe", () => {
  const proposition: Proposition = {
    tag: "atom",
    name: "established",
    arguments: [],
  };
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
    () =>
      check_contract_compatibility(
        function_contract(),
        actual,
        compatibility_certificates(),
      ),
    "Kernel certificate depends on unsafe evidence.",
  );
});

Deno.test("contract summaries require certificates for both result branches", () => {
  const proposition: Proposition = {
    tag: "atom",
    name: "true_branch_fact",
    arguments: [],
  };
  const actual = function_contract({
    summary: {
      ...function_contract().summary,
      ensures_when_true: proposition,
    },
  });
  assert_throws(
    () =>
      check_contract_compatibility(
        function_contract(),
        actual,
        compatibility_certificates(),
      ),
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
      () =>
        check_contract_compatibility(
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

Deno.test("contract summaries compare typed equality in their proof context", () => {
  const term = { tag: "var" as const, index: 0 };
  const equality: Proposition = {
    tag: "equal",
    type: type_sort(0),
    left: term,
    right: term,
  };
  const environment = KernelEnvironment.empty();
  const term_context = [type_sort(0)];
  const goal: Proposition = {
    tag: "and",
    left: equality,
    right: {
      tag: "and",
      left: true_proposition,
      right: true_proposition,
    },
  };
  const summary: FunctionFactSummary = {
    requires: true_proposition,
    ensures: equality,
    ensures_when_true: true_proposition,
    ensures_when_false: true_proposition,
    total: true,
    safety: { tag: "safe" },
    certificate: check_proof(
      {
        tag: "and_intro",
        left: { tag: "refl", type: type_sort(0), term },
        right: {
          tag: "and_intro",
          left: { tag: "true_intro" },
          right: { tag: "true_intro" },
        },
      },
      goal,
      {
        allow_unsafe: false,
        environment,
        term_context,
      },
    ),
    proof_context: { environment, term_context },
  };

  assert_equals(summary_matches(summary, summary), true);
});
