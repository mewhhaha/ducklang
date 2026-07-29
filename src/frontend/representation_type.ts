import { expect } from "../expect.ts";

export type RepresentationScalar =
  | "Bool"
  | "Char"
  | "Unit"
  | "Int"
  | "I32"
  | "U32"
  | "I64"
  | "F32"
  | "F64"
  | "F32x4"
  | "Text"
  | "Bytes"
  | "Resume"
  | "Type";

export type RepresentationOwnership =
  | "scalar"
  | "bounded_borrow"
  | "frozen_shareable"
  | "ownership_transfer"
  | "unique_heap";

export type RepresentationEffect = {
  effect: string;
  operation: string | undefined;
};

export type RepresentationType =
  | { tag: "variable"; id: number; hint: string | undefined }
  | { tag: "rigid"; id: number; name: string }
  | {
    tag: "forall";
    quantified_variables: readonly number[];
    body: RepresentationType;
  }
  | { tag: "top" }
  | { tag: "never" }
  | { tag: "scalar"; name: RepresentationScalar }
  | { tag: "integer"; signed: boolean; width: number }
  | { tag: "named"; name: string; args: readonly RepresentationType[] }
  | { tag: "product"; fields: readonly RepresentationProductField[] }
  | { tag: "record"; fields: readonly RepresentationRecordField[] }
  | {
    tag: "fixed_array";
    length: number;
    element: RepresentationType;
  }
  | { tag: "sum"; cases: readonly RepresentationSumCase[] }
  | {
    tag: "function";
    params: readonly RepresentationType[];
    effects: readonly RepresentationEffect[];
    result: RepresentationType;
  }
  | {
    tag: "owned";
    ownership: RepresentationOwnership;
    value: RepresentationType;
  }
  | { tag: "type_value"; represented: RepresentationType }
  | { tag: "union"; members: readonly RepresentationType[] }
  | { tag: "intersection"; members: readonly RepresentationType[] }
  | {
    tag: "difference";
    base: RepresentationType;
    removed: RepresentationType;
  };

export type RepresentationProductField = {
  label: string | undefined;
  type: RepresentationType;
};

export type RepresentationRecordField = {
  label: string;
  type: RepresentationType;
};

export type RepresentationSumCase = {
  label: string;
  payload: RepresentationType;
};

const MAX_REPRESENTATION_DEPTH = 256;

export function snapshot_representation_type(
  type: RepresentationType,
): RepresentationType {
  return snapshot_representation_at(type, 0, new WeakSet<object>());
}

export function same_representation_type(
  left: RepresentationType,
  right: RepresentationType,
): boolean {
  const stable_left = snapshot_representation_type(left);
  const stable_right = snapshot_representation_type(right);
  return same_representation_at(
    stable_left,
    stable_right,
    new Map(),
    new Map(),
    { next_binder: 0 },
  );
}

function snapshot_representation_at(
  type: RepresentationType,
  depth: number,
  active: WeakSet<object>,
): RepresentationType {
  expect(depth <= MAX_REPRESENTATION_DEPTH, "Representation type is too deep.");
  expect(
    type !== null && typeof type === "object",
    "Representation type must be an object.",
  );
  assert_plain_record(type, "Representation type");
  expect(!active.has(type), "Representation type cannot be cyclic.");
  active.add(type);
  const tag = own_property<RepresentationType["tag"]>(type, "tag");
  let result: RepresentationType;
  switch (tag) {
    case "variable": {
      const id = representation_id(own_property(type, "id"), "variable");
      const hint = optional_text(type, "hint", "Variable hint");
      result = { tag, id, hint };
      break;
    }
    case "rigid": {
      const id = representation_id(own_property(type, "id"), "rigid");
      const name = required_text(own_property(type, "name"), "Rigid name");
      result = { tag, id, name };
      break;
    }
    case "forall": {
      const quantified = plain_array<number>(
        own_property(type, "quantified_variables"),
        "Forall variables",
      );
      const quantified_variables: number[] = [];
      const seen = new Set<number>();
      for (const variable of quantified) {
        const id = representation_id(variable, "forall variable");
        expect(!seen.has(id), `Duplicate forall variable ${id}.`);
        seen.add(id);
        quantified_variables.push(id);
      }
      result = {
        tag,
        quantified_variables: Object.freeze(quantified_variables),
        body: snapshot_representation_at(
          own_property(type, "body"),
          depth + 1,
          active,
        ),
      };
      break;
    }
    case "top":
    case "never":
      result = { tag };
      break;
    case "scalar": {
      const name = own_property<RepresentationScalar>(type, "name");
      expect(
        is_representation_scalar(name),
        `Invalid representation scalar ${String(name)}.`,
      );
      result = { tag, name };
      break;
    }
    case "integer": {
      const signed = own_property<boolean>(type, "signed");
      const width = own_property<number>(type, "width");
      expect(
        typeof signed === "boolean",
        "Representation integer signedness must be boolean.",
      );
      expect(
        Number.isSafeInteger(width) && width > 0 && width <= 64,
        `Representation integer width ${String(width)} is invalid.`,
      );
      result = { tag, signed, width };
      break;
    }
    case "named": {
      const name = required_text(
        own_property(type, "name"),
        "Named representation",
      );
      const args = plain_array<RepresentationType>(
        own_property(type, "args"),
        "Named representation arguments",
      ).map((argument) =>
        snapshot_representation_at(argument, depth + 1, active)
      );
      result = { tag, name, args: Object.freeze(args) };
      break;
    }
    case "product": {
      const fields = snapshot_product_fields(
        own_property(type, "fields"),
        depth,
        active,
      );
      result = { tag, fields };
      break;
    }
    case "record": {
      const fields = snapshot_record_fields(
        own_property(type, "fields"),
        depth,
        active,
      );
      result = { tag, fields };
      break;
    }
    case "fixed_array": {
      const length = own_property<number>(type, "length");
      expect(
        Number.isSafeInteger(length) && length >= 0,
        `Fixed array length ${String(length)} is invalid.`,
      );
      result = {
        tag,
        length,
        element: snapshot_representation_at(
          own_property(type, "element"),
          depth + 1,
          active,
        ),
      };
      break;
    }
    case "sum": {
      const cases = snapshot_sum_cases(
        own_property(type, "cases"),
        depth,
        active,
      );
      result = { tag, cases };
      break;
    }
    case "function": {
      const params = plain_array<RepresentationType>(
        own_property(type, "params"),
        "Function parameters",
      ).map((parameter) =>
        snapshot_representation_at(parameter, depth + 1, active)
      );
      const effects = plain_array<RepresentationEffect>(
        own_property(type, "effects"),
        "Function effects",
      ).map(snapshot_representation_effect);
      result = {
        tag,
        params: Object.freeze(params),
        effects: Object.freeze(effects),
        result: snapshot_representation_at(
          own_property(type, "result"),
          depth + 1,
          active,
        ),
      };
      break;
    }
    case "owned": {
      const ownership = own_property<RepresentationOwnership>(
        type,
        "ownership",
      );
      expect(
        is_representation_ownership(ownership),
        `Invalid representation ownership ${String(ownership)}.`,
      );
      result = {
        tag,
        ownership,
        value: snapshot_representation_at(
          own_property(type, "value"),
          depth + 1,
          active,
        ),
      };
      break;
    }
    case "type_value":
      result = {
        tag,
        represented: snapshot_representation_at(
          own_property(type, "represented"),
          depth + 1,
          active,
        ),
      };
      break;
    case "union":
    case "intersection": {
      const members = plain_array<RepresentationType>(
        own_property(type, "members"),
        "Representation members",
      ).map((member) => snapshot_representation_at(member, depth + 1, active));
      result = { tag, members: Object.freeze(members) };
      break;
    }
    case "difference":
      result = {
        tag,
        base: snapshot_representation_at(
          own_property(type, "base"),
          depth + 1,
          active,
        ),
        removed: snapshot_representation_at(
          own_property(type, "removed"),
          depth + 1,
          active,
        ),
      };
      break;
    default:
      throw new Error(`Invalid representation type tag ${String(tag)}.`);
  }
  active.delete(type);
  return Object.freeze(result);
}

function snapshot_product_fields(
  value: unknown,
  depth: number,
  active: WeakSet<object>,
): readonly RepresentationProductField[] {
  const fields = plain_array<RepresentationProductField>(
    value,
    "Product fields",
  );
  const labels = new Set<string>();
  return Object.freeze(fields.map((field) => {
    assert_plain_record(field, "Product field");
    const label = optional_text(field, "label", "Product field label");
    if (label !== undefined) {
      expect(!labels.has(label), `Duplicate product field ${label}.`);
      labels.add(label);
    }
    return Object.freeze({
      label,
      type: snapshot_representation_at(
        own_property(field, "type"),
        depth + 1,
        active,
      ),
    });
  }));
}

function snapshot_record_fields(
  value: unknown,
  depth: number,
  active: WeakSet<object>,
): readonly RepresentationRecordField[] {
  const fields = plain_array<RepresentationRecordField>(
    value,
    "Record fields",
  );
  const labels = new Set<string>();
  return Object.freeze(fields.map((field) => {
    assert_plain_record(field, "Record field");
    const label = required_text(
      own_property(field, "label"),
      "Record field label",
    );
    expect(!labels.has(label), `Duplicate record field ${label}.`);
    labels.add(label);
    return Object.freeze({
      label,
      type: snapshot_representation_at(
        own_property(field, "type"),
        depth + 1,
        active,
      ),
    });
  }));
}

function snapshot_sum_cases(
  value: unknown,
  depth: number,
  active: WeakSet<object>,
): readonly RepresentationSumCase[] {
  const cases = plain_array<RepresentationSumCase>(value, "Sum cases");
  const labels = new Set<string>();
  return Object.freeze(cases.map((current) => {
    assert_plain_record(current, "Sum case");
    const label = required_text(
      own_property(current, "label"),
      "Sum case label",
    );
    expect(!labels.has(label), `Duplicate sum case ${label}.`);
    labels.add(label);
    return Object.freeze({
      label,
      payload: snapshot_representation_at(
        own_property(current, "payload"),
        depth + 1,
        active,
      ),
    });
  }));
}

function snapshot_representation_effect(
  effect: RepresentationEffect,
): RepresentationEffect {
  assert_plain_record(effect, "Representation effect");
  const effect_name = required_text(
    own_property(effect, "effect"),
    "Effect name",
  );
  const operation = optional_text(effect, "operation", "Effect operation");
  return Object.freeze({ effect: effect_name, operation });
}

function same_representation_at(
  left: RepresentationType,
  right: RepresentationType,
  left_binders: Map<number, number>,
  right_binders: Map<number, number>,
  binders: { next_binder: number },
): boolean {
  if (left.tag !== right.tag) return false;
  switch (left.tag) {
    case "variable": {
      const other = right as typeof left;
      const left_binder = left_binders.get(left.id);
      const right_binder = right_binders.get(other.id);
      if (left_binder !== undefined || right_binder !== undefined) {
        return left_binder === right_binder;
      }
      return left.id === other.id;
    }
    case "rigid":
      return left.id === (right as typeof left).id;
    case "forall": {
      const other = right as typeof left;
      if (
        left.quantified_variables.length !==
          other.quantified_variables.length
      ) {
        return false;
      }
      const scoped_left = new Map(left_binders);
      const scoped_right = new Map(right_binders);
      for (
        let index = 0;
        index < left.quantified_variables.length;
        index += 1
      ) {
        const left_variable = left.quantified_variables[index];
        const right_variable = other.quantified_variables[index];
        expect(
          left_variable !== undefined && right_variable !== undefined,
          "Forall variable disappeared.",
        );
        const binder = binders.next_binder;
        binders.next_binder += 1;
        scoped_left.set(left_variable, binder);
        scoped_right.set(right_variable, binder);
      }
      return same_representation_at(
        left.body,
        other.body,
        scoped_left,
        scoped_right,
        binders,
      );
    }
    case "top":
    case "never":
      return true;
    case "scalar":
      return left.name === (right as typeof left).name;
    case "integer": {
      const other = right as typeof left;
      return left.signed === other.signed && left.width === other.width;
    }
    case "named": {
      const other = right as typeof left;
      return left.name === other.name &&
        same_representation_list(
          left.args,
          other.args,
          left_binders,
          right_binders,
          binders,
        );
    }
    case "product": {
      const other = right as typeof left;
      if (left.fields.length !== other.fields.length) return false;
      for (let index = 0; index < left.fields.length; index += 1) {
        const field = left.fields[index];
        const candidate = other.fields[index];
        expect(
          field !== undefined && candidate !== undefined,
          "Product field disappeared.",
        );
        if (
          field.label !== candidate.label ||
          !same_representation_at(
            field.type,
            candidate.type,
            left_binders,
            right_binders,
            binders,
          )
        ) {
          return false;
        }
      }
      return true;
    }
    case "record": {
      const other = right as typeof left;
      if (left.fields.length !== other.fields.length) return false;
      for (let index = 0; index < left.fields.length; index += 1) {
        const field = left.fields[index];
        const candidate = other.fields[index];
        expect(
          field !== undefined && candidate !== undefined,
          "Record field disappeared.",
        );
        if (
          field.label !== candidate.label ||
          !same_representation_at(
            field.type,
            candidate.type,
            left_binders,
            right_binders,
            binders,
          )
        ) {
          return false;
        }
      }
      return true;
    }
    case "fixed_array": {
      const other = right as typeof left;
      return left.length === other.length &&
        same_representation_at(
          left.element,
          other.element,
          left_binders,
          right_binders,
          binders,
        );
    }
    case "sum": {
      const other = right as typeof left;
      if (left.cases.length !== other.cases.length) return false;
      for (let index = 0; index < left.cases.length; index += 1) {
        const current = left.cases[index];
        const candidate = other.cases[index];
        expect(
          current !== undefined && candidate !== undefined,
          "Sum case disappeared.",
        );
        if (
          current.label !== candidate.label ||
          !same_representation_at(
            current.payload,
            candidate.payload,
            left_binders,
            right_binders,
            binders,
          )
        ) {
          return false;
        }
      }
      return true;
    }
    case "function": {
      const other = right as typeof left;
      if (
        !same_representation_list(
          left.params,
          other.params,
          left_binders,
          right_binders,
          binders,
        ) ||
        left.effects.length !== other.effects.length
      ) {
        return false;
      }
      for (let index = 0; index < left.effects.length; index += 1) {
        const effect = left.effects[index];
        const candidate = other.effects[index];
        expect(
          effect !== undefined && candidate !== undefined,
          "Function effect disappeared.",
        );
        if (
          effect.effect !== candidate.effect ||
          effect.operation !== candidate.operation
        ) {
          return false;
        }
      }
      return same_representation_at(
        left.result,
        other.result,
        left_binders,
        right_binders,
        binders,
      );
    }
    case "owned": {
      const other = right as typeof left;
      return left.ownership === other.ownership &&
        same_representation_at(
          left.value,
          other.value,
          left_binders,
          right_binders,
          binders,
        );
    }
    case "type_value":
      return same_representation_at(
        left.represented,
        (right as typeof left).represented,
        left_binders,
        right_binders,
        binders,
      );
    case "union":
    case "intersection":
      return same_representation_list(
        left.members,
        (right as typeof left).members,
        left_binders,
        right_binders,
        binders,
      );
    case "difference": {
      const other = right as typeof left;
      return same_representation_at(
        left.base,
        other.base,
        left_binders,
        right_binders,
        binders,
      ) &&
        same_representation_at(
          left.removed,
          other.removed,
          left_binders,
          right_binders,
          binders,
        );
    }
  }
}

function same_representation_list(
  left: readonly RepresentationType[],
  right: readonly RepresentationType[],
  left_binders: Map<number, number>,
  right_binders: Map<number, number>,
  binders: { next_binder: number },
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const current = left[index];
    const candidate = right[index];
    expect(
      current !== undefined && candidate !== undefined,
      "Representation member disappeared.",
    );
    if (
      !same_representation_at(
        current,
        candidate,
        left_binders,
        right_binders,
        binders,
      )
    ) {
      return false;
    }
  }
  return true;
}

function representation_id(value: unknown, label: string): number {
  expect(
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    `Representation ${label} ID ${String(value)} is invalid.`,
  );
  return value;
}

function required_text(value: unknown, label: string): string {
  expect(
    typeof value === "string" && value.length > 0,
    `${label} must not be empty.`,
  );
  return value;
}

function optional_text(
  value: object,
  key: string,
  label: string,
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return undefined;
  const current = own_property<unknown>(value, key);
  if (current === undefined) return undefined;
  return required_text(current, label);
}

function own_property<Value>(value: object, key: string): Value {
  expect(
    Object.prototype.hasOwnProperty.call(value, key),
    `Representation value is missing ${key}.`,
  );
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  expect(
    descriptor !== undefined && descriptor.get === undefined &&
      descriptor.set === undefined,
    `Representation property ${key} must be an own data property.`,
  );
  return descriptor.value as Value;
}

function plain_array<Value>(value: unknown, label: string): readonly Value[] {
  expect(Array.isArray(value), `${label} must be an array.`);
  expect(
    Object.getPrototypeOf(value) === Array.prototype,
    `${label} must be an ordinary array.`,
  );
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
        index < value.length && String(index) === key,
      `${label} contains invalid property ${key}.`,
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    expect(
      Object.prototype.hasOwnProperty.call(value, index),
      `${label} cannot contain holes.`,
    );
  }
  return value as readonly Value[];
}

function assert_plain_record(value: object, label: string): void {
  expect(
    Object.getPrototypeOf(value) === Object.prototype,
    `${label} must be a plain record.`,
  );
}

function is_representation_scalar(
  value: unknown,
): value is RepresentationScalar {
  return value === "Bool" || value === "Char" || value === "Unit" ||
    value === "Int" || value === "I32" || value === "U32" ||
    value === "I64" || value === "F32" || value === "F64" ||
    value === "F32x4" || value === "Text" || value === "Bytes" ||
    value === "Resume" || value === "Type";
}

function is_representation_ownership(
  value: unknown,
): value is RepresentationOwnership {
  return value === "scalar" || value === "bounded_borrow" ||
    value === "frozen_shareable" || value === "ownership_transfer" ||
    value === "unique_heap";
}
