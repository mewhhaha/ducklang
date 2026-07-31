import {
  compiler_diagnostic,
  type CompilerDiagnostic,
  diagnostic_codes,
} from "../diagnostic.ts";
import { expect } from "../expect.ts";
import type { TypeExpr } from "../type_syntax.ts";
import { type Checked, fail, ok } from "./checked.ts";

export type PrefixSignatureKind = "let" | "const" | "fact" | "opaque fact";

export type PrefixSpan = { start: number; end: number };

export type PrefixTypeReference = {
  text: string;
  canonical: string;
  expression?: TypeExpr;
  proof?: PrefixProposition;
  refinement?: PrefixRefinement;
  representation?: string;
  resolved?: true;
  span: PrefixSpan;
};

export type PrefixRefinement = {
  binder: string;
  proposition: PrefixProposition;
  text: string;
  span: PrefixSpan;
};

export type PrefixSignatureParameter = {
  name: string;
  type: PrefixTypeReference;
  span: PrefixSpan;
};

export type PrefixSignatureBinder = PrefixSignatureParameter;

export type PrefixSignatureResult = {
  name?: "result";
  type: PrefixTypeReference;
  span: PrefixSpan;
};

export type PrefixCallableType = {
  binders: readonly PrefixSignatureBinder[];
  parameters: readonly PrefixSignatureParameter[];
  result: PrefixSignatureResult;
  span: PrefixSpan;
};

export type PrefixTerm = {
  text: string;
  references: readonly string[];
  shape: PrefixTermShape;
  span: PrefixSpan;
};

export type PrefixTermShape =
  | { tag: "name"; name: string }
  | { tag: "number" }
  | { tag: "string" }
  | { tag: "character" }
  | { tag: "boolean" }
  | {
    tag: "binary";
    operator: string;
    left: PrefixTerm;
    right: PrefixTerm;
  }
  | { tag: "unary"; operator: string; operand: PrefixTerm }
  | {
    tag: "call";
    function: PrefixTerm;
    arguments: readonly PrefixTerm[];
  }
  | { tag: "field"; object: PrefixTerm; field: string }
  | { tag: "index"; object: PrefixTerm }
  | { tag: "parenthesized"; value: PrefixTerm }
  | { tag: "unsupported" };

export type PrefixProofTerm =
  | { tag: "name"; name: string; span: PrefixSpan }
  | { tag: "refl" | "true_intro"; span: PrefixSpan }
  | {
    tag: "unsafe_assume";
    proposition: PrefixProposition;
    span: PrefixSpan;
  }
  | {
    tag: "lambda";
    name: string;
    body: PrefixProofTerm;
    span: PrefixSpan;
  }
  | {
    tag:
      | "symm"
      | "and_left"
      | "and_right"
      | "or_left"
      | "or_right"
      | "false_elim";
    proof: PrefixProofTerm;
    span: PrefixSpan;
  }
  | {
    tag: "trans" | "and_intro" | "implies_apply";
    left: PrefixProofTerm;
    right: PrefixProofTerm;
    span: PrefixSpan;
  }
  | {
    tag: "forall_apply";
    proof: PrefixProofTerm;
    argument: PrefixTerm;
    span: PrefixSpan;
  }
  | {
    tag: "exists_intro";
    witness: PrefixTerm;
    proof: PrefixProofTerm;
    span: PrefixSpan;
  }
  | {
    tag: "or_cases";
    proof: PrefixProofTerm;
    left_name: string;
    left_body: PrefixProofTerm;
    right_name: string;
    right_body: PrefixProofTerm;
    span: PrefixSpan;
  }
  | {
    tag: "exists_elim";
    proof: PrefixProofTerm;
    witness_name: string;
    evidence_name: string;
    body: PrefixProofTerm;
    span: PrefixSpan;
  }
  | {
    tag: "congr";
    parameter_name: string;
    function: PrefixTerm;
    proof: PrefixProofTerm;
    span: PrefixSpan;
  }
  | {
    tag: "transport";
    equality: PrefixProofTerm;
    motive_name: string;
    motive: PrefixProposition;
    proof: PrefixProofTerm;
    span: PrefixSpan;
  }
  | {
    tag: "tactics";
    commands: readonly PrefixTacticCommand[];
    span: PrefixSpan;
  };

export type PrefixTacticCommand =
  | {
    tag: "exact" | "apply" | "cases";
    proof: PrefixProofTerm;
    span: PrefixSpan;
  }
  | { tag: "intro"; name: string; span: PrefixSpan }
  | {
    tag: "assumption" | "constructor" | "left" | "right";
    span: PrefixSpan;
  };

export type PrefixProposition =
  | { tag: "true"; span: PrefixSpan }
  | { tag: "false"; span: PrefixSpan }
  | { tag: "holds"; value: PrefixTerm; span: PrefixSpan }
  | {
    tag: "equal" | "not_equal" | "less" | "less_equal";
    left: PrefixTerm;
    right: PrefixTerm;
    span: PrefixSpan;
  }
  | {
    tag: "is";
    value: PrefixTerm;
    type: PrefixTypeReference;
    span: PrefixSpan;
  }
  | { tag: "not"; proposition: PrefixProposition; span: PrefixSpan }
  | {
    tag: "and" | "or" | "implies";
    left: PrefixProposition;
    right: PrefixProposition;
    span: PrefixSpan;
  }
  | {
    tag: "forall" | "exists";
    binder: PrefixSignatureBinder;
    proposition: PrefixProposition;
    span: PrefixSpan;
  };

export type PrefixSignature = {
  name: string;
  kind: PrefixSignatureKind;
  scope: string;
  type: PrefixCallableType;
  requires: readonly PrefixProposition[];
  ensures: readonly PrefixProposition[];
  decreases: readonly PrefixTerm[];
  span: PrefixSpan;
};

export type PrefixDefinition = {
  attribute_span?: PrefixSpan;
  unsafe_span?: PrefixSpan;
  name: string;
  kind: PrefixSignatureKind;
  scope: string;
  recursive?: boolean;
  callable_parameters?: readonly string[];
  callable_parameter_types?: readonly (PrefixTypeReference | undefined)[];
  callable_body?: PrefixTerm;
  callable_proof_body?: PrefixProofTerm;
  fact_parameters?: readonly string[];
  fact_body?: PrefixProposition;
  span: PrefixSpan;
};

export type PrefixSignatureAssociation = {
  signature: PrefixSignature;
  definition: PrefixDefinition;
};

export type PrefixSignatureIndex = ReadonlyMap<
  string,
  PrefixSignatureAssociation
>;

const maximum_prefix_proof_snapshot_nodes = 20_000;
const maximum_prefix_proposition_snapshot_nodes = 20_000;
const maximum_prefix_term_snapshot_nodes = 20_000;

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
    const definition = own_array_value(
      definitions,
      index,
      "Prefix definitions",
    );
    expect(
      definition !== undefined,
      "Prefix definitions cannot contain holes.",
    );
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
  }

  for (const definition of stable_definitions) {
    const key = scoped_name(definition.scope, definition.name);
    if (!signatures_by_key.has(key)) continue;
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
  }

  const associations: [string, PrefixSignatureAssociation][] = [];
  for (const signature of stable_signatures) {
    const key = scoped_name(signature.scope, signature.name);
    if (signatures_by_key.get(key) !== signature) continue;
    const definition = definitions_by_key.get(key);
    if (definition === undefined) {
      const cross_scope = stable_definitions.find((candidate) =>
        candidate.name === signature.name
      );
      let code:
        | typeof diagnostic_codes.prefix_signature_orphaned
        | typeof diagnostic_codes.prefix_signature_mismatch =
          diagnostic_codes.prefix_signature_mismatch;
      let message =
        `Prefix signature ${signature.name} does not match a definition in the same scope.`;
      if (cross_scope === undefined) {
        code = diagnostic_codes.prefix_signature_orphaned;
        message =
          `Prefix signature ${signature.name} has no matching definition in scope ${signature.scope}.`;
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

  constructor(
    entries: readonly (readonly [string, PrefixSignatureAssociation])[],
  ) {
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

  forEach(
    callback: (
      value: PrefixSignatureAssociation,
      key: string,
      map: PrefixSignatureIndex,
    ) => void,
  ): void {
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
  const type = own_value<PrefixCallableType>(signature, "type");
  const requires = own_value<readonly PrefixProposition[]>(
    signature,
    "requires",
  );
  const ensures = own_value<readonly PrefixProposition[]>(
    signature,
    "ensures",
  );
  const decreases = own_value<readonly PrefixTerm[]>(signature, "decreases");
  const span = own_value<PrefixSpan>(signature, "span");
  require_text(name, "Prefix signature name");
  require_text(scope, "Prefix signature scope");
  require_kind(kind);
  return Object.freeze({
    name,
    kind,
    scope,
    type: snapshot_callable_type(type),
    requires: snapshot_propositions(requires, "requires"),
    ensures: snapshot_propositions(ensures, "ensures"),
    decreases: snapshot_terms(decreases, "decreases"),
    span: snapshot_span(span),
  });
}

function snapshot_definition(definition: PrefixDefinition): PrefixDefinition {
  assert_record(definition, "Prefix definition");
  const name = own_value<string>(definition, "name");
  const kind = own_value<PrefixSignatureKind>(definition, "kind");
  const scope = own_value<string>(definition, "scope");
  const span = own_value<PrefixSpan>(definition, "span");
  let recursive: boolean | undefined;
  if (Object.prototype.hasOwnProperty.call(definition, "recursive")) {
    recursive = own_value<boolean | undefined>(definition, "recursive");
    expect(
      recursive === undefined || typeof recursive === "boolean",
      "Prefix definition recursive marker must be boolean.",
    );
  }
  let attribute_span: PrefixSpan | undefined;
  if (Object.prototype.hasOwnProperty.call(definition, "attribute_span")) {
    attribute_span = own_value<PrefixSpan | undefined>(
      definition,
      "attribute_span",
    );
  }
  let unsafe_span: PrefixSpan | undefined;
  if (Object.prototype.hasOwnProperty.call(definition, "unsafe_span")) {
    unsafe_span = own_value<PrefixSpan | undefined>(
      definition,
      "unsafe_span",
    );
  }
  let fact_parameters: readonly string[] | undefined;
  if (Object.prototype.hasOwnProperty.call(definition, "fact_parameters")) {
    fact_parameters = own_value<readonly string[] | undefined>(
      definition,
      "fact_parameters",
    );
    expect(
      fact_parameters === undefined || Array.isArray(fact_parameters),
      "Fact parameters must be an array.",
    );
  }
  let fact_body: PrefixProposition | undefined;
  if (Object.prototype.hasOwnProperty.call(definition, "fact_body")) {
    fact_body = own_value<PrefixProposition | undefined>(
      definition,
      "fact_body",
    );
  }
  let callable_parameters: readonly string[] | undefined;
  if (Object.prototype.hasOwnProperty.call(definition, "callable_parameters")) {
    callable_parameters = own_value<readonly string[] | undefined>(
      definition,
      "callable_parameters",
    );
    expect(
      callable_parameters === undefined || Array.isArray(callable_parameters),
      "Callable parameters must be an array.",
    );
  }
  let callable_parameter_types:
    | readonly (PrefixTypeReference | undefined)[]
    | undefined;
  if (
    Object.prototype.hasOwnProperty.call(
      definition,
      "callable_parameter_types",
    )
  ) {
    callable_parameter_types = own_value<
      readonly (PrefixTypeReference | undefined)[] | undefined
    >(definition, "callable_parameter_types");
    expect(
      callable_parameter_types === undefined ||
        Array.isArray(callable_parameter_types),
      "Callable parameter types must be an array.",
    );
  }
  let callable_body: PrefixTerm | undefined;
  if (Object.prototype.hasOwnProperty.call(definition, "callable_body")) {
    callable_body = own_value<PrefixTerm | undefined>(
      definition,
      "callable_body",
    );
  }
  let callable_proof_body: PrefixProofTerm | undefined;
  if (
    Object.prototype.hasOwnProperty.call(definition, "callable_proof_body")
  ) {
    callable_proof_body = own_value<PrefixProofTerm | undefined>(
      definition,
      "callable_proof_body",
    );
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
  if (attribute_span !== undefined) {
    snapshot.attribute_span = snapshot_span(attribute_span);
  }
  if (unsafe_span !== undefined) {
    snapshot.unsafe_span = snapshot_span(unsafe_span);
  }
  if (recursive !== undefined) snapshot.recursive = recursive;
  if (callable_parameters !== undefined) {
    snapshot.callable_parameters = snapshot_texts(
      callable_parameters,
      "callable parameters",
    );
  }
  if (callable_parameter_types !== undefined) {
    assert_plain_array(
      callable_parameter_types,
      "Callable parameter types",
    );
    const parameter_types: (PrefixTypeReference | undefined)[] = [];
    const parameter_type_count = own_array_length(
      callable_parameter_types,
      "Callable parameter types",
    );
    for (let index = 0; index < parameter_type_count; index += 1) {
      const type = own_array_value(
        callable_parameter_types,
        index,
        "Callable parameter types",
      );
      if (type === undefined) {
        parameter_types.push(undefined);
        continue;
      }
      parameter_types.push(snapshot_type_reference(type));
    }
    snapshot.callable_parameter_types = Object.freeze(parameter_types);
  }
  if (callable_body !== undefined) {
    snapshot.callable_body = snapshot_term(callable_body);
  }
  if (callable_proof_body !== undefined) {
    snapshot.callable_proof_body = snapshot_proof_term(callable_proof_body);
  }
  if (fact_parameters !== undefined) {
    snapshot.fact_parameters = snapshot_texts(
      fact_parameters,
      "fact parameters",
    );
  }
  if (fact_body !== undefined) {
    snapshot.fact_body = snapshot_proposition(fact_body);
  }
  return Object.freeze(snapshot);
}

function snapshot_callable_type(type: PrefixCallableType): PrefixCallableType {
  assert_record(type, "Prefix callable type");
  const binders = own_value<readonly PrefixSignatureBinder[]>(type, "binders");
  const parameters = own_value<readonly PrefixSignatureParameter[]>(
    type,
    "parameters",
  );
  const result = own_value<PrefixSignatureResult>(type, "result");
  const span = own_value<PrefixSpan>(type, "span");
  const active = new WeakSet<object>();
  return Object.freeze({
    binders: snapshot_parameters(binders, "binders", active),
    parameters: snapshot_parameters(parameters, "parameters", active),
    result: snapshot_result(result, active),
    span: snapshot_span(span),
  });
}

function snapshot_parameters(
  parameters: readonly PrefixSignatureParameter[],
  label: string,
  active: WeakSet<object> = new WeakSet<object>(),
  depth = 0,
): readonly PrefixSignatureParameter[] {
  assert_plain_array(parameters, `Prefix ${label}`);
  const result: PrefixSignatureParameter[] = [];
  const count = own_array_length(parameters, `Prefix ${label}`);
  for (let index = 0; index < count; index += 1) {
    const parameter = own_array_value(
      parameters,
      index,
      `Prefix ${label}`,
    );
    expect(parameter !== undefined, `Prefix ${label} cannot contain holes.`);
    assert_record(parameter, `Prefix ${label} entry`);
    const name = own_value<string>(parameter, "name");
    const type = own_value<PrefixTypeReference>(parameter, "type");
    const span = own_value<PrefixSpan>(parameter, "span");
    result.push(Object.freeze({
      name: require_text(name, `Prefix ${label} name`),
      type: snapshot_type_reference(type, active, depth + 1),
      span: snapshot_span(span),
    }));
  }
  return Object.freeze(result);
}

function snapshot_result(
  result: PrefixSignatureResult,
  active: WeakSet<object> = new WeakSet<object>(),
  depth = 0,
): PrefixSignatureResult {
  assert_record(result, "Prefix signature result");
  const type = own_value<PrefixTypeReference>(result, "type");
  const span = own_value<PrefixSpan>(result, "span");
  const snapshot: PrefixSignatureResult = {
    type: snapshot_type_reference(type, active, depth + 1),
    span: snapshot_span(span),
  };
  if (Object.prototype.hasOwnProperty.call(result, "name")) {
    const name = own_value<"result" | undefined>(result, "name");
    expect(
      name === undefined || name === "result",
      "Prefix result binder must be result.",
    );
    if (name !== undefined) snapshot.name = name;
  }
  return Object.freeze(snapshot);
}

function snapshot_type_reference(
  type: PrefixTypeReference,
  active: WeakSet<object> = new WeakSet<object>(),
  depth = 0,
): PrefixTypeReference {
  assert_record(type, "Prefix type reference");
  expect(depth <= 256, "Prefix dependent type nesting exceeds 256 levels.");
  expect(!active.has(type), "Prefix dependent type cannot be cyclic.");
  active.add(type);
  try {
    const text = own_value<string>(type, "text");
    const canonical = own_value<string>(type, "canonical");
    const span = own_value<PrefixSpan>(type, "span");
    const snapshot: PrefixTypeReference = {
      text: require_text(text, "Prefix type reference"),
      canonical: require_text(canonical, "Canonical prefix type reference"),
      span: snapshot_span(span),
    };
    if (Object.prototype.hasOwnProperty.call(type, "refinement")) {
      const refinement = own_value<PrefixRefinement | undefined>(
        type,
        "refinement",
      );
      if (refinement !== undefined) {
        assert_record(refinement, "Prefix refinement");
        snapshot.refinement = Object.freeze({
          binder: require_text(
            own_value<string>(refinement, "binder"),
            "Prefix refinement binder",
          ),
          proposition: snapshot_proposition(
            own_value<PrefixProposition>(refinement, "proposition"),
            active,
            depth + 1,
          ),
          text: require_text(
            own_value<string>(refinement, "text"),
            "Prefix refinement text",
          ),
          span: snapshot_span(own_value<PrefixSpan>(refinement, "span")),
        });
      }
    }
    if (Object.prototype.hasOwnProperty.call(type, "proof")) {
      const proof = own_value<PrefixProposition | undefined>(type, "proof");
      if (proof !== undefined) {
        snapshot.proof = snapshot_proposition(proof, active, depth + 1);
      }
    }
    return Object.freeze(snapshot);
  } finally {
    active.delete(type);
  }
}

function snapshot_propositions(
  propositions: readonly PrefixProposition[],
  label: string,
): readonly PrefixProposition[] {
  assert_plain_array(propositions, `Prefix ${label} clauses`);
  const result: PrefixProposition[] = [];
  const count = own_array_length(propositions, `Prefix ${label} clauses`);
  for (let index = 0; index < count; index += 1) {
    const proposition = own_array_value(
      propositions,
      index,
      `Prefix ${label} clauses`,
    );
    expect(
      proposition !== undefined,
      `Prefix ${label} clauses cannot contain holes.`,
    );
    result.push(snapshot_proposition(proposition));
  }
  return Object.freeze(result);
}

function snapshot_proposition(
  proposition: PrefixProposition,
  active: WeakSet<object> = new WeakSet<object>(),
  depth = 0,
  budget: { nodes: number } = { nodes: 0 },
): PrefixProposition {
  assert_record(proposition, "Prefix proposition");
  budget.nodes += 1;
  expect(
    budget.nodes <= maximum_prefix_proposition_snapshot_nodes,
    "Prefix proposition snapshot exceeded " +
      maximum_prefix_proposition_snapshot_nodes.toString() + " nodes.",
  );
  expect(depth <= 256, "Prefix proposition nesting exceeds 256 levels.");
  expect(!active.has(proposition), "Prefix proposition cannot be cyclic.");
  active.add(proposition);
  try {
    const tag = own_value<PrefixProposition["tag"]>(proposition, "tag");
    const span = snapshot_span(own_value<PrefixSpan>(proposition, "span"));
    if (tag === "true" || tag === "false") {
      return Object.freeze({ tag, span });
    }
    if (tag === "holds") {
      return Object.freeze({
        tag,
        value: snapshot_term(own_value<PrefixTerm>(proposition, "value")),
        span,
      });
    }
    if (
      tag === "equal" || tag === "not_equal" || tag === "less" ||
      tag === "less_equal"
    ) {
      return Object.freeze({
        tag,
        left: snapshot_term(own_value<PrefixTerm>(proposition, "left")),
        right: snapshot_term(own_value<PrefixTerm>(proposition, "right")),
        span,
      });
    }
    if (tag === "is") {
      return Object.freeze({
        tag,
        value: snapshot_term(own_value<PrefixTerm>(proposition, "value")),
        type: snapshot_type_reference(
          own_value<PrefixTypeReference>(proposition, "type"),
          active,
          depth + 1,
        ),
        span,
      });
    }
    if (tag === "not") {
      return Object.freeze({
        tag,
        proposition: snapshot_proposition(
          own_value<PrefixProposition>(proposition, "proposition"),
          active,
          depth + 1,
          budget,
        ),
        span,
      });
    }
    if (tag === "and" || tag === "or" || tag === "implies") {
      return Object.freeze({
        tag,
        left: snapshot_proposition(
          own_value<PrefixProposition>(proposition, "left"),
          active,
          depth + 1,
          budget,
        ),
        right: snapshot_proposition(
          own_value<PrefixProposition>(proposition, "right"),
          active,
          depth + 1,
          budget,
        ),
        span,
      });
    }
    if (tag === "forall" || tag === "exists") {
      const binder = own_value<PrefixSignatureBinder>(proposition, "binder");
      return Object.freeze({
        tag,
        binder: snapshot_parameters(
          [binder],
          "proposition binder",
          active,
          depth + 1,
        )[0],
        proposition: snapshot_proposition(
          own_value<PrefixProposition>(proposition, "proposition"),
          active,
          depth + 1,
          budget,
        ),
        span,
      });
    }
    tag satisfies never;
    throw new Error("Invalid prefix proposition tag.");
  } finally {
    active.delete(proposition);
  }
}

function snapshot_terms(
  terms: readonly PrefixTerm[],
  label: string,
): readonly PrefixTerm[] {
  assert_plain_array(terms, `Prefix ${label} clauses`);
  const result: PrefixTerm[] = [];
  const count = own_array_length(terms, `Prefix ${label} clauses`);
  for (let index = 0; index < count; index += 1) {
    const term = own_array_value(terms, index, `Prefix ${label} clauses`);
    expect(term !== undefined, `Prefix ${label} clauses cannot contain holes.`);
    result.push(snapshot_term(term));
  }
  return Object.freeze(result);
}

function snapshot_proof_term(
  proof: PrefixProofTerm,
  active: WeakSet<object> = new WeakSet<object>(),
  depth = 0,
  budget: { nodes: number } = { nodes: 0 },
): PrefixProofTerm {
  assert_record(proof, "Prefix proof term");
  budget.nodes += 1;
  expect(
    budget.nodes <= maximum_prefix_proof_snapshot_nodes,
    "Prefix proof snapshot exceeded " +
      maximum_prefix_proof_snapshot_nodes.toString() + " nodes.",
  );
  expect(depth <= 256, "Prefix proof term nesting exceeds 256 levels.");
  expect(!active.has(proof), "Prefix proof term cannot be cyclic.");
  active.add(proof);
  try {
    const tag = own_value<PrefixProofTerm["tag"]>(proof, "tag");
    const span = snapshot_span(own_value<PrefixSpan>(proof, "span"));
    if (tag === "name") {
      return Object.freeze({
        tag,
        name: require_text(
          own_value<string>(proof, "name"),
          "Prefix proof name",
        ),
        span,
      });
    }
    if (tag === "refl" || tag === "true_intro") {
      return Object.freeze({ tag, span });
    }
    if (tag === "unsafe_assume") {
      return Object.freeze({
        tag,
        proposition: snapshot_proposition(
          own_value<PrefixProposition>(proof, "proposition"),
          new WeakSet<object>(),
          0,
          budget,
        ),
        span,
      });
    }
    if (tag === "lambda") {
      return Object.freeze({
        tag,
        name: require_text(
          own_value<string>(proof, "name"),
          "Prefix proof binder",
        ),
        body: snapshot_proof_term(
          own_value<PrefixProofTerm>(proof, "body"),
          active,
          depth + 1,
          budget,
        ),
        span,
      });
    }
    if (
      tag === "symm" || tag === "and_left" || tag === "and_right" ||
      tag === "or_left" || tag === "or_right" || tag === "false_elim"
    ) {
      return Object.freeze({
        tag,
        proof: snapshot_proof_term(
          own_value<PrefixProofTerm>(proof, "proof"),
          active,
          depth + 1,
          budget,
        ),
        span,
      });
    }
    if (tag === "or_cases") {
      return Object.freeze({
        tag,
        proof: snapshot_proof_term(
          own_value<PrefixProofTerm>(proof, "proof"),
          active,
          depth + 1,
          budget,
        ),
        left_name: require_text(
          own_value<string>(proof, "left_name"),
          "Prefix proof left binder",
        ),
        left_body: snapshot_proof_term(
          own_value<PrefixProofTerm>(proof, "left_body"),
          active,
          depth + 1,
          budget,
        ),
        right_name: require_text(
          own_value<string>(proof, "right_name"),
          "Prefix proof right binder",
        ),
        right_body: snapshot_proof_term(
          own_value<PrefixProofTerm>(proof, "right_body"),
          active,
          depth + 1,
          budget,
        ),
        span,
      });
    }
    if (tag === "forall_apply") {
      return Object.freeze({
        tag,
        proof: snapshot_proof_term(
          own_value<PrefixProofTerm>(proof, "proof"),
          active,
          depth + 1,
          budget,
        ),
        argument: snapshot_term(
          own_value<PrefixTerm>(proof, "argument"),
          new WeakSet<object>(),
          0,
          budget,
        ),
        span,
      });
    }
    if (tag === "exists_intro") {
      return Object.freeze({
        tag,
        witness: snapshot_term(
          own_value<PrefixTerm>(proof, "witness"),
          new WeakSet<object>(),
          0,
          budget,
        ),
        proof: snapshot_proof_term(
          own_value<PrefixProofTerm>(proof, "proof"),
          active,
          depth + 1,
          budget,
        ),
        span,
      });
    }
    if (tag === "exists_elim") {
      return Object.freeze({
        tag,
        proof: snapshot_proof_term(
          own_value<PrefixProofTerm>(proof, "proof"),
          active,
          depth + 1,
          budget,
        ),
        witness_name: require_text(
          own_value<string>(proof, "witness_name"),
          "Prefix existential witness binder",
        ),
        evidence_name: require_text(
          own_value<string>(proof, "evidence_name"),
          "Prefix existential evidence binder",
        ),
        body: snapshot_proof_term(
          own_value<PrefixProofTerm>(proof, "body"),
          active,
          depth + 1,
          budget,
        ),
        span,
      });
    }
    if (tag === "congr") {
      return Object.freeze({
        tag,
        parameter_name: require_text(
          own_value<string>(proof, "parameter_name"),
          "Prefix congruence parameter",
        ),
        function: snapshot_term(
          own_value<PrefixTerm>(proof, "function"),
          new WeakSet<object>(),
          0,
          budget,
        ),
        proof: snapshot_proof_term(
          own_value<PrefixProofTerm>(proof, "proof"),
          active,
          depth + 1,
          budget,
        ),
        span,
      });
    }
    if (tag === "transport") {
      return Object.freeze({
        tag,
        equality: snapshot_proof_term(
          own_value<PrefixProofTerm>(proof, "equality"),
          active,
          depth + 1,
          budget,
        ),
        motive_name: require_text(
          own_value<string>(proof, "motive_name"),
          "Prefix transport motive parameter",
        ),
        motive: snapshot_proposition(
          own_value<PrefixProposition>(proof, "motive"),
          new WeakSet<object>(),
          0,
          budget,
        ),
        proof: snapshot_proof_term(
          own_value<PrefixProofTerm>(proof, "proof"),
          active,
          depth + 1,
          budget,
        ),
        span,
      });
    }
    if (tag === "tactics") {
      const commands = own_value<readonly PrefixTacticCommand[]>(
        proof,
        "commands",
      );
      expect(
        Array.isArray(commands),
        "Prefix tactic commands must be an array.",
      );
      expect(
        Object.getPrototypeOf(commands) === Array.prototype,
        "Prefix tactic commands must be an ordinary array.",
      );
      const command_count = own_array_length(
        commands,
        "Prefix tactic commands",
      );
      expect(
        command_count <= maximum_prefix_proof_snapshot_nodes - budget.nodes,
        "Prefix proof snapshot exceeded " +
          maximum_prefix_proof_snapshot_nodes.toString() + " nodes.",
      );
      assert_plain_array(commands, "Prefix tactic commands");
      const stable_commands: PrefixTacticCommand[] = [];
      for (let index = 0; index < command_count; index += 1) {
        budget.nodes += 1;
        expect(
          budget.nodes <= maximum_prefix_proof_snapshot_nodes,
          "Prefix proof snapshot exceeded " +
            maximum_prefix_proof_snapshot_nodes.toString() + " nodes.",
        );
        const command = own_array_value(
          commands,
          index,
          "Prefix tactic commands",
        );
        expect(
          command !== undefined,
          "Prefix tactic commands cannot contain holes.",
        );
        assert_record(command, "Prefix tactic command");
        const command_span = snapshot_span(
          own_value<PrefixSpan>(command, "span"),
        );
        const command_tag = own_value<PrefixTacticCommand["tag"]>(
          command,
          "tag",
        );
        if (
          command_tag === "exact" || command_tag === "apply" ||
          command_tag === "cases"
        ) {
          stable_commands.push(Object.freeze({
            tag: command_tag,
            proof: snapshot_proof_term(
              own_value<PrefixProofTerm>(command, "proof"),
              active,
              depth + 1,
              budget,
            ),
            span: command_span,
          }));
          continue;
        }
        if (command_tag === "intro") {
          stable_commands.push(Object.freeze({
            tag: command_tag,
            name: require_text(
              own_value<string>(command, "name"),
              "Prefix tactic binder",
            ),
            span: command_span,
          }));
          continue;
        }
        if (
          command_tag === "assumption" || command_tag === "constructor" ||
          command_tag === "left" || command_tag === "right"
        ) {
          stable_commands.push(Object.freeze({
            tag: command_tag,
            span: command_span,
          }));
          continue;
        }
        command_tag satisfies never;
        throw new Error("Invalid prefix tactic command.");
      }
      return Object.freeze({
        tag,
        commands: Object.freeze(stable_commands),
        span,
      });
    }
    if (
      tag === "trans" || tag === "and_intro" || tag === "implies_apply"
    ) {
      return Object.freeze({
        tag,
        left: snapshot_proof_term(
          own_value<PrefixProofTerm>(proof, "left"),
          active,
          depth + 1,
          budget,
        ),
        right: snapshot_proof_term(
          own_value<PrefixProofTerm>(proof, "right"),
          active,
          depth + 1,
          budget,
        ),
        span,
      });
    }
    tag satisfies never;
    throw new Error("Invalid prefix proof term.");
  } finally {
    active.delete(proof);
  }
}

function snapshot_term(
  term: PrefixTerm,
  active: WeakSet<object> = new WeakSet<object>(),
  depth = 0,
  budget: { nodes: number } = { nodes: 0 },
): PrefixTerm {
  assert_record(term, "Prefix term");
  budget.nodes += 1;
  expect(
    budget.nodes <= maximum_prefix_term_snapshot_nodes,
    "Prefix term snapshot exceeded " +
      maximum_prefix_term_snapshot_nodes.toString() + " nodes.",
  );
  expect(depth <= 256, "Prefix term nesting exceeds 256 levels.");
  expect(!active.has(term), "Prefix term cannot be cyclic.");
  active.add(term);
  const text = own_value<string>(term, "text");
  const references = own_value<readonly string[]>(term, "references");
  const shape = own_value<PrefixTermShape>(term, "shape");
  const span = own_value<PrefixSpan>(term, "span");
  const snapshot = Object.freeze({
    text: require_text(text, "Prefix term"),
    references: snapshot_texts(references, "term references"),
    shape: snapshot_term_shape(shape, active, depth, budget),
    span: snapshot_span(span),
  });
  active.delete(term);
  return snapshot;
}

function snapshot_term_shape(
  shape: PrefixTermShape,
  active: WeakSet<object>,
  depth: number,
  budget: { nodes: number },
): PrefixTermShape {
  assert_record(shape, "Prefix term shape");
  const tag = own_value<PrefixTermShape["tag"]>(shape, "tag");
  if (
    tag === "number" || tag === "string" || tag === "character" ||
    tag === "boolean" || tag === "unsupported"
  ) {
    return Object.freeze({ tag });
  }
  if (tag === "name") {
    return Object.freeze({
      tag,
      name: require_text(own_value<string>(shape, "name"), "Prefix term name"),
    });
  }
  if (tag === "binary") {
    return Object.freeze({
      tag,
      operator: require_text(
        own_value<string>(shape, "operator"),
        "Prefix binary operator",
      ),
      left: snapshot_term(
        own_value<PrefixTerm>(shape, "left"),
        active,
        depth + 1,
        budget,
      ),
      right: snapshot_term(
        own_value<PrefixTerm>(shape, "right"),
        active,
        depth + 1,
        budget,
      ),
    });
  }
  if (tag === "unary") {
    return Object.freeze({
      tag,
      operator: require_text(
        own_value<string>(shape, "operator"),
        "Prefix unary operator",
      ),
      operand: snapshot_term(
        own_value<PrefixTerm>(shape, "operand"),
        active,
        depth + 1,
        budget,
      ),
    });
  }
  if (tag === "call") {
    const arguments_value = own_value<readonly PrefixTerm[]>(
      shape,
      "arguments",
    );
    assert_plain_array(arguments_value, "Prefix call arguments");
    const arguments_snapshot: PrefixTerm[] = [];
    for (
      let index = 0;
      index < own_array_length(arguments_value, "Prefix call arguments");
      index += 1
    ) {
      const argument = own_array_value(
        arguments_value,
        index,
        "Prefix call arguments",
      );
      expect(argument !== undefined, "Prefix call arguments contain a hole.");
      arguments_snapshot.push(
        snapshot_term(argument, active, depth + 1, budget),
      );
    }
    return Object.freeze({
      tag,
      function: snapshot_term(
        own_value<PrefixTerm>(shape, "function"),
        active,
        depth + 1,
        budget,
      ),
      arguments: Object.freeze(arguments_snapshot),
    });
  }
  if (tag === "field") {
    return Object.freeze({
      tag,
      object: snapshot_term(
        own_value<PrefixTerm>(shape, "object"),
        active,
        depth + 1,
        budget,
      ),
      field: require_text(
        own_value<string>(shape, "field"),
        "Prefix field name",
      ),
    });
  }
  if (tag === "index") {
    return Object.freeze({
      tag,
      object: snapshot_term(
        own_value<PrefixTerm>(shape, "object"),
        active,
        depth + 1,
        budget,
      ),
    });
  }
  if (tag === "parenthesized") {
    return Object.freeze({
      tag,
      value: snapshot_term(
        own_value<PrefixTerm>(shape, "value"),
        active,
        depth + 1,
        budget,
      ),
    });
  }
  tag satisfies never;
  throw new Error("Invalid prefix term shape.");
}

function snapshot_texts(
  values: readonly string[],
  label: string,
): readonly string[] {
  expect(Array.isArray(values), `Prefix ${label} clauses must be an array.`);
  assert_plain_array(values, `Prefix ${label} clauses`);
  const value_count = own_array_length(values, `Prefix ${label} clauses`);
  const result: string[] = [];
  for (let index = 0; index < value_count; index += 1) {
    const value = own_array_value(values, index, `Prefix ${label} clauses`);
    expect(
      value !== undefined,
      `Prefix ${label} clauses cannot contain holes.`,
    );
    result.push(require_text(value, `Prefix ${label} clause`));
  }
  return Object.freeze(result);
}

function snapshot_span(
  span: { start: number; end: number },
): { start: number; end: number } {
  assert_record(span, "Prefix signature span");
  const start = own_value<number>(span, "start");
  const end = own_value<number>(span, "end");
  expect(
    Number.isSafeInteger(start) && start >= 0,
    "Prefix signature span start is invalid.",
  );
  expect(
    Number.isSafeInteger(end) && end >= start,
    "Prefix signature span end is invalid.",
  );
  return Object.freeze({ start, end });
}

function assert_record(value: object, label: string): void {
  expect(
    value !== null && typeof value === "object",
    `${label} must be an object.`,
  );
  const prototype = Object.getPrototypeOf(value);
  expect(
    prototype === Object.prototype || prototype === null,
    `${label} must be a plain record.`,
  );
  const keys = Reflect.ownKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    expect(
      key !== undefined && typeof key === "string",
      `${label} cannot contain symbol properties.`,
    );
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(
      descriptor !== undefined && descriptor.get === undefined &&
        descriptor.set === undefined,
      `${label} cannot contain accessors.`,
    );
  }
}

function require_own_data(value: object, key: string): void {
  expect(
    Object.prototype.hasOwnProperty.call(value, key),
    `Missing own prefix property ${key}.`,
  );
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  expect(
    descriptor !== undefined && descriptor.get === undefined &&
      descriptor.set === undefined,
    `Prefix property ${key} must be an own data property.`,
  );
}

function own_value<Value>(value: object, key: string): Value {
  require_own_data(value, key);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  expect(
    descriptor !== undefined && "value" in descriptor,
    `Prefix property ${key} must be a data property.`,
  );
  return descriptor.value as Value;
}

function own_array_value<Value>(
  value: readonly Value[],
  index: number,
  label: string,
): Value | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
  expect(
    descriptor !== undefined && descriptor.get === undefined &&
      descriptor.set === undefined,
    `${label} cannot contain holes or accessors.`,
  );
  return descriptor.value as Value;
}

function own_array_length(value: readonly unknown[], label: string): number {
  const descriptor = Object.getOwnPropertyDescriptor(value, "length");
  expect(
    descriptor !== undefined && descriptor.get === undefined &&
      descriptor.set === undefined,
    `${label} length must be a data property.`,
  );
  expect(
    Number.isSafeInteger(descriptor.value) && descriptor.value >= 0,
    `${label} length is invalid.`,
  );
  return descriptor.value as number;
}

function assert_plain_array(value: readonly unknown[], label: string): void {
  expect(Array.isArray(value), `${label} must be an array.`);
  expect(
    Object.getPrototypeOf(value) === Array.prototype,
    `${label} must be an ordinary array.`,
  );
  const keys = Reflect.ownKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    expect(
      key !== undefined && typeof key === "string",
      `${label} cannot contain symbol properties.`,
    );
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(
      descriptor !== undefined && descriptor.get === undefined &&
        descriptor.set === undefined,
      `${label} cannot contain accessors.`,
    );
  }
  const length = own_array_length(value, label);
  for (let index = 0; index < length; index += 1) {
    expect(
      Object.getOwnPropertyDescriptor(value, String(index)) !== undefined,
      `${label} cannot contain holes.`,
    );
  }
}

function require_text(value: string, label: string): string {
  expect(
    typeof value === "string" && value.length > 0,
    `${label} must not be empty.`,
  );
  return value;
}

function require_kind(kind: PrefixSignatureKind): void {
  expect(
    kind === "let" || kind === "const" || kind === "fact" ||
      kind === "opaque fact",
    "Invalid prefix signature kind.",
  );
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
