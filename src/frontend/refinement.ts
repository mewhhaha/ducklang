import { expect } from "../expect.ts";
import { integer_type_name } from "../integer.ts";
import {
  check_certificate,
  type KernelCertificate,
  type Proposition,
  proposition_equal,
} from "./proof_kernel.ts";
import {
  type RepresentationOwnership,
  type RepresentationProductField,
  type RepresentationType,
  same_representation_type,
  snapshot_runtime_representation_type,
} from "./representation_type.ts";

export type RepresentationValue =
  | { tag: "unit" }
  | {
    tag: "scalar";
    type: string;
    value: string | number | bigint | boolean;
  }
  | { tag: "opaque"; name: string; value: string | number | bigint | boolean }
  | { tag: "product"; fields: readonly RepresentationValue[] }
  | { tag: "sum"; case: string; payload: RepresentationValue }
  | { tag: "function" }
  | {
    tag: "owned";
    ownership: RepresentationOwnership;
    value: RepresentationValue;
  };

export type SemanticType =
  | { tag: "representation"; representation: RepresentationType }
  | { tag: "proof"; proposition: Proposition }
  | {
    tag: "refinement";
    value: RepresentationType;
    proposition: Proposition;
    certificate: KernelCertificate;
  }
  | {
    tag: "logical_exists";
    witness: RepresentationType;
    proposition: Proposition;
  }
  | {
    tag: "computational_exists";
    witness: RepresentationType;
    payload: RepresentationType;
  };

export type ErasedDecision = { tag: "yes" } | { tag: "no" };

export type LogicalDecision =
  | { tag: "yes"; proposition: Proposition; proof: KernelCertificate }
  | { tag: "no"; proposition: Proposition; proof: KernelCertificate };

export type ComputationalPackage = {
  readonly __computational_package: unique symbol;
};

type PackageContents = {
  type: Extract<SemanticType, { tag: "computational_exists" }>;
  witness: RepresentationValue;
  payload: RepresentationValue;
};

const MAX_PROPOSITION_DEPTH = 256;
const MAX_RUNTIME_VALUE_DEPTH = 256;
const TRUSTED_SEMANTIC_TYPES = new WeakSet<object>();
const TRUSTED_DECISIONS = new WeakSet<object>();
const TRUSTED_PACKAGES = new WeakSet<object>();
const PACKAGE_CONTENTS = new WeakMap<object, PackageContents>();
const TRUSTED_OWNED_VALUES = new WeakSet<object>();
const OWNED_VALUE_TYPES = new WeakMap<
  object,
  Extract<RepresentationType, { tag: "owned" }>
>();
const CONSUMED_RUNTIME_VALUES = new WeakSet<object>();
const OPENED_LINEAR_PACKAGES = new WeakSet<object>();

export function representation_type(
  representation: RepresentationType,
): Extract<SemanticType, { tag: "representation" }> {
  const result = Object.freeze({
    tag: "representation",
    representation: snapshot_runtime_representation_type(representation),
  });
  TRUSTED_SEMANTIC_TYPES.add(result);
  return result;
}

export function proof_type(
  proposition: Proposition,
): Extract<SemanticType, { tag: "proof" }> {
  const result = Object.freeze({
    tag: "proof" as const,
    proposition: snapshot_proposition(proposition),
  });
  TRUSTED_SEMANTIC_TYPES.add(result);
  return result;
}

export function logical_existential_type(
  witness: RepresentationType,
  proposition: Proposition,
): Extract<SemanticType, { tag: "logical_exists" }> {
  const result = Object.freeze({
    tag: "logical_exists" as const,
    witness: snapshot_runtime_representation_type(witness),
    proposition: snapshot_proposition(proposition),
  });
  TRUSTED_SEMANTIC_TYPES.add(result);
  return result;
}

export function refinement_type(
  value: RepresentationType,
  proposition: Proposition,
  certificate: KernelCertificate,
): Extract<SemanticType, { tag: "refinement" }> {
  const stable_value = snapshot_runtime_representation_type(value);
  const stable_proposition = snapshot_proposition(proposition);
  const checked = check_certificate(certificate, stable_proposition, {
    require_safe: true,
  });
  const result = Object.freeze({
    tag: "refinement",
    value: stable_value,
    proposition: stable_proposition,
    certificate: checked,
  });
  TRUSTED_SEMANTIC_TYPES.add(result);
  return result;
}

export function weaken_refinement(type: SemanticType): RepresentationType {
  assert_trusted_semantic_type(type);
  if (type.tag === "refinement") return type.value;
  if (type.tag === "representation") return type.representation;
  throw new Error(`Cannot weaken non-runtime type ${type.tag}.`);
}

export function erase_semantic_type(
  type: SemanticType,
): RepresentationType | undefined {
  assert_trusted_semantic_type(type);
  switch (type.tag) {
    case "representation":
      return snapshot_runtime_representation_type(type.representation);
    case "refinement":
      return snapshot_runtime_representation_type(type.value);
    case "proof":
    case "logical_exists":
      return undefined;
    case "computational_exists":
      return Object.freeze({
        tag: "product",
        fields: Object.freeze([
          Object.freeze({
            label: "witness",
            type: snapshot_runtime_representation_type(type.witness),
          }),
          Object.freeze({
            label: "payload",
            type: snapshot_runtime_representation_type(type.payload),
          }),
        ]),
      });
  }
}

export function erase_decision(decision: LogicalDecision): ErasedDecision {
  assert_trusted_decision(decision);
  let expected: Proposition = decision.proposition;
  if (decision.tag === "no") {
    expected = { tag: "not", proposition: decision.proposition };
  }
  check_certificate(decision.proof, expected, { require_safe: true });
  if (decision.tag === "yes") return { tag: "yes" };
  return { tag: "no" };
}

export function yes_decision(
  proposition: Proposition,
  proof: KernelCertificate,
): LogicalDecision {
  const stable_proposition = snapshot_proposition(proposition);
  const checked = check_certificate(proof, stable_proposition, {
    require_safe: true,
  });
  const result = Object.freeze({
    tag: "yes" as const,
    proposition: stable_proposition,
    proof: checked,
  });
  TRUSTED_DECISIONS.add(result);
  return result;
}

export function no_decision(
  proposition: Proposition,
  proof: KernelCertificate,
): LogicalDecision {
  const stable_proposition = snapshot_proposition(proposition);
  const expected = {
    tag: "not" as const,
    proposition: stable_proposition,
  };
  const checked = check_certificate(proof, expected, { require_safe: true });
  const result = Object.freeze({
    tag: "no" as const,
    proposition: stable_proposition,
    proof: checked,
  });
  TRUSTED_DECISIONS.add(result);
  return result;
}

export function computational_existential_type(
  witness: RepresentationType,
  payload: RepresentationType,
): Extract<SemanticType, { tag: "computational_exists" }> {
  const result = Object.freeze({
    tag: "computational_exists",
    witness: snapshot_runtime_representation_type(witness),
    payload: snapshot_runtime_representation_type(payload),
  });
  TRUSTED_SEMANTIC_TYPES.add(result);
  return result;
}

export function owned_runtime_value(
  type: Extract<RepresentationType, { tag: "owned" }>,
  value: RepresentationValue,
): RepresentationValue {
  const stable_type = snapshot_runtime_representation_type(type) as Extract<
    RepresentationType,
    { tag: "owned" }
  >;
  const stable_value = snapshot_representation_value(stable_type.value, value);
  assert_unique_inputs_available(
    stable_type.value,
    stable_value,
    new WeakSet<object>(),
  );
  consume_unique_input(stable_type.value, stable_value);
  const result = Object.freeze({
    tag: "owned" as const,
    ownership: stable_type.ownership,
    value: stable_value,
  });
  TRUSTED_OWNED_VALUES.add(result);
  OWNED_VALUE_TYPES.set(result, stable_type);
  return result;
}

export function computational_existential_family_type(
  witness: RepresentationType,
  payloads: readonly RepresentationType[],
): Extract<SemanticType, { tag: "computational_exists" }> {
  const payload_entries = snapshot_data_array<RepresentationType>(
    payloads,
    "Computational existential payload layouts",
  );
  expect(
    payload_entries.length > 0,
    "Computational existential needs a payload layout.",
  );
  const stable_payloads = payload_entries.map((payload) =>
    snapshot_runtime_representation_type(payload)
  );
  const first = stable_payloads[0];
  expect(
    first !== undefined,
    "Computational existential needs a payload layout.",
  );
  for (const payload of stable_payloads.slice(1)) {
    expect(
      same_representation_type(first, payload),
      "Computational existential has non-uniform payload layouts.",
    );
  }
  return computational_existential_type(witness, first);
}

export function pack_computational_existential(
  type: SemanticType,
  witness: RepresentationValue,
  payload: RepresentationValue,
): ComputationalPackage {
  assert_trusted_semantic_type(type);
  expect(
    type.tag === "computational_exists",
    "Expected a computational existential type.",
  );
  const stable_witness = snapshot_representation_value(type.witness, witness);
  const stable_payload = snapshot_representation_value(type.payload, payload);
  const available = new WeakSet<object>();
  assert_unique_inputs_available(type.witness, stable_witness, available);
  assert_unique_inputs_available(type.payload, stable_payload, available);
  consume_unique_input(type.witness, stable_witness);
  consume_unique_input(type.payload, stable_payload);
  const package_handle = Object.freeze({}) as ComputationalPackage;
  TRUSTED_PACKAGES.add(package_handle);
  PACKAGE_CONTENTS.set(
    package_handle,
    Object.freeze({
      type,
      witness: stable_witness,
      payload: stable_payload,
    }),
  );
  return package_handle;
}

export function open_computational_existential(
  package_value: ComputationalPackage,
): {
  type: Extract<SemanticType, { tag: "computational_exists" }>;
  witness: RepresentationValue;
  payload: RepresentationValue;
} {
  expect(
    package_value !== null && typeof package_value === "object" &&
      TRUSTED_PACKAGES.has(package_value),
    "Computational existential package is not sealed.",
  );
  const contents = PACKAGE_CONTENTS.get(package_value);
  expect(
    contents !== undefined,
    "Computational package contents are unavailable.",
  );
  const type = contents.type;
  if (
    has_unique_or_linear_layout(type.witness) ||
    has_unique_or_linear_layout(type.payload)
  ) {
    expect(
      !OPENED_LINEAR_PACKAGES.has(package_value),
      "Unique computational existential package was already opened.",
    );
    OPENED_LINEAR_PACKAGES.add(package_value);
  }
  return Object.freeze({
    type: contents.type,
    witness: contents.witness,
    payload: contents.payload,
  });
}

function snapshot_representation_value(
  type: RepresentationType,
  value: RepresentationValue,
  depth = 0,
  active = new WeakSet<object>(),
): RepresentationValue {
  expect(depth <= MAX_RUNTIME_VALUE_DEPTH, "Runtime value is too deep.");
  assert_plain_runtime_record(value);
  const value_tag = read_required_own_data<RepresentationValue["tag"]>(
    value,
    "tag",
  );
  expect(!active.has(value), "Cyclic runtime value.");
  active.add(value);
  switch (type.tag) {
    case "never":
      throw new Error("Never has no runtime value.");
    case "scalar": {
      if (type.name === "Unit") {
        expect(
          value_tag === "unit",
          "Runtime value does not match Unit layout.",
        );
        active.delete(value);
        return Object.freeze({ tag: "unit" });
      }
      const scalar_type = read_required_own_data<string>(value, "type");
      const scalar_value = read_required_own_data<
        string | number | bigint | boolean
      >(value, "value");
      expect(
        value_tag === "scalar" && scalar_type === type.name,
        `Runtime value does not match scalar layout ${type.name}.`,
      );
      expect(
        scalar_value_matches(type.name, scalar_value),
        `Scalar runtime value does not match ${type.name}.`,
      );
      active.delete(value);
      return Object.freeze({
        tag: "scalar",
        type: scalar_type,
        value: scalar_value,
      });
    }
    case "integer": {
      const name = integer_type_name(type);
      const scalar_type = read_required_own_data<string>(value, "type");
      const scalar_value = read_required_own_data<
        string | number | bigint | boolean
      >(value, "value");
      expect(
        value_tag === "scalar" && scalar_type === name,
        `Runtime value does not match integer layout ${name}.`,
      );
      expect(
        integer_value_matches(type.signed, type.width, scalar_value),
        `Scalar runtime value does not match ${name}.`,
      );
      active.delete(value);
      return Object.freeze({
        tag: "scalar",
        type: scalar_type,
        value: scalar_value,
      });
    }
    case "named": {
      const name = read_required_own_data<string>(value, "name");
      const opaque_value = read_required_own_data<
        string | number | bigint | boolean
      >(value, "value");
      expect(
        value_tag === "opaque" && name === type.name,
        `Runtime value does not match opaque layout ${type.name}.`,
      );
      expect(
        is_runtime_primitive(opaque_value),
        "Opaque runtime value must be primitive.",
      );
      active.delete(value);
      return Object.freeze({
        tag: "opaque",
        name,
        value: opaque_value,
      });
    }
    case "product": {
      return snapshot_aggregate_value(
        type.fields,
        value,
        value_tag,
        depth,
        active,
      );
    }
    case "record": {
      return snapshot_aggregate_value(
        type.fields,
        value,
        value_tag,
        depth,
        active,
      );
    }
    case "fixed_array": {
      expect(
        value_tag === "product",
        "Runtime value does not match fixed array layout.",
      );
      const fields = snapshot_data_array<RepresentationValue>(
        read_required_own_data<readonly RepresentationValue[]>(
          value,
          "fields",
        ),
        "Runtime aggregate fields",
      );
      expect(
        fields.length === type.length,
        "Runtime fixed array length does not match its layout.",
      );
      const elements = fields.map((element) =>
        snapshot_representation_value(
          type.element,
          element,
          depth + 1,
          active,
        )
      );
      active.delete(value);
      return Object.freeze({
        tag: "product",
        fields: Object.freeze(elements),
      });
    }
    case "sum": {
      const case_name = read_required_own_data<string>(value, "case");
      const runtime_payload = read_required_own_data<RepresentationValue>(
        value,
        "payload",
      );
      expect(
        value_tag === "sum",
        "Runtime value does not match sum layout.",
      );
      expect(
        runtime_payload !== null && typeof runtime_payload === "object",
        "Runtime sum payload is required.",
      );
      const current = type.cases.find((candidate) =>
        candidate.label === case_name
      );
      expect(current !== undefined, `Unknown runtime sum case ${case_name}.`);
      const payload = snapshot_representation_value(
        current.payload,
        runtime_payload,
        depth + 1,
        active,
      );
      active.delete(value);
      return Object.freeze({
        tag: "sum",
        case: case_name,
        payload,
      });
    }
    case "function":
      expect(
        value_tag === "function",
        "Runtime value does not match function layout.",
      );
      active.delete(value);
      return Object.freeze({ tag: "function" });
    case "owned": {
      const ownership = read_required_own_data<RepresentationOwnership>(
        value,
        "ownership",
      );
      read_required_own_data<RepresentationValue>(value, "value");
      assert_owned_handle_layout(type, value);
      expect(
        value_tag === "owned" && ownership === type.ownership,
        "Runtime ownership does not match its representation.",
      );
      active.delete(value);
      return value;
    }
    case "variable":
    case "rigid":
    case "forall":
    case "top":
    case "type_value":
    case "union":
    case "intersection":
    case "difference":
      throw new Error(
        `Representation type ${type.tag} is not a concrete runtime layout.`,
      );
  }
}

function snapshot_aggregate_value(
  fields: readonly RepresentationProductField[],
  value: RepresentationValue,
  value_tag: RepresentationValue["tag"],
  depth: number,
  active: WeakSet<object>,
): RepresentationValue {
  expect(
    value_tag === "product",
    "Runtime value does not match aggregate layout.",
  );
  const actual_fields = snapshot_data_array<RepresentationValue>(
    read_required_own_data<readonly RepresentationValue[]>(value, "fields"),
    "Runtime aggregate fields",
  );
  expect(
    actual_fields.length === fields.length,
    "Runtime aggregate field count does not match its layout.",
  );
  const stable_fields: RepresentationValue[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const actual = actual_fields[index];
    expect(
      field !== undefined && actual !== undefined,
      "Missing runtime aggregate field.",
    );
    stable_fields.push(
      snapshot_representation_value(field.type, actual, depth + 1, active),
    );
  }
  active.delete(value);
  return Object.freeze({
    tag: "product",
    fields: Object.freeze(stable_fields),
  });
}

function snapshot_proposition(
  proposition: Proposition,
  depth = 0,
): Proposition {
  expect(depth <= MAX_PROPOSITION_DEPTH, "Refinement proposition is too deep.");
  if (proposition === null || typeof proposition !== "object") {
    throw new Error("Invalid refinement proposition.");
  }
  assert_plain_proposition_record(proposition);
  const proposition_tag = read_required_own_data<Proposition["tag"]>(
    proposition,
    "tag",
  );
  switch (proposition_tag) {
    case "true":
      return Object.freeze({ tag: "true" });
    case "false":
      return Object.freeze({ tag: "false" });
    case "atom":
      return Object.freeze({
        tag: "atom",
        name: require_text(
          read_required_own_data<string>(proposition, "name"),
          "Atom name",
        ),
      });
    case "equal":
      return Object.freeze({
        tag: "equal",
        left: require_text(
          read_required_own_data<string>(proposition, "left"),
          "Equality left term",
        ),
        right: require_text(
          read_required_own_data<string>(proposition, "right"),
          "Equality right term",
        ),
      });
    case "and":
    case "or":
      return Object.freeze({
        tag: proposition_tag,
        left: snapshot_proposition(
          read_required_own_data<Proposition>(proposition, "left"),
          depth + 1,
        ),
        right: snapshot_proposition(
          read_required_own_data<Proposition>(proposition, "right"),
          depth + 1,
        ),
      });
    case "implies":
      return Object.freeze({
        tag: "implies",
        premise: snapshot_proposition(
          read_required_own_data<Proposition>(proposition, "premise"),
          depth + 1,
        ),
        conclusion: snapshot_proposition(
          read_required_own_data<Proposition>(proposition, "conclusion"),
          depth + 1,
        ),
      });
    case "not":
      return Object.freeze({
        tag: "not",
        proposition: snapshot_proposition(
          read_required_own_data<Proposition>(proposition, "proposition"),
          depth + 1,
        ),
      });
    default:
      throw new Error("Invalid refinement proposition tag.");
  }
}

function require_text(value: string, label: string): string {
  expect(
    typeof value === "string" && value.length > 0,
    `${label} must not be empty.`,
  );
  return value;
}

function read_required_own_data<T>(value: object, key: string): T {
  return require_own_data(value, key).value as T;
}

function assert_plain_proposition_record(value: object): void {
  const prototype = Object.getPrototypeOf(value);
  expect(
    prototype === Object.prototype || prototype === null,
    "Refinement proposition must be a plain record.",
  );
  for (const key of Reflect.ownKeys(value)) {
    expect(
      typeof key === "string",
      "Refinement proposition cannot contain symbols.",
    );
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(
      descriptor !== undefined && descriptor.get === undefined &&
        descriptor.set === undefined,
      "Refinement proposition cannot contain accessor properties.",
    );
  }
}

function is_runtime_primitive(
  value: unknown,
): value is string | number | bigint | boolean {
  return typeof value === "string" || typeof value === "number" ||
    typeof value === "bigint" || typeof value === "boolean";
}

function scalar_value_matches(
  name: string,
  value: string | number | bigint | boolean,
): boolean {
  if (name === "Bool") return typeof value === "boolean";
  if (name === "Text") return typeof value === "string";
  if (name === "Char") {
    return typeof value === "string" && Array.from(value).length === 1;
  }
  if (name === "I64") {
    return typeof value === "bigint" &&
      value >= -(1n << 63n) && value <= (1n << 63n) - 1n;
  }
  if (name === "I32") {
    return typeof value === "number" && Number.isInteger(value) &&
      Number.isFinite(value) && value >= -(2 ** 31) && value <= 2 ** 31 - 1;
  }
  if (name === "U32") {
    return typeof value === "number" && Number.isInteger(value) &&
      Number.isFinite(value) && value >= 0 && value <= 2 ** 32 - 1;
  }
  if (name === "Int") {
    return typeof value === "number" && Number.isSafeInteger(value);
  }
  if (name === "F32" || name === "F64") {
    if (typeof value !== "number") return false;
    if (Number.isNaN(value)) return true;
    if (name === "F32") return Math.fround(value) === value;
    return true;
  }
  return is_runtime_primitive(value);
}

function integer_value_matches(
  signed: boolean,
  width: number,
  value: string | number | bigint | boolean,
): boolean {
  if (width <= 32) {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) return false;
  } else {
    if (typeof value !== "bigint") return false;
  }
  const integer = BigInt(value);
  if (signed) {
    const limit = 1n << BigInt(width - 1);
    return integer >= -limit && integer < limit;
  }
  return integer >= 0n && integer < (1n << BigInt(width));
}

function has_unique_or_linear_layout(type: RepresentationType): boolean {
  switch (type.tag) {
    case "owned": {
      return is_consuming_ownership(type.ownership) ||
        has_unique_or_linear_layout(type.value);
    }
    case "product":
      return type.fields.some((field) =>
        has_unique_or_linear_layout(field.type)
      );
    case "record":
      return type.fields.some((field) =>
        has_unique_or_linear_layout(field.type)
      );
    case "fixed_array":
      return has_unique_or_linear_layout(type.element);
    case "sum":
      return type.cases.some((current) =>
        has_unique_or_linear_layout(current.payload)
      );
    case "function":
      return type.params.some(has_unique_or_linear_layout) ||
        has_unique_or_linear_layout(type.result);
    case "never":
    case "scalar":
    case "integer":
    case "named":
      return false;
    case "variable":
    case "rigid":
    case "forall":
    case "top":
    case "type_value":
    case "union":
    case "intersection":
    case "difference":
      throw new Error(
        `Representation type ${type.tag} is not a concrete runtime layout.`,
      );
  }
}

function assert_owned_handle_layout(
  type: Extract<RepresentationType, { tag: "owned" }>,
  value: RepresentationValue,
): asserts value is Extract<RepresentationValue, { tag: "owned" }> {
  expect(
    value !== null && typeof value === "object" &&
      TRUSTED_OWNED_VALUES.has(value),
    "Owned runtime value is not a sealed handle.",
  );
  const canonical = OWNED_VALUE_TYPES.get(value);
  expect(
    canonical !== undefined,
    "Owned runtime value has no canonical layout.",
  );
  expect(
    same_representation_type(canonical, type),
    "Owned runtime value layout does not match its expected type.",
  );
}

function assert_unique_inputs_available(
  type: RepresentationType,
  value: RepresentationValue,
  seen: WeakSet<object>,
): void {
  switch (type.tag) {
    case "owned": {
      assert_owned_handle_layout(type, value);
      if (is_consuming_ownership(type.ownership)) {
        expect(
          !seen.has(value),
          "Unique runtime value appears more than once.",
        );
        expect(
          !CONSUMED_RUNTIME_VALUES.has(value),
          "Unique runtime value was already consumed.",
        );
        seen.add(value);
      }
      const owned_value = value as Extract<
        RepresentationValue,
        { tag: "owned" }
      >;
      assert_unique_inputs_available(type.value, owned_value.value, seen);
      return;
    }
    case "product":
      expect(value.tag === "product", "Product runtime value is required.");
      {
        const fields = snapshot_data_array<RepresentationValue>(
          value.fields,
          "Runtime aggregate fields",
        );
        for (let index = 0; index < type.fields.length; index += 1) {
          const field = type.fields[index];
          const actual = fields[index];
          expect(
            field !== undefined && actual !== undefined,
            "Missing runtime product field.",
          );
          assert_unique_inputs_available(field.type, actual, seen);
        }
      }
      return;
    case "record":
      expect(value.tag === "product", "Record runtime value is required.");
      {
        const fields = snapshot_data_array<RepresentationValue>(
          value.fields,
          "Runtime aggregate fields",
        );
        for (let index = 0; index < type.fields.length; index += 1) {
          const field = type.fields[index];
          const actual = fields[index];
          expect(
            field !== undefined && actual !== undefined,
            "Missing runtime record field.",
          );
          assert_unique_inputs_available(field.type, actual, seen);
        }
      }
      return;
    case "fixed_array": {
      expect(value.tag === "product", "Fixed array runtime value is required.");
      const fields = snapshot_data_array<RepresentationValue>(
        value.fields,
        "Runtime aggregate fields",
      );
      expect(
        fields.length === type.length,
        "Runtime fixed array length does not match its layout.",
      );
      for (const element of fields) {
        assert_unique_inputs_available(type.element, element, seen);
      }
      return;
    }
    case "sum": {
      expect(value.tag === "sum", "Sum runtime value is required.");
      const current = type.cases.find((candidate) =>
        candidate.label === value.case
      );
      expect(current !== undefined, `Unknown runtime sum case ${value.case}.`);
      assert_unique_inputs_available(current.payload, value.payload, seen);
      return;
    }
    case "function":
    case "never":
    case "scalar":
    case "integer":
    case "named":
      return;
    case "variable":
    case "rigid":
    case "forall":
    case "top":
    case "type_value":
    case "union":
    case "intersection":
    case "difference":
      throw new Error(
        `Representation type ${type.tag} is not a concrete runtime layout.`,
      );
  }
}

function consume_unique_input(
  type: RepresentationType,
  value: RepresentationValue,
): void {
  switch (type.tag) {
    case "owned": {
      assert_owned_handle_layout(type, value);
      expect(value.tag === "owned", "Owned runtime value must be an object.");
      if (is_consuming_ownership(type.ownership)) {
        expect(
          !CONSUMED_RUNTIME_VALUES.has(value),
          "Unique runtime value was already consumed.",
        );
        CONSUMED_RUNTIME_VALUES.add(value);
      }
      consume_unique_input(type.value, value.value);
      return;
    }
    case "product":
      expect(value.tag === "product", "Product runtime value is required.");
      for (let index = 0; index < type.fields.length; index += 1) {
        const field = type.fields[index];
        const actual = value.fields[index];
        expect(
          field !== undefined && actual !== undefined,
          "Missing runtime product field.",
        );
        consume_unique_input(field.type, actual);
      }
      return;
    case "record":
      expect(value.tag === "product", "Record runtime value is required.");
      for (let index = 0; index < type.fields.length; index += 1) {
        const field = type.fields[index];
        const actual = value.fields[index];
        expect(
          field !== undefined && actual !== undefined,
          "Missing runtime record field.",
        );
        consume_unique_input(field.type, actual);
      }
      return;
    case "fixed_array":
      expect(value.tag === "product", "Fixed array runtime value is required.");
      expect(
        value.fields.length === type.length,
        "Runtime fixed array length does not match its layout.",
      );
      for (const element of value.fields) {
        consume_unique_input(type.element, element);
      }
      return;
    case "sum": {
      expect(value.tag === "sum", "Sum runtime value is required.");
      const current = type.cases.find((candidate) =>
        candidate.label === value.case
      );
      expect(current !== undefined, `Unknown runtime sum case ${value.case}.`);
      consume_unique_input(current.payload, value.payload);
      return;
    }
    case "function":
    case "never":
    case "scalar":
    case "integer":
    case "named":
      return;
    case "variable":
    case "rigid":
    case "forall":
    case "top":
    case "type_value":
    case "union":
    case "intersection":
    case "difference":
      throw new Error(
        `Representation type ${type.tag} is not a concrete runtime layout.`,
      );
  }
}

function assert_plain_runtime_record(value: RepresentationValue): void {
  expect(
    value !== null && typeof value === "object",
    "Runtime value must be an object.",
  );
  const prototype = Object.getPrototypeOf(value);
  expect(
    prototype === Object.prototype || prototype === null,
    "Runtime value must be a plain record.",
  );
  for (const key of Reflect.ownKeys(value)) {
    expect(
      typeof key === "string",
      "Runtime value cannot contain symbol properties.",
    );
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(
      descriptor !== undefined && descriptor.get === undefined &&
        descriptor.set === undefined,
      "Runtime value cannot contain accessor properties.",
    );
  }
}

function snapshot_data_array<Value>(
  value: readonly Value[],
  label: string,
): readonly Value[] {
  expect(Array.isArray(value), `${label} must be an array.`);
  expect(
    Object.getPrototypeOf(value) === Array.prototype,
    `${label} must be an ordinary array.`,
  );
  const length_descriptor = Object.getOwnPropertyDescriptor(value, "length");
  expect(
    length_descriptor !== undefined &&
      length_descriptor.get === undefined &&
      length_descriptor.set === undefined &&
      Number.isSafeInteger(length_descriptor.value) &&
      length_descriptor.value >= 0,
    `${label} length must be an own data property.`,
  );
  const length = length_descriptor.value as number;
  for (const key of Reflect.ownKeys(value)) {
    expect(
      typeof key === "string",
      `${label} cannot contain symbol properties.`,
    );
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(
      descriptor !== undefined && descriptor.get === undefined &&
        descriptor.set === undefined,
      `${label} properties must be data properties.`,
    );
    if (key === "length") continue;
    const index = Number(key);
    expect(
      Number.isSafeInteger(index) && index >= 0 &&
        index < length && String(index) === key,
      `${label} contains invalid property ${key}.`,
    );
  }
  const snapshot: Value[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    expect(
      descriptor !== undefined && descriptor.get === undefined &&
        descriptor.set === undefined,
      `${label} cannot contain holes.`,
    );
    snapshot.push(descriptor.value as Value);
  }
  return Object.freeze(snapshot);
}

function require_own_data(value: object, key: string): PropertyDescriptor {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  expect(
    descriptor !== undefined,
    `Missing own layout property ${key}.`,
  );
  expect(
    descriptor.get === undefined && descriptor.set === undefined,
    `Layout property ${key} must be an own data property.`,
  );
  return descriptor;
}

function is_consuming_ownership(
  ownership: RepresentationOwnership,
): boolean {
  return ownership === "ownership_transfer" || ownership === "unique_heap";
}

function assert_trusted_semantic_type(type: SemanticType): void {
  expect(
    type !== null && typeof type === "object" &&
      TRUSTED_SEMANTIC_TYPES.has(type),
    "Semantic type is not sealed by the refinement layer.",
  );
}

function assert_trusted_decision(decision: LogicalDecision): void {
  expect(
    decision !== null && typeof decision === "object" &&
      TRUSTED_DECISIONS.has(decision),
    "Logical decision is not sealed by the refinement layer.",
  );
}

export function refinement_proves(
  type: SemanticType,
  proposition: Proposition,
): boolean {
  assert_trusted_semantic_type(type);
  if (type.tag !== "refinement") return false;
  const stable = snapshot_proposition(proposition);
  check_certificate(type.certificate, type.proposition, { require_safe: true });
  return proposition_equal(type.proposition, stable) &&
    proposition_equal(type.certificate.proposition, stable);
}
