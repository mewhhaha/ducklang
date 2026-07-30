import { Applicative } from "@mewhhaha/typeclasses";
import type { Core } from "./core/ast.ts";
import { core_from_source } from "./core/from_source.ts";
import {
  integer_maximum,
  integer_type_from_name,
  integer_type_name,
} from "./integer.ts";
import {
  compiler_diagnostic,
  type CompilerDiagnostic,
  CompilerDiagnosticError,
  diagnostic_codes,
  diagnostic_sequence,
} from "./diagnostic.ts";
import { expect } from "./expect.ts";
import {
  all,
  type Checked,
  checked_value,
  diagnostics_of,
  fail,
  ok,
} from "./frontend/checked.ts";
import {
  type BabaCstNode,
  type BabaParseResult,
  is_trusted_baba_parse_result,
} from "./frontend/baba_parser.ts";
import type { Source as SourceNode } from "./frontend/ast.ts";
import type { Stmt } from "./frontend/ast.ts";
import {
  analyze_baba_semantics,
  type BabaSemanticAnalyzeOptions,
} from "./frontend/baba_analyze.ts";
import {
  type BindingIndex,
  build_binding_index,
  type EntityId,
} from "./frontend/binding_index.ts";
import { lower_baba_source } from "./frontend/baba_lower.ts";
import { substitute_type_expr } from "./frontend/baba_declaration_lower.ts";
import { lower_baba_type_reference } from "./frontend/baba_type_lower.ts";
import { apply_function_result_context } from "./frontend/function_context.ts";
import { format_type_expr } from "./frontend/type_expr.ts";
import { check_source_for_gpufuck } from "./frontend/gpufuck_pipeline.ts";
import { source_with_host_interface } from "./frontend/host_interface.ts";
import { parse_number_expr } from "./frontend/number_literal.ts";
import { is_snake_case } from "./frontend/names.ts";
import {
  representation_type_of_source_type,
  resolved_name_of_source_type,
  source_facts,
} from "./frontend/source_facts.ts";
import type { SourceDiagnostic } from "./frontend/semantic_diagnostic.ts";
import type {
  SemanticCallableControlFlow,
  SemanticCfg,
} from "./frontend/semantic_cfg.ts";
import { semantic_cfgs_from_source } from "./frontend/semantic_cfg_lower.ts";
import {
  has_source_span,
  mark_source_span,
  mark_source_syntax,
  source_span,
  type SourceSpan,
  type SourceSyntax,
  type SyntaxDiagnostic,
} from "./frontend/syntax.ts";
import {
  baba_source_syntax,
  record_baba_source_name_sites,
} from "./frontend/source_parse.ts";
import {
  SemanticIdentityAllocator,
  type SemanticOrigin,
  type ValueId,
} from "./frontend/semantic_identity.ts";
import {
  type RepresentationType,
  same_representation_type,
  snapshot_representation_type,
} from "./frontend/representation_type.ts";
import type { FactState } from "./frontend/fact_graph.ts";
import {
  check_proof,
  type KernelCertificate,
  type ProofTerm,
  type Proposition,
} from "./frontend/proof_kernel.ts";
import {
  type KernelContext,
  KernelEnvironment,
  type KernelTerm,
  type KernelType,
  snapshot_kernel_context,
  type_sort,
} from "./frontend/kernel_terms.ts";
import type { FunctionFactSummary } from "./frontend/function_summary.ts";
import type { TypeExpr } from "./type_syntax.ts";
import {
  associate_prefix_signatures,
  type PrefixDefinition,
  type PrefixProofTerm,
  type PrefixProposition,
  type PrefixRefinement,
  type PrefixSignature,
  type PrefixTerm,
  type PrefixTypeReference,
} from "./frontend/prefix_signature.ts";
import { extract_prefix_source_metadata } from "./frontend/prefix_signature_source.ts";

export type SemanticSymbolIndex = ReadonlyMap<string, readonly ValueId[]>;
export type SemanticTypeIndex = ReadonlyMap<ValueId, RepresentationType>;
export type RefinementIndex = ReadonlyMap<ValueId, FactState>;
export type CheckedKernelCertificate = {
  certificate: KernelCertificate;
  environment: KernelEnvironment;
  term_context: KernelContext;
};
export type KernelCertificateIndex = ReadonlyMap<
  string,
  CheckedKernelCertificate
>;
export type SourceOriginIndex = ReadonlyMap<ValueId, SemanticOrigin>;
export type FunctionFactIndex = ReadonlyMap<string, FunctionFactSummary>;
export type SemanticCallableCfgIndex = ReadonlyMap<
  ValueId,
  SemanticCallableControlFlow
>;

export type DuckSourceAnalysis = {
  source: SourceNode;
  syntax: SourceSyntax;
  syntax_diagnostics: SyntaxDiagnostic[];
  diagnostics: SourceDiagnostic[];
};

export type DuckAnalysis = {
  parsed: BabaParseResult;
  source: SourceNode;
  source_analysis: DuckSourceAnalysis;
  diagnostics: readonly SourceDiagnostic[];
  control_flow: SemanticCfg | undefined;
  callable_control_flow: SemanticCallableCfgIndex;
  symbols: SemanticSymbolIndex;
  types: SemanticTypeIndex;
  facts: RefinementIndex;
  proofs: KernelCertificateIndex;
  origins: SourceOriginIndex;
  function_summaries: FunctionFactIndex;
};

export type DuckSemanticProgram = {
  core: Core;
  symbols: SemanticSymbolIndex;
  types: SemanticTypeIndex;
  facts: RefinementIndex;
  proofs: KernelCertificateIndex;
  origins: SourceOriginIndex;
  function_summaries: FunctionFactIndex;
};

const checked_duck_analyses = new WeakSet<DuckAnalysis>();
const checked_duck_analysis_state = new WeakMap<
  DuckAnalysis,
  {
    has_errors: boolean;
    source_fingerprint: string;
  }
>();
const checked_semantic_program_sources = new WeakMap<
  DuckSemanticProgram,
  SourceNode
>();
const weak_map_get = WeakMap.prototype.get;
const weak_map_set = WeakMap.prototype.set;
const weak_set_add = WeakSet.prototype.add;
const weak_set_has = WeakSet.prototype.has;

export function is_checked_duck_semantic_program_for_source(
  program: unknown,
  source: SourceNode,
): program is DuckSemanticProgram {
  if (program === null || typeof program !== "object") return false;
  return Reflect.apply(weak_map_get, checked_semantic_program_sources, [
    program as DuckSemanticProgram,
  ]) === source;
}

export type DuckAnalyzeOptions = BabaSemanticAnalyzeOptions & {
  host_interface?: SourceNode;
  uri?: string;
};

class FrozenMap<Key, Value> implements ReadonlyMap<Key, Value> {
  readonly #entries: Map<Key, Value>;

  constructor(entries: Iterable<readonly [Key, Value]>) {
    this.#entries = new Map(entries);
    Object.freeze(this);
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: Key): Value | undefined {
    return this.#entries.get(key);
  }

  has(key: Key): boolean {
    return this.#entries.has(key);
  }

  entries(): MapIterator<[Key, Value]> {
    return this.#entries.entries();
  }

  keys(): MapIterator<Key> {
    return this.#entries.keys();
  }

  values(): MapIterator<Value> {
    return this.#entries.values();
  }

  forEach(
    callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void,
  ): void {
    this.#entries.forEach((value, key) => callback(value, key, this));
  }

  [Symbol.iterator](): MapIterator<[Key, Value]> {
    return this.entries();
  }
}

export function analyze_duck_source(
  parsed: BabaParseResult,
  options: DuckAnalyzeOptions = {},
): DuckAnalysis {
  const stable_input = snapshot_baba_parse_result(parsed);
  const source_metadata = extract_prefix_source_metadata(stable_input);
  const prefix_signatures = source_metadata.signatures.filter((signature) =>
    !span_contains_parse_diagnostic(signature.span, stable_input.diagnostics)
  );
  const prefix_definitions = source_metadata.definitions.filter((definition) =>
    !span_contains_parse_diagnostic(definition.span, stable_input.diagnostics)
  );
  const lowering = lower_baba_source(stable_input);
  const lowering_diagnostics = diagnostics_of(lowering);
  let source = checked_value(lowering);
  if (source === undefined) {
    source = { tag: "program", statements: [] };
    mark_source_span(source, { start: 0, end: stable_input.cst.text.length });
  }
  const prefix_type_application = apply_prefix_signature_types(
    source,
    stable_input.cst.root,
    stable_input.cst.text,
    prefix_signatures,
    prefix_definitions,
  );
  const prefix_type_diagnostics = diagnostics_of(prefix_type_application);
  const syntax = baba_source_syntax(stable_input);
  mark_source_syntax(source, syntax);
  record_baba_source_name_sites(source, syntax);
  let analysis_source = source;
  if (options.host_interface !== undefined) {
    analysis_source = source_with_host_interface(
      analysis_source,
      options.host_interface,
    );
  }
  let semantic_diagnostics: SourceDiagnostic[] = [];
  if (
    stable_input.diagnostics.length === 0 &&
    lowering_diagnostics.length === 0 &&
    prefix_type_diagnostics.length === 0
  ) {
    semantic_diagnostics = analyze_baba_semantics(
      analysis_source,
      options,
    );
  }
  const source_analysis: DuckSourceAnalysis = {
    source: analysis_source,
    syntax,
    syntax_diagnostics: [...stable_input.diagnostics],
    diagnostics: diagnostic_sequence(semantic_diagnostics, options.uri),
  };
  // Definitions are syntax-owned. Caller-supplied metadata must not be able
  // to manufacture a matching definition and suppress a source diagnostic.
  const signature_diagnostics = diagnostics_of(
    associate_prefix_signatures(
      prefix_signatures,
      prefix_definitions,
    ),
  );
  const identity = new SemanticIdentityAllocator("duck-program");
  const binding_index = build_binding_index({
    source: source_analysis.source,
    syntax,
    recovery_intervals: stable_input.recovery_intervals,
  });
  const symbols = new Map<string, ValueId[]>();
  const types = new Map<ValueId, RepresentationType>();
  const origins = new Map<ValueId, SemanticOrigin>();
  const binding_values = collect_semantic_bindings(
    binding_index,
    stable_input.cst.root,
    identity,
    symbols,
    types,
    origins,
  );
  const contract_validation = validate_prefix_contracts(
    prefix_signatures,
    prefix_definitions,
    source_analysis.source,
    stable_input.cst.root,
    stable_input.cst.text,
    symbols,
    types,
    origins,
  );
  const diagnostics = diagnostic_sequence([
    ...stable_input.diagnostics.map((diagnostic) =>
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        diagnostic.message,
        diagnostic.span,
      )
    ),
    ...source_analysis.diagnostics,
    ...lowering_diagnostics,
    ...prefix_type_diagnostics,
    ...signature_diagnostics,
    ...contract_validation.diagnostics,
  ], options.uri);
  let control_flow: SemanticCfg | undefined;
  let callable_control_flow: SemanticCallableCfgIndex = new FrozenMap([]);
  if (!has_error_diagnostics(diagnostics)) {
    const control_flows = semantic_cfgs_from_source(
      source_analysis.source,
      stable_input.cst.root,
      binding_index,
      binding_values,
      origins,
    );
    control_flow = control_flows.root;
    callable_control_flow = new FrozenMap(control_flows.callables);
  }
  freeze_semantic_graph(source_analysis.syntax_diagnostics);
  freeze_semantic_graph(source_analysis.diagnostics);
  Object.freeze(source_analysis);
  freeze_semantic_graph(diagnostics);
  const analysis: DuckAnalysis = {
    parsed: stable_input,
    source: source_analysis.source,
    source_analysis,
    diagnostics,
    control_flow,
    callable_control_flow,
    symbols: freeze_symbol_index(symbols),
    types: new FrozenMap(types),
    facts: new FrozenMap<ValueId, FactState>([]),
    proofs: new FrozenMap(contract_validation.proofs),
    origins: new FrozenMap(origins),
    function_summaries: new FrozenMap<string, FunctionFactSummary>([]),
  };
  Object.freeze(analysis);
  Reflect.apply(weak_map_set, checked_duck_analysis_state, [
    analysis,
    Object.freeze({
      has_errors: has_error_diagnostics(analysis.diagnostics),
      source_fingerprint: semantic_graph_fingerprint(analysis.source),
    }),
  ]);
  Reflect.apply(weak_set_add, checked_duck_analyses, [analysis]);
  return analysis;
}

function span_contains_parse_diagnostic(
  span: SourceSpan,
  diagnostics: readonly SyntaxDiagnostic[],
): boolean {
  return diagnostics.some((diagnostic) =>
    diagnostic.span.start >= span.start &&
    diagnostic.span.start <= span.end
  );
}

function apply_prefix_signature_types(
  source: SourceNode,
  cst_root: BabaCstNode | undefined,
  source_text: string,
  signatures: readonly PrefixSignature[],
  definitions: readonly PrefixDefinition[],
): Checked<SourceNode> {
  const applications: Checked<null>[] = [];
  for (const signature of signatures) {
    const binder_check = check_prefix_binder_names(signature, definitions);
    applications.push(binder_check.map(() => null));
    if (diagnostics_of(binder_check).length > 0) continue;
    if (signature.kind === "fact" || signature.kind === "opaque fact") {
      continue;
    }
    if (signature.type.result.type.proof !== undefined) continue;
    const proof_parameter = signature.type.parameters.find((parameter) =>
      parameter.type.proof !== undefined
    );
    if (proof_parameter !== undefined) {
      applications.push(
        fail(
          compiler_diagnostic(
            diagnostic_codes.prefix_proof_invalid,
            `Prefix signature ${signature.name} cannot yet erase explicit proof parameter ${proof_parameter.name} from a runtime-returning definition.`,
            proof_parameter.span,
          ),
        ),
      );
      continue;
    }
    const definition = definitions.find((candidate) =>
      candidate.name === signature.name &&
      candidate.scope === signature.scope &&
      candidate.span.start >= signature.span.end
    );
    if (definition === undefined) continue;
    const parameter_type_check = check_prefix_callable_parameter_types(
      signature,
      definition,
      source,
      cst_root,
      source_text,
    );
    applications.push(parameter_type_check.map(() => null));
    if (diagnostics_of(parameter_type_check).length > 0) continue;
    const binding = find_source_binding(
      source,
      signature.name,
      definition.span,
    );
    if (binding === undefined) {
      applications.push(
        fail(
          compiler_diagnostic(
            diagnostic_codes.prefix_signature_mismatch,
            `Prefix signature ${signature.name} cannot predeclare this structural or mutual definition.`,
            definition.span,
            [{ message: "Prefix signature is here.", span: signature.span }],
          ),
        ),
      );
      continue;
    }
    if (
      binding.annotation !== undefined ||
      binding.type_annotation !== undefined
    ) {
      applications.push(
        fail(
          compiler_diagnostic(
            diagnostic_codes.prefix_signature_mismatch,
            `Named callable ${signature.name} cannot combine a prefix signature with an inline annotation.`,
            definition.span,
            [{ message: "Prefix signature is here.", span: signature.span }],
          ),
        ),
      );
      continue;
    }
    const parameter_checks = signature.type.parameters.map((parameter) => {
      const type_node = find_cst_node(
        cst_root,
        parameter.type.span,
        "type_reference",
      );
      expect(
        type_node !== undefined,
        `Prefix parameter ${parameter.name} lost its Baba type node.`,
      );
      return lower_baba_type_reference(type_node, source_text);
    });
    const result_node = find_cst_node(
      cst_root,
      signature.type.result.type.span,
      "type_reference",
    );
    expect(
      result_node !== undefined,
      `Prefix signature ${signature.name} lost its Baba result type node.`,
    );
    const result_check = lower_baba_type_reference(result_node, source_text);
    let lowered_parameters: Checked<TypeExpr[]> = ok([]);
    for (const parameter_check of parameter_checks) {
      lowered_parameters = Applicative.lift(
        (parameters: TypeExpr[], parameter: TypeExpr) => [
          ...parameters,
          parameter,
        ],
        lowered_parameters,
        parameter_check,
      );
    }
    applications.push(
      Applicative.lift(
        (parameters: TypeExpr[], result: TypeExpr) => {
          let parameter_type: TypeExpr;
          if (parameters.length === 1) {
            const only_parameter = parameters[0];
            expect(
              only_parameter !== undefined,
              `Prefix signature ${signature.name} lost its parameter type.`,
            );
            parameter_type = only_parameter;
          } else {
            parameter_type = {
              tag: "product",
              entries: parameters.map((type_expr) => ({ type_expr })),
              value_pack: true,
            };
            mark_source_span(parameter_type, signature.type.span);
          }
          let annotation: TypeExpr = {
            tag: "arrow",
            param: parameter_type,
            effects: undefined,
            result,
          };
          mark_source_span(annotation, signature.type.span);
          const type_parameters = signature.type.binders.filter((binder) =>
            binder.type.canonical === "Type"
          ).map((binder) => binder.name);
          if (type_parameters.length > 0) {
            annotation = {
              tag: "forall",
              params: type_parameters,
              body: annotation,
            };
            mark_source_span(annotation, signature.type.span);
          }
          binding.annotation = format_type_expr(annotation);
          binding.type_annotation = annotation;
          if (binding.pattern?.tag === "binding") {
            binding.pattern.annotation = binding.annotation;
            binding.pattern.type_annotation = annotation;
          }
          binding.value = apply_function_result_context(
            binding.value,
            annotation,
          );
          return null;
        },
        lowered_parameters,
        result_check,
      ),
    );
  }
  return all(applications).map(() => source);
}

function find_source_binding(
  root: object,
  name: string,
  span: SourceSpan,
): Extract<Stmt, { tag: "bind" }> | undefined {
  const pending: object[] = [root];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    expect(current !== undefined, "Prefix binding traversal lost a node.");
    if (visited.has(current)) continue;
    visited.add(current);
    if (
      "tag" in current && current.tag === "bind" &&
      "name" in current && current.name === name &&
      has_source_span(current)
    ) {
      const current_span = source_span(current);
      if (current_span.start === span.start && current_span.end === span.end) {
        return current as Extract<Stmt, { tag: "bind" }>;
      }
    }
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (
        descriptor === undefined || descriptor.get !== undefined ||
        descriptor.set !== undefined
      ) {
        continue;
      }
      const child = descriptor.value;
      if (child !== null && typeof child === "object") pending.push(child);
    }
  }
  return undefined;
}

function find_cst_node(
  node: BabaCstNode | undefined,
  span: SourceSpan,
  kind: string,
): BabaCstNode | undefined {
  if (
    node === undefined || node.start > span.start || node.end < span.end
  ) {
    return undefined;
  }
  if (
    node.kind === kind && node.start === span.start && node.end === span.end
  ) {
    return node;
  }
  for (const child of node.children) {
    const found = find_cst_node(child, span, kind);
    if (found !== undefined) return found;
  }
  return undefined;
}

function check_prefix_callable_parameter_types(
  signature: PrefixSignature,
  definition: PrefixDefinition,
  source: SourceNode,
  cst_root: BabaCstNode | undefined,
  source_text: string,
): Checked<undefined> {
  const parameters = definition.callable_parameters;
  const parameter_types = definition.callable_parameter_types;
  if (parameters === undefined || parameter_types === undefined) {
    return ok(undefined);
  }
  if (parameters.length !== signature.type.parameters.length) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_mismatch,
        `Prefix signature ${signature.name} does not match its definition parameters.`,
        definition.span,
        [{ message: "Signature is here.", span: signature.span }],
      ),
    );
  }
  expect(
    parameter_types.length === parameters.length,
    `Callable ${signature.name} parameter metadata is misaligned.`,
  );
  const checks: Checked<undefined>[] = [];
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index];
    const declared = signature.type.parameters[index];
    const inline_type = parameter_types[index];
    expect(
      parameter !== undefined && declared !== undefined,
      `Prefix callable ${signature.name} lost parameter ${index}.`,
    );
    if (
      inline_type === undefined ||
      inline_type.canonical === declared.type.canonical
    ) {
      continue;
    }
    const inline_node = find_cst_node(
      cst_root,
      inline_type.span,
      "type_reference",
    );
    const declared_node = find_cst_node(
      cst_root,
      declared.type.span,
      "type_reference",
    );
    expect(
      inline_node !== undefined && declared_node !== undefined,
      `Callable ${signature.name} lost a parameter type node.`,
    );
    const inline_check = lower_baba_type_reference(inline_node, source_text);
    const declared_check = lower_baba_type_reference(
      declared_node,
      source_text,
    );
    const lowered_types = Applicative.lift(
      (inline_expression: TypeExpr, declared_expression: TypeExpr) => {
        return [inline_expression, declared_expression] as const;
      },
      inline_check,
      declared_check,
    );
    const type_expressions = checked_value(lowered_types);
    if (type_expressions === undefined) {
      checks.push(lowered_types.map(() => undefined));
      continue;
    }
    const [inline_expression, declared_expression] = type_expressions;
    const inline_name = resolved_name_of_source_type(
      source,
      inline_expression,
    );
    const declared_name = resolved_name_of_source_type(
      source,
      declared_expression,
    );
    if (inline_name !== "unknown" && inline_name === declared_name) continue;
    checks.push(
      fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_mismatch,
          `Callable ${signature.name} parameter ${parameter} declares ${inline_type.text} but its prefix signature requires ${declared.type.text}.`,
          inline_type.span,
          [{
            message: "Prefix parameter is here.",
            span: declared.type.span,
          }],
        ),
      ),
    );
  }
  return all(checks).map(() => undefined);
}

function validate_prefix_contracts(
  signatures: readonly PrefixSignature[],
  definitions: readonly PrefixDefinition[],
  source: SourceNode,
  cst_root: BabaCstNode | undefined,
  source_text: string,
  symbols: ReadonlyMap<string, readonly ValueId[]>,
  types: ReadonlyMap<ValueId, RepresentationType>,
  origins: ReadonlyMap<ValueId, SemanticOrigin>,
): {
  diagnostics: CompilerDiagnostic[];
  proofs: ReadonlyMap<string, CheckedKernelCertificate>;
} {
  const transparent_aliases = new Map<string, string>();
  const transparent_type_definitions = new Map<
    string,
    TransparentTypeDefinition
  >();
  const declared_type_names = new Set<string>();
  let declarations = source.declarations;
  if (declarations === undefined) declarations = [];
  for (const declaration of declarations) {
    if (declaration.tag !== "type") continue;
    declared_type_names.add(declaration.name);
    if (
      declaration.body.tag !== "alias" || declaration.body.opaque === true
    ) continue;
    const declaration_node = find_cst_node(
      cst_root,
      source_span(declaration),
      "type_declaration_statement",
    );
    expect(
      declaration_node !== undefined,
      `Transparent type ${declaration.name} lost its Baba declaration.`,
    );
    const body_node = declaration_node.children.find((child) =>
      child.kind === "type_reference"
    );
    expect(
      body_node !== undefined,
      `Transparent type ${declaration.name} lost its Baba body.`,
    );
    const body = checked_value(
      lower_baba_type_reference(body_node, source_text),
    );
    expect(
      body !== undefined,
      `Transparent type ${declaration.name} has an invalid lowered body.`,
    );
    transparent_type_definitions.set(declaration.name, {
      parameters: declaration.params,
      body,
    });
    if (declaration.params.length === 0) {
      transparent_aliases.set(
        declaration.name,
        declaration.body.type_name,
      );
    }
  }
  const resolved_signatures = signatures.map((signature) => {
    const type_variables = new Set(
      signature.type.binders.map((binder) => binder.name),
    );
    return {
      ...signature,
      type: {
        ...signature.type,
        binders: signature.type.binders.map((binder) => ({
          ...binder,
          type: resolve_prefix_type_reference(
            binder.type,
            transparent_aliases,
            transparent_type_definitions,
            source,
            cst_root,
            source_text,
            new Set(),
          ),
        })),
        parameters: signature.type.parameters.map((parameter) => ({
          ...parameter,
          type: resolve_prefix_type_reference(
            parameter.type,
            transparent_aliases,
            transparent_type_definitions,
            source,
            cst_root,
            source_text,
            type_variables,
          ),
        })),
        result: {
          ...signature.type.result,
          type: resolve_prefix_type_reference(
            signature.type.result.type,
            transparent_aliases,
            transparent_type_definitions,
            source,
            cst_root,
            source_text,
            type_variables,
          ),
        },
      },
      requires: signature.requires.map((proposition) =>
        resolve_prefix_proposition_types(
          proposition,
          transparent_aliases,
          transparent_type_definitions,
          source,
          cst_root,
          source_text,
          type_variables,
        )
      ),
      ensures: signature.ensures.map((proposition) =>
        resolve_prefix_proposition_types(
          proposition,
          transparent_aliases,
          transparent_type_definitions,
          source,
          cst_root,
          source_text,
          type_variables,
        )
      ),
    };
  });
  const resolved_definitions = definitions.map((definition) => {
    const resolved: PrefixDefinition = { ...definition };
    if (definition.callable_parameter_types !== undefined) {
      resolved.callable_parameter_types = definition.callable_parameter_types
        .map(
          (type) => {
            if (type === undefined) return undefined;
            return {
              ...resolve_prefix_type_reference(
                type,
                transparent_aliases,
                transparent_type_definitions,
                source,
                cst_root,
                source_text,
                new Set(),
              ),
            };
          },
        );
    }
    if (definition.fact_body !== undefined) {
      const signature = signatures.find((candidate) =>
        candidate.name === definition.name &&
        candidate.scope === definition.scope &&
        candidate.span.start <= definition.span.start
      );
      const type_variables = new Set<string>();
      if (signature !== undefined) {
        for (const binder of signature.type.binders) {
          type_variables.add(binder.name);
        }
      }
      resolved.fact_body = resolve_prefix_proposition_types(
        definition.fact_body,
        transparent_aliases,
        transparent_type_definitions,
        source,
        cst_root,
        source_text,
        type_variables,
      );
    }
    return resolved;
  });
  const checks: Checked<
    { key: string; proof: CheckedKernelCertificate } | undefined
  >[] = [];
  for (const definition of resolved_definitions) {
    if (definition.callable_proof_body === undefined) continue;
    const signature = resolved_signatures.find((candidate) =>
      candidate.name === definition.name &&
      candidate.scope === definition.scope &&
      candidate.span.end <= definition.span.start
    );
    if (
      signature !== undefined &&
      signature.type.result.type.proof !== undefined
    ) {
      continue;
    }
    checks.push(
      fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          `Proof body for ${definition.name} requires a matching prefix signature with a Proof result.`,
          definition.callable_proof_body.span,
        ),
      ),
    );
  }
  for (const signature of resolved_signatures) {
    const signature_checks: Checked<undefined>[] = [
      check_prefix_binder_names(signature, resolved_definitions),
      check_prefix_proof_formation(
        signature,
        resolved_signatures,
        declared_type_names,
      ),
      check_prefix_refinement_formation(
        signature,
        resolved_signatures,
        declared_type_names,
      ),
      check_prefix_requires(
        signature,
        resolved_signatures,
        source_text,
        declared_type_names,
      ),
      check_prefix_decreases(
        signature,
        resolved_signatures,
        resolved_definitions,
      ),
      check_prefix_fact_definition(
        signature,
        resolved_signatures,
        resolved_definitions,
        source_text,
        declared_type_names,
      ),
      check_prefix_signature_representation(
        signature,
        resolved_definitions,
        source,
        cst_root,
        source_text,
        symbols,
        types,
        origins,
      ),
    ];
    checks.push(...signature_checks);
    if (diagnostics_of(all(signature_checks)).length > 0) continue;
    if (signature.type.result.type.proof !== undefined) {
      checks.push(
        check_prefix_proof_definition(
          signature,
          resolved_signatures,
          resolved_definitions,
          declared_type_names,
          cst_root,
        ),
      );
      continue;
    }
    for (
      let clause_index = 0;
      clause_index < signature.ensures.length;
      clause_index += 1
    ) {
      const ensures = signature.ensures[clause_index];
      expect(
        ensures !== undefined,
        `Prefix signature ${signature.name} lost ensures clause ${clause_index}.`,
      );
      checks.push(
        check_prefix_ensures(
          signature,
          ensures,
          clause_index,
          resolved_definitions,
          source_text,
          symbols,
          types,
          origins,
        ),
      );
    }
    const result_refinement = signature.type.result.type.refinement;
    if (result_refinement !== undefined) {
      checks.push(
        check_prefix_result_refinement(
          signature,
          result_refinement,
          resolved_definitions,
          source_text,
          symbols,
          types,
          origins,
        ),
      );
    }
  }
  const proofs = new Map<string, CheckedKernelCertificate>();
  for (const check of checks) {
    const proof = checked_value(check);
    if (proof !== undefined) {
      proofs.set(proof.key, proof.proof);
    }
  }
  return {
    diagnostics: diagnostics_of(all(checks)),
    proofs,
  };
}

function resolve_transparent_type_aliases(
  type_name: string,
  aliases: ReadonlyMap<string, string>,
  resolving = new Set<string>(),
): string {
  let resolved = "";
  let index = 0;
  while (index < type_name.length) {
    const character = type_name[index];
    expect(character !== undefined, "Canonical type character disappeared.");
    if (character === '"' || character === "'") {
      const quote = character;
      resolved += character;
      index += 1;
      let escaped = false;
      while (index < type_name.length) {
        const literal_character = type_name[index];
        expect(
          literal_character !== undefined,
          "Canonical singleton type character disappeared.",
        );
        resolved += literal_character;
        index += 1;
        if (escaped) {
          escaped = false;
        } else if (literal_character === "\\") {
          escaped = true;
        } else if (literal_character === quote) {
          break;
        }
      }
      continue;
    }
    if (!/[A-Za-z_]/.test(character)) {
      resolved += character;
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < type_name.length) {
      const next = type_name[end];
      expect(next !== undefined, "Canonical type name character disappeared.");
      if (!/[A-Za-z0-9_]/.test(next)) break;
      end += 1;
    }
    const name = type_name.slice(index, end);
    const target = aliases.get(name);
    if (target === undefined || resolving.has(name)) {
      resolved += name;
      index = end;
      continue;
    }
    const nested = new Set(resolving);
    nested.add(name);
    resolved += resolve_transparent_type_aliases(target, aliases, nested);
    index = end;
  }
  return resolved;
}

function resolve_prefix_type_reference(
  type: PrefixTypeReference,
  aliases: ReadonlyMap<string, string>,
  type_definitions: ReadonlyMap<string, TransparentTypeDefinition>,
  source: SourceNode,
  cst_root: BabaCstNode | undefined,
  source_text: string,
  type_variables: ReadonlySet<string>,
): PrefixTypeReference {
  let proof = type.proof;
  if (proof !== undefined) {
    proof = resolve_prefix_proposition_types(
      proof,
      aliases,
      type_definitions,
      source,
      cst_root,
      source_text,
      type_variables,
    );
  }
  let refinement = type.refinement;
  if (refinement !== undefined) {
    refinement = {
      ...refinement,
      proposition: resolve_prefix_proposition_types(
        refinement.proposition,
        aliases,
        type_definitions,
        source,
        cst_root,
        source_text,
        type_variables,
      ),
    };
  }
  const resolved_type = { ...type, proof, refinement };
  if (proof !== undefined) {
    return { ...resolved_type, canonical: "Proof", resolved: true };
  }
  const canonical = resolve_transparent_type_aliases(type.canonical, aliases);
  if (canonical === "Type" || canonical === "Prop") {
    return { ...resolved_type, canonical, resolved: true };
  }
  const type_node = find_cst_node(cst_root, type.span, "type_reference");
  expect(type_node !== undefined, "Prefix type reference lost its Baba node.");
  const lowered = checked_value(
    lower_baba_type_reference(type_node, source_text),
  );
  if (lowered !== undefined) {
    const normalized_expression = normalize_transparent_type_expression(
      lowered,
      type_definitions,
    );
    const type_variable_names = [
      ...canonical.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g),
    ].map((match) => match[0]).filter((name) => type_variables.has(name));
    const resolved_name = resolved_name_of_source_type(
      source,
      lowered,
      type_variables,
    );
    if (resolved_name !== "unknown") {
      if (type_variable_names.length > 0) {
        return {
          ...resolved_type,
          canonical,
          expression: normalized_expression,
          resolved: true,
        };
      }
      const representation = representation_type_of_source_type(
        source,
        lowered,
        type_variables,
      );
      let representation_name: string | undefined;
      if (representation !== undefined) {
        representation_name = logical_representation_name(representation);
      }
      return {
        ...resolved_type,
        canonical: resolved_name,
        expression: normalized_expression,
        representation: representation_name,
        resolved: true,
      };
    }
  }
  return { ...resolved_type, canonical };
}

function normalize_transparent_type_expression(
  type: TypeExpr,
  definitions: ReadonlyMap<string, TransparentTypeDefinition>,
  resolving = new Set<string>(),
): TypeExpr {
  const application = transparent_type_application(type);
  if (application !== undefined && !resolving.has(application.name)) {
    const definition = definitions.get(application.name);
    if (
      definition !== undefined &&
      definition.parameters.length === application.arguments.length
    ) {
      const substitutions = new Map<string, TypeExpr>();
      for (let index = 0; index < definition.parameters.length; index += 1) {
        const parameter = definition.parameters[index];
        const argument = application.arguments[index];
        expect(
          parameter !== undefined && argument !== undefined,
          `Transparent type ${application.name} lost argument ${index}.`,
        );
        substitutions.set(
          parameter,
          normalize_transparent_type_expression(
            argument,
            definitions,
            resolving,
          ),
        );
      }
      const nested = new Set(resolving);
      nested.add(application.name);
      return normalize_transparent_type_expression(
        substitute_type_expr(definition.body, substitutions),
        definitions,
        nested,
      );
    }
  }
  if (type.tag === "frozen" || type.tag === "borrow") {
    return {
      tag: type.tag,
      value: normalize_transparent_type_expression(
        type.value,
        definitions,
        resolving,
      ),
    };
  }
  if (type.tag === "union" || type.tag === "intersection") {
    const pending = [type.left, type.right];
    const members: TypeExpr[] = [];
    while (pending.length > 0) {
      const member = pending.pop();
      expect(member !== undefined, "Type-set member disappeared.");
      if (member.tag === type.tag) {
        pending.push(member.left, member.right);
        continue;
      }
      members.push(
        normalize_transparent_type_expression(
          member,
          definitions,
          resolving,
        ),
      );
    }
    members.sort((left, right) => {
      const left_name = format_type_expr(left);
      const right_name = format_type_expr(right);
      if (left_name < right_name) return -1;
      if (left_name > right_name) return 1;
      return 0;
    });
    const distinct_members = members.filter((member, index) => {
      if (index === 0) return true;
      const previous = members[index - 1];
      expect(previous !== undefined, "Sorted type-set member disappeared.");
      return format_type_expr(previous) !== format_type_expr(member);
    });
    const first_member = distinct_members[0];
    expect(first_member !== undefined, "Type set cannot lose every member.");
    let normalized = first_member;
    for (let index = 1; index < distinct_members.length; index += 1) {
      const member = distinct_members[index];
      expect(member !== undefined, "Distinct type-set member disappeared.");
      normalized = {
        tag: type.tag,
        left: normalized,
        right: member,
      };
    }
    return normalized;
  }
  if (type.tag === "difference") {
    return {
      tag: "difference",
      left: normalize_transparent_type_expression(
        type.left,
        definitions,
        resolving,
      ),
      right: normalize_transparent_type_expression(
        type.right,
        definitions,
        resolving,
      ),
    };
  }
  if (type.tag === "apply") {
    return {
      tag: "apply",
      func: normalize_transparent_type_expression(
        type.func,
        definitions,
        resolving,
      ),
      arg: normalize_transparent_type_expression(
        type.arg,
        definitions,
        resolving,
      ),
    };
  }
  if (type.tag === "tuple") {
    return {
      tag: "tuple",
      items: type.items.map((value) =>
        normalize_transparent_type_expression(value, definitions, resolving)
      ),
    };
  }
  if (type.tag === "product") {
    return {
      tag: "product",
      entries: type.entries.map((entry) => ({
        label: entry.label,
        type_expr: normalize_transparent_type_expression(
          entry.type_expr,
          definitions,
          resolving,
        ),
      })),
      value_pack: type.value_pack,
      repeat: type.repeat,
    };
  }
  if (type.tag === "array") {
    return {
      tag: "array",
      element: normalize_transparent_type_expression(
        type.element,
        definitions,
        resolving,
      ),
      length: type.length,
    };
  }
  if (type.tag === "arrow") {
    return {
      tag: "arrow",
      param: normalize_transparent_type_expression(
        type.param,
        definitions,
        resolving,
      ),
      effects: type.effects,
      result: normalize_transparent_type_expression(
        type.result,
        definitions,
        resolving,
      ),
    };
  }
  if (type.tag === "forall") {
    return {
      tag: "forall",
      params: [...type.params],
      body: normalize_transparent_type_expression(
        type.body,
        definitions,
        resolving,
      ),
    };
  }
  return type;
}

function transparent_type_application(
  type: TypeExpr,
): { name: string; arguments: readonly TypeExpr[] } | undefined {
  const arguments_: TypeExpr[] = [];
  let function_type = type;
  while (function_type.tag === "apply") {
    arguments_.unshift(function_type.arg);
    function_type = function_type.func;
  }
  if (function_type.tag !== "name") return undefined;
  return { name: function_type.name, arguments: arguments_ };
}

function logical_representation_name(
  representation: RepresentationType,
): string {
  if (representation.tag === "scalar") return representation.name;
  if (representation.tag === "integer") {
    return integer_type_name(representation);
  }
  if (
    representation.tag === "union" ||
    representation.tag === "intersection"
  ) {
    let common: string | undefined;
    for (const member of representation.members) {
      const member_name = logical_representation_name(member);
      if (common === undefined) {
        common = member_name;
      } else if (common !== member_name) {
        return JSON.stringify(representation);
      }
    }
    if (common !== undefined) return common;
  }
  if (representation.tag === "difference") {
    return logical_representation_name(representation.base);
  }
  return JSON.stringify(representation);
}

function resolve_prefix_proposition_types(
  proposition: PrefixProposition,
  aliases: ReadonlyMap<string, string>,
  type_definitions: ReadonlyMap<string, TransparentTypeDefinition>,
  source: SourceNode,
  cst_root: BabaCstNode | undefined,
  source_text: string,
  type_variables: ReadonlySet<string>,
): PrefixProposition {
  if (proposition.tag === "is") {
    return {
      ...proposition,
      type: resolve_prefix_type_reference(
        proposition.type,
        aliases,
        type_definitions,
        source,
        cst_root,
        source_text,
        type_variables,
      ),
    };
  }
  if (proposition.tag === "not") {
    return {
      ...proposition,
      proposition: resolve_prefix_proposition_types(
        proposition.proposition,
        aliases,
        type_definitions,
        source,
        cst_root,
        source_text,
        type_variables,
      ),
    };
  }
  if (
    proposition.tag === "and" || proposition.tag === "or" ||
    proposition.tag === "implies"
  ) {
    return {
      ...proposition,
      left: resolve_prefix_proposition_types(
        proposition.left,
        aliases,
        type_definitions,
        source,
        cst_root,
        source_text,
        type_variables,
      ),
      right: resolve_prefix_proposition_types(
        proposition.right,
        aliases,
        type_definitions,
        source,
        cst_root,
        source_text,
        type_variables,
      ),
    };
  }
  if (proposition.tag === "forall" || proposition.tag === "exists") {
    const binder = {
      ...proposition,
      binder: {
        ...proposition.binder,
        type: resolve_prefix_type_reference(
          proposition.binder.type,
          aliases,
          type_definitions,
          source,
          cst_root,
          source_text,
          type_variables,
        ),
      },
    };
    const nested_type_variables = new Set(type_variables);
    if (binder.binder.type.canonical === "Type") {
      nested_type_variables.add(binder.binder.name);
    }
    return {
      ...binder,
      proposition: resolve_prefix_proposition_types(
        proposition.proposition,
        aliases,
        type_definitions,
        source,
        cst_root,
        source_text,
        nested_type_variables,
      ),
    };
  }
  return proposition;
}

function check_prefix_binder_names(
  signature: PrefixSignature,
  definitions: readonly PrefixDefinition[],
): Checked<undefined> {
  const names = new Set<string>();
  for (const binder of signature.type.binders) {
    if (is_snake_case(binder.name) && binder.name !== "_") continue;
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_mismatch,
        `Prefix signature ${signature.name} type binder ${binder.name} must use snake_case.`,
        binder.span,
      ),
    );
  }
  const binders = [
    ...signature.type.binders,
    ...signature.type.parameters,
  ];
  const reserved_result_parameter = signature.type.parameters.find(
    (parameter) => parameter.name === "result",
  );
  if (reserved_result_parameter !== undefined) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_mismatch,
        `Prefix signature ${signature.name} cannot use reserved result as a parameter binder.`,
        reserved_result_parameter.span,
      ),
    );
  }
  for (const binder of binders) {
    if (!names.has(binder.name)) {
      names.add(binder.name);
      continue;
    }
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_mismatch,
        `Prefix signature ${signature.name} repeats logical binder ${binder.name}.`,
        binder.span,
      ),
    );
  }
  if (signature.type.result.name !== undefined) {
    const result_name = signature.type.result.name;
    if (names.has(result_name)) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_mismatch,
          `Prefix signature ${signature.name} repeats logical binder ${result_name}.`,
          signature.type.result.span,
        ),
      );
    }
  }
  const definition = definitions.find((candidate) =>
    candidate.name === signature.name &&
    candidate.scope === signature.scope &&
    candidate.span.start >= signature.span.end
  );
  const callable_parameters = definition?.callable_parameters;
  if (callable_parameters !== undefined) {
    const callable_names = new Set<string>();
    for (const parameter of callable_parameters) {
      if (!callable_names.has(parameter)) {
        callable_names.add(parameter);
        continue;
      }
      expect(
        definition !== undefined,
        `Callable ${signature.name} lost its matched definition.`,
      );
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_mismatch,
          `Callable ${signature.name} repeats parameter ${parameter}.`,
          definition.span,
        ),
      );
    }
  }
  const fact_parameters = definition?.fact_parameters;
  if (fact_parameters === undefined) return ok(undefined);
  expect(
    definition !== undefined,
    `Fact ${signature.name} lost its matched definition.`,
  );
  const fact_names = new Set<string>();
  for (const parameter of fact_parameters) {
    if (!fact_names.has(parameter)) {
      fact_names.add(parameter);
      continue;
    }
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_mismatch,
        `Fact ${signature.name} repeats parameter ${parameter}.`,
        definition.span,
      ),
    );
  }
  return ok(undefined);
}

function check_prefix_proof_formation(
  signature: PrefixSignature,
  signatures: readonly PrefixSignature[],
  declared_type_names: ReadonlySet<string>,
): Checked<undefined> {
  const proof_parameters = signature.type.parameters.filter((parameter) =>
    parameter.type.proof !== undefined
  );
  if (
    proof_parameters.length > 0 &&
    signature.type.result.type.proof === undefined
  ) {
    const parameter = proof_parameters[0];
    expect(parameter !== undefined, "Proof parameter selection disappeared.");
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        `Prefix signature ${signature.name} cannot yet erase explicit proof parameter ${parameter.name} from a runtime-returning definition.`,
        parameter.span,
      ),
    );
  }
  if (
    signature.type.result.type.proof !== undefined &&
    signature.type.result.name !== undefined
  ) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        `Proof result for ${signature.name} cannot introduce the runtime result binder.`,
        signature.type.result.span,
      ),
    );
  }
  if (
    signature.type.result.type.proof !== undefined &&
    signature.ensures.length > 0
  ) {
    const guarantee = signature.ensures[0];
    expect(guarantee !== undefined, "Proof guarantee selection disappeared.");
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        `Proof declaration ${signature.name} must express its guarantee in the Proof result instead of ensures.`,
        guarantee.span,
      ),
    );
  }
  const term_types = new Map<string, LogicalTermType>();
  for (const parameter of signature.type.parameters) {
    if (parameter.type.proof !== undefined) continue;
    term_types.set(
      parameter.name,
      logical_term_type_from_reference(parameter.type),
    );
  }
  const facts = prefix_fact_signatures(
    signatures,
    signature.scope,
    signature.span.start,
  );
  const type_names = signature_type_names(signature, declared_type_names);
  const checks: Checked<undefined>[] = [];
  for (const parameter of proof_parameters) {
    const proposition = parameter.type.proof;
    expect(
      proposition !== undefined,
      `Proof parameter ${parameter.name} lost its proposition.`,
    );
    checks.push(
      check_prefix_proposition(
        signature.name,
        proposition,
        term_types,
        type_names,
        facts,
        new Set(),
      ),
    );
  }
  const result = signature.type.result.type.proof;
  if (result !== undefined) {
    checks.push(
      check_prefix_proposition(
        signature.name,
        result,
        term_types,
        type_names,
        facts,
        new Set(),
      ),
    );
  }
  return all(checks).map(() => undefined);
}

type PrefixKernelProofContext = {
  declarations: Map<string, KernelType>;
  proof_indices: ReadonlyMap<string, number>;
  proof_propositions: ReadonlyMap<string, Proposition>;
  term_context: KernelType[];
  term_indices: ReadonlyMap<string, number>;
  term_types: ReadonlyMap<string, LogicalTermType>;
};

function check_prefix_proof_definition(
  signature: PrefixSignature,
  signatures: readonly PrefixSignature[],
  definitions: readonly PrefixDefinition[],
  declared_type_names: ReadonlySet<string>,
  cst_root: BabaCstNode | undefined,
): Checked<{ key: string; proof: CheckedKernelCertificate } | undefined> {
  const goal_source = signature.type.result.type.proof;
  expect(
    goal_source !== undefined,
    `Proof declaration ${signature.name} lost its result proposition.`,
  );
  const definition = definitions.find((candidate) =>
    candidate.name === signature.name &&
    candidate.scope === signature.scope &&
    candidate.span.start >= signature.span.end
  );
  if (definition === undefined) return ok(undefined);
  const body = definition.callable_proof_body;
  if (body === undefined) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        `Proof declaration ${signature.name} must use a direct by proof term body.`,
        definition.span,
        [{ message: "Proof signature is here.", span: signature.span }],
      ),
    );
  }
  if (definition.attribute_span !== undefined) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        `Proof declaration ${signature.name} cannot carry runtime binding attributes.`,
        definition.attribute_span,
      ),
    );
  }
  const binding_node = find_cst_node(
    cst_root,
    definition.span,
    "binding_statement",
  );
  expect(
    binding_node !== undefined,
    `Proof declaration ${signature.name} lost its Baba binding node.`,
  );
  const equals_index = binding_node.children.findIndex((child) =>
    child.kind === '"="'
  );
  expect(
    equals_index >= 0,
    `Proof declaration ${signature.name} lost its binding equals sign.`,
  );
  const inline_annotation = binding_node.children.find((child, index) =>
    index < equals_index && child.kind === "type_reference"
  );
  if (inline_annotation !== undefined) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_mismatch,
        `Proof declaration ${signature.name} cannot combine a prefix signature with an inline annotation.`,
        { start: inline_annotation.start, end: inline_annotation.end },
        [{ message: "Proof signature is here.", span: signature.span }],
      ),
    );
  }
  if (definition.recursive === true) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        `Recursive proof declaration ${signature.name} requires a checked totality derivation.`,
        definition.span,
      ),
    );
  }
  if (
    definitions.filter((candidate) =>
      candidate.scope === definition.scope &&
      candidate.span.start === definition.span.start &&
      candidate.span.end === definition.span.end
    ).length > 1
  ) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        `Proof declaration ${signature.name} cannot yet erase from a mutual binding group.`,
        definition.span,
      ),
    );
  }
  const callable_parameters = definition.callable_parameters;
  if (
    callable_parameters === undefined ||
    callable_parameters.length !== signature.type.parameters.length
  ) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_mismatch,
        `Proof signature ${signature.name} does not match its definition parameters.`,
        definition.span,
        [{ message: "Proof signature is here.", span: signature.span }],
      ),
    );
  }
  const parameter_types = definition.callable_parameter_types;
  expect(
    parameter_types !== undefined &&
      parameter_types.length === callable_parameters.length,
    `Proof declaration ${signature.name} parameter metadata is misaligned.`,
  );
  const parameter_annotation_checks: Checked<undefined>[] = [];
  for (let index = 0; index < parameter_types.length; index += 1) {
    const inline_type = parameter_types[index];
    const declared = signature.type.parameters[index];
    expect(
      declared !== undefined,
      `Proof declaration ${signature.name} lost parameter ${index}.`,
    );
    if (
      inline_type === undefined ||
      inline_type.canonical === declared.type.canonical
    ) {
      continue;
    }
    parameter_annotation_checks.push(
      fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_mismatch,
          `Proof signature ${signature.name} parameter ${declared.name} has type ${declared.type.canonical}, but its inline annotation is ${inline_type.canonical}.`,
          inline_type.span,
          [{
            message: "Proof parameter is declared here.",
            span: declared.span,
          }],
        ),
      ),
    );
  }
  const parameter_annotations = all(parameter_annotation_checks);
  if (diagnostics_of(parameter_annotations).length > 0) {
    return parameter_annotations.map(() => undefined);
  }
  const declarations = new Map<string, KernelType>();
  for (const binder of signature.type.binders) {
    if (binder.type.canonical === "Type") {
      declarations.set(binder.name, type_sort(0));
    }
  }
  const term_context: KernelType[] = [];
  const term_indices = new Map<string, number>();
  const term_types = new Map<string, LogicalTermType>();
  const proof_parameters = signature.type.parameters.filter((parameter) =>
    parameter.type.proof !== undefined
  );
  const proof_indices = new Map<string, number>();
  const proof_propositions = new Map<string, Proposition>();
  let proof_index = 0;
  for (let index = 0; index < signature.type.parameters.length; index += 1) {
    const parameter = signature.type.parameters[index];
    const definition_parameter = callable_parameters[index];
    expect(
      parameter !== undefined && definition_parameter !== undefined,
      `Proof parameter ${index} disappeared.`,
    );
    if (parameter.type.proof === undefined) continue;
    proof_indices.set(
      definition_parameter,
      proof_parameters.length - proof_index - 1,
    );
    proof_index += 1;
  }
  for (const parameter of signature.type.parameters) {
    if (parameter.type.proof !== undefined) continue;
    const logical_type = logical_term_type_from_reference(parameter.type);
    const kernel_type: KernelType = {
      tag: "constant",
      name: logical_type.representation,
    };
    declarations.set(logical_type.representation, type_sort(0));
    term_indices.set(parameter.name, term_context.length);
    term_types.set(parameter.name, logical_type);
    term_context.push(kernel_type);
  }
  const context: PrefixKernelProofContext = {
    declarations,
    proof_indices,
    proof_propositions,
    term_context,
    term_indices,
    term_types,
  };
  const facts = prefix_fact_signatures(
    signatures,
    signature.scope,
    signature.span.start,
  );
  const type_names = signature_type_names(signature, declared_type_names);
  const goal = prefix_kernel_proposition(
    signature.name,
    goal_source,
    context,
    facts,
    type_names,
  );
  const hypothesis_goals: Proposition[] = [];
  for (const parameter of proof_parameters) {
    const proposition = parameter.type.proof;
    expect(
      proposition !== undefined,
      `Proof hypothesis ${parameter.name} lost its proposition.`,
    );
    const hypothesis = prefix_kernel_proposition(
      signature.name,
      proposition,
      context,
      facts,
      type_names,
    );
    hypothesis_goals.push(hypothesis);
    const parameter_index = signature.type.parameters.indexOf(parameter);
    const definition_parameter = callable_parameters[parameter_index];
    expect(
      definition_parameter !== undefined,
      `Proof hypothesis ${parameter.name} lost its definition parameter.`,
    );
    proof_propositions.set(definition_parameter, hypothesis);
  }
  const elaborated = elaborate_prefix_proof(body, goal, context);
  const proof = checked_value(elaborated);
  if (proof === undefined) return elaborated.map(() => undefined);
  let theorem_goal = goal;
  let theorem_proof = proof;
  for (let index = hypothesis_goals.length - 1; index >= 0; index -= 1) {
    const premise = hypothesis_goals[index];
    expect(premise !== undefined, `Proof premise ${index} disappeared.`);
    theorem_goal = {
      tag: "implies",
      premise,
      conclusion: theorem_goal,
    };
    theorem_proof = {
      tag: "implies_intro",
      premise,
      body: theorem_proof,
    };
  }
  const environment = KernelEnvironment.from(declarations);
  const stable_term_context = snapshot_kernel_context(term_context);
  try {
    return ok({
      key: signature.scope + ":" + signature.name + ":proof",
      proof: Object.freeze({
        certificate: check_proof(theorem_proof, theorem_goal, {
          allow_unsafe: false,
          require_safe: true,
          environment,
          term_context: stable_term_context,
        }),
        environment,
        term_context: stable_term_context,
      }),
    });
  } catch (error) {
    let message = String(error);
    if (error instanceof Error) message = error.message;
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        `Invalid proof for ${signature.name}: ${message}`,
        body.span,
        [{ message: "Proof goal is declared here.", span: goal_source.span }],
      ),
    );
  }
}

function prefix_kernel_proposition(
  declaration_name: string,
  proposition: PrefixProposition,
  context: PrefixKernelProofContext,
  facts: ReadonlyMap<string, PrefixFactSignature>,
  type_names: ReadonlySet<string>,
): Proposition {
  if (proposition.tag === "true") return { tag: "true" };
  if (proposition.tag === "false") return { tag: "false" };
  if (proposition.tag === "holds") {
    if (proposition.value.text === "true") return { tag: "true" };
    if (proposition.value.text === "false") return { tag: "false" };
    return {
      tag: "atom",
      name: prefix_proposition_atom(proposition, context),
    };
  }
  if (proposition.tag === "equal") {
    const left = prefix_kernel_term(
      declaration_name,
      proposition.left,
      context,
      facts,
    );
    const right = prefix_kernel_term(
      declaration_name,
      proposition.right,
      context,
      facts,
    );
    if (
      left !== undefined && right !== undefined &&
      left.type_name === right.type_name
    ) {
      return {
        tag: "equal",
        type: left.type,
        left: left.term,
        right: right.term,
      };
    }
    return {
      tag: "atom",
      name: prefix_proposition_atom(proposition, context),
    };
  }
  if (proposition.tag === "not_equal") {
    const equality: PrefixProposition = {
      tag: "equal",
      left: proposition.left,
      right: proposition.right,
      span: proposition.span,
    };
    return {
      tag: "not",
      proposition: prefix_kernel_proposition(
        declaration_name,
        equality,
        context,
        facts,
        type_names,
      ),
    };
  }
  if (proposition.tag === "less" || proposition.tag === "less_equal") {
    return {
      tag: "atom",
      name: prefix_proposition_atom(proposition, context),
    };
  }
  if (proposition.tag === "is") {
    return {
      tag: "atom",
      name: prefix_proposition_atom(proposition, context),
    };
  }
  if (proposition.tag === "not") {
    return {
      tag: "not",
      proposition: prefix_kernel_proposition(
        declaration_name,
        proposition.proposition,
        context,
        facts,
        type_names,
      ),
    };
  }
  if (
    proposition.tag === "and" || proposition.tag === "or" ||
    proposition.tag === "implies"
  ) {
    const left = prefix_kernel_proposition(
      declaration_name,
      proposition.left,
      context,
      facts,
      type_names,
    );
    const right = prefix_kernel_proposition(
      declaration_name,
      proposition.right,
      context,
      facts,
      type_names,
    );
    if (proposition.tag === "and") {
      return { tag: "and", left, right };
    }
    if (proposition.tag === "or") return { tag: "or", left, right };
    return { tag: "implies", premise: left, conclusion: right };
  }
  if (proposition.tag === "forall" || proposition.tag === "exists") {
    const logical_type = logical_term_type_from_reference(
      proposition.binder.type,
    );
    const domain: KernelType = {
      tag: "constant",
      name: logical_type.representation,
    };
    context.declarations.set(logical_type.representation, type_sort(0));
    const nested_indices = new Map<string, number>();
    for (const [name, index] of context.term_indices) {
      nested_indices.set(name, index + 1);
    }
    nested_indices.set(proposition.binder.name, 0);
    const nested_types = new Map(context.term_types);
    nested_types.set(proposition.binder.name, logical_type);
    const nested_context: PrefixKernelProofContext = {
      ...context,
      term_context: [domain, ...context.term_context],
      term_indices: nested_indices,
      term_types: nested_types,
    };
    const body = prefix_kernel_proposition(
      declaration_name,
      proposition.proposition,
      nested_context,
      facts,
      type_names,
    );
    if (proposition.tag === "forall") {
      return { tag: "forall", domain, body };
    }
    return { tag: "exists", domain, body };
  }
  throw new Error("Unknown prefix proof proposition.");
}

function prefix_proposition_atom(
  proposition: PrefixProposition,
  context: PrefixKernelProofContext,
): string {
  if (proposition.tag === "holds") {
    return JSON.stringify([
      "holds",
      prefix_term_key(proposition.value, context),
    ]);
  }
  if (
    proposition.tag === "equal" || proposition.tag === "not_equal" ||
    proposition.tag === "less" || proposition.tag === "less_equal"
  ) {
    return JSON.stringify([
      proposition.tag,
      prefix_term_key(proposition.left, context),
      prefix_term_key(proposition.right, context),
    ]);
  }
  if (proposition.tag === "is") {
    return JSON.stringify([
      "is",
      prefix_term_key(proposition.value, context),
      proposition.type.canonical,
    ]);
  }
  throw new Error("Only atomic propositions have kernel atom keys.");
}

function prefix_term_key(
  term: PrefixTerm,
  context: PrefixKernelProofContext,
): unknown {
  const shape = term.shape;
  if (shape.tag === "number") {
    const fixed_width = prefix_integer_literal(term.text);
    if (fixed_width !== undefined) {
      return [
        "number",
        integer_type_name(fixed_width.type),
        fixed_width.value.toString(),
      ];
    }
    const literal = parse_number_expr(term.text);
    expect(literal.tag === "num", "Parsed proof number is not numeric.");
    return ["number", literal.type.toUpperCase(), literal.value.toString()];
  }
  if (
    shape.tag === "string" || shape.tag === "character" ||
    shape.tag === "boolean"
  ) {
    return [shape.tag, term.text];
  }
  if (shape.tag === "unsupported") {
    return [shape.tag, term.span.start, term.span.end, term.text];
  }
  if (shape.tag === "name") {
    const index = context.term_indices.get(shape.name);
    if (index !== undefined) return ["var", index];
    return ["name", shape.name];
  }
  if (shape.tag === "binary") {
    return [
      "binary",
      shape.operator,
      prefix_term_key(shape.left, context),
      prefix_term_key(shape.right, context),
    ];
  }
  if (shape.tag === "unary") {
    return [
      "unary",
      shape.operator,
      prefix_term_key(shape.operand, context),
    ];
  }
  if (shape.tag === "call") {
    return [
      "call",
      prefix_term_key(shape.function, context),
      shape.arguments.map((argument) => prefix_term_key(argument, context)),
    ];
  }
  if (shape.tag === "field") {
    return ["field", prefix_term_key(shape.object, context), shape.field];
  }
  if (shape.tag === "index") {
    return [
      "index",
      prefix_term_key(shape.object, context),
      term.span.start,
      term.span.end,
      term.text,
    ];
  }
  return prefix_term_key(shape.value, context);
}

function prefix_kernel_term(
  declaration_name: string,
  term: PrefixTerm,
  context: PrefixKernelProofContext,
  facts: ReadonlyMap<string, PrefixFactSignature>,
): { term: KernelTerm; type: KernelType; type_name: string } | undefined {
  if (term.shape.tag === "name") {
    const index = context.term_indices.get(term.shape.name);
    const logical_type = context.term_types.get(term.shape.name);
    if (index === undefined || logical_type === undefined) return undefined;
    const type: KernelType = {
      tag: "constant",
      name: logical_type.representation,
    };
    return {
      term: { tag: "var", index },
      type,
      type_name: logical_type.representation,
    };
  }
  if (term.shape.tag === "parenthesized") {
    return prefix_kernel_term(
      declaration_name,
      term.shape.value,
      context,
      facts,
    );
  }
  if (
    term.shape.tag !== "number" && term.shape.tag !== "string" &&
    term.shape.tag !== "character" && term.shape.tag !== "boolean"
  ) {
    return undefined;
  }
  const logical_type = checked_value(
    check_prefix_term_type(
      declaration_name,
      term,
      context.term_types,
      facts,
      new Set(),
    ),
  );
  if (logical_type === undefined) return undefined;
  const type_name = logical_type.representation;
  const type: KernelType = { tag: "constant", name: type_name };
  let literal_key = term.text;
  if (term.shape.tag === "number") {
    const literal = parse_number_expr(term.text);
    expect(literal.tag === "num", "Parsed proof number is not numeric.");
    literal_key = literal.value.toString();
  }
  const name = "literal:" + type_name + ":" + literal_key;
  context.declarations.set(type_name, type_sort(0));
  context.declarations.set(name, type);
  return { term: { tag: "constant", name, type }, type, type_name };
}

function elaborate_prefix_proof(
  proof: PrefixProofTerm,
  goal: Proposition,
  context: PrefixKernelProofContext,
): Checked<ProofTerm> {
  if (proof.tag === "name") {
    const index = context.proof_indices.get(proof.name);
    if (index !== undefined) return ok({ tag: "assumption", index });
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        `Unknown proof evidence ${proof.name}.`,
        proof.span,
      ),
    );
  }
  if (proof.tag === "refl") {
    if (goal.tag !== "equal") {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "refl requires an equality goal.",
          proof.span,
        ),
      );
    }
    return ok({ tag: "refl", type: goal.type, term: goal.left });
  }
  if (proof.tag === "true_intro") return ok({ tag: "true_intro" });
  if (proof.tag === "and_intro") {
    if (goal.tag !== "and") {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "and_intro requires a conjunction goal.",
          proof.span,
        ),
      );
    }
    return Applicative.lift(
      (left: ProofTerm, right: ProofTerm): ProofTerm => ({
        tag: "and_intro",
        left,
        right,
      }),
      elaborate_prefix_proof(proof.left, goal.left, context),
      elaborate_prefix_proof(proof.right, goal.right, context),
    );
  }
  if (proof.tag === "symm" && goal.tag === "equal") {
    const reversed: Proposition = {
      tag: "equal",
      type: goal.type,
      left: goal.right,
      right: goal.left,
    };
    return elaborate_prefix_proof(proof.proof, reversed, context).map(
      (inner): ProofTerm => ({ tag: "symm", proof: inner }),
    );
  }
  if (
    (proof.tag === "and_left" || proof.tag === "and_right") &&
    proof.proof.tag === "and_intro"
  ) {
    let projected = proof.proof.left;
    let retained = proof.proof.right;
    if (proof.tag === "and_right") {
      projected = proof.proof.right;
      retained = proof.proof.left;
    }
    const retained_proof = synthesize_prefix_proof(retained, context);
    return Applicative.lift(
      (projected_term: ProofTerm, retained_term: SynthesizedPrefixProof) => {
        let pair: ProofTerm;
        if (proof.tag === "and_left") {
          pair = {
            tag: "and_intro",
            left: projected_term,
            right: retained_term.term,
          };
          return { tag: "and_left", proof: pair };
        }
        pair = {
          tag: "and_intro",
          left: retained_term.term,
          right: projected_term,
        };
        return { tag: "and_right", proof: pair };
      },
      elaborate_prefix_proof(projected, goal, context),
      retained_proof,
    );
  }
  if (proof.tag === "trans" && goal.tag === "equal") {
    if (proof.left.tag === "refl") {
      const left_goal: Proposition = {
        tag: "equal",
        type: goal.type,
        left: goal.left,
        right: goal.left,
      };
      return Applicative.lift(
        (left: ProofTerm, right: ProofTerm): ProofTerm => ({
          tag: "trans",
          left,
          right,
        }),
        elaborate_prefix_proof(proof.left, left_goal, context),
        elaborate_prefix_proof(proof.right, goal, context),
      );
    }
    if (proof.right.tag === "refl") {
      const right_goal: Proposition = {
        tag: "equal",
        type: goal.type,
        left: goal.right,
        right: goal.right,
      };
      return Applicative.lift(
        (left: ProofTerm, right: ProofTerm): ProofTerm => ({
          tag: "trans",
          left,
          right,
        }),
        elaborate_prefix_proof(proof.left, goal, context),
        elaborate_prefix_proof(proof.right, right_goal, context),
      );
    }
    if (prefix_proof_synthesizes(proof.left)) {
      const left = synthesize_prefix_proof(proof.left, context);
      const left_proof = checked_value(left);
      if (left_proof === undefined) {
        return left.map((synthesized) => synthesized.term);
      }
      if (left_proof.proposition.tag !== "equal") {
        return fail(
          compiler_diagnostic(
            diagnostic_codes.prefix_proof_invalid,
            "trans requires equality proofs.",
            proof.left.span,
          ),
        );
      }
      const right_goal: Proposition = {
        tag: "equal",
        type: left_proof.proposition.type,
        left: left_proof.proposition.right,
        right: goal.right,
      };
      return elaborate_prefix_proof(proof.right, right_goal, context).map(
        (right): ProofTerm => ({
          tag: "trans",
          left: left_proof.term,
          right,
        }),
      );
    }
    if (prefix_proof_synthesizes(proof.right)) {
      const right = synthesize_prefix_proof(proof.right, context);
      const right_proof = checked_value(right);
      if (right_proof === undefined) {
        return right.map((synthesized) => synthesized.term);
      }
      if (right_proof.proposition.tag !== "equal") {
        return fail(
          compiler_diagnostic(
            diagnostic_codes.prefix_proof_invalid,
            "trans requires equality proofs.",
            proof.right.span,
          ),
        );
      }
      const left_goal: Proposition = {
        tag: "equal",
        type: right_proof.proposition.type,
        left: goal.left,
        right: right_proof.proposition.left,
      };
      return elaborate_prefix_proof(proof.left, left_goal, context).map(
        (left): ProofTerm => ({
          tag: "trans",
          left,
          right: right_proof.term,
        }),
      );
    }
  }
  if (proof.tag === "implies_apply") {
    const function_proof = synthesize_prefix_proof(proof.left, context);
    const synthesized = checked_value(function_proof);
    if (synthesized === undefined) {
      return function_proof.map((checked) => checked.term);
    }
    if (synthesized.proposition.tag !== "implies") {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "implies_apply requires an implication proof.",
          proof.left.span,
        ),
      );
    }
    return elaborate_prefix_proof(
      proof.right,
      synthesized.proposition.premise,
      context,
    ).map((argument): ProofTerm => ({
      tag: "implies_apply",
      function: synthesized.term,
      argument,
    }));
  }
  return synthesize_prefix_proof(proof, context).map(
    (synthesized) => synthesized.term,
  );
}

type SynthesizedPrefixProof = {
  term: ProofTerm;
  proposition: Proposition;
};

function synthesize_prefix_proof(
  proof: PrefixProofTerm,
  context: PrefixKernelProofContext,
): Checked<SynthesizedPrefixProof> {
  if (proof.tag === "name") {
    const index = context.proof_indices.get(proof.name);
    const proposition = context.proof_propositions.get(proof.name);
    if (index !== undefined && proposition !== undefined) {
      return ok({ term: { tag: "assumption", index }, proposition });
    }
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        `Unknown proof evidence ${proof.name}.`,
        proof.span,
      ),
    );
  }
  if (proof.tag === "true_intro") {
    return ok({
      term: { tag: "true_intro" },
      proposition: { tag: "true" },
    });
  }
  if (proof.tag === "refl") {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        "refl requires an expected equality goal.",
        proof.span,
      ),
    );
  }
  if (proof.tag === "symm") {
    const inner_check = synthesize_prefix_proof(proof.proof, context);
    const inner = checked_value(inner_check);
    if (inner === undefined) return inner_check;
    if (inner.proposition.tag !== "equal") {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "symm requires an equality proof.",
          proof.span,
        ),
      );
    }
    return ok({
      term: { tag: "symm", proof: inner.term },
      proposition: {
        tag: "equal",
        type: inner.proposition.type,
        left: inner.proposition.right,
        right: inner.proposition.left,
      },
    });
  }
  if (proof.tag === "and_left" || proof.tag === "and_right") {
    const inner_check = synthesize_prefix_proof(proof.proof, context);
    const inner = checked_value(inner_check);
    if (inner === undefined) return inner_check;
    if (inner.proposition.tag !== "and") {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "Conjunction elimination requires a conjunction proof.",
          proof.span,
        ),
      );
    }
    let proposition = inner.proposition.left;
    if (proof.tag === "and_right") {
      proposition = inner.proposition.right;
    }
    return ok({
      term: { tag: proof.tag, proof: inner.term },
      proposition,
    });
  }
  if (
    proof.tag !== "trans" && proof.tag !== "and_intro" &&
    proof.tag !== "implies_apply"
  ) {
    throw new Error("Unknown prefix proof term.");
  }
  const left = synthesize_prefix_proof(proof.left, context);
  const right = synthesize_prefix_proof(proof.right, context);
  const pair = Applicative.lift(
    (left_proof: SynthesizedPrefixProof, right_proof: SynthesizedPrefixProof) =>
      [left_proof, right_proof] as const,
    left,
    right,
  );
  const synthesized = checked_value(pair);
  if (synthesized === undefined) {
    return pair.map(([left_proof]) => left_proof);
  }
  const [left_proof, right_proof] = synthesized;
  if (proof.tag === "trans") {
    if (
      left_proof.proposition.tag !== "equal" ||
      right_proof.proposition.tag !== "equal"
    ) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "trans requires equality proofs.",
          proof.span,
        ),
      );
    }
    return ok({
      term: {
        tag: "trans",
        left: left_proof.term,
        right: right_proof.term,
      },
      proposition: {
        tag: "equal",
        type: left_proof.proposition.type,
        left: left_proof.proposition.left,
        right: right_proof.proposition.right,
      },
    });
  }
  if (proof.tag === "and_intro") {
    return ok({
      term: {
        tag: "and_intro",
        left: left_proof.term,
        right: right_proof.term,
      },
      proposition: {
        tag: "and",
        left: left_proof.proposition,
        right: right_proof.proposition,
      },
    });
  }
  if (left_proof.proposition.tag !== "implies") {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        "implies_apply requires an implication proof.",
        proof.left.span,
      ),
    );
  }
  return ok({
    term: {
      tag: "implies_apply",
      function: left_proof.term,
      argument: right_proof.term,
    },
    proposition: left_proof.proposition.conclusion,
  });
}

function prefix_proof_synthesizes(proof: PrefixProofTerm): boolean {
  if (proof.tag === "refl") return false;
  if (proof.tag === "name" || proof.tag === "true_intro") return true;
  if (
    proof.tag === "symm" || proof.tag === "and_left" ||
    proof.tag === "and_right"
  ) {
    return prefix_proof_synthesizes(proof.proof);
  }
  if (
    proof.tag !== "trans" && proof.tag !== "and_intro" &&
    proof.tag !== "implies_apply"
  ) {
    throw new Error("Unknown prefix proof term.");
  }
  return prefix_proof_synthesizes(proof.left) &&
    prefix_proof_synthesizes(proof.right);
}

function check_prefix_refinement_formation(
  signature: PrefixSignature,
  signatures: readonly PrefixSignature[],
  declared_type_names: ReadonlySet<string>,
): Checked<undefined> {
  const term_types = new Map<string, LogicalTermType>();
  for (const parameter of signature.type.parameters) {
    if (parameter.type.proof !== undefined) continue;
    term_types.set(
      parameter.name,
      logical_term_type_from_reference(parameter.type),
    );
  }
  const parameter_references = new Set(
    signature.type.parameters.map((parameter) => parameter.type),
  );
  const references = [
    ...parameter_references,
    signature.type.result.type,
  ];
  const checks: Checked<undefined>[] = [];
  for (const reference of references) {
    const refinement = reference.refinement;
    if (refinement === undefined) continue;
    if (
      reference.resolved !== true || reference.canonical === "Type" ||
      reference.canonical === "Prop"
    ) {
      checks.push(
        fail(
          compiler_diagnostic(
            diagnostic_codes.prefix_signature_mismatch,
            `Prefix signature ${signature.name} cannot refine ${reference.text}.`,
            refinement.span,
          ),
        ),
      );
      continue;
    }
    const scoped_terms = new Map(term_types);
    scoped_terms.set(
      refinement.binder,
      logical_term_type_from_reference({
        ...reference,
        refinement: undefined,
      }),
    );
    const formation = check_prefix_proposition(
      signature.name,
      refinement.proposition,
      scoped_terms,
      signature_type_names(signature, declared_type_names),
      prefix_fact_signatures(
        signatures,
        signature.scope,
        signature.span.start,
      ),
      new Set(),
    );
    checks.push(formation);
    if (
      parameter_references.has(reference) &&
      diagnostics_of(formation).length === 0 &&
      !prefix_proposition_is_tautology(
        refinement.proposition,
        scoped_terms,
      )
    ) {
      checks.push(
        fail(
          compiler_diagnostic(
            diagnostic_codes.prefix_signature_unproved,
            `Prefix signature ${signature.name} cannot yet synthesize calls requiring parameter refinement ${refinement.text}.`,
            refinement.span,
          ),
        ),
      );
    }
  }
  return all(checks).map(() => undefined);
}

function check_prefix_requires(
  signature: PrefixSignature,
  signatures: readonly PrefixSignature[],
  source_text: string,
  declared_type_names: ReadonlySet<string>,
): Checked<undefined> {
  if (signature.requires.length === 0) return ok(undefined);
  const term_types = new Map<string, LogicalTermType>();
  for (const parameter of signature.type.parameters) {
    if (parameter.type.proof !== undefined) continue;
    term_types.set(
      parameter.name,
      logical_term_type_from_reference(parameter.type),
    );
  }
  const checks: Checked<undefined>[] = [];
  for (const requirement of signature.requires) {
    const formation = check_prefix_proposition(
      signature.name,
      requirement,
      term_types,
      signature_type_names(signature, declared_type_names),
      prefix_fact_signatures(
        signatures,
        signature.scope,
        signature.span.start,
      ),
      new Set(),
    );
    if (diagnostics_of(formation).length > 0) {
      checks.push(formation);
      continue;
    }
    if (prefix_proposition_is_tautology(requirement, term_types)) {
      checks.push(ok(undefined));
      continue;
    }
    const requirement_text = source_text.slice(
      requirement.span.start,
      requirement.span.end,
    );
    checks.push(
      fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_unproved,
          `Prefix signature ${signature.name} cannot yet propagate requires ${requirement_text} by semantic identity.`,
          requirement.span,
        ),
      ),
    );
  }
  return all(checks).map(() => undefined);
}

function check_prefix_decreases(
  signature: PrefixSignature,
  signatures: readonly PrefixSignature[],
  definitions: readonly PrefixDefinition[],
): Checked<undefined> {
  if (signature.decreases.length === 0) return ok(undefined);
  const definition = definitions.find((candidate) =>
    candidate.name === signature.name &&
    candidate.scope === signature.scope &&
    candidate.span.start >= signature.span.end
  );
  if (definition?.recursive === true) {
    const metric = signature.decreases[0];
    expect(
      metric !== undefined,
      `Prefix signature ${signature.name} lost its decreases metric.`,
    );
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_unproved,
        `Prefix signature ${signature.name} has recursive decreases obligations that are not yet checked.`,
        metric.span,
      ),
    );
  }
  const term_types = new Map<string, LogicalTermType>();
  for (const parameter of signature.type.parameters) {
    if (parameter.type.proof !== undefined) continue;
    term_types.set(
      parameter.name,
      logical_term_type_from_reference(parameter.type),
    );
  }
  const checks = signature.decreases.map((metric) => {
    const checked_type = check_prefix_term_type(
      signature.name,
      metric,
      term_types,
      prefix_fact_signatures(
        signatures,
        signature.scope,
        signature.span.start,
      ),
      new Set(),
    );
    const metric_type = checked_value(checked_type);
    if (metric_type === undefined) return checked_type.map(() => undefined);
    if (is_machine_integer_logical_type(metric_type.representation)) {
      return ok(undefined);
    }
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_unproved,
        `Prefix signature ${signature.name} uses non-integer decreases metric ${metric.text}: ${
          logical_term_type_display(metric_type)
        }.`,
        metric.span,
      ),
    );
  });
  return all(checks).map(() => undefined);
}

function prefix_proposition_is_tautology(
  proposition: PrefixSignature["requires"][number],
  term_types: ReadonlyMap<string, LogicalTermType>,
): boolean {
  if (proposition.tag === "true") return true;
  if (proposition.tag === "holds") return proposition.value.text === "true";
  if (proposition.tag === "equal") {
    if (proposition.left.text !== proposition.right.text) return false;
    if (proposition.left.references.length === 0) return true;
    return proposition.left.references.every((reference) =>
      term_types.has(reference)
    );
  }
  if (proposition.tag === "and") {
    return prefix_proposition_is_tautology(proposition.left, term_types) &&
      prefix_proposition_is_tautology(proposition.right, term_types);
  }
  return false;
}

function check_prefix_fact_definition(
  signature: PrefixSignature,
  signatures: readonly PrefixSignature[],
  definitions: readonly PrefixDefinition[],
  source_text: string,
  declared_type_names: ReadonlySet<string>,
): Checked<undefined> {
  if (signature.kind !== "fact" && signature.kind !== "opaque fact") {
    return ok(undefined);
  }
  const definition = definitions.find((candidate) =>
    candidate.name === signature.name &&
    candidate.scope === signature.scope &&
    candidate.span.start >= signature.span.end
  );
  if (definition === undefined) return ok(undefined);
  const parameters = definition.fact_parameters;
  const body = definition.fact_body;
  if (
    parameters === undefined ||
    parameters.length !== signature.type.parameters.length
  ) {
    let parameter_count = 0;
    if (parameters !== undefined) parameter_count = parameters.length;
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_mismatch,
        `Fact ${signature.name} must define ${signature.type.parameters.length} parameters but defines ${parameter_count}.`,
        definition.span,
        [{ message: "Fact signature is here.", span: signature.span }],
      ),
    );
  }
  if (body === undefined) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_unproved,
        `Fact ${signature.name} has no checked proposition body.`,
        definition.span,
      ),
    );
  }
  const type_names = signature_type_names(signature, declared_type_names);
  const type_variables = new Set(
    signature.type.binders.map((binder) => binder.name),
  );
  for (const parameter of signature.type.parameters) {
    if (
      parameter.type.resolved === true ||
      type_variables.has(parameter.type.canonical)
    ) {
      continue;
    }
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_mismatch,
        `Fact ${signature.name} refers to unknown parameter type ${parameter.type.text}.`,
        parameter.type.span,
      ),
    );
  }
  if (
    fact_dependency_is_recursive(
      signature.name,
      signature.name,
      signature.scope,
      signatures,
      definitions,
      new Set(),
    )
  ) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_unproved,
        `Fact ${signature.name} is recursive without a checked totality derivation.`,
        body.span,
      ),
    );
  }
  const term_types = new Map<string, LogicalTermType>();
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index];
    const declared = signature.type.parameters[index];
    expect(
      parameter !== undefined && declared !== undefined,
      `Fact ${signature.name} lost parameter ${index}.`,
    );
    term_types.set(parameter, logical_term_type_from_reference(declared.type));
  }
  const formation = check_prefix_proposition(
    signature.name,
    body,
    term_types,
    type_names,
    prefix_fact_signatures(
      signatures,
      signature.scope,
      definition.span.start,
    ),
    new Set(),
  );
  if (diagnostics_of(formation).length === 0) return formation;
  return fail(
    ...diagnostics_of(formation).map((diagnostic) =>
      compiler_diagnostic(
        diagnostic.code,
        diagnostic.message,
        diagnostic.span,
        [{
          message: "Fact body is here: " +
            source_text.slice(body.span.start, body.span.end),
          span: body.span,
        }],
      )
    ),
  );
}

function first_unbound_proposition_name(
  proposition: PrefixSignature["requires"][number],
  bound: ReadonlySet<string>,
): string | undefined {
  if (
    proposition.tag === "true" || proposition.tag === "false"
  ) {
    return undefined;
  }
  if (proposition.tag === "holds") {
    return unbound_term_reference(proposition.value, bound);
  }
  if (
    proposition.tag === "equal" || proposition.tag === "not_equal" ||
    proposition.tag === "less" || proposition.tag === "less_equal"
  ) {
    const left = unbound_term_reference(proposition.left, bound);
    if (left !== undefined) return left;
    return unbound_term_reference(proposition.right, bound);
  }
  if (proposition.tag === "is") {
    return unbound_term_reference(proposition.value, bound);
  }
  if (proposition.tag === "not") {
    return first_unbound_proposition_name(proposition.proposition, bound);
  }
  if (
    proposition.tag === "and" || proposition.tag === "or" ||
    proposition.tag === "implies"
  ) {
    const left = first_unbound_proposition_name(proposition.left, bound);
    if (left !== undefined) return left;
    return first_unbound_proposition_name(proposition.right, bound);
  }
  if (proposition.tag === "forall" || proposition.tag === "exists") {
    const nested_bound = new Set(bound);
    nested_bound.add(proposition.binder.name);
    return first_unbound_proposition_name(
      proposition.proposition,
      nested_bound,
    );
  }
  throw new Error("Unknown prefix proposition.");
}

function unbound_term_reference(
  term: PrefixSignature["decreases"][number],
  bound: ReadonlySet<string>,
): string | undefined {
  for (const reference of term.references) {
    if (reference === "true" || reference === "false") continue;
    if (bound.has(reference)) continue;
    return reference;
  }
  return undefined;
}

function fact_dependency_is_recursive(
  current_name: string,
  target_name: string,
  scope: string,
  signatures: readonly PrefixSignature[],
  definitions: readonly PrefixDefinition[],
  visited: Set<string>,
): boolean {
  if (visited.has(current_name)) return false;
  visited.add(current_name);
  const definition = definitions.find((candidate) =>
    candidate.name === current_name &&
    candidate.scope === scope &&
    (candidate.kind === "fact" || candidate.kind === "opaque fact")
  );
  if (definition?.fact_body === undefined) return false;
  const facts = prefix_fact_signatures(
    signatures,
    scope,
    definition.span.start,
  );
  const dependencies = prefix_proposition_fact_dependencies(
    definition.fact_body,
    facts,
  );
  for (const dependency of dependencies) {
    if (dependency === target_name) return true;
    if (
      fact_dependency_is_recursive(
        dependency,
        target_name,
        scope,
        signatures,
        definitions,
        visited,
      )
    ) {
      return true;
    }
  }
  return false;
}

function prefix_proposition_fact_dependencies(
  proposition: PrefixSignature["requires"][number],
  facts: ReadonlyMap<string, PrefixFactSignature>,
): readonly string[] {
  if (proposition.tag === "true" || proposition.tag === "false") return [];
  if (proposition.tag === "holds") {
    return prefix_term_fact_dependencies(proposition.value, facts);
  }
  if (
    proposition.tag === "equal" || proposition.tag === "not_equal" ||
    proposition.tag === "less" || proposition.tag === "less_equal"
  ) {
    return [
      ...prefix_term_fact_dependencies(proposition.left, facts),
      ...prefix_term_fact_dependencies(proposition.right, facts),
    ];
  }
  if (proposition.tag === "is") {
    return prefix_term_fact_dependencies(proposition.value, facts);
  }
  if (proposition.tag === "not") {
    return prefix_proposition_fact_dependencies(
      proposition.proposition,
      facts,
    );
  }
  if (
    proposition.tag === "and" || proposition.tag === "or" ||
    proposition.tag === "implies"
  ) {
    return [
      ...prefix_proposition_fact_dependencies(proposition.left, facts),
      ...prefix_proposition_fact_dependencies(proposition.right, facts),
    ];
  }
  if (proposition.tag === "forall" || proposition.tag === "exists") {
    return prefix_proposition_fact_dependencies(
      proposition.proposition,
      facts,
    );
  }
  throw new Error("Unknown prefix proposition dependency.");
}

function prefix_term_fact_dependencies(
  term: PrefixSignature["decreases"][number],
  facts: ReadonlyMap<string, PrefixFactSignature>,
): readonly string[] {
  const shape = term.shape;
  if (shape.tag === "binary") {
    return [
      ...prefix_term_fact_dependencies(shape.left, facts),
      ...prefix_term_fact_dependencies(shape.right, facts),
    ];
  }
  if (shape.tag === "unary") {
    return prefix_term_fact_dependencies(shape.operand, facts);
  }
  if (shape.tag === "call") {
    const dependencies: string[] = [];
    if (
      shape.function.shape.tag === "name" &&
      facts.has(shape.function.shape.name)
    ) {
      dependencies.push(shape.function.shape.name);
    }
    for (const argument of shape.arguments) {
      dependencies.push(...prefix_term_fact_dependencies(argument, facts));
    }
    return dependencies;
  }
  if (
    shape.tag === "field" || shape.tag === "index"
  ) {
    return prefix_term_fact_dependencies(shape.object, facts);
  }
  if (shape.tag === "parenthesized") {
    return prefix_term_fact_dependencies(shape.value, facts);
  }
  return [];
}

type PrefixFactSignature = {
  parameters: readonly LogicalTermType[];
  type_parameters: ReadonlySet<string>;
};

type LogicalTermType = {
  display_name?: string;
  expression?: TypeExpr;
  name: string;
  representation: string;
  refinement?: string;
};

type TransparentTypeDefinition = {
  parameters: readonly string[];
  body: TypeExpr;
};

function logical_term_type_from_reference(
  type: PrefixTypeReference,
): LogicalTermType {
  let representation = type.representation;
  if (representation === undefined) representation = type.canonical;
  let display_name = type.canonical;
  if (type.expression !== undefined) {
    display_name = format_type_expr(type.expression);
  }
  let name = type.canonical;
  if (type.refinement !== undefined) {
    name = type.refinement.text.replaceAll(/\s+/g, "");
    display_name = type.refinement.text;
  }
  return {
    display_name,
    expression: type.expression,
    name,
    representation,
  };
}

function prefix_fact_signatures(
  signatures: readonly PrefixSignature[],
  scope: string,
  visible_at: number,
): ReadonlyMap<string, PrefixFactSignature> {
  const facts = new Map<string, PrefixFactSignature>();
  for (const signature of signatures) {
    if (signature.kind !== "fact" && signature.kind !== "opaque fact") {
      continue;
    }
    if (
      signature.scope !== scope &&
      !scope.startsWith(signature.scope + "/")
    ) {
      continue;
    }
    if (signature.span.start > visible_at) continue;
    facts.set(signature.name, {
      parameters: signature.type.parameters.map((parameter) =>
        logical_term_type_from_reference(parameter.type)
      ),
      type_parameters: new Set(
        signature.type.binders.filter((binder) =>
          binder.type.canonical === "Type"
        ).map((binder) => binder.name),
      ),
    });
  }
  return facts;
}

function signature_type_names(
  signature: PrefixSignature,
  declared_type_names: ReadonlySet<string>,
): ReadonlySet<string> {
  const names = new Set(declared_type_names);
  for (const binder of signature.type.binders) {
    if (binder.type.canonical === "Type") names.add(binder.name);
  }
  return names;
}

function check_prefix_proposition(
  declaration_name: string,
  proposition: PrefixSignature["requires"][number],
  term_types: ReadonlyMap<string, LogicalTermType>,
  type_names: ReadonlySet<string>,
  facts: ReadonlyMap<string, PrefixFactSignature>,
  nonzero_terms: ReadonlySet<string>,
): Checked<undefined> {
  const bound = new Set(term_types.keys());
  for (const fact_name of facts.keys()) bound.add(fact_name);
  const unbound = first_unbound_proposition_name(proposition, bound);
  if (unbound !== undefined) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_unproved,
        `${declaration_name} refers to unbound logical value ${unbound}.`,
        proposition.span,
      ),
    );
  }
  return check_formed_prefix_proposition(
    declaration_name,
    proposition,
    term_types,
    type_names,
    facts,
    nonzero_terms,
  );
}

function check_formed_prefix_proposition(
  declaration_name: string,
  proposition: PrefixSignature["requires"][number],
  term_types: ReadonlyMap<string, LogicalTermType>,
  type_names: ReadonlySet<string>,
  facts: ReadonlyMap<string, PrefixFactSignature>,
  nonzero_terms: ReadonlySet<string>,
): Checked<undefined> {
  if (proposition.tag === "true" || proposition.tag === "false") {
    return ok(undefined);
  }
  if (proposition.tag === "holds") {
    const term_type = check_prefix_term_type(
      declaration_name,
      proposition.value,
      term_types,
      facts,
      nonzero_terms,
    );
    const type = checked_value(term_type);
    if (type === undefined) return term_type.map(() => undefined);
    if (type.representation === "Bool" || type.name === "Prop") {
      return ok(undefined);
    }
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_unproved,
        `${declaration_name} uses ${proposition.value.text}: ${
          logical_term_type_display(type)
        } as a proposition.`,
        proposition.value.span,
      ),
    );
  }
  if (
    proposition.tag === "equal" || proposition.tag === "not_equal" ||
    proposition.tag === "less" || proposition.tag === "less_equal"
  ) {
    const left = check_prefix_term_type(
      declaration_name,
      proposition.left,
      term_types,
      facts,
      nonzero_terms,
    );
    const right = check_prefix_term_type(
      declaration_name,
      proposition.right,
      term_types,
      facts,
      nonzero_terms,
    );
    const operands = Applicative.lift(
      (left_type: LogicalTermType, right_type: LogicalTermType) =>
        [
          left_type,
          right_type,
        ] as const,
      left,
      right,
    );
    const operand_types = checked_value(operands);
    if (operand_types === undefined) return operands.map(() => undefined);
    const [left_type, right_type] = operand_types;
    if (!logical_term_types_match(left_type, right_type)) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_unproved,
          `${declaration_name} compares ${
            logical_term_type_display(left_type)
          } with ${logical_term_type_display(right_type)}.`,
          proposition.span,
        ),
      );
    }
    if (
      (proposition.tag === "less" || proposition.tag === "less_equal") &&
      !is_ordered_logical_type(left_type.representation)
    ) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_unproved,
          `${declaration_name} orders values of type ${
            logical_term_type_display(left_type)
          }.`,
          proposition.span,
        ),
      );
    }
    return ok(undefined);
  }
  if (proposition.tag === "is") {
    if (
      proposition.type.resolved !== true &&
      !type_names.has(proposition.type.canonical)
    ) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_unproved,
          `${declaration_name} refers to unknown logical type ${proposition.type.text}.`,
          proposition.type.span,
        ),
      );
    }
    return check_prefix_term_type(
      declaration_name,
      proposition.value,
      term_types,
      facts,
      nonzero_terms,
    ).map(() => undefined);
  }
  if (proposition.tag === "not") {
    return check_prefix_proposition(
      declaration_name,
      proposition.proposition,
      term_types,
      type_names,
      facts,
      nonzero_terms,
    );
  }
  if (
    proposition.tag === "and" || proposition.tag === "or" ||
    proposition.tag === "implies"
  ) {
    const left = check_prefix_proposition(
      declaration_name,
      proposition.left,
      term_types,
      type_names,
      facts,
      nonzero_terms,
    );
    let right_nonzero = nonzero_terms;
    if (proposition.tag === "and") {
      const established = proposition_nonzero_term(proposition.left);
      if (established !== undefined) {
        const extended = new Set(nonzero_terms);
        extended.add(established);
        right_nonzero = extended;
      }
    }
    const right = check_prefix_proposition(
      declaration_name,
      proposition.right,
      term_types,
      type_names,
      facts,
      right_nonzero,
    );
    return all([left, right]).map(() => undefined);
  }
  if (proposition.tag === "forall" || proposition.tag === "exists") {
    const binder_type = proposition.binder.type.canonical;
    if (
      proposition.binder.type.resolved !== true &&
      !type_names.has(binder_type)
    ) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_unproved,
          `${declaration_name} quantifies over unknown logical type ${binder_type}.`,
          proposition.binder.type.span,
        ),
      );
    }
    const nested_types = new Map(term_types);
    nested_types.set(
      proposition.binder.name,
      logical_term_type_from_reference(proposition.binder.type),
    );
    const nested_nonzero = new Set(nonzero_terms);
    nested_nonzero.delete(proposition.binder.name);
    return check_prefix_proposition(
      declaration_name,
      proposition.proposition,
      nested_types,
      type_names,
      facts,
      nested_nonzero,
    );
  }
  throw new Error("Unknown formed prefix proposition.");
}

function check_prefix_term_type(
  declaration_name: string,
  term: PrefixSignature["decreases"][number],
  term_types: ReadonlyMap<string, LogicalTermType>,
  facts: ReadonlyMap<string, PrefixFactSignature>,
  nonzero_terms: ReadonlySet<string>,
): Checked<LogicalTermType> {
  const shape = term.shape;
  if (shape.tag === "name") {
    const direct_type = term_types.get(shape.name);
    if (direct_type !== undefined) {
      return ok(direct_type);
    }
    return unsupported_prefix_term(declaration_name, term);
  }
  if (shape.tag === "boolean") {
    return ok({
      name: "Bool",
      representation: "Bool",
      refinement: term.text,
    });
  }
  if (shape.tag === "number") {
    return check_prefix_number_type(declaration_name, term);
  }
  if (shape.tag === "string") {
    return ok({
      name: "Text",
      representation: "Text",
      refinement: term.text,
    });
  }
  if (shape.tag === "character") {
    return ok({
      name: "Char",
      representation: "Char",
      refinement: term.text,
    });
  }
  if (shape.tag === "parenthesized") {
    return check_prefix_term_type(
      declaration_name,
      shape.value,
      term_types,
      facts,
      nonzero_terms,
    );
  }
  if (shape.tag === "unary") {
    if (shape.operator === "-" && shape.operand.shape.tag === "number") {
      return check_prefix_negative_number_type(
        declaration_name,
        shape.operand,
      );
    }
    const operand = check_prefix_term_type(
      declaration_name,
      shape.operand,
      term_types,
      facts,
      nonzero_terms,
    );
    const operand_type = checked_value(operand);
    if (operand_type === undefined) return operand;
    if (
      (shape.operator === "-" || shape.operator === "+") &&
      is_machine_integer_logical_type(operand_type.representation)
    ) {
      return ok({
        name: operand_type.representation,
        representation: operand_type.representation,
      });
    }
    if (shape.operator === "!" && operand_type.representation === "Bool") {
      return ok({ name: "Bool", representation: "Bool" });
    }
    return unsupported_prefix_term(declaration_name, term);
  }
  if (shape.tag === "binary") {
    const left = check_prefix_term_type(
      declaration_name,
      shape.left,
      term_types,
      facts,
      nonzero_terms,
    );
    const right = check_prefix_term_type(
      declaration_name,
      shape.right,
      term_types,
      facts,
      nonzero_terms,
    );
    const operands = Applicative.lift(
      (left_type: LogicalTermType, right_type: LogicalTermType) =>
        [
          left_type,
          right_type,
        ] as const,
      left,
      right,
    );
    const operand_types = checked_value(operands);
    if (operand_types === undefined) return operands.map((types) => types[0]);
    const [left_type, right_type] = operand_types;
    if (shape.operator === "&&" || shape.operator === "||") {
      if (
        left_type.representation !== "Bool" ||
        right_type.representation !== "Bool"
      ) {
        return unsupported_prefix_term(declaration_name, term);
      }
      return ok({ name: "Bool", representation: "Bool" });
    }
    if (shape.operator === "==") {
      if (
        !logical_term_types_match(left_type, right_type) ||
        !supports_prefix_runtime_equality(left_type.representation)
      ) {
        return unsupported_prefix_term(declaration_name, term);
      }
      return ok({ name: "Bool", representation: "Bool" });
    }
    if (
      !logical_term_types_match(left_type, right_type) ||
      !is_machine_integer_logical_type(left_type.representation) ||
      !is_machine_integer_logical_type(right_type.representation)
    ) {
      return unsupported_prefix_term(declaration_name, term);
    }
    if (
      shape.operator !== "+" && shape.operator !== "-" &&
      shape.operator !== "*" && shape.operator !== "/" &&
      shape.operator !== "%"
    ) {
      return unsupported_prefix_term(declaration_name, term);
    }
    if (
      (shape.operator === "/" || shape.operator === "%") &&
      !prefix_term_is_known_nonzero(shape.right, nonzero_terms)
    ) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_unproved,
          `${declaration_name} cannot prove ${shape.right.text} is nonzero before evaluating ${term.text}.`,
          shape.right.span,
        ),
      );
    }
    const result_type: LogicalTermType = {
      name: left_type.representation,
      representation: left_type.representation,
    };
    if (
      shape.operator === "/" &&
      is_signed_machine_integer_logical_type(result_type.representation) &&
      !prefix_term_is_positive_number(shape.right)
    ) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_unproved,
          `${declaration_name} cannot rule out signed division overflow in ${term.text}.`,
          term.span,
        ),
      );
    }
    return ok(result_type);
  }
  if (shape.tag === "call") {
    if (shape.function.shape.tag !== "name") {
      return unsupported_prefix_term(declaration_name, term);
    }
    const fact_name = shape.function.shape.name;
    if (term_types.has(fact_name)) {
      return unsupported_prefix_term(declaration_name, term);
    }
    const fact = facts.get(fact_name);
    if (fact === undefined) {
      return unsupported_prefix_term(declaration_name, term);
    }
    if (shape.arguments.length !== fact.parameters.length) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_mismatch,
          `Fact ${fact_name} expects ${fact.parameters.length} arguments but received ${shape.arguments.length}.`,
          term.span,
        ),
      );
    }
    const type_substitutions = new Map<string, LogicalTermType>();
    const argument_checks = shape.arguments.map((argument, index) => {
      const checked_argument = check_prefix_term_type(
        declaration_name,
        argument,
        term_types,
        facts,
        nonzero_terms,
      );
      const argument_type = checked_value(checked_argument);
      if (argument_type === undefined) return checked_argument;
      const expected = fact.parameters[index];
      expect(
        expected !== undefined,
        `Fact ${fact_name} lost parameter ${index}.`,
      );
      const candidate_substitutions = new Map(type_substitutions);
      if (
        expected.expression !== undefined &&
        prefix_type_pattern_matches(
          expected.expression,
          argument_type,
          fact.type_parameters,
          candidate_substitutions,
        )
      ) {
        for (const [name, type] of candidate_substitutions) {
          type_substitutions.set(name, type);
        }
        return ok(argument_type);
      }
      if (
        argument_type.name === expected.name ||
        argument_type.refinement === expected.name ||
        expected.name === expected.representation &&
          argument_type.representation === expected.representation
      ) {
        return ok(argument_type);
      }
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_mismatch,
          `Fact ${fact_name} argument ${index + 1} requires ${
            logical_term_type_display(expected)
          } but received ${logical_term_type_display(argument_type)}.`,
          argument.span,
        ),
      );
    });
    return all(argument_checks).map(() => ({
      name: "Prop",
      representation: "Prop",
    }));
  }
  return unsupported_prefix_term(declaration_name, term);
}

function check_prefix_number_type(
  declaration_name: string,
  term: PrefixSignature["decreases"][number],
): Checked<LogicalTermType> {
  const integer_literal = prefix_integer_literal(term.text);
  if (integer_literal !== undefined) {
    if (integer_literal.type.width > 64) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_mismatch,
          `${declaration_name} uses unsupported logical integer width ${integer_literal.type.width} in ${term.text}.`,
          term.span,
        ),
      );
    }
    if (integer_literal.value > integer_maximum(integer_literal.type)) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_mismatch,
          `${declaration_name} contains out-of-range ${
            integer_type_name(integer_literal.type)
          } logical number ${term.text}.`,
          term.span,
        ),
      );
    }
    return ok({
      name: integer_type_name(integer_literal.type),
      representation: integer_type_name(integer_literal.type),
      refinement: term.text,
    });
  }
  let expression;
  try {
    expression = parse_number_expr(term.text);
  } catch (error) {
    let message = String(error);
    if (error instanceof Error) message = error.message;
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_mismatch,
        `${declaration_name} contains invalid logical number ${term.text}: ${message}`,
        term.span,
      ),
    );
  }
  expect(expression.tag === "num", "Logical number did not parse as a number.");
  if (
    expression.integer === undefined && expression.type === "i32" &&
    /^[0-9][0-9_]*$/.test(term.text)
  ) {
    const value = BigInt(term.text.replaceAll("_", ""));
    if (value > 2_147_483_647n) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_mismatch,
          `${declaration_name} contains out-of-range I32 logical number ${term.text}.`,
          term.span,
        ),
      );
    }
    return ok({
      name: "I32",
      representation: "I32",
      refinement: term.text,
    });
  }
  if (expression.type === "f32") {
    return ok({ name: "F32", representation: "F32" });
  }
  if (expression.type === "f64") {
    return ok({ name: "F64", representation: "F64" });
  }
  return fail(
    compiler_diagnostic(
      diagnostic_codes.prefix_signature_mismatch,
      `${declaration_name} contains malformed logical number ${term.text}.`,
      term.span,
    ),
  );
}

function check_prefix_negative_number_type(
  declaration_name: string,
  term: PrefixSignature["decreases"][number],
): Checked<LogicalTermType> {
  const integer_literal = prefix_integer_literal(term.text);
  if (integer_literal !== undefined) {
    if (integer_literal.type.width > 64) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_mismatch,
          `${declaration_name} uses unsupported logical integer width ${integer_literal.type.width} in -${term.text}.`,
          term.span,
        ),
      );
    }
    if (!integer_literal.type.signed) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_mismatch,
          `${declaration_name} negates unsigned logical number ${term.text}.`,
          term.span,
        ),
      );
    }
    const minimum_magnitude = 1n <<
      BigInt(integer_literal.type.width - 1);
    if (integer_literal.value > minimum_magnitude) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_mismatch,
          `${declaration_name} contains out-of-range negative ${
            integer_type_name(integer_literal.type)
          } logical number -${term.text}.`,
          term.span,
        ),
      );
    }
    return ok({
      name: integer_type_name(integer_literal.type),
      representation: integer_type_name(integer_literal.type),
      refinement: "-" + term.text,
    });
  }
  if (/^[0-9][0-9_]*$/.test(term.text)) {
    const value = BigInt(term.text.replaceAll("_", ""));
    if (value <= 2_147_483_648n) {
      return ok({
        name: "I32",
        representation: "I32",
        refinement: "-" + term.text,
      });
    }
  }
  return fail(
    compiler_diagnostic(
      diagnostic_codes.prefix_signature_mismatch,
      `${declaration_name} contains invalid negative logical number -${term.text}.`,
      term.span,
    ),
  );
}

function prefix_integer_literal(
  text: string,
): { type: { signed: boolean; width: number }; value: bigint } | undefined {
  const suffix = /([iu][1-9][0-9]*)$/.exec(text)?.[1];
  if (suffix === undefined) return undefined;
  const type = integer_type_from_name(suffix.toUpperCase());
  if (type === undefined) return undefined;
  const literal = text.slice(0, text.length - suffix.length);
  return {
    type,
    value: BigInt(literal.replaceAll("_", "")),
  };
}

function unsupported_prefix_term(
  declaration_name: string,
  term: PrefixSignature["decreases"][number],
): Checked<LogicalTermType> {
  return fail(
    compiler_diagnostic(
      diagnostic_codes.prefix_signature_unproved,
      `${declaration_name} contains unsupported logical term ${term.text}.`,
      term.span,
    ),
  );
}

function logical_term_types_match(
  left: LogicalTermType,
  right: LogicalTermType,
): boolean {
  return left.name === right.name ||
    left.representation === right.representation;
}

function logical_term_type_display(type: LogicalTermType): string {
  if (type.display_name !== undefined) return type.display_name;
  return type.name;
}

function prefix_type_pattern_matches(
  pattern: TypeExpr,
  actual: LogicalTermType,
  type_parameters: ReadonlySet<string>,
  substitutions: Map<string, LogicalTermType>,
  bound_names: {
    pattern: readonly string[];
    actual: readonly string[];
  } = { pattern: [], actual: [] },
): boolean {
  if (pattern.tag === "name") {
    const pattern_depth = bound_names.pattern.lastIndexOf(pattern.name);
    if (pattern_depth >= 0) {
      if (actual.expression?.tag !== "name") return false;
      const actual_depth = bound_names.actual.lastIndexOf(
        actual.expression.name,
      );
      return pattern_depth === actual_depth;
    }
  }
  if (pattern.tag === "name" && type_parameters.has(pattern.name)) {
    if (
      actual.expression !== undefined &&
      type_expression_references_enclosing_binder(
        actual.expression,
        new Set(bound_names.actual),
      )
    ) {
      return false;
    }
    const existing = substitutions.get(pattern.name);
    if (existing === undefined) {
      substitutions.set(pattern.name, actual);
      return true;
    }
    return logical_term_types_match(existing, actual);
  }
  const actual_expression = actual.expression;
  if (actual_expression === undefined) return false;
  if (pattern.tag !== actual_expression.tag) return false;
  if (pattern.tag === "name" && actual_expression.tag === "name") {
    return pattern.name === actual_expression.name;
  }
  if (pattern.tag === "atom" && actual_expression.tag === "atom") {
    return pattern.name === actual_expression.name;
  }
  if (
    pattern.tag === "literal" || pattern.tag === "top" ||
    pattern.tag === "never"
  ) {
    return format_type_expr(pattern) === format_type_expr(actual_expression);
  }
  if (
    (pattern.tag === "frozen" && actual_expression.tag === "frozen") ||
    (pattern.tag === "borrow" && actual_expression.tag === "borrow")
  ) {
    return prefix_type_pattern_matches(
      pattern.value,
      logical_term_type_from_expression(actual_expression.value),
      type_parameters,
      substitutions,
      bound_names,
    );
  }
  if (
    (pattern.tag === "union" && actual_expression.tag === "union") ||
    (pattern.tag === "intersection" &&
      actual_expression.tag === "intersection") ||
    (pattern.tag === "difference" && actual_expression.tag === "difference")
  ) {
    return prefix_type_pattern_matches(
      pattern.left,
      logical_term_type_from_expression(actual_expression.left),
      type_parameters,
      substitutions,
      bound_names,
    ) &&
      prefix_type_pattern_matches(
        pattern.right,
        logical_term_type_from_expression(actual_expression.right),
        type_parameters,
        substitutions,
        bound_names,
      );
  }
  if (pattern.tag === "apply" && actual_expression.tag === "apply") {
    return prefix_type_pattern_matches(
      pattern.func,
      logical_term_type_from_expression(actual_expression.func),
      type_parameters,
      substitutions,
      bound_names,
    ) &&
      prefix_type_pattern_matches(
        pattern.arg,
        logical_term_type_from_expression(actual_expression.arg),
        type_parameters,
        substitutions,
        bound_names,
      );
  }
  if (pattern.tag === "tuple" && actual_expression.tag === "tuple") {
    if (pattern.items.length !== actual_expression.items.length) return false;
    return pattern.items.every((value, index) => {
      const actual_value = actual_expression.items[index];
      expect(actual_value !== undefined, "Tuple type argument disappeared.");
      return prefix_type_pattern_matches(
        value,
        logical_term_type_from_expression(actual_value),
        type_parameters,
        substitutions,
        bound_names,
      );
    });
  }
  if (pattern.tag === "product" && actual_expression.tag === "product") {
    if (pattern.entries.length !== actual_expression.entries.length) {
      return false;
    }
    if (pattern.value_pack !== actual_expression.value_pack) return false;
    if (
      JSON.stringify(pattern.repeat) !==
        JSON.stringify(actual_expression.repeat)
    ) {
      return false;
    }
    return pattern.entries.every((entry, index) => {
      const actual_entry = actual_expression.entries[index];
      expect(actual_entry !== undefined, "Product type entry disappeared.");
      if (entry.label !== actual_entry.label) return false;
      return prefix_type_pattern_matches(
        entry.type_expr,
        logical_term_type_from_expression(actual_entry.type_expr),
        type_parameters,
        substitutions,
        bound_names,
      );
    });
  }
  if (pattern.tag === "array" && actual_expression.tag === "array") {
    if (
      JSON.stringify(pattern.length) !==
        JSON.stringify(actual_expression.length)
    ) {
      return false;
    }
    return prefix_type_pattern_matches(
      pattern.element,
      logical_term_type_from_expression(actual_expression.element),
      type_parameters,
      substitutions,
      bound_names,
    );
  }
  if (pattern.tag === "arrow" && actual_expression.tag === "arrow") {
    if (
      JSON.stringify(pattern.effects) !==
        JSON.stringify(actual_expression.effects)
    ) {
      return false;
    }
    return prefix_type_pattern_matches(
      pattern.param,
      logical_term_type_from_expression(actual_expression.param),
      type_parameters,
      substitutions,
      bound_names,
    ) &&
      prefix_type_pattern_matches(
        pattern.result,
        logical_term_type_from_expression(actual_expression.result),
        type_parameters,
        substitutions,
        bound_names,
      );
  }
  if (pattern.tag === "forall" && actual_expression.tag === "forall") {
    const pattern_parameters = [...pattern.params];
    let pattern_body = pattern.body;
    while (pattern_body.tag === "forall") {
      pattern_parameters.push(...pattern_body.params);
      pattern_body = pattern_body.body;
    }
    const actual_parameters = [...actual_expression.params];
    let actual_body = actual_expression.body;
    while (actual_body.tag === "forall") {
      actual_parameters.push(...actual_body.params);
      actual_body = actual_body.body;
    }
    if (pattern_parameters.length !== actual_parameters.length) return false;
    const nested_bound_names = {
      pattern: [...bound_names.pattern, ...pattern_parameters],
      actual: [...bound_names.actual, ...actual_parameters],
    };
    return prefix_type_pattern_matches(
      pattern_body,
      logical_term_type_from_expression(actual_body),
      type_parameters,
      substitutions,
      nested_bound_names,
    );
  }
  return false;
}

function logical_term_type_from_expression(
  expression: TypeExpr,
): LogicalTermType {
  const name = format_type_expr(expression);
  return { expression, name, representation: name };
}

function type_expression_references_enclosing_binder(
  type: TypeExpr,
  enclosing_names: ReadonlySet<string>,
  local_names = new Set<string>(),
): boolean {
  if (type.tag === "name") {
    return enclosing_names.has(type.name) && !local_names.has(type.name);
  }
  if (type.tag === "frozen" || type.tag === "borrow") {
    return type_expression_references_enclosing_binder(
      type.value,
      enclosing_names,
      local_names,
    );
  }
  if (
    type.tag === "union" || type.tag === "intersection" ||
    type.tag === "difference"
  ) {
    return type_expression_references_enclosing_binder(
      type.left,
      enclosing_names,
      local_names,
    ) ||
      type_expression_references_enclosing_binder(
        type.right,
        enclosing_names,
        local_names,
      );
  }
  if (type.tag === "apply") {
    return type_expression_references_enclosing_binder(
      type.func,
      enclosing_names,
      local_names,
    ) ||
      type_expression_references_enclosing_binder(
        type.arg,
        enclosing_names,
        local_names,
      );
  }
  if (type.tag === "tuple") {
    return type.items.some((value) =>
      type_expression_references_enclosing_binder(
        value,
        enclosing_names,
        local_names,
      )
    );
  }
  if (type.tag === "product") {
    return type.entries.some((entry) =>
      type_expression_references_enclosing_binder(
        entry.type_expr,
        enclosing_names,
        local_names,
      )
    );
  }
  if (type.tag === "array") {
    return type_expression_references_enclosing_binder(
      type.element,
      enclosing_names,
      local_names,
    );
  }
  if (type.tag === "arrow") {
    return type_expression_references_enclosing_binder(
      type.param,
      enclosing_names,
      local_names,
    ) ||
      type_expression_references_enclosing_binder(
        type.result,
        enclosing_names,
        local_names,
      );
  }
  if (type.tag === "forall") {
    const nested_local_names = new Set(local_names);
    for (const parameter of type.params) nested_local_names.add(parameter);
    return type_expression_references_enclosing_binder(
      type.body,
      enclosing_names,
      nested_local_names,
    );
  }
  return false;
}

function is_ordered_logical_type(type_name: string): boolean {
  return type_name === "Int" || type_name === "I32" || type_name === "U32" ||
    type_name === "I64" || type_name === "F32" || type_name === "F64" ||
    /^[IU][1-9][0-9]*$/.test(type_name);
}

function supports_prefix_runtime_equality(type_name: string): boolean {
  return is_ordered_logical_type(type_name) ||
    type_name === "Bool" || type_name === "Char" || type_name === "Text" ||
    type_name === "Bytes" || type_name === "Unit" ||
    type_name.startsWith("#");
}

function is_machine_integer_logical_type(type_name: string): boolean {
  return type_name === "Int" || type_name === "I32" || type_name === "U32" ||
    type_name === "I64" || /^[IU][1-9][0-9]*$/.test(type_name);
}

function is_signed_machine_integer_logical_type(type_name: string): boolean {
  return type_name === "Int" || type_name === "I32" || type_name === "I64" ||
    /^I[1-9][0-9]*$/.test(type_name);
}

function prefix_term_is_known_nonzero(
  term: PrefixSignature["decreases"][number],
  nonzero_terms: ReadonlySet<string>,
): boolean {
  if (term.shape.tag === "name") return nonzero_terms.has(term.shape.name);
  if (term.shape.tag !== "number") return false;
  const integer_literal = prefix_integer_literal(term.text);
  if (integer_literal !== undefined) {
    if (integer_literal.type.width > 64) return false;
    if (integer_literal.value > integer_maximum(integer_literal.type)) {
      return false;
    }
    return integer_literal.value !== 0n;
  }
  if (!/^[0-9][0-9_]*$/.test(term.text)) return false;
  return BigInt(term.text.replaceAll("_", "")) !== 0n;
}

function prefix_term_is_positive_number(
  term: PrefixSignature["decreases"][number],
): boolean {
  if (term.shape.tag !== "number") return false;
  const integer_literal = prefix_integer_literal(term.text);
  if (integer_literal !== undefined) {
    if (integer_literal.type.width > 64) return false;
    if (integer_literal.value > integer_maximum(integer_literal.type)) {
      return false;
    }
    return integer_literal.value > 0n;
  }
  if (!/^[0-9][0-9_]*$/.test(term.text)) return false;
  return BigInt(term.text.replaceAll("_", "")) > 0n;
}

function proposition_nonzero_term(
  proposition: PrefixSignature["requires"][number],
): string | undefined {
  if (proposition.tag === "not") {
    if (proposition.proposition.tag !== "equal") return undefined;
    return unequal_zero_term(
      proposition.proposition.left,
      proposition.proposition.right,
    );
  }
  if (proposition.tag !== "not_equal") return undefined;
  return unequal_zero_term(proposition.left, proposition.right);
}

function unequal_zero_term(
  left: PrefixSignature["decreases"][number],
  right: PrefixSignature["decreases"][number],
): string | undefined {
  if (
    prefix_term_is_zero(left) && right.shape.tag === "name"
  ) {
    return right.shape.name;
  }
  if (
    prefix_term_is_zero(right) && left.shape.tag === "name"
  ) {
    return left.shape.name;
  }
  return undefined;
}

function prefix_term_is_zero(
  term: PrefixSignature["decreases"][number],
): boolean {
  if (term.shape.tag !== "number") return false;
  const integer_literal = prefix_integer_literal(term.text);
  if (integer_literal !== undefined) {
    if (integer_literal.type.width > 64) return false;
    if (integer_literal.value > integer_maximum(integer_literal.type)) {
      return false;
    }
    return integer_literal.value === 0n;
  }
  if (!/^[0-9][0-9_]*$/.test(term.text)) return false;
  return BigInt(term.text.replaceAll("_", "")) === 0n;
}

function check_prefix_result_refinement(
  signature: PrefixSignature,
  refinement: PrefixRefinement,
  definitions: readonly PrefixDefinition[],
  source_text: string,
  symbols: ReadonlyMap<string, readonly ValueId[]>,
  types: ReadonlyMap<ValueId, RepresentationType>,
  origins: ReadonlyMap<ValueId, SemanticOrigin>,
): Checked<{ key: string; proof: CheckedKernelCertificate } | undefined> {
  const ensures = rename_prefix_proposition_reference(
    refinement.proposition,
    refinement.binder,
    "result",
  );
  return check_prefix_ensures(
    {
      ...signature,
      type: {
        ...signature.type,
        result: { ...signature.type.result, name: "result" },
      },
    },
    ensures,
    signature.ensures.length,
    definitions,
    source_text,
    symbols,
    types,
    origins,
  );
}

function rename_prefix_proposition_reference(
  proposition: PrefixProposition,
  from: string,
  to: string,
): PrefixProposition {
  if (proposition.tag === "true" || proposition.tag === "false") {
    return proposition;
  }
  if (proposition.tag === "holds") {
    return {
      ...proposition,
      value: rename_prefix_term_reference(proposition.value, from, to),
    };
  }
  if (
    proposition.tag === "equal" || proposition.tag === "not_equal" ||
    proposition.tag === "less" || proposition.tag === "less_equal"
  ) {
    return {
      ...proposition,
      left: rename_prefix_term_reference(proposition.left, from, to),
      right: rename_prefix_term_reference(proposition.right, from, to),
    };
  }
  if (proposition.tag === "is") {
    return {
      ...proposition,
      value: rename_prefix_term_reference(proposition.value, from, to),
    };
  }
  if (proposition.tag === "not") {
    return {
      ...proposition,
      proposition: rename_prefix_proposition_reference(
        proposition.proposition,
        from,
        to,
      ),
    };
  }
  if (
    proposition.tag === "and" || proposition.tag === "or" ||
    proposition.tag === "implies"
  ) {
    return {
      ...proposition,
      left: rename_prefix_proposition_reference(proposition.left, from, to),
      right: rename_prefix_proposition_reference(proposition.right, from, to),
    };
  }
  if (proposition.tag === "forall" || proposition.tag === "exists") {
    if (proposition.binder.name === from) return proposition;
    return {
      ...proposition,
      proposition: rename_prefix_proposition_reference(
        proposition.proposition,
        from,
        to,
      ),
    };
  }
  throw new Error("Unknown prefix proposition.");
}

function rename_prefix_term_reference(
  term: PrefixTerm,
  from: string,
  to: string,
): PrefixTerm {
  const references = term.references.map((reference) => {
    if (reference === from) return to;
    return reference;
  });
  const shape = term.shape;
  if (shape.tag === "name") {
    if (shape.name !== from) return { ...term, references };
    return {
      ...term,
      text: to,
      references,
      shape: { tag: "name", name: to },
    };
  }
  if (shape.tag === "binary") {
    return {
      ...term,
      references,
      shape: {
        ...shape,
        left: rename_prefix_term_reference(shape.left, from, to),
        right: rename_prefix_term_reference(shape.right, from, to),
      },
    };
  }
  if (shape.tag === "unary") {
    return {
      ...term,
      references,
      shape: {
        ...shape,
        operand: rename_prefix_term_reference(shape.operand, from, to),
      },
    };
  }
  if (shape.tag === "call") {
    return {
      ...term,
      references,
      shape: {
        ...shape,
        function: rename_prefix_term_reference(shape.function, from, to),
        arguments: shape.arguments.map((argument) =>
          rename_prefix_term_reference(argument, from, to)
        ),
      },
    };
  }
  if (shape.tag === "field" || shape.tag === "index") {
    return {
      ...term,
      references,
      shape: {
        ...shape,
        object: rename_prefix_term_reference(shape.object, from, to),
      },
    };
  }
  if (shape.tag === "parenthesized") {
    return {
      ...term,
      references,
      shape: {
        ...shape,
        value: rename_prefix_term_reference(shape.value, from, to),
      },
    };
  }
  return { ...term, references };
}

function check_prefix_ensures(
  signature: PrefixSignature,
  ensures: PrefixSignature["ensures"][number],
  clause_index: number,
  definitions: readonly PrefixDefinition[],
  source_text: string,
  symbols: ReadonlyMap<string, readonly ValueId[]>,
  types: ReadonlyMap<ValueId, RepresentationType>,
  origins: ReadonlyMap<ValueId, SemanticOrigin>,
): Checked<{ key: string; proof: CheckedKernelCertificate } | undefined> {
  const proof_key = signature.scope + ":" + signature.name + ":ensures:" +
    clause_index.toString();
  const proposition_text = source_text.slice(
    ensures.span.start,
    ensures.span.end,
  );
  if (
    ensures.tag === "true" ||
    (ensures.tag === "holds" && ensures.value.text === "true")
  ) {
    const environment = KernelEnvironment.empty();
    const term_context = snapshot_kernel_context([]);
    return ok({
      key: proof_key,
      proof: Object.freeze({
        certificate: check_proof(
          { tag: "true_intro" },
          { tag: "true" },
          {
            allow_unsafe: false,
            environment,
            term_context,
          },
        ),
        environment,
        term_context,
      }),
    });
  }
  if (ensures.tag !== "equal") {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_unproved,
        `Prefix signature ${signature.name} does not establish ensures ${proposition_text}.`,
        ensures.span,
      ),
    );
  }
  if (ensures.left.text === "result" && ensures.right.text === "result") {
    const result_type_name = signature.type.result.type.canonical;
    const declarations = new Map<string, KernelType>();
    declarations.set(result_type_name, type_sort(0));
    const environment = KernelEnvironment.from(declarations);
    const term_context = snapshot_kernel_context([{
      tag: "constant",
      name: result_type_name,
    }]);
    const equality_type = {
      tag: "constant" as const,
      name: result_type_name,
    };
    const variable = { tag: "var" as const, index: 0 };
    const goal = {
      tag: "equal" as const,
      type: equality_type,
      left: variable,
      right: variable,
    };
    return ok({
      key: proof_key,
      proof: Object.freeze({
        certificate: check_proof(
          { tag: "refl", type: equality_type, term: variable },
          goal,
          {
            allow_unsafe: false,
            environment,
            term_context,
          },
        ),
        environment,
        term_context,
      }),
    });
  }
  let expected_name: string | undefined;
  if (ensures.left.text === "result") expected_name = ensures.right.text;
  if (ensures.right.text === "result") expected_name = ensures.left.text;
  if (expected_name === undefined) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_unproved,
        `Prefix signature ${signature.name} does not establish ensures ${proposition_text}.`,
        ensures.span,
      ),
    );
  }
  const metadata_definition = definitions.find((definition) =>
    definition.name === signature.name &&
    definition.scope === signature.scope &&
    definition.span.start >= signature.span.end
  );
  if (metadata_definition === undefined) return ok(undefined);
  let callable_type: RepresentationType | undefined;
  let callable_start = Number.MAX_SAFE_INTEGER;
  const signature_values = symbols.get(signature.name);
  if (signature_values !== undefined) {
    for (const value of signature_values) {
      const origin = origins.get(value);
      if (
        origin === undefined ||
        origin.start < metadata_definition.span.start ||
        origin.end > metadata_definition.span.end ||
        origin.start >= callable_start
      ) {
        continue;
      }
      callable_type = types.get(value);
      callable_start = origin.start;
    }
  }
  if (callable_type !== undefined) {
    callable_type = callable_function_body(callable_type);
  }
  if (callable_type === undefined) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_unproved,
        `Prefix signature ${signature.name} cannot certify ensures ${proposition_text} because the definition has no inferred callable representation.`,
        ensures.span,
      ),
    );
  }
  const signature_parameters = signature.type.parameters;
  const result_type_name = signature.type.result.type.canonical;
  if (signature.type.result.name !== "result") {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_unproved,
        `Prefix signature ${signature.name} must name its result to certify ensures ${proposition_text}.`,
        signature.type.result.span,
      ),
    );
  }
  const expected_index = signature_parameters.findIndex((parameter) =>
    parameter.name === expected_name
  );
  const expected_parameter = signature_parameters[expected_index];
  const expected_representation = callable_type.params[expected_index];
  if (
    callable_type.params.length !== signature_parameters.length ||
    expected_parameter === undefined ||
    expected_representation === undefined ||
    !same_representation_type(
      callable_type.result,
      expected_representation,
    )
  ) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_unproved,
        `Prefix signature ${signature.name} does not match the inferred callable representation required by ensures ${proposition_text}.`,
        ensures.span,
      ),
    );
  }
  const result_name = metadata_definition.callable_body?.text;
  const lambda_parameters = metadata_definition.callable_parameters;
  const establishes = result_name !== undefined &&
    lambda_parameters !== undefined && expected_index >= 0 &&
    expected_parameter !== undefined &&
    expected_parameter.type.canonical === result_type_name &&
    lambda_parameters[expected_index] === result_name;
  if (!establishes) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_unproved,
        `Prefix signature ${signature.name} does not establish ensures ${proposition_text}.`,
        ensures.span,
      ),
    );
  }
  const declarations = new Map<string, KernelType>();
  for (const parameter of signature_parameters) {
    declarations.set(parameter.type.canonical, type_sort(0));
  }
  declarations.set(result_type_name, type_sort(0));
  const environment = KernelEnvironment.from(declarations);
  const term_context = snapshot_kernel_context(
    signature_parameters.map((parameter) => ({
      tag: "constant" as const,
      name: parameter.type.canonical,
    })),
  );
  const variable = {
    tag: "var" as const,
    index: expected_index,
  };
  expect(
    expected_parameter !== undefined,
    "Established contract lost its expected parameter.",
  );
  const equality_type = {
    tag: "constant" as const,
    name: expected_parameter.type.canonical,
  };
  const goal = {
    tag: "equal" as const,
    type: equality_type,
    left: variable,
    right: variable,
  };
  return ok({
    key: proof_key,
    proof: Object.freeze({
      certificate: check_proof(
        { tag: "refl", type: equality_type, term: variable },
        goal,
        {
          allow_unsafe: false,
          environment,
          term_context,
        },
      ),
      environment,
      term_context,
    }),
  });
}

function check_prefix_signature_representation(
  signature: PrefixSignature,
  definitions: readonly PrefixDefinition[],
  source: SourceNode,
  cst_root: BabaCstNode | undefined,
  source_text: string,
  symbols: ReadonlyMap<string, readonly ValueId[]>,
  types: ReadonlyMap<ValueId, RepresentationType>,
  origins: ReadonlyMap<ValueId, SemanticOrigin>,
): Checked<undefined> {
  const unsupported_binder = signature.type.binders.find((binder) =>
    binder.type.canonical !== "Type"
  );
  if (unsupported_binder !== undefined) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_mismatch,
        `Prefix signature ${signature.name} cannot erase dependent binder ${unsupported_binder.name}: ${unsupported_binder.type.text}.`,
        unsupported_binder.span,
      ),
    );
  }
  if (
    signature.type.result.type.proof !== undefined ||
    signature.type.parameters.some((parameter) =>
      parameter.type.proof !== undefined
    )
  ) {
    return ok(undefined);
  }
  if (signature.kind === "fact" || signature.kind === "opaque fact") {
    if (signature.type.result.type.canonical === "Prop") return ok(undefined);
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_mismatch,
        `Fact signature ${signature.name} must return Prop.`,
        signature.type.result.type.span,
      ),
    );
  }
  const definition = definitions.find((candidate) =>
    candidate.name === signature.name &&
    candidate.scope === signature.scope &&
    candidate.span.start >= signature.span.end
  );
  if (definition === undefined) return ok(undefined);
  const body_check = check_prefix_callable_body(
    signature,
    definition,
    source,
    cst_root,
    source_text,
  );
  if (diagnostics_of(body_check).length > 0) return body_check;
  const values = symbols.get(signature.name);
  if (values === undefined) return ok(undefined);
  let callable: RepresentationType | undefined;
  let callable_start = Number.MAX_SAFE_INTEGER;
  for (const value of values) {
    const origin = origins.get(value);
    if (
      origin === undefined ||
      origin.start < definition.span.start ||
      origin.end > definition.span.end ||
      origin.start >= callable_start
    ) {
      continue;
    }
    callable = types.get(value);
    callable_start = origin.start;
  }
  if (callable === undefined) return ok(undefined);
  callable = callable_function_body(callable);
  if (callable === undefined) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_mismatch,
        `Prefix signature ${signature.name} requires a callable definition.`,
        definition.span,
        [{ message: "Signature is here.", span: signature.span }],
      ),
    );
  }
  if (callable.params.length !== signature.type.parameters.length) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_mismatch,
        `Prefix signature ${signature.name} does not match its definition representation.`,
        definition.span,
        [{ message: "Signature is here.", span: signature.span }],
      ),
    );
  }
  return ok(undefined);
}

function check_prefix_callable_body(
  signature: PrefixSignature,
  definition: PrefixDefinition,
  source: SourceNode,
  cst_root: BabaCstNode | undefined,
  source_text: string,
): Checked<undefined> {
  const parameters = definition.callable_parameters;
  const parameter_types = definition.callable_parameter_types;
  const body = definition.callable_body;
  if (
    parameters === undefined || parameter_types === undefined ||
    body === undefined
  ) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_mismatch,
        `Prefix signature ${signature.name} requires a direct callable definition.`,
        definition.span,
        [{ message: "Signature is here.", span: signature.span }],
      ),
    );
  }
  if (parameters.length !== signature.type.parameters.length) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_mismatch,
        `Prefix signature ${signature.name} does not match its definition parameters.`,
        definition.span,
        [{ message: "Signature is here.", span: signature.span }],
      ),
    );
  }
  const parameter_type_check = check_prefix_callable_parameter_types(
    signature,
    definition,
    source,
    cst_root,
    source_text,
  );
  if (diagnostics_of(parameter_type_check).length > 0) {
    return parameter_type_check;
  }
  expect(
    parameter_types.length === parameters.length,
    `Callable ${signature.name} parameter metadata is misaligned.`,
  );
  const term_types = new Map<string, LogicalTermType>();
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index];
    const declared = signature.type.parameters[index];
    expect(
      parameter !== undefined && declared !== undefined,
      `Prefix callable ${signature.name} lost parameter ${index}.`,
    );
    term_types.set(parameter, logical_term_type_from_reference(declared.type));
  }
  const checked_body = check_prefix_term_type(
    signature.name,
    body,
    term_types,
    new Map(),
    new Set(),
  );
  const body_type = checked_value(checked_body);
  if (body_type === undefined) return checked_body.map(() => undefined);
  const result_type = signature.type.result.type.canonical;
  const binding = find_source_binding(source, signature.name, definition.span);
  if (binding === undefined) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_signature_mismatch,
        `Prefix signature ${signature.name} cannot predeclare this structural or mutual definition.`,
        definition.span,
        [{ message: "Prefix signature is here.", span: signature.span }],
      ),
    );
  }
  if (body_type.name === result_type) return ok(undefined);
  if (body.text === result_type) return ok(undefined);
  let actual_result_name: string | undefined;
  if (binding.value.tag === "lam" || binding.value.tag === "rec") {
    actual_result_name = source_facts(source).editor_type_of.get(
      binding.value.body,
    )?.resolved_name;
  }
  if (actual_result_name === result_type) return ok(undefined);
  return fail(
    compiler_diagnostic(
      diagnostic_codes.prefix_signature_mismatch,
      `Prefix signature ${signature.name} declares result ${result_type} but its body has ${body_type.name}.`,
      body.span,
      [{
        message: "Signature result is here.",
        span: signature.type.result.span,
      }],
    ),
  );
}

function callable_function_body(
  representation: RepresentationType,
): Extract<RepresentationType, { tag: "function" }> | undefined {
  let current = representation;
  while (current.tag === "forall") current = current.body;
  if (current.tag !== "function") return undefined;
  return current;
}

function freeze_symbol_index(
  symbols: Map<string, ValueId[]>,
): SemanticSymbolIndex {
  const entries: [string, readonly ValueId[]][] = [];
  symbols.forEach((values, name) => {
    entries.push([name, Object.freeze([...values])]);
  });
  return new FrozenMap(entries);
}

function snapshot_baba_parse_result(parsed: BabaParseResult): BabaParseResult {
  expect(
    is_trusted_baba_parse_result(parsed),
    "Baba parse result is not trusted by the parser boundary.",
  );
  expect(
    parsed !== null && typeof parsed === "object",
    "Baba parse result must be an object.",
  );
  require_own_data(parsed, "tokens");
  require_own_data(parsed, "diagnostics");
  require_own_data(parsed, "recovery_intervals");
  require_own_data(parsed, "cst");
  expect(
    typeof parsed.cst === "object" && parsed.cst !== null,
    "Baba CST must be an object.",
  );
  require_own_data(parsed.cst, "text");
  require_own_data(parsed.cst, "tree");
  require_own_data(parsed.cst, "root");
  expect(
    typeof parsed.cst.text === "string",
    "Baba CST text must be a string.",
  );
  expect(
    typeof parsed.cst.tree === "string",
    "Baba CST tree must be a string.",
  );
  assert_plain_array(parsed.tokens, "Baba tokens");
  assert_plain_array(parsed.diagnostics, "Baba diagnostics");
  assert_plain_array(
    parsed.recovery_intervals,
    "Baba recovery intervals",
  );
  let root: BabaCstNode | undefined;
  if (parsed.cst.root !== undefined) {
    root = snapshot_cst_node(
      parsed.cst.root,
      new WeakSet<object>(),
      new WeakSet<object>(),
      new Set<string>(),
      parsed.cst.text.length,
    );
  } else {
    expect(
      parsed.cst.text.trim().length === 0,
      "Non-empty Baba input must have a CST root.",
    );
  }
  if (root !== undefined) {
    expect(
      root.start === 0 && root.end === parsed.cst.text.length,
      "Baba CST root must cover the complete source.",
    );
  }
  const tokens: BabaParseResult["tokens"] = [];
  for (let index = 0; index < parsed.tokens.length; index += 1) {
    const token = parsed.tokens[index];
    expect(token !== undefined, "Baba token list cannot contain holes.");
    require_own_data(token, "kind");
    require_own_data(token, "text");
    require_own_data(token, "start");
    require_own_data(token, "end");
    expect(
      typeof token.kind === "string" && token.kind.length > 0,
      "Baba token kind must be a non-empty string.",
    );
    expect(
      Number.isSafeInteger(token.start) && token.start >= 0 &&
        token.start <= parsed.cst.text.length,
      "Baba token start is outside source text.",
    );
    expect(
      Number.isSafeInteger(token.end) && token.end >= token.start &&
        token.end <= parsed.cst.text.length,
      "Baba token end is outside source text.",
    );
    tokens.push(
      Object.freeze({
        kind: token.kind,
        text: token.text,
        start: token.start,
        end: token.end,
      }),
    );
  }
  const diagnostics: BabaParseResult["diagnostics"] = [];
  for (let index = 0; index < parsed.diagnostics.length; index += 1) {
    const diagnostic = parsed.diagnostics[index];
    expect(diagnostic !== undefined, "Baba diagnostics cannot contain holes.");
    require_own_data(diagnostic, "message");
    require_own_data(diagnostic, "span");
    require_own_data(diagnostic.span, "start");
    require_own_data(diagnostic.span, "end");
    expect(
      Number.isSafeInteger(diagnostic.span.start) &&
        diagnostic.span.start >= 0 &&
        diagnostic.span.start <= parsed.cst.text.length,
      "Baba diagnostic start is outside source text.",
    );
    expect(
      Number.isSafeInteger(diagnostic.span.end) &&
        diagnostic.span.end >= diagnostic.span.start &&
        diagnostic.span.end <= parsed.cst.text.length,
      "Baba diagnostic end is outside source text.",
    );
    diagnostics.push(Object.freeze({
      message: diagnostic.message,
      span: Object.freeze({
        start: diagnostic.span.start,
        end: diagnostic.span.end,
      }),
    }));
  }
  const diagnostic_snapshots = new Map<SyntaxDiagnostic, SyntaxDiagnostic>();
  for (let index = 0; index < parsed.diagnostics.length; index += 1) {
    const source_diagnostic = parsed.diagnostics[index];
    const diagnostic = diagnostics[index];
    expect(
      source_diagnostic !== undefined && diagnostic !== undefined,
      "Baba diagnostic snapshot disappeared.",
    );
    diagnostic_snapshots.set(source_diagnostic, diagnostic);
  }
  const recovery_nodes = new Map<string, BabaCstNode>();
  collect_cst_recovery_nodes(root, recovery_nodes);
  const recovery_intervals: BabaParseResult["recovery_intervals"] = [];
  for (
    let index = 0;
    index < parsed.recovery_intervals.length;
    index += 1
  ) {
    const interval = parsed.recovery_intervals[index];
    expect(
      interval !== undefined,
      "Baba recovery intervals cannot contain holes.",
    );
    require_own_data(interval, "diagnostic");
    require_own_data(interval, "skipped");
    require_own_data(interval, "source_node_id");
    require_own_data(interval.diagnostic, "message");
    require_own_data(interval.diagnostic, "span");
    require_own_data(interval.diagnostic.span, "start");
    require_own_data(interval.diagnostic.span, "end");
    require_own_data(interval.skipped, "start");
    require_own_data(interval.skipped, "end");
    expect(
      Number.isSafeInteger(interval.skipped.start) &&
        interval.skipped.start >= 0 &&
        interval.skipped.start <= parsed.cst.text.length,
      "Baba recovery interval start is outside source text.",
    );
    expect(
      Number.isSafeInteger(interval.skipped.end) &&
        interval.skipped.end >= interval.skipped.start &&
        interval.skipped.end <= parsed.cst.text.length,
      "Baba recovery interval end is outside source text.",
    );
    const diagnostic = diagnostic_snapshots.get(interval.diagnostic);
    expect(
      diagnostic !== undefined,
      "Baba recovery interval must reference a parser diagnostic.",
    );
    const recovery_node = recovery_nodes.get(interval.source_node_id);
    expect(
      recovery_node !== undefined,
      "Baba recovery interval must reference a CST node.",
    );
    expect(
      interval.skipped.start === recovery_node.start &&
        interval.skipped.end === recovery_node.end,
      "Baba recovery interval must match its CST recovery node.",
    );
    expect(
      diagnostic.span.start === interval.skipped.start &&
        diagnostic.span.end === interval.skipped.end,
      "Baba recovery interval must match its parser diagnostic.",
    );
    recovery_intervals.push(Object.freeze({
      diagnostic,
      skipped: Object.freeze({
        start: interval.skipped.start,
        end: interval.skipped.end,
      }),
      source_node_id: interval.source_node_id,
    }));
  }
  return Object.freeze({
    tokens: Object.freeze(tokens),
    diagnostics: Object.freeze(diagnostics),
    recovery_intervals: Object.freeze(recovery_intervals),
    cst: Object.freeze({
      text: parsed.cst.text,
      tree: parsed.cst.tree,
      root,
    }),
  }) as unknown as BabaParseResult;
}

function collect_cst_recovery_nodes(
  node: BabaCstNode | undefined,
  nodes: Map<string, BabaCstNode>,
): void {
  if (node === undefined) return;
  if (node.kind === "ERROR" || node.kind === "MISSING") {
    nodes.set(node.id, node);
  }
  for (const child of node.children) {
    collect_cst_recovery_nodes(child, nodes);
  }
}

function snapshot_cst_node(
  node: BabaCstNode,
  active: WeakSet<object>,
  seen: WeakSet<object>,
  ids: Set<string>,
  source_length: number,
  depth = 0,
): BabaCstNode {
  expect(depth <= 4096, "Baba CST is too deep.");
  expect(
    node !== null && typeof node === "object",
    "Baba CST node must be an object.",
  );
  require_own_data(node, "id");
  require_own_data(node, "kind");
  require_own_data(node, "start");
  require_own_data(node, "end");
  require_own_data(node, "children");
  expect(
    typeof node.id === "string" && node.id.length > 0,
    "Baba CST node ID must not be empty.",
  );
  expect(!ids.has(node.id), `Duplicate Baba CST node ID ${node.id}.`);
  ids.add(node.id);
  expect(typeof node.kind === "string", "Baba CST node kind must be a string.");
  expect(
    Number.isSafeInteger(node.start) && node.start >= 0,
    "Baba CST node start must be a nonnegative integer.",
  );
  expect(
    Number.isSafeInteger(node.end) && node.end >= node.start,
    "Baba CST node end must follow start.",
  );
  expect(node.end <= source_length, "Baba CST node exceeds source text.");
  assert_plain_array(node.children, "Baba CST children");
  expect(!active.has(node), "Cyclic Baba CST node.");
  expect(!seen.has(node), "Baba CST node is shared by multiple parents.");
  active.add(node);
  seen.add(node);
  const children: BabaCstNode[] = [];
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    expect(child !== undefined, "Baba CST children cannot contain holes.");
    children.push(
      snapshot_cst_node(child, active, seen, ids, source_length, depth + 1),
    );
  }
  active.delete(node);
  return Object.freeze({
    id: node.id,
    kind: node.kind,
    start: node.start,
    end: node.end,
    children: Object.freeze(children),
  }) as unknown as BabaCstNode;
}

function require_own_data(value: object, key: string): void {
  expect(
    Object.prototype.hasOwnProperty.call(value, key),
    `Missing Baba property ${key}.`,
  );
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  expect(
    descriptor !== undefined && descriptor.get === undefined &&
      descriptor.set === undefined,
    `Baba property ${key} must be an own data property.`,
  );
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
      `${label} cannot contain accessor properties.`,
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    expect(
      Object.getOwnPropertyDescriptor(value, String(index)) !== undefined,
      `${label} cannot contain holes.`,
    );
  }
}

export function lower_duck_source(
  analysis: DuckAnalysis,
): Checked<DuckSemanticProgram> {
  expect(
    Reflect.apply(weak_set_has, checked_duck_analyses, [analysis]),
    "Duck semantic lowering requires compiler-owned analysis.",
  );
  const analysis_state = Reflect.apply(
    weak_map_get,
    checked_duck_analysis_state,
    [analysis],
  ) as {
    has_errors: boolean;
    source_fingerprint: string;
  } | undefined;
  expect(
    analysis_state !== undefined,
    "Compiler-owned Duck analysis lost its checked state.",
  );
  expect(
    semantic_graph_fingerprint(analysis.source) ===
      analysis_state.source_fingerprint,
    "Duck analysis source changed after semantic checking.",
  );
  if (analysis_state.has_errors) {
    return fail(...analysis.diagnostics);
  }
  try {
    return check_source_for_gpufuck(analysis.source).map((source) => {
      const core = core_from_source(source);
      freeze_semantic_graph(analysis.source);
      freeze_semantic_graph(core);
      const program = Object.freeze({
        core,
        symbols: analysis.symbols,
        types: analysis.types,
        facts: analysis.facts,
        proofs: analysis.proofs,
        origins: analysis.origins,
        function_summaries: analysis.function_summaries,
      });
      Reflect.apply(weak_map_set, checked_semantic_program_sources, [
        program,
        analysis.source,
      ]);
      return program;
    });
  } catch (error) {
    if (error instanceof CompilerDiagnosticError) {
      return fail(error.diagnostic);
    }
    throw error;
  }
}

function freeze_semantic_graph<value extends object>(root: value): value {
  const pending: object[] = [root];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    expect(current !== undefined, "Semantic graph traversal lost a node.");
    if (visited.has(current)) continue;
    visited.add(current);
    const prototype = Object.getPrototypeOf(current);
    expect(
      prototype === Object.prototype || prototype === Array.prototype,
      "Semantic graphs must contain only ordinary records and arrays.",
    );
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      expect(
        descriptor !== undefined && descriptor.get === undefined &&
          descriptor.set === undefined,
        "Semantic graphs cannot contain accessor properties.",
      );
      const child = descriptor.value;
      if (child !== null && typeof child === "object") {
        pending.push(child);
      }
    }
    Object.freeze(current);
  }
  return root;
}

function semantic_graph_fingerprint(root: object): string {
  const cached = new WeakMap<object, string>();
  const active = new WeakSet<object>();
  let remaining_nodes = 100_000;

  function encode(value: unknown): string {
    if (value === null) return "null";
    if (typeof value === "bigint") return "bigint:" + value.toString();
    if (typeof value !== "object") {
      return typeof value + ":" + JSON.stringify(value);
    }
    const existing = cached.get(value);
    if (existing !== undefined) return existing;
    expect(!active.has(value), "Semantic graphs cannot contain cycles.");
    remaining_nodes -= 1;
    expect(remaining_nodes >= 0, "Semantic graph is too large.");
    active.add(value);
    const prototype = Object.getPrototypeOf(value);
    expect(
      prototype === Object.prototype || prototype === Array.prototype,
      "Semantic graphs must contain only ordinary records and arrays.",
    );
    const entries: string[] = [];
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === "length") continue;
      expect(
        typeof key === "string",
        "Semantic graphs cannot contain symbol properties.",
      );
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      expect(
        descriptor !== undefined && descriptor.get === undefined &&
          descriptor.set === undefined,
        "Semantic graphs cannot contain accessor properties.",
      );
      entries.push(
        key.length.toString() + ":" + key + "=" + encode(descriptor.value),
      );
    }
    active.delete(value);
    let prefix = "object";
    if (Array.isArray(value)) prefix = "array";
    const result = prefix + "[" + entries.join(",") + "]";
    cached.set(value, result);
    return result;
  }

  return encode(root);
}

function collect_semantic_bindings(
  binding_index: BindingIndex,
  root: BabaCstNode | undefined,
  identity: SemanticIdentityAllocator,
  symbols: Map<string, ValueId[]>,
  types: Map<ValueId, RepresentationType>,
  origins: Map<ValueId, SemanticOrigin>,
): Map<EntityId, ValueId> {
  const binding_values = new Map<EntityId, ValueId>();
  for (const entity of binding_index.entities.values()) {
    if (
      (entity.kind !== "value" && entity.kind !== "const" &&
        entity.kind !== "parameter" && entity.kind !== "module_parameter") ||
      entity.owner !== undefined
    ) {
      continue;
    }
    let definition_span: SourceSpan | undefined;
    if (entity.definition !== undefined) {
      const occurrence = binding_index.occurrences.get(entity.definition);
      expect(
        occurrence !== undefined,
        `Semantic binding ${entity.id} lost its definition occurrence.`,
      );
      definition_span = occurrence.span;
    }
    const cst_node = find_covering_node(root, definition_span);
    let value: ValueId;
    if (cst_node === undefined || definition_span === undefined) {
      value = identity.allocate_value();
    } else {
      value = identity.value_for(
        cst_node.id,
        "binding:" + entity.kind + ":" + entity.name + ":" +
          entity.generation.toString(),
      );
      origins.set(
        value,
        Object.freeze({
          source_node: cst_node.id,
          start: definition_span.start,
          end: definition_span.end,
        }),
      );
    }
    binding_values.set(entity.id, value);
    if (entity.definition !== undefined) {
      const values = symbols.get(entity.name);
      if (values === undefined) {
        symbols.set(entity.name, [value]);
      } else {
        values.push(value);
      }
    }
    const representation = binding_index.facts.get(entity.id)?.representation;
    if (representation !== undefined) {
      types.set(value, snapshot_representation_type(representation));
    }
  }
  return binding_values;
}

function find_covering_node(
  node: BabaCstNode | undefined,
  span: SourceSpan | undefined,
): BabaCstNode | undefined {
  if (
    node === undefined || span === undefined ||
    node.start > span.start || node.end < span.end
  ) {
    return undefined;
  }
  let best: BabaCstNode = node;
  for (const child of node.children) {
    const candidate = find_covering_node(child, span);
    if (
      candidate !== undefined &&
      candidate.end - candidate.start < best.end - best.start
    ) {
      best = candidate;
    }
  }
  return best;
}

function has_error_diagnostics(
  diagnostics: readonly SourceDiagnostic[],
): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
