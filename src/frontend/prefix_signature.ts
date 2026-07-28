import { compiler_diagnostic, diagnostic_codes, type CompilerDiagnostic } from "../diagnostic.ts";
import { expect } from "../expect.ts";
import { fail, ok, type Checked } from "./checked.ts";

export type PrefixSignatureKind = "let" | "const" | "fact" | "opaque fact";

export type PrefixSignature = {
  name: string;
  kind: PrefixSignatureKind;
  scope: string;
  type_text: string;
  requires: readonly string[];
  ensures: readonly string[];
  decreases: readonly string[];
  span: { start: number; end: number };
};

export type PrefixDefinition = {
  name: string;
  kind: PrefixSignatureKind;
  scope: string;
  body_text?: string;
  span: { start: number; end: number };
};

export type PrefixSignatureAssociation = {
  signature: PrefixSignature;
  definition: PrefixDefinition;
};

export type PrefixSignatureIndex = ReadonlyMap<string, PrefixSignatureAssociation>;

export function associate_prefix_signatures(
  signatures: readonly PrefixSignature[],
  definitions: readonly PrefixDefinition[],
): Checked<PrefixSignatureIndex> {
  assert_plain_array(signatures, "Prefix signatures");
  assert_plain_array(definitions, "Prefix definitions");
  const signature_count = own_array_length(signatures, "Prefix signatures");
  const definition_count = own_array_length(definitions, "Prefix definitions");
  const stable_signatures: PrefixSignature[] = [];
  for (let index = 0; index < signature_count; index += 1) {
    const signature = own_array_value(signatures, index, "Prefix signatures");
    expect(signature !== undefined, "Prefix signatures cannot contain holes.");
    stable_signatures.push(snapshot_signature(signature));
  }
  const stable_definitions: PrefixDefinition[] = [];
  for (let index = 0; index < definition_count; index += 1) {
    const definition = own_array_value(definitions, index, "Prefix definitions");
    expect(definition !== undefined, "Prefix definitions cannot contain holes.");
    stable_definitions.push(snapshot_definition(definition));
  }
  const diagnostics: CompilerDiagnostic[] = [];
  const signatures_by_key = new Map<string, PrefixSignature>();
  const definitions_by_key = new Map<string, PrefixDefinition>();

  for (const signature of stable_signatures) {
    const key = scoped_name(signature.scope, signature.name);
    if (signatures_by_key.has(key)) {
      const previous = signatures_by_key.get(key);
      diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_duplicate,
          `Duplicate prefix signature for ${signature.name}.`,
          signature.span,
          related_span(previous, "Previous signature is here."),
        ),
      );
      continue;
    }
    signatures_by_key.set(key, signature);
    if (signature.decreases.length > 1) {
      diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_multiple_decreases,
          `Prefix signature ${signature.name} declares decreases more than once.`,
          signature.span,
        ),
      );
    }
    const contract_clauses = [...signature.requires, ...signature.ensures];
    for (const clause of contract_clauses) {
      if (clause.trim() !== "false") continue;
      diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_unproved,
          `Prefix signature ${signature.name} contains an unsatisfiable contract clause.`,
          signature.span,
        ),
      );
    }
    for (const requirement of signature.requires) {
      if (requirement.trim() === "true" || requirement.trim() === "false") continue;
      diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_unproved,
          `Prefix signature ${signature.name} has a requires clause that is not yet elaborated: ${requirement}.`,
          signature.span,
        ),
      );
    }
  }

  for (const definition of stable_definitions) {
    const key = scoped_name(definition.scope, definition.name);
    if (definitions_by_key.has(key)) {
      const previous = definitions_by_key.get(key);
      diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_duplicate,
          `Duplicate definition for prefix signature ${definition.name}.`,
          definition.span,
          related_span(previous, "Previous definition is here."),
        ),
      );
      continue;
    }
    definitions_by_key.set(key, definition);
    if ((definition.kind === "fact" || definition.kind === "opaque fact") &&
      definition.body_text !== undefined && definition.body_text.trim() !== "true") {
      diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_unproved,
          `Fact ${definition.name} has an unchecked body; provide a checked proposition expression.`,
          definition.span,
        ),
      );
    }
  }

  const associations: [string, PrefixSignatureAssociation][] = [];
  for (const signature of stable_signatures) {
    const key = scoped_name(signature.scope, signature.name);
    if (signatures_by_key.get(key) !== signature) continue;
    const definition = definitions_by_key.get(key);
    if (definition === undefined) {
      const cross_scope = stable_definitions.find((candidate) => candidate.name === signature.name);
      let code: typeof diagnostic_codes.prefix_signature_orphaned |
        typeof diagnostic_codes.prefix_signature_mismatch =
        diagnostic_codes.prefix_signature_mismatch;
      let message = `Prefix signature ${signature.name} does not match a definition in the same scope.`;
      if (cross_scope === undefined) {
        code = diagnostic_codes.prefix_signature_orphaned;
        message = `Prefix signature ${signature.name} has no matching definition in scope ${signature.scope}.`;
      }
      diagnostics.push(
        compiler_diagnostic(
          code,
          message,
          signature.span,
          related_span(cross_scope, "Definition is in another scope."),
        ),
      );
      continue;
    }
    if (definition.kind !== signature.kind) {
      diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_mismatch,
          `Prefix signature ${signature.name} declares ${signature.kind} but definition is ${definition.kind}.`,
          signature.span,
          [{ message: "Definition is here.", span: definition.span }],
        ),
      );
      continue;
    }
    if (definition.span.start < signature.span.end) {
      diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_mismatch,
          `Definition for ${signature.name} must appear after its prefix signature.`,
          signature.span,
          [{ message: "Definition is here.", span: definition.span }],
        ),
      );
      continue;
    }
    associations.push([key, Object.freeze({ signature, definition })]);
  }

  if (diagnostics.length > 0) return fail(...diagnostics);
  return ok(new ReadonlyPrefixSignatureIndex(associations));
}

class ReadonlyPrefixSignatureIndex implements PrefixSignatureIndex {
  readonly #entries: Map<string, PrefixSignatureAssociation>;

  constructor(entries: readonly (readonly [string, PrefixSignatureAssociation])[]) {
    this.#entries = new Map(entries);
    Object.freeze(this);
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: string): PrefixSignatureAssociation | undefined {
    return this.#entries.get(key);
  }

  has(key: string): boolean {
    return this.#entries.has(key);
  }

  entries(): MapIterator<[string, PrefixSignatureAssociation]> {
    return this.#entries.entries();
  }

  keys(): MapIterator<string> {
    return this.#entries.keys();
  }

  values(): MapIterator<PrefixSignatureAssociation> {
    return this.#entries.values();
  }

  forEach(callback: (value: PrefixSignatureAssociation, key: string, map: PrefixSignatureIndex) => void): void {
    this.#entries.forEach((value, key) => callback(value, key, this));
  }

  [Symbol.iterator](): MapIterator<[string, PrefixSignatureAssociation]> {
    return this.#entries.entries();
  }
}

function snapshot_signature(signature: PrefixSignature): PrefixSignature {
  assert_record(signature, "Prefix signature");
  const name = own_value<string>(signature, "name");
  const kind = own_value<PrefixSignatureKind>(signature, "kind");
  const scope = own_value<string>(signature, "scope");
  const type_text = own_value<string>(signature, "type_text");
  const requires = own_value<readonly string[]>(signature, "requires");
  const ensures = own_value<readonly string[]>(signature, "ensures");
  const decreases = own_value<readonly string[]>(signature, "decreases");
  const span = own_value<{ start: number; end: number }>(signature, "span");
  require_text(name, "Prefix signature name");
  require_text(scope, "Prefix signature scope");
  require_text(type_text, "Prefix signature type");
  require_kind(kind);
  return Object.freeze({
    name,
    kind,
    scope,
    type_text,
    requires: snapshot_texts(requires, "requires"),
    ensures: snapshot_texts(ensures, "ensures"),
    decreases: snapshot_texts(decreases, "decreases"),
    span: snapshot_span(span),
  });
}

function snapshot_definition(definition: PrefixDefinition): PrefixDefinition {
  assert_record(definition, "Prefix definition");
  const name = own_value<string>(definition, "name");
  const kind = own_value<PrefixSignatureKind>(definition, "kind");
  const scope = own_value<string>(definition, "scope");
  const span = own_value<{ start: number; end: number }>(definition, "span");
  let body_text: string | undefined;
  if (Object.prototype.hasOwnProperty.call(definition, "body_text")) {
    body_text = own_value<string | undefined>(definition, "body_text");
    expect(body_text === undefined || typeof body_text === "string", "Prefix definition body must be text.");
  }
  require_text(name, "Prefix definition name");
  require_text(scope, "Prefix definition scope");
  require_kind(kind);
  const snapshot: PrefixDefinition = {
    name,
    kind,
    scope,
    span: snapshot_span(span),
  };
  if (body_text !== undefined) snapshot.body_text = body_text;
  return Object.freeze(snapshot);
}

function snapshot_texts(values: readonly string[], label: string): readonly string[] {
  expect(Array.isArray(values), `Prefix ${label} clauses must be an array.`);
  assert_plain_array(values, `Prefix ${label} clauses`);
  const value_count = own_array_length(values, `Prefix ${label} clauses`);
  const result: string[] = [];
  for (let index = 0; index < value_count; index += 1) {
    const value = own_array_value(values, index, `Prefix ${label} clauses`);
    expect(value !== undefined, `Prefix ${label} clauses cannot contain holes.`);
    result.push(require_text(value, `Prefix ${label} clause`));
  }
  return Object.freeze(result);
}

function snapshot_span(span: { start: number; end: number }): { start: number; end: number } {
  assert_record(span, "Prefix signature span");
  const start = own_value<number>(span, "start");
  const end = own_value<number>(span, "end");
  expect(Number.isSafeInteger(start) && start >= 0, "Prefix signature span start is invalid.");
  expect(Number.isSafeInteger(end) && end >= start, "Prefix signature span end is invalid.");
  return Object.freeze({ start, end });
}

function assert_record(value: object, label: string): void {
  expect(value !== null && typeof value === "object", `${label} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  expect(prototype === Object.prototype || prototype === null, `${label} must be a plain record.`);
  const keys = Reflect.ownKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    expect(key !== undefined && typeof key === "string", `${label} cannot contain symbol properties.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(descriptor !== undefined && descriptor.get === undefined && descriptor.set === undefined, `${label} cannot contain accessors.`);
  }
}

function require_own_data(value: object, key: string): void {
  expect(Object.prototype.hasOwnProperty.call(value, key), `Missing own prefix property ${key}.`);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  expect(descriptor !== undefined && descriptor.get === undefined && descriptor.set === undefined, `Prefix property ${key} must be an own data property.`);
}

function own_value<Value>(value: object, key: string): Value {
  require_own_data(value, key);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  expect(descriptor !== undefined && "value" in descriptor, `Prefix property ${key} must be a data property.`);
  return descriptor.value as Value;
}

function own_array_value<Value>(value: readonly Value[], index: number, label: string): Value | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
  expect(descriptor !== undefined && descriptor.get === undefined && descriptor.set === undefined, `${label} cannot contain holes or accessors.`);
  return descriptor.value as Value;
}

function own_array_length(value: readonly unknown[], label: string): number {
  const descriptor = Object.getOwnPropertyDescriptor(value, "length");
  expect(descriptor !== undefined && descriptor.get === undefined && descriptor.set === undefined, `${label} length must be a data property.`);
  expect(Number.isSafeInteger(descriptor.value) && descriptor.value >= 0, `${label} length is invalid.`);
  return descriptor.value as number;
}

function assert_plain_array(value: readonly unknown[], label: string): void {
  expect(Array.isArray(value), `${label} must be an array.`);
  expect(Object.getPrototypeOf(value) === Array.prototype, `${label} must be an ordinary array.`);
  const keys = Reflect.ownKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    expect(key !== undefined && typeof key === "string", `${label} cannot contain symbol properties.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(descriptor !== undefined && descriptor.get === undefined && descriptor.set === undefined, `${label} cannot contain accessors.`);
  }
  const length = own_array_length(value, label);
  for (let index = 0; index < length; index += 1) {
    expect(Object.getOwnPropertyDescriptor(value, String(index)) !== undefined, `${label} cannot contain holes.`);
  }
}

function require_text(value: string, label: string): string {
  expect(typeof value === "string" && value.length > 0, `${label} must not be empty.`);
  return value;
}

function require_kind(kind: PrefixSignatureKind): void {
  expect(kind === "let" || kind === "const" || kind === "fact" || kind === "opaque fact", "Invalid prefix signature kind.");
}

function related_span(
  value: PrefixSignature | PrefixDefinition | undefined,
  message: string,
): { message: string; span: { start: number; end: number } }[] | undefined {
  if (value === undefined) return undefined;
  return [{ message, span: value.span }];
}

function scoped_name(scope: string, name: string): string {
  return JSON.stringify([scope, name]);
}
