import {
  check_certificate,
  check_proposition_formation,
  type KernelCertificate,
  proposition_equal,
  type Proposition,
  type ProofSafety,
} from "./proof_kernel.ts";
import { expect } from "../expect.ts";
import {
  type KernelContext,
  kernel_context_equal,
  KernelEnvironment,
  type KernelTerm,
  type KernelType,
  snapshot_kernel_context,
} from "./kernel_terms.ts";

export type FunctionFactSummary = {
  requires: Proposition;
  ensures: Proposition;
  ensures_when_true: Proposition;
  ensures_when_false: Proposition;
  total: boolean;
  safety: ProofSafety;
  certificate: KernelCertificate;
  proof_context: FunctionProofContext;
};

export type FunctionProofContext = {
  environment: KernelEnvironment;
  term_context: KernelContext;
};

export type ContractBinder = {
  name: string;
  type: string;
};

export type ContractFunction = {
  parameters: readonly ContractBinder[];
  result: string;
  summary: FunctionFactSummary;
};

export type ContractCompatibilityCertificates = {
  requires: KernelCertificate;
  ensures: KernelCertificate;
  ensures_when_true: KernelCertificate;
  ensures_when_false: KernelCertificate;
};

/**
 * Check the contravariant requirements and covariant guarantees required when
 * an actual function is passed where an expected contract is required.
 */
export function check_contract_compatibility(
  expected: ContractFunction,
  actual: ContractFunction,
  certificates: ContractCompatibilityCertificates,
): void {
  const stable_expected = snapshot_contract_function(expected);
  const stable_actual = snapshot_contract_function(actual);
  const stable_certificates = snapshot_compatibility_certificates(certificates);
  expect(
    stable_expected.parameters.length === stable_actual.parameters.length,
    "Contract functions must have the same arity.",
  );
  for (let index = 0; index < stable_expected.parameters.length; index += 1) {
    const expected_parameter = stable_expected.parameters[index];
    const actual_parameter = stable_actual.parameters[index];
    expect(
      expected_parameter !== undefined && actual_parameter !== undefined,
      "Contract parameter disappeared during compatibility checking.",
    );
    expect(
      expected_parameter.type === actual_parameter.type,
      `Contract parameter ${index} has incompatible representation types.`,
    );
  }
  expect(
    stable_expected.result === stable_actual.result,
    "Contract result has an incompatible representation type.",
  );
  if (stable_expected.summary.total) {
    expect(stable_actual.summary.total, "A total contract requires a total function.");
  }
  if (stable_expected.summary.safety.tag === "safe") {
    expect(
      stable_actual.summary.safety.tag === "safe",
      "A safe contract cannot accept an unsafe function.",
    );
  }
  expect(
    stable_expected.summary.proof_context.environment ===
      stable_actual.summary.proof_context.environment,
    "Contract functions belong to different proof environments.",
  );
  expect(
    kernel_context_equal(
      stable_expected.summary.proof_context.term_context,
      stable_actual.summary.proof_context.term_context,
      stable_expected.summary.proof_context.environment,
    ),
    "Contract functions belong to different proof contexts.",
  );

  const substitutions = new Map<string, string>();
  for (let index = 0; index < stable_expected.parameters.length; index += 1) {
    const expected_parameter = stable_expected.parameters[index];
    const actual_parameter = stable_actual.parameters[index];
    if (expected_parameter === undefined || actual_parameter === undefined) {
      throw new Error("Contract parameter disappeared during substitution.");
    }
    substitutions.set(actual_parameter.name, expected_parameter.name);
  }

  const actual_requires = substitute_proposition(
    stable_actual.summary.requires,
    substitutions,
  );
  const actual_ensures = substitute_proposition(
    stable_actual.summary.ensures,
    substitutions,
  );
  const actual_true = substitute_proposition(
    stable_actual.summary.ensures_when_true,
    substitutions,
  );
  const actual_false = substitute_proposition(
    stable_actual.summary.ensures_when_false,
    substitutions,
  );

  check_certificate(
    stable_certificates.requires,
    implication(stable_expected.summary.requires, actual_requires),
    certificate_options(stable_expected.summary),
  );
  check_certificate(
    stable_certificates.ensures,
    implication(
      stable_expected.summary.requires,
      implication(actual_ensures, stable_expected.summary.ensures),
    ),
    certificate_options(stable_expected.summary),
  );
  check_certificate(
    stable_certificates.ensures_when_true,
    implication(
      stable_expected.summary.requires,
      implication(actual_true, stable_expected.summary.ensures_when_true),
    ),
    certificate_options(stable_expected.summary),
  );
  check_certificate(
    stable_certificates.ensures_when_false,
    implication(
      stable_expected.summary.requires,
      implication(actual_false, stable_expected.summary.ensures_when_false),
    ),
    certificate_options(stable_expected.summary),
  );
}

function certificate_options(summary: FunctionFactSummary) {
  return {
    require_safe: summary.safety.tag === "safe",
    environment: summary.proof_context.environment,
    term_context: summary.proof_context.term_context,
  };
}

function snapshot_contract_function(function_value: ContractFunction): ContractFunction {
  assert_plain_record(function_value, "Contract function");
  require_own_data(function_value, "parameters");
  require_own_data(function_value, "result");
  require_own_data(function_value, "summary");
  const parameters = function_value.parameters;
  assert_plain_array(parameters, "Contract parameters");
  const names = new Set<string>();
  const stable_parameters: ContractBinder[] = [];
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index];
    expect(parameter !== undefined, "Contract parameters cannot contain holes.");
    assert_plain_record(parameter, "Contract parameter");
    require_own_data(parameter, "name");
    require_own_data(parameter, "type");
    expect(typeof parameter.name === "string" && parameter.name.length > 0, "Contract parameter name must not be empty.");
    expect(!names.has(parameter.name), `Duplicate contract parameter ${parameter.name}.`);
    names.add(parameter.name);
    expect(typeof parameter.type === "string" && parameter.type.length > 0, "Contract parameter type must not be empty.");
    stable_parameters.push({ name: parameter.name, type: parameter.type });
  }
  expect(typeof function_value.result === "string" && function_value.result.length > 0, "Contract result type must not be empty.");
  return {
    parameters: Object.freeze(stable_parameters),
    result: function_value.result,
    summary: snapshot_summary(function_value.summary),
  };
}

function snapshot_summary(summary: FunctionFactSummary): FunctionFactSummary {
  assert_plain_record(summary, "Function summary");
  require_properties(summary, ["requires", "ensures", "ensures_when_true", "ensures_when_false", "total", "safety", "certificate", "proof_context"]);
  expect(typeof summary.total === "boolean", "Function summary totality must be boolean.");
  const safety = snapshot_safety(summary.safety);
  const proof_context = snapshot_proof_context(summary.proof_context);
  const stable_requires = check_proposition_formation(
    summary.requires,
    proof_context,
  );
  const stable_ensures = check_proposition_formation(
    summary.ensures,
    proof_context,
  );
  const stable_true = check_proposition_formation(
    summary.ensures_when_true,
    proof_context,
  );
  const stable_false = check_proposition_formation(
    summary.ensures_when_false,
    proof_context,
  );
  const certificate = check_certificate(
    summary.certificate,
    summary_certificate_goal(stable_ensures, stable_true, stable_false),
    {
    require_safe: safety.tag === "safe",
    environment: proof_context.environment,
    term_context: proof_context.term_context,
    },
  );
  return {
    requires: stable_requires,
    ensures: stable_ensures,
    ensures_when_true: stable_true,
    ensures_when_false: stable_false,
    total: summary.total,
    safety,
    certificate,
    proof_context,
  };
}

function snapshot_proof_context(
  context: FunctionProofContext,
): FunctionProofContext {
  assert_plain_record(context, "Function proof context");
  require_properties(context, ["environment", "term_context"]);
  return {
    environment: context.environment,
    term_context: snapshot_kernel_context(context.term_context),
  };
}

function summary_certificate_goal(
  ensures: Proposition,
  ensures_when_true: Proposition,
  ensures_when_false: Proposition,
): Proposition {
  return {
    tag: "and",
    left: ensures,
    right: {
      tag: "and",
      left: ensures_when_true,
      right: ensures_when_false,
    },
  };
}

function snapshot_compatibility_certificates(
  certificates: ContractCompatibilityCertificates,
): ContractCompatibilityCertificates {
  assert_plain_record(certificates, "Contract compatibility certificates");
  require_properties(certificates, ["requires", "ensures", "ensures_when_true", "ensures_when_false"]);
  return {
    requires: certificates.requires,
    ensures: certificates.ensures,
    ensures_when_true: certificates.ensures_when_true,
    ensures_when_false: certificates.ensures_when_false,
  };
}

function snapshot_safety(safety: ProofSafety): ProofSafety {
  assert_plain_record(safety, "Function summary safety");
  require_own_data(safety, "tag");
  if (safety.tag === "safe") return { tag: "safe" };
  expect(safety.tag === "unsafe", "Invalid function summary safety tag.");
  require_own_data(safety, "origins");
  assert_plain_array(safety.origins, "Unsafe origins");
  const origins: string[] = [];
  for (let index = 0; index < safety.origins.length; index += 1) {
    const origin = safety.origins[index];
    expect(typeof origin === "string" && origin.length > 0, "Unsafe origin must not be empty.");
    origins.push(origin);
  }
  return { tag: "unsafe", origins: Object.freeze(origins) };
}

function assert_plain_array(value: readonly unknown[], label: string): void {
  expect(Array.isArray(value), `${label} must be an array.`);
  expect(Object.getPrototypeOf(value) === Array.prototype, `${label} must be an ordinary array.`);
  const keys = Reflect.ownKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    expect(key !== undefined, `${label} key disappeared.`);
    expect(typeof key === "string", `${label} cannot contain symbol properties.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(descriptor !== undefined && descriptor.get === undefined && descriptor.set === undefined, `${label} cannot contain accessor properties.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    expect(descriptor !== undefined, `${label} cannot contain holes.`);
  }
}

function assert_plain_record(value: object, label: string): void {
  expect(value !== null && typeof value === "object", `${label} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  expect(prototype === Object.prototype || prototype === null, `${label} must be a plain record.`);
  const keys = Reflect.ownKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    expect(key !== undefined, `${label} key disappeared.`);
    expect(typeof key === "string", `${label} cannot contain symbol properties.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(descriptor !== undefined && descriptor.get === undefined && descriptor.set === undefined, `${label} cannot contain accessors.`);
  }
}

function require_own_data(value: object, key: string): void {
  expect(Object.prototype.hasOwnProperty.call(value, key), `Missing own contract property ${key}.`);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  expect(descriptor !== undefined && descriptor.get === undefined && descriptor.set === undefined, `Contract property ${key} must be an own data property.`);
}

function require_properties(value: object, keys: readonly string[]): void {
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    expect(key !== undefined, "Contract property list is incomplete.");
    require_own_data(value, key);
  }
}

function implication(premise: Proposition, conclusion: Proposition): Proposition {
  return { tag: "implies", premise, conclusion };
}

function substitute_proposition(
  proposition: Proposition,
  substitutions: ReadonlyMap<string, string>,
): Proposition {
  switch (proposition.tag) {
    case "true":
    case "false":
      return proposition;
    case "atom": {
      const arguments_: KernelTerm[] = [];
      for (let index = 0; index < proposition.arguments.length; index += 1) {
        const argument = proposition.arguments[index];
        expect(
          argument !== undefined,
          `Predicate argument ${index} is missing.`,
        );
        arguments_[index] = substitute_kernel_term(argument, substitutions);
      }
      return {
        tag: "atom",
        name: proposition.name,
        arguments: arguments_,
      };
    }
    case "equal":
      return {
        tag: "equal",
        type: substitute_kernel_type(proposition.type, substitutions),
        left: substitute_kernel_term(proposition.left, substitutions),
        right: substitute_kernel_term(proposition.right, substitutions),
      };
    case "and":
    case "or":
      return {
        tag: proposition.tag,
        left: substitute_proposition(proposition.left, substitutions),
        right: substitute_proposition(proposition.right, substitutions),
      };
    case "implies":
      return {
        tag: "implies",
        premise: substitute_proposition(proposition.premise, substitutions),
        conclusion: substitute_proposition(proposition.conclusion, substitutions),
      };
    case "not":
      return {
        tag: "not",
        proposition: substitute_proposition(proposition.proposition, substitutions),
      };
    case "forall":
    case "exists":
      return {
        tag: proposition.tag,
        domain: substitute_kernel_type(proposition.domain, substitutions),
        body: substitute_proposition(proposition.body, substitutions),
      };
  }
}

function substitute_kernel_term(
  term: KernelTerm,
  substitutions: ReadonlyMap<string, string>,
): KernelTerm {
  switch (term.tag) {
    case "var":
      return term;
    case "constant": {
      const replacement = substitutions.get(term.name);
      let name = term.name;
      if (replacement !== undefined) {
        name = replacement;
      }
      return {
        tag: "constant",
        name,
        type: substitute_kernel_type(term.type, substitutions),
      };
    }
    case "lam":
      return {
        tag: "lam",
        domain: substitute_kernel_type(term.domain, substitutions),
        body: substitute_kernel_term(term.body, substitutions),
      };
    case "app":
      return {
        tag: "app",
        function: substitute_kernel_term(term.function, substitutions),
        argument: substitute_kernel_term(term.argument, substitutions),
      };
  }
}

function substitute_kernel_type(
  type: KernelType,
  substitutions: ReadonlyMap<string, string>,
): KernelType {
  switch (type.tag) {
    case "sort":
    case "var":
      return type;
    case "constant": {
      const replacement = substitutions.get(type.name);
      if (replacement === undefined) return type;
      return { tag: "constant", name: replacement };
    }
    case "pi":
      return {
        tag: "pi",
        domain: substitute_kernel_type(type.domain, substitutions),
        codomain: substitute_kernel_type(type.codomain, substitutions),
      };
    case "lam":
      return {
        tag: "lam",
        domain: substitute_kernel_type(type.domain, substitutions),
        body: substitute_kernel_type(type.body, substitutions),
      };
    case "app":
      return {
        tag: "app",
        function: substitute_kernel_type(type.function, substitutions),
        argument: substitute_kernel_type(type.argument, substitutions),
      };
  }
}

export function summary_matches(
  summary: FunctionFactSummary,
  expected: FunctionFactSummary,
): boolean {
  const stable_summary = snapshot_summary(summary);
  const stable_expected = snapshot_summary(expected);
  if (
    stable_summary.proof_context.environment !==
      stable_expected.proof_context.environment
  ) {
    return false;
  }
  if (
    !kernel_context_equal(
      stable_summary.proof_context.term_context,
      stable_expected.proof_context.term_context,
      stable_summary.proof_context.environment,
    )
  ) {
    return false;
  }
  const options = stable_summary.proof_context;
  return proposition_equal(
    stable_summary.requires,
    stable_expected.requires,
    options,
  ) &&
    proposition_equal(
      stable_summary.ensures,
      stable_expected.ensures,
      options,
    ) &&
    proposition_equal(
      stable_summary.ensures_when_true,
      stable_expected.ensures_when_true,
      options,
    ) &&
    proposition_equal(
      stable_summary.ensures_when_false,
      stable_expected.ensures_when_false,
      options,
    ) &&
    stable_summary.total === stable_expected.total &&
    stable_summary.safety.tag === stable_expected.safety.tag;
}
