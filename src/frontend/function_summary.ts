import {
  check_certificate,
  type KernelCertificate,
  proposition_equal,
  type Proposition,
  type ProofSafety,
} from "./proof_kernel.ts";
import { expect } from "../expect.ts";

export type FunctionFactSummary = {
  requires: Proposition;
  ensures: Proposition;
  ensures_when_true: Proposition;
  ensures_when_false: Proposition;
  total: boolean;
  safety: ProofSafety;
  certificate: KernelCertificate;
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
    { require_safe: stable_expected.summary.safety.tag === "safe" },
  );
  check_certificate(
    stable_certificates.ensures,
    implication(
      stable_expected.summary.requires,
      implication(actual_ensures, stable_expected.summary.ensures),
    ),
    { require_safe: stable_expected.summary.safety.tag === "safe" },
  );
  check_certificate(
    stable_certificates.ensures_when_true,
    implication(
      stable_expected.summary.requires,
      implication(actual_true, stable_expected.summary.ensures_when_true),
    ),
    { require_safe: stable_expected.summary.safety.tag === "safe" },
  );
  check_certificate(
    stable_certificates.ensures_when_false,
    implication(
      stable_expected.summary.requires,
      implication(actual_false, stable_expected.summary.ensures_when_false),
    ),
    { require_safe: stable_expected.summary.safety.tag === "safe" },
  );
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
  require_properties(summary, ["requires", "ensures", "ensures_when_true", "ensures_when_false", "total", "safety", "certificate"]);
  expect(typeof summary.total === "boolean", "Function summary totality must be boolean.");
  const safety = snapshot_safety(summary.safety);
  const stable_requires = snapshot_proposition(summary.requires);
  const stable_ensures = snapshot_proposition(summary.ensures);
  const stable_true = snapshot_proposition(summary.ensures_when_true);
  const stable_false = snapshot_proposition(summary.ensures_when_false);
  const certificate = check_certificate(
    summary.certificate,
    summary_certificate_goal(stable_ensures, stable_true, stable_false),
    {
    require_safe: safety.tag === "safe",
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

function snapshot_proposition(proposition: Proposition, depth = 0): Proposition {
  expect(depth <= 256, "Contract proposition is too deep.");
  expect(proposition !== null && typeof proposition === "object", "Contract proposition must be an object.");
  assert_plain_record(proposition, "Contract proposition");
  require_own_data(proposition, "tag");
  switch (proposition.tag) {
    case "true":
      return { tag: "true" };
    case "false":
      return { tag: "false" };
    case "atom":
      require_own_data(proposition, "name");
      expect(typeof proposition.name === "string" && proposition.name.length > 0, "Contract atom name must not be empty.");
      return { tag: "atom", name: proposition.name };
    case "equal":
      require_own_data(proposition, "left");
      require_own_data(proposition, "right");
      expect(typeof proposition.left === "string" && proposition.left.length > 0, "Contract equality left term must not be empty.");
      expect(typeof proposition.right === "string" && proposition.right.length > 0, "Contract equality right term must not be empty.");
      return { tag: "equal", left: proposition.left, right: proposition.right };
    case "and":
    case "or":
      require_own_data(proposition, "left");
      require_own_data(proposition, "right");
      return {
        tag: proposition.tag,
        left: snapshot_proposition(proposition.left, depth + 1),
        right: snapshot_proposition(proposition.right, depth + 1),
      };
    case "implies":
      require_own_data(proposition, "premise");
      require_own_data(proposition, "conclusion");
      return {
        tag: "implies",
        premise: snapshot_proposition(proposition.premise, depth + 1),
        conclusion: snapshot_proposition(proposition.conclusion, depth + 1),
      };
    case "not":
      require_own_data(proposition, "proposition");
      return {
        tag: "not",
        proposition: snapshot_proposition(proposition.proposition, depth + 1),
      };
    default:
      throw new Error("Invalid contract proposition tag.");
  }
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
    case "atom":
      return { tag: "atom", name: substitute_term(proposition.name, substitutions) };
    case "equal":
      return {
        tag: "equal",
        left: substitute_term(proposition.left, substitutions),
        right: substitute_term(proposition.right, substitutions),
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
  }
}

function substitute_term(
  term: string,
  substitutions: ReadonlyMap<string, string>,
): string {
  const replacement = substitutions.get(term);
  if (replacement === undefined) return term;
  return replacement;
}

export function summary_matches(
  summary: FunctionFactSummary,
  expected: FunctionFactSummary,
): boolean {
  return proposition_equal(summary.requires, expected.requires) &&
    proposition_equal(summary.ensures, expected.ensures) &&
    proposition_equal(summary.ensures_when_true, expected.ensures_when_true) &&
    proposition_equal(summary.ensures_when_false, expected.ensures_when_false) &&
    summary.total === expected.total &&
    summary.safety.tag === expected.safety.tag;
}
