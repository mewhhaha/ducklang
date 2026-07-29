import { expect } from "../expect.ts";
import { integer_type_name } from "../integer.ts";
import {
  check_certificate,
  type KernelCertificate,
  type Proposition,
  proposition_equal,
} from "./proof_kernel.ts";
import {
  type RepresentationEffect,
  type RepresentationOwnership,
  type RepresentationProductField,
  type RepresentationRecordField,
  type RepresentationScalar,
  type RepresentationSumCase,
  type RepresentationType,
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
const MAX_REPRESENTATION_DEPTH = 256;
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
    representation: snapshot_representation(representation),
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
    witness: snapshot_representation(witness),
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
  const stable_value = snapshot_representation(value);
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
      return snapshot_representation(type.representation);
    case "refinement":
      return snapshot_representation(type.value);
    case "proof":
    case "logical_exists":
      return undefined;
    case "computational_exists":
      return Object.freeze({
        tag: "product",
        fields: Object.freeze([
          Object.freeze({
            label: "witness",
            type: snapshot_representation(type.witness),
          }),
          Object.freeze({
            label: "payload",
            type: snapshot_representation(type.payload),
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
    witness: snapshot_representation(witness),
    payload: snapshot_representation(payload),
  });
  TRUSTED_SEMANTIC_TYPES.add(result);
  return result;
}

export function owned_runtime_value(
  type: Extract<RepresentationType, { tag: "owned" }>,
  value: RepresentationValue,
): RepresentationValue {
  validate_ownership(type.ownership);
  const stable_type = snapshot_representation(type) as Extract<
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
    ownership: type.ownership,
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
  expect(
    payloads.length > 0,
    "Computational existential needs a payload layout.",
  );
  const stable_payloads = payloads.map((payload) =>
    snapshot_representation(payload)
  );
  const first = stable_payloads[0];
  expect(
    first !== undefined,
    "Computational existential needs a payload layout.",
  );
  for (const payload of stable_payloads.slice(1)) {
    expect(
      representation_equal(first, payload),
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

function snapshot_representation(
  type: RepresentationType,
  depth = 0,
  active = new WeakSet<object>(),
): RepresentationType {
  expect(depth <= MAX_REPRESENTATION_DEPTH, "Representation type is too deep.");
  expect(
    type !== null && typeof type === "object",
    "Invalid representation type.",
  );
  assert_plain_representation_record(type);
  require_own_data(type, "tag");
  expect(!active.has(type), "Cyclic representation type.");
  active.add(type);
  let result: RepresentationType;
  switch (type.tag) {
    case "never":
      result = { tag: "never" };
      break;
    case "scalar": {
      require_own_data(type, "name");
      const name = require_text(type.name, "Scalar name");
      validate_scalar(name);
      result = { tag: "scalar", name };
      break;
    }
    case "integer":
      require_own_data(type, "signed");
      require_own_data(type, "width");
      expect(
        typeof type.signed === "boolean",
        "Integer signedness is invalid.",
      );
      expect(
        Number.isSafeInteger(type.width) &&
          type.width > 0 &&
          type.width <= 64,
        `Integer width ${String(type.width)} is invalid.`,
      );
      result = {
        tag: "integer",
        signed: type.signed,
        width: type.width,
      };
      break;
    case "named":
      require_own_data(type, "name");
      require_own_data(type, "args");
      assert_plain_representation_array(type.args);
      result = {
        tag: "named",
        name: require_text(type.name, "Named representation"),
        args: Object.freeze(
          type.args.map((arg) =>
            snapshot_representation(arg, depth + 1, active)
          ),
        ),
      };
      break;
    case "product": {
      require_own_data(type, "fields");
      assert_plain_representation_array(type.fields);
      assert_unique_field_labels(type.fields);
      result = {
        tag: "product",
        fields: Object.freeze(type.fields.map((field) =>
          Object.freeze({
            label: field_label(read_optional_own_data<string>(field, "label")),
            type: snapshot_representation(
              read_required_own_data<RepresentationType>(field, "type"),
              depth + 1,
              active,
            ),
          })
        )),
      };
      break;
    }
    case "record": {
      require_own_data(type, "fields");
      assert_plain_representation_array(type.fields);
      assert_unique_record_labels(type.fields);
      result = {
        tag: "record",
        fields: Object.freeze(type.fields.map((field) =>
          Object.freeze({
            label: require_text(
              read_required_own_data<string>(field, "label"),
              "Record field label",
            ),
            type: snapshot_representation(
              read_required_own_data<RepresentationType>(field, "type"),
              depth + 1,
              active,
            ),
          })
        )),
      };
      break;
    }
    case "fixed_array":
      require_own_data(type, "length");
      require_own_data(type, "element");
      expect(
        Number.isSafeInteger(type.length) && type.length >= 0,
        `Fixed array length ${String(type.length)} is invalid.`,
      );
      result = {
        tag: "fixed_array",
        length: type.length,
        element: snapshot_representation(type.element, depth + 1, active),
      };
      break;
    case "sum": {
      require_own_data(type, "cases");
      assert_plain_representation_array(type.cases);
      assert_unique_case_labels(type.cases);
      result = {
        tag: "sum",
        cases: Object.freeze(type.cases.map((current) =>
          Object.freeze({
            label: require_text(
              read_required_own_data<string>(current, "label"),
              "Case label",
            ),
            payload: snapshot_representation(
              read_required_own_data<RepresentationType>(current, "payload"),
              depth + 1,
              active,
            ),
          })
        )),
      };
      break;
    }
    case "function":
      require_own_data(type, "params");
      require_own_data(type, "effects");
      require_own_data(type, "result");
      assert_plain_representation_array(type.params);
      assert_plain_representation_array(type.effects);
      result = {
        tag: "function",
        params: Object.freeze(
          type.params.map((parameter) =>
            snapshot_representation(parameter, depth + 1, active)
          ),
        ),
        effects: Object.freeze(
          type.effects.map((effect) => snapshot_representation_effect(effect)),
        ),
        result: snapshot_representation(type.result, depth + 1, active),
      };
      break;
    case "owned": {
      require_own_data(type, "ownership");
      require_own_data(type, "value");
      validate_ownership(type.ownership);
      result = {
        tag: "owned",
        ownership: type.ownership,
        value: snapshot_representation(type.value, depth + 1, active),
      };
      break;
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
    default:
      throw new Error("Invalid representation type.");
  }
  active.delete(type);
  return Object.freeze(result);
}

function snapshot_representation_value(
  type: RepresentationType,
  value: RepresentationValue,
  depth = 0,
  active = new WeakSet<object>(),
): RepresentationValue {
  expect(depth <= MAX_RUNTIME_VALUE_DEPTH, "Runtime value is too deep.");
  assert_plain_runtime_record(value);
  require_own_data(value, "tag");
  expect(!active.has(value), "Cyclic runtime value.");
  active.add(value);
  switch (type.tag) {
    case "never":
      throw new Error("Never has no runtime value.");
    case "scalar":
      if (type.name === "Unit") {
        expect(
          value.tag === "unit",
          "Runtime value does not match Unit layout.",
        );
        active.delete(value);
        return Object.freeze({ tag: "unit" });
      }
      require_own_data(value, "type");
      require_own_data(value, "value");
      expect(
        value.tag === "scalar" && value.type === type.name,
        `Runtime value does not match scalar layout ${type.name}.`,
      );
      expect(
        scalar_value_matches(type.name, value.value),
        `Scalar runtime value does not match ${type.name}.`,
      );
      active.delete(value);
      return Object.freeze({
        tag: "scalar",
        type: value.type,
        value: value.value,
      });
    case "integer": {
      const name = integer_type_name(type);
      require_own_data(value, "type");
      require_own_data(value, "value");
      expect(
        value.tag === "scalar" && value.type === name,
        `Runtime value does not match integer layout ${name}.`,
      );
      expect(
        integer_value_matches(type.signed, type.width, value.value),
        `Scalar runtime value does not match ${name}.`,
      );
      active.delete(value);
      return Object.freeze({
        tag: "scalar",
        type: value.type,
        value: value.value,
      });
    }
    case "named":
      require_own_data(value, "name");
      require_own_data(value, "value");
      expect(
        value.tag === "opaque" && value.name === type.name,
        `Runtime value does not match opaque layout ${type.name}.`,
      );
      expect(
        is_runtime_primitive(value.value),
        "Opaque runtime value must be primitive.",
      );
      active.delete(value);
      return Object.freeze({
        tag: "opaque",
        name: value.name,
        value: value.value,
      });
    case "product": {
      return snapshot_aggregate_value(type.fields, value, depth, active);
    }
    case "record": {
      return snapshot_aggregate_value(type.fields, value, depth, active);
    }
    case "fixed_array": {
      require_own_data(value, "fields");
      expect(
        value.tag === "product",
        "Runtime value does not match fixed array layout.",
      );
      assert_plain_runtime_array(value.fields);
      expect(
        value.fields.length === type.length,
        "Runtime fixed array length does not match its layout.",
      );
      const elements = value.fields.map((element) =>
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
      require_own_data(value, "case");
      require_own_data(value, "payload");
      expect(value.tag === "sum", "Runtime value does not match sum layout.");
      expect(
        value.payload !== null && typeof value.payload === "object",
        "Runtime sum payload is required.",
      );
      const current = type.cases.find((candidate) =>
        candidate.label === value.case
      );
      expect(current !== undefined, `Unknown runtime sum case ${value.case}.`);
      const payload = snapshot_representation_value(
        current.payload,
        value.payload,
        depth + 1,
        active,
      );
      active.delete(value);
      return Object.freeze({
        tag: "sum",
        case: value.case,
        payload,
      });
    }
    case "function":
      expect(
        value.tag === "function",
        "Runtime value does not match function layout.",
      );
      active.delete(value);
      return Object.freeze({ tag: "function" });
    case "owned": {
      require_own_data(value, "ownership");
      require_own_data(value, "value");
      assert_owned_handle_layout(type, value);
      expect(
        value.tag === "owned" && value.ownership === type.ownership,
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
  depth: number,
  active: WeakSet<object>,
): RepresentationValue {
  require_own_data(value, "fields");
  expect(
    value.tag === "product",
    "Runtime value does not match aggregate layout.",
  );
  expect(
    Array.isArray(value.fields),
    "Runtime aggregate fields must be an array.",
  );
  assert_plain_runtime_array(value.fields);
  expect(
    value.fields.length === fields.length,
    "Runtime aggregate field count does not match its layout.",
  );
  const stable_fields: RepresentationValue[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const actual = value.fields[index];
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

function representation_equal(
  left: RepresentationType,
  right: RepresentationType,
): boolean {
  if (left.tag !== right.tag) return false;
  switch (left.tag) {
    case "never":
      return true;
    case "scalar":
      return left.name === (right as typeof left).name;
    case "integer": {
      const other = right as Extract<RepresentationType, { tag: "integer" }>;
      return left.signed === other.signed && left.width === other.width;
    }
    case "named": {
      const other = right as Extract<RepresentationType, { tag: "named" }>;
      if (left.name !== other.name || left.args.length !== other.args.length) {
        return false;
      }
      return left.args.every((arg, index) => {
        const candidate = other.args[index];
        return candidate !== undefined &&
          representation_equal(arg, candidate);
      });
    }
    case "product": {
      const other = right as Extract<RepresentationType, { tag: "product" }>;
      if (left.fields.length !== other.fields.length) return false;
      for (let index = 0; index < left.fields.length; index += 1) {
        const field = left.fields[index];
        const candidate = other.fields[index];
        if (field === undefined || candidate === undefined) return false;
        if (
          field.label !== candidate.label ||
          !representation_equal(field.type, candidate.type)
        ) {
          return false;
        }
      }
      return true;
    }
    case "record": {
      const other = right as Extract<RepresentationType, { tag: "record" }>;
      if (left.fields.length !== other.fields.length) return false;
      return left.fields.every((field, index) => {
        const candidate = other.fields[index];
        return candidate !== undefined &&
          field.label === candidate.label &&
          representation_equal(field.type, candidate.type);
      });
    }
    case "fixed_array": {
      const other = right as Extract<
        RepresentationType,
        { tag: "fixed_array" }
      >;
      return left.length === other.length &&
        representation_equal(left.element, other.element);
    }
    case "sum": {
      const other = right as Extract<RepresentationType, { tag: "sum" }>;
      if (left.cases.length !== other.cases.length) return false;
      for (let index = 0; index < left.cases.length; index += 1) {
        const current = left.cases[index];
        const candidate = other.cases[index];
        if (current === undefined || candidate === undefined) return false;
        if (
          current.label !== candidate.label ||
          !representation_equal(current.payload, candidate.payload)
        ) {
          return false;
        }
      }
      return true;
    }
    case "function": {
      const other = right as Extract<RepresentationType, { tag: "function" }>;
      if (left.params.length !== other.params.length) return false;
      for (let index = 0; index < left.params.length; index += 1) {
        const parameter = left.params[index];
        const candidate = other.params[index];
        if (parameter === undefined || candidate === undefined) return false;
        if (!representation_equal(parameter, candidate)) return false;
      }
      if (!representation_effects_equal(left.effects, other.effects)) {
        return false;
      }
      return representation_equal(left.result, other.result);
    }
    case "owned": {
      const other = right as Extract<RepresentationType, { tag: "owned" }>;
      return left.ownership === other.ownership &&
        representation_equal(left.value, other.value);
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
        `Representation type ${left.tag} is not a concrete runtime layout.`,
      );
  }
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
  require_own_data(proposition, "tag");
  switch (proposition.tag) {
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
        tag: proposition.tag,
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

function field_label(label: string | undefined): string | undefined {
  if (label === undefined) return undefined;
  return require_text(label, "Field label");
}

function snapshot_representation_effect(
  effect: RepresentationEffect,
): RepresentationEffect {
  assert_plain_layout_entry(effect);
  const effect_name = require_text(
    read_required_own_data<string>(effect, "effect"),
    "Effect name",
  );
  const operation = read_required_own_data<string | undefined>(
    effect,
    "operation",
  );
  if (operation !== undefined) {
    require_text(operation, "Effect operation");
  }
  return Object.freeze({ effect: effect_name, operation });
}

function representation_effects_equal(
  left: readonly RepresentationEffect[],
  right: readonly RepresentationEffect[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((effect, index) => {
    const candidate = right[index];
    return candidate !== undefined &&
      effect.effect === candidate.effect &&
      effect.operation === candidate.operation;
  });
}

function validate_scalar(name: string): asserts name is RepresentationScalar {
  const valid = name === "Bool" || name === "Char" || name === "Unit" ||
    name === "Int" || name === "I32" || name === "U32" ||
    name === "I64" || name === "F32" || name === "F64" ||
    name === "F32x4" || name === "Text" || name === "Bytes" ||
    name === "Resume" || name === "Type";
  expect(valid, `Invalid representation scalar ${name}.`);
}

function read_required_own_data<T>(value: object, key: string): T {
  require_own_data(value, key);
  return (value as Record<string, unknown>)[key] as T;
}

function read_optional_own_data<T>(value: object, key: string): T | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return undefined;
  require_own_data(value, key);
  return (value as Record<string, unknown>)[key] as T;
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

function assert_unique_field_labels(
  fields: readonly RepresentationProductField[],
): void {
  const labels = new Set<string>();
  for (const field of fields) {
    assert_plain_layout_entry(field);
    if (field.label === undefined) continue;
    expect(
      !labels.has(field.label),
      `Duplicate representation field ${field.label}.`,
    );
    labels.add(field.label);
  }
}

function assert_unique_record_labels(
  fields: readonly RepresentationRecordField[],
): void {
  const labels = new Set<string>();
  for (const field of fields) {
    assert_plain_layout_entry(field);
    const label = read_required_own_data<string>(field, "label");
    expect(!labels.has(label), `Duplicate representation field ${label}.`);
    labels.add(label);
  }
}

function assert_unique_case_labels(
  cases: readonly RepresentationSumCase[],
): void {
  const labels = new Set<string>();
  for (const current of cases) {
    assert_plain_layout_entry(current);
    expect(
      !labels.has(current.label),
      `Duplicate representation case ${current.label}.`,
    );
    labels.add(current.label);
  }
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
    representation_equal(canonical, type),
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
      assert_plain_runtime_array(value.fields);
      for (let index = 0; index < type.fields.length; index += 1) {
        const field = type.fields[index];
        const actual = value.fields[index];
        expect(
          field !== undefined && actual !== undefined,
          "Missing runtime product field.",
        );
        assert_unique_inputs_available(field.type, actual, seen);
      }
      return;
    case "record":
      expect(value.tag === "product", "Record runtime value is required.");
      assert_plain_runtime_array(value.fields);
      for (let index = 0; index < type.fields.length; index += 1) {
        const field = type.fields[index];
        const actual = value.fields[index];
        expect(
          field !== undefined && actual !== undefined,
          "Missing runtime record field.",
        );
        assert_unique_inputs_available(field.type, actual, seen);
      }
      return;
    case "fixed_array":
      expect(value.tag === "product", "Fixed array runtime value is required.");
      assert_plain_runtime_array(value.fields);
      expect(
        value.fields.length === type.length,
        "Runtime fixed array length does not match its layout.",
      );
      for (const element of value.fields) {
        assert_unique_inputs_available(type.element, element, seen);
      }
      return;
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

function assert_plain_runtime_array(
  value: readonly RepresentationValue[],
): void {
  expect(Array.isArray(value), "Runtime aggregate fields must be an array.");
  expect(
    Object.getPrototypeOf(value) === Array.prototype,
    "Runtime aggregate fields must be an ordinary array.",
  );
  for (const key of Reflect.ownKeys(value)) {
    expect(
      typeof key === "string",
      "Runtime aggregate cannot contain symbol properties.",
    );
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(
      descriptor !== undefined && descriptor.get === undefined &&
        descriptor.set === undefined,
      "Runtime aggregate cannot contain accessor properties.",
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    expect(
      descriptor !== undefined && descriptor.get === undefined &&
        descriptor.set === undefined,
      "Runtime aggregate fields cannot contain holes.",
    );
  }
}

function assert_plain_representation_record(type: RepresentationType): void {
  assert_plain_layout_entry(type);
}

function assert_plain_layout_entry(value: unknown): void {
  expect(
    value !== null && typeof value === "object",
    "Representation layout entry must be an object.",
  );
  const prototype = Object.getPrototypeOf(value);
  expect(
    prototype === Object.prototype || prototype === null,
    "Representation type must be a plain record.",
  );
  for (const key of Reflect.ownKeys(value as object)) {
    expect(
      typeof key === "string",
      "Representation type cannot contain symbols.",
    );
    const descriptor = Object.getOwnPropertyDescriptor(value as object, key);
    expect(
      descriptor !== undefined && descriptor.get === undefined &&
        descriptor.set === undefined,
      "Representation type cannot contain accessor properties.",
    );
  }
}

function require_own_data(value: object, key: string): void {
  expect(
    Object.prototype.hasOwnProperty.call(value, key),
    `Missing own layout property ${key}.`,
  );
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  expect(
    descriptor !== undefined && descriptor.get === undefined &&
      descriptor.set === undefined,
    `Layout property ${key} must be an own data property.`,
  );
}

function assert_plain_representation_array(value: readonly unknown[]): void {
  expect(Array.isArray(value), "Representation type members must be an array.");
  expect(
    Object.getPrototypeOf(value) === Array.prototype,
    "Representation type members must be an ordinary array.",
  );
  for (const key of Reflect.ownKeys(value)) {
    expect(
      typeof key === "string",
      "Representation type arrays cannot contain symbols.",
    );
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(
      descriptor !== undefined && descriptor.get === undefined &&
        descriptor.set === undefined,
      "Representation type arrays cannot contain accessor properties.",
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    expect(
      descriptor !== undefined && descriptor.get === undefined &&
        descriptor.set === undefined,
      "Representation type members cannot contain holes.",
    );
  }
}

function validate_ownership(ownership: RepresentationOwnership): void {
  expect(
    ownership === "scalar" || ownership === "bounded_borrow" ||
      ownership === "frozen_shareable" ||
      ownership === "ownership_transfer" ||
      ownership === "unique_heap",
    `Invalid representation ownership ${String(ownership)}.`,
  );
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
