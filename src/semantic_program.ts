import { Applicative } from "@mewhhaha/typeclasses";
import type { Core } from "./core/ast.ts";
import { core_from_source } from "./core/from_source.ts";
import {
  integer_maximum,
  integer_minimum,
  integer_type_from_name,
  integer_type_name,
  normalize_integer,
} from "./integer.ts";
import {
  type Prim,
  primitive_trap_conditions,
  wasm_intrinsic_prim,
} from "./op.ts";
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
import type {
  FixityDeclaration,
  FrontExpr,
  Source as SourceNode,
  Stmt,
  TypeDeclaration,
} from "./frontend/ast.ts";
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
import { lower_baba_type_reference } from "./frontend/baba_type_lower.ts";
import { apply_function_result_context } from "./frontend/function_context.ts";
import {
  format_type_expr,
  resolve_transparent_type_aliases,
} from "./frontend/type_expr.ts";
import {
  normalize_transparent_type_expression,
  type TransparentTypeDefinition,
} from "./frontend/transparent_type.ts";
import { check_source_for_gpufuck } from "./frontend/gpufuck_pipeline.ts";
import { source_with_host_callable_exports } from "./frontend/host_exports.ts";
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
  SemanticNode,
} from "./frontend/semantic_cfg.ts";
import { semantic_calls_at_span } from "./frontend/semantic_cfg.ts";
import { semantic_cfgs_from_source } from "./frontend/semantic_cfg_lower.ts";
import {
  clone_source_tree,
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
import { text_byte_offset_is_boundary } from "./frontend/text.ts";
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
  infer_semantic_bounded_offset_certificate,
  infer_semantic_index_bounds_certificate,
  infer_semantic_integer_narrowing_certificate,
  infer_semantic_machine_certificate,
  infer_semantic_primitive_safety_certificate,
  infer_semantic_remainder_certificate,
  infer_semantic_remainder_divisibility_certificate,
  infer_semantic_slice_bounds_certificate,
  infer_semantic_type_certificate,
  infer_semantic_unreachable_certificate,
  semantic_index_has_length_measure,
  semantic_index_is_disproved,
  semantic_index_is_unreachable,
  semantic_integer_narrowing_is_disproved,
  semantic_integer_narrowing_is_unreachable,
  semantic_primitive_is_disproved,
  semantic_primitive_is_unreachable,
  semantic_slice_is_disproved,
  semantic_slice_is_unreachable,
  type SemanticMachineRequirement,
  type SemanticTypeRequirement,
} from "./frontend/semantic_fact_graph.ts";
import {
  semantic_predicate_certificate,
  type SemanticBoundedOffsetRequirement,
  type SemanticControlFlowCertificate,
  type SemanticIndexBoundsRequirement,
  type SemanticIntegerNarrowingRequirement,
  type SemanticPredicateAtom,
  type SemanticPrimitiveSafetyRequirement,
  type SemanticRemainderDivisibilityRequirement,
  type SemanticRemainderRequirement,
  type SemanticSliceBoundsCertificate,
  type SemanticSliceBoundsRequirement,
  verify_semantic_bounded_offset_certificate,
  verify_semantic_index_bounds_certificate,
  verify_semantic_index_disproved,
  verify_semantic_index_length_measure,
  verify_semantic_index_unreachable,
  verify_semantic_integer_narrowing_certificate,
  verify_semantic_integer_narrowing_disproved,
  verify_semantic_integer_narrowing_unreachable,
  verify_semantic_machine_certificate,
  verify_semantic_predicate_certificate,
  verify_semantic_primitive_disproved,
  verify_semantic_primitive_safety_certificate,
  verify_semantic_primitive_unreachable,
  verify_semantic_remainder_certificate,
  verify_semantic_remainder_divisibility_certificate,
  verify_semantic_slice_bounds_certificate,
  verify_semantic_slice_disproved,
  verify_semantic_slice_unreachable,
  verify_semantic_type_certificate,
  verify_semantic_unreachable_certificate,
} from "./frontend/semantic_fact_certificate.ts";
import {
  check_proof,
  instantiate_proposition,
  type KernelCertificate,
  lift_proposition,
  machine_reflection_holds,
  type ProofTerm,
  type Proposition,
  proposition_equal,
} from "./frontend/proof_kernel.ts";
import {
  type KernelContext,
  KernelEnvironment,
  type KernelTerm,
  type KernelType,
  shift_kernel_term_variables,
  snapshot_kernel_context,
  term_equal,
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
  type PrefixSpan,
  type PrefixTacticCommand,
  type PrefixTerm,
  type PrefixTypeReference,
} from "./frontend/prefix_signature.ts";
import { extract_prefix_source_metadata } from "./frontend/prefix_signature_source.ts";
import { proof_limits } from "./frontend/proof_limits.ts";

export type SemanticSymbolIndex = ReadonlyMap<string, readonly ValueId[]>;
export type SemanticTypeIndex = ReadonlyMap<ValueId, RepresentationType>;
export type RefinementIndex = ReadonlyMap<ValueId, FactState>;
export type CheckedKernelCertificate = {
  certificate: KernelCertificate;
  environment: KernelEnvironment;
  term_context: KernelContext;
  semantic_certificate?: SemanticControlFlowCertificate;
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

type ProofParameterUsageContext = {
  source: SourceNode;
  binding_index: BindingIndex;
};
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
  const syntax = baba_source_syntax(stable_input);
  mark_source_syntax(source, syntax);
  record_baba_source_name_sites(source, syntax);
  let proof_parameter_usage: ProofParameterUsageContext | undefined;
  if (
    prefix_signatures.some((signature) =>
      signature.type.result.type.proof === undefined &&
      signature.type.parameters.some((parameter) =>
        parameter.type.proof !== undefined
      )
    )
  ) {
    const usage_lowering = lower_baba_source(stable_input);
    const usage_source = checked_value(usage_lowering);
    if (usage_source !== undefined) {
      mark_source_syntax(usage_source, syntax);
      record_baba_source_name_sites(usage_source, syntax);
      proof_parameter_usage = {
        source: usage_source,
        binding_index: build_binding_index({
          source: usage_source,
          syntax,
          recovery_intervals: stable_input.recovery_intervals,
        }),
      };
    }
  }
  const prefix_type_application = apply_prefix_signature_types(
    source,
    stable_input.cst.root,
    stable_input.cst.text,
    prefix_signatures,
    prefix_definitions,
    proof_parameter_usage,
  );
  const prefix_type_diagnostics = diagnostics_of(prefix_type_application);
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
  const transparent_types = collect_transparent_types(
    source_analysis.source,
    stable_input.cst.root,
    stable_input.cst.text,
  );
  const precontract_diagnostics = diagnostic_sequence([
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
    ...transparent_types.diagnostics,
  ], options.uri);
  let inferred_control_flow: SemanticCfg | undefined;
  let inferred_callable_control_flow = new Map<
    ValueId,
    SemanticCallableControlFlow
  >();
  if (!has_error_diagnostics(precontract_diagnostics)) {
    const control_flows = semantic_cfgs_from_source(
      source_analysis.source,
      stable_input.cst.root,
      binding_index,
      binding_values,
      origins,
      transparent_types.definitions,
    );
    inferred_control_flow = control_flows.root;
    inferred_callable_control_flow = new Map(control_flows.callables);
  }
  const contract_validation = validate_prefix_contracts(
    prefix_signatures,
    prefix_definitions,
    source_analysis.source,
    stable_input.cst.root,
    stable_input.cst.text,
    binding_index,
    binding_values,
    inferred_control_flow,
    inferred_callable_control_flow,
    symbols,
    types,
    origins,
    transparent_types,
  );
  let index_coverage_diagnostics: CompilerDiagnostic[] = [];
  let narrowing_coverage_diagnostics: CompilerDiagnostic[] = [];
  let primitive_coverage_diagnostics: CompilerDiagnostic[] = [];
  let slice_coverage_diagnostics: CompilerDiagnostic[] = [];
  if (!has_error_diagnostics(precontract_diagnostics)) {
    const facts = source_facts(source_analysis.source);
    index_coverage_diagnostics = validate_index_obligation_coverage(
      facts,
      binding_index,
      inferred_control_flow,
      inferred_callable_control_flow,
    );
    primitive_coverage_diagnostics = validate_primitive_obligation_coverage(
      facts,
      inferred_control_flow,
      inferred_callable_control_flow,
    );
    narrowing_coverage_diagnostics =
      validate_integer_narrowing_obligation_coverage(
        facts,
        inferred_control_flow,
        inferred_callable_control_flow,
      );
    slice_coverage_diagnostics = validate_slice_obligation_coverage(
      facts,
      inferred_control_flow,
      inferred_callable_control_flow,
    );
  }
  const index_validation = validate_index_obligations(
    inferred_control_flow,
    inferred_callable_control_flow,
  );
  const primitive_validation = validate_partial_primitive_obligations(
    inferred_control_flow,
    inferred_callable_control_flow,
  );
  const narrowing_validation = validate_integer_narrowing_obligations(
    inferred_control_flow,
    inferred_callable_control_flow,
  );
  const slice_validation = validate_slice_obligations(
    inferred_control_flow,
    inferred_callable_control_flow,
  );
  const diagnostics = diagnostic_sequence([
    ...precontract_diagnostics,
    ...contract_validation.diagnostics,
    ...index_coverage_diagnostics,
    ...index_validation.diagnostics,
    ...primitive_coverage_diagnostics,
    ...primitive_validation.diagnostics,
    ...narrowing_coverage_diagnostics,
    ...narrowing_validation.diagnostics,
    ...slice_coverage_diagnostics,
    ...slice_validation.diagnostics,
  ], options.uri);
  let control_flow: SemanticCfg | undefined;
  let callable_control_flow: SemanticCallableCfgIndex = new FrozenMap([]);
  if (!has_error_diagnostics(diagnostics)) {
    control_flow = inferred_control_flow;
    callable_control_flow = new FrozenMap(inferred_callable_control_flow);
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
    proofs: new FrozenMap([
      ...contract_validation.proofs,
      ...index_validation.proofs,
      ...primitive_validation.proofs,
      ...narrowing_validation.proofs,
      ...slice_validation.proofs,
    ]),
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
  proof_parameter_usage: ProofParameterUsageContext | undefined,
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
    const proof_parameter_indices = signature.type.parameters.flatMap(
      (parameter, index) => {
        if (parameter.type.proof === undefined) return [];
        return [index];
      },
    );
    const erased_parameter_usage = check_erased_proof_parameter_usage(
      signature,
      definition,
      proof_parameter_usage,
    );
    applications.push(erased_parameter_usage.map(() => null));
    if (diagnostics_of(erased_parameter_usage).length > 0) continue;
    erase_callable_proof_parameters(
      binding.value,
      proof_parameter_indices,
    );
    const runtime_parameters = signature.type.parameters.filter((parameter) =>
      parameter.type.proof === undefined
    );
    const parameter_checks = runtime_parameters.map((parameter) => {
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

function check_erased_proof_parameter_usage(
  signature: PrefixSignature,
  definition: PrefixDefinition,
  usage: ProofParameterUsageContext | undefined,
): Checked<undefined> {
  const proof_parameter_indices = signature.type.parameters.flatMap(
    (parameter, index) => {
      if (parameter.type.proof === undefined) return [];
      return [index];
    },
  );
  if (proof_parameter_indices.length === 0) return ok(undefined);
  expect(
    usage !== undefined,
    `Proof-requiring callable ${signature.name} lost its usage context.`,
  );
  const binding = find_source_binding(
    usage.source,
    signature.name,
    definition.span,
  );
  expect(
    binding !== undefined &&
      (binding.value.tag === "lam" || binding.value.tag === "rec"),
    `Proof-requiring callable ${signature.name} lost its function value.`,
  );
  const binding_index = usage.binding_index;
  const proof_entities = new Map<
    EntityId,
    PrefixSignature["type"]["parameters"][number]
  >();
  for (const index of proof_parameter_indices) {
    const parameter = signature.type.parameters[index];
    const source_parameter = binding.value.params[index];
    expect(
      parameter !== undefined && source_parameter !== undefined,
      `Proof-requiring callable ${signature.name} lost proof parameter ${index}.`,
    );
    let parameter_entity: EntityId | undefined;
    for (const entity of binding_index.entities.values()) {
      if (
        entity.kind === "parameter" &&
        entity.definition_subject === source_parameter
      ) {
        parameter_entity = entity.id;
        break;
      }
    }
    expect(
      parameter_entity !== undefined,
      `Proof-requiring callable ${signature.name} parameter ${source_parameter.name} lost its semantic identity.`,
    );
    proof_entities.set(parameter_entity, parameter);
  }
  const checks: Checked<undefined>[] = [];
  const body_span = source_span(binding.value.body);
  for (const occurrence of binding_index.occurrences.values()) {
    if (
      occurrence.span.start < body_span.start ||
      occurrence.span.end > body_span.end ||
      occurrence.entity === undefined
    ) {
      continue;
    }
    let parameter = proof_entities.get(occurrence.entity);
    const entity = binding_index.entities.get(occurrence.entity);
    if (
      parameter === undefined &&
      occurrence.role === "shadow" &&
      entity?.replaces !== undefined
    ) {
      const subject = entity.definition_subject as { tag?: string };
      if (subject.tag === "assign" || subject.tag === "index_assign") {
        parameter = proof_entities.get(entity.replaces);
      }
    }
    if (parameter === undefined) continue;
    checks.push(
      fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          `Erased proof evidence ${occurrence.name} cannot be used as runtime data.`,
          occurrence.span,
          [{
            message: "Proof parameter is declared here.",
            span: parameter.span,
          }],
        ),
      ),
    );
  }
  return all(checks).map(() => undefined);
}

function erase_callable_proof_parameters(
  value: FrontExpr,
  proof_parameter_indices: readonly number[],
): void {
  if (
    proof_parameter_indices.length === 0 ||
    (value.tag !== "lam" && value.tag !== "rec")
  ) {
    return;
  }
  const erased = new Set(proof_parameter_indices);
  value.params = value.params.filter((_parameter, index) => !erased.has(index));
  const pattern = value.pattern;
  if (pattern?.tag !== "product" || pattern.value_pack !== true) {
    if (value.params.length === 0) value.pattern = { tag: "unit" };
    return;
  }
  pattern.entries = pattern.entries.filter((_entry, index) =>
    !erased.has(index)
  );
  if (pattern.entries.length === 0) {
    value.pattern = { tag: "unit" };
    return;
  }
  if (pattern.entries.length === 1) {
    const entry = pattern.entries[0];
    expect(entry !== undefined, "Erased callable pattern lost its parameter.");
    value.pattern = entry.pattern;
  }
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

type TransparentTypeContext = {
  aliases: ReadonlyMap<string, string>;
  definitions: ReadonlyMap<string, TransparentTypeDefinition>;
  diagnostics: readonly CompilerDiagnostic[];
};

function collect_transparent_types(
  source: SourceNode,
  cst_root: BabaCstNode | undefined,
  source_text: string,
): TransparentTypeContext {
  const aliases = new Map<string, string>();
  const definitions = new Map<string, TransparentTypeDefinition>();
  const declarations_by_name = new Map<string, TypeDeclaration>();
  let declarations = source.declarations;
  if (declarations === undefined) declarations = [];
  for (const declaration of declarations) {
    if (
      declaration.tag !== "type" || declaration.body.tag !== "alias" ||
      declaration.body.opaque === true
    ) {
      continue;
    }
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
    definitions.set(declaration.name, {
      parameters: declaration.params,
      body,
    });
    declarations_by_name.set(declaration.name, declaration);
    if (declaration.params.length === 0) {
      aliases.set(declaration.name, declaration.body.type_name);
    }
  }
  const diagnostics: CompilerDiagnostic[] = [];
  for (const name of definitions.keys()) {
    if (!transparent_alias_reaches(name, name, definitions, new Set())) {
      continue;
    }
    const declaration = declarations_by_name.get(name);
    expect(
      declaration !== undefined,
      `Transparent type ${name} lost its source declaration.`,
    );
    diagnostics.push(
      compiler_diagnostic(
        diagnostic_codes.recursive_type_alias,
        `Transparent type alias ${name} is recursive.`,
        source_span(declaration),
      ),
    );
  }
  return { aliases, definitions, diagnostics };
}

function transparent_alias_reaches(
  current: string,
  target: string,
  definitions: ReadonlyMap<string, TransparentTypeDefinition>,
  visited: ReadonlySet<string>,
): boolean {
  if (visited.has(current)) return false;
  const definition = definitions.get(current);
  if (definition === undefined) return false;
  const dependencies = new Set<string>();
  collect_transparent_alias_dependencies(
    definition.body,
    new Set(definition.parameters),
    dependencies,
  );
  if (dependencies.has(target)) return true;
  const next = new Set(visited);
  next.add(current);
  for (const dependency of dependencies) {
    if (
      transparent_alias_reaches(
        dependency,
        target,
        definitions,
        next,
      )
    ) {
      return true;
    }
  }
  return false;
}

function collect_transparent_alias_dependencies(
  type: TypeExpr,
  bound_names: ReadonlySet<string>,
  dependencies: Set<string>,
): void {
  if (type.tag === "name") {
    if (!bound_names.has(type.name)) dependencies.add(type.name);
    return;
  }
  if (type.tag === "frozen" || type.tag === "borrow") {
    collect_transparent_alias_dependencies(
      type.value,
      bound_names,
      dependencies,
    );
    return;
  }
  if (
    type.tag === "union" || type.tag === "intersection" ||
    type.tag === "difference"
  ) {
    collect_transparent_alias_dependencies(
      type.left,
      bound_names,
      dependencies,
    );
    collect_transparent_alias_dependencies(
      type.right,
      bound_names,
      dependencies,
    );
    return;
  }
  if (type.tag === "apply") {
    collect_transparent_alias_dependencies(
      type.func,
      bound_names,
      dependencies,
    );
    collect_transparent_alias_dependencies(
      type.arg,
      bound_names,
      dependencies,
    );
    return;
  }
  if (type.tag === "tuple") {
    for (const member of type.items) {
      collect_transparent_alias_dependencies(
        member,
        bound_names,
        dependencies,
      );
    }
    return;
  }
  if (type.tag === "product") {
    for (const entry of type.entries) {
      collect_transparent_alias_dependencies(
        entry.type_expr,
        bound_names,
        dependencies,
      );
    }
    return;
  }
  if (type.tag === "array") {
    collect_transparent_alias_dependencies(
      type.element,
      bound_names,
      dependencies,
    );
    return;
  }
  if (type.tag === "arrow") {
    collect_transparent_alias_dependencies(
      type.param,
      bound_names,
      dependencies,
    );
    collect_transparent_alias_dependencies(
      type.result,
      bound_names,
      dependencies,
    );
    return;
  }
  if (type.tag === "forall") {
    const nested_names = new Set(bound_names);
    for (const parameter of type.params) nested_names.add(parameter);
    collect_transparent_alias_dependencies(
      type.body,
      nested_names,
      dependencies,
    );
  }
}

function validate_index_obligation_coverage(
  facts: ReturnType<typeof source_facts>,
  binding_index: BindingIndex,
  control_flow: SemanticCfg | undefined,
  callable_control_flow: ReadonlyMap<ValueId, SemanticCallableControlFlow>,
): CompilerDiagnostic[] {
  const covered_spans = new Set<string>();
  const control_flows: SemanticCfg[] = [];
  if (control_flow !== undefined) control_flows.push(control_flow);
  for (const callable of callable_control_flow.values()) {
    control_flows.push(callable.control_flow);
  }
  for (const candidate of control_flows) {
    for (const block of candidate.blocks) {
      for (const node of block.nodes) {
        if (node.operation.tag !== "index") continue;
        covered_spans.add(
          node.span.start.toString() + ":" + node.span.end.toString(),
        );
      }
    }
  }

  const obligation_subjects: object[] = [];
  const direct_get_callees = new Set<FrontExpr>();
  for (const expression of facts.expressions) {
    if (expression.tag === "index") {
      obligation_subjects.push(expression);
      continue;
    }
    if (
      expression.tag === "app" &&
      expression.func.tag === "var" &&
      expression.func.name === "@get"
    ) {
      direct_get_callees.add(expression.func);
      obligation_subjects.push(expression);
    }
  }
  for (const statement of facts.statements) {
    if (statement.tag === "index_assign") {
      obligation_subjects.push(statement);
    }
  }

  const checks: Checked<null>[] = [];
  for (const expression of facts.expressions) {
    if (
      expression.tag !== "var" || expression.name !== "@get" ||
      direct_get_callees.has(expression)
    ) {
      continue;
    }
    if (!has_source_span(expression)) continue;
    checks.push(fail(compiler_diagnostic(
      diagnostic_codes.partial_operation_unproved,
      "unknown: partial intrinsic @get cannot escape a directly checked call.",
      source_span(expression),
    )));
  }
  for (const subject of obligation_subjects) {
    if (!has_source_span(subject)) continue;
    const span = source_span(subject);
    const key = span.start.toString() + ":" + span.end.toString();
    if (covered_spans.has(key)) continue;
    if (static_index_operation_is_total(subject, binding_index)) continue;
    checks.push(fail(compiler_diagnostic(
      diagnostic_codes.partial_operation_unproved,
      "unknown: the compiler could not construct an index proof obligation.",
      span,
    )));
  }
  return diagnostics_of(all(checks));
}

function static_index_operation_is_total(
  subject: object,
  binding_index: BindingIndex,
): boolean {
  const expression = subject as FrontExpr | Stmt;
  let object: FrontExpr | undefined;
  let index: FrontExpr | undefined;
  let object_entity: EntityId | undefined;
  if (expression.tag === "index") {
    object = expression.object;
    index = expression.index;
  } else if (
    expression.tag === "app" &&
    expression.func.tag === "var" &&
    expression.func.name === "@get"
  ) {
    object = expression.args[0];
    index = expression.args[1];
  } else if (expression.tag === "index_assign") {
    index = expression.index;
    object_entity = binding_index.occurrence_of(expression, "name")?.entity;
  }
  let index_value: number | undefined;
  if (
    index?.tag === "num" && index.type === "i32" &&
    index.character === undefined && typeof index.value === "number" &&
    Number.isSafeInteger(index.value)
  ) {
    index_value = index.value;
  } else if (index?.tag === "var" || index?.tag === "linear") {
    let entity_id = binding_index.occurrence_of(index, "name")?.entity;
    const visited_entities = new Set<EntityId>();
    while (
      entity_id !== undefined && !visited_entities.has(entity_id)
    ) {
      visited_entities.add(entity_id);
      const entity = binding_index.entities.get(entity_id);
      const definition = entity?.definition_subject as {
        value?: FrontExpr;
      } | undefined;
      const value = definition?.value;
      if (
        value?.tag === "num" && value.type === "i32" &&
        value.character === undefined && typeof value.value === "number" &&
        Number.isSafeInteger(value.value)
      ) {
        index_value = value.value;
        break;
      }
      entity_id = entity?.replaces;
    }
  }
  if (index_value === undefined) return false;
  const direct_length = source_aggregate_length(object);
  if (direct_length !== undefined) {
    return index_value >= 0 && index_value < direct_length;
  }
  let object_type: RepresentationType | undefined;
  if (object !== undefined) {
    object_type = binding_index.representation_of(object);
  }
  let annotated_length: number | undefined;
  if (
    object !== undefined &&
    (object.tag === "var" || object.tag === "linear")
  ) {
    const occurrence = binding_index.occurrence_of(object, "name");
    object_entity = occurrence?.entity;
  }
  if (object_entity !== undefined) {
    const visited_entities = new Set<EntityId>();
    while (!visited_entities.has(object_entity)) {
      visited_entities.add(object_entity);
      const current = binding_index.entities.get(object_entity);
      if (current?.replaces === undefined) break;
      object_entity = current.replaces;
    }
    if (object_type === undefined) {
      object_type = binding_index.facts.get(object_entity)?.representation;
    }
    const entity = binding_index.entities.get(object_entity);
    if (entity !== undefined) {
      const definition = entity?.definition_subject as {
        type_annotation?: TypeExpr;
        value?: FrontExpr;
      } | undefined;
      annotated_length = source_aggregate_length(definition?.value);
      const annotation = definition?.type_annotation;
      if (annotated_length === undefined) {
        if (annotation?.tag === "tuple") {
          annotated_length = annotation.items.length;
        } else if (
          annotation?.tag === "product" &&
          annotation.repeat === undefined
        ) {
          annotated_length = annotation.entries.length;
        } else if (
          annotation?.tag === "array" &&
          annotation.length.tag === "number"
        ) {
          annotated_length = annotation.length.value;
        }
      }
    }
  }
  if (annotated_length !== undefined) {
    return index_value >= 0 && index_value < annotated_length;
  }
  if (object_type === undefined) {
    return false;
  }
  while (object_type.tag === "owned") object_type = object_type.value;
  let length: number | undefined;
  if (object_type.tag === "product" || object_type.tag === "record") {
    length = object_type.fields.length;
  } else if (object_type.tag === "fixed_array") {
    length = object_type.length;
  }
  return length !== undefined && index_value >= 0 && index_value < length;
}

function source_aggregate_length(
  expression: FrontExpr | undefined,
): number | undefined {
  if (
    expression?.tag === "product" || expression?.tag === "shape"
  ) {
    return expression.entries.length;
  }
  if (expression?.tag === "array" && expression.rest === undefined) {
    return expression.items.length;
  }
  if (
    expression?.tag === "array_repeat" &&
    expression.length.tag === "num" &&
    expression.length.type === "i32" &&
    typeof expression.length.value === "number" &&
    Number.isSafeInteger(expression.length.value) &&
    expression.length.value >= 0
  ) {
    return expression.length.value;
  }
  return undefined;
}

function validate_slice_obligation_coverage(
  facts: ReturnType<typeof source_facts>,
  control_flow: SemanticCfg | undefined,
  callable_control_flow: ReadonlyMap<ValueId, SemanticCallableControlFlow>,
): CompilerDiagnostic[] {
  const direct_slice_calls: FrontExpr[] = [];
  const direct_slice_callees = new Set<FrontExpr>();
  for (const expression of facts.expressions) {
    if (
      expression.tag !== "app" ||
      expression.func.tag !== "var" ||
      expression.func.name !== "@slice"
    ) {
      continue;
    }
    direct_slice_calls.push(expression);
    direct_slice_callees.add(expression.func);
  }
  const escaped_slice_references = facts.expressions.filter((expression) =>
    expression.tag === "var" &&
    expression.name === "@slice" &&
    !direct_slice_callees.has(expression) &&
    has_source_span(expression)
  );
  if (
    direct_slice_calls.length === 0 &&
    escaped_slice_references.length === 0
  ) {
    return [];
  }

  const covered_spans = new Set<string>();
  const control_flows: SemanticCfg[] = [];
  if (control_flow !== undefined) control_flows.push(control_flow);
  for (const callable of callable_control_flow.values()) {
    control_flows.push(callable.control_flow);
  }
  for (const candidate of control_flows) {
    for (const block of candidate.blocks) {
      for (const node of block.nodes) {
        if (node.operation.tag !== "slice") continue;
        covered_spans.add(
          node.span.start.toString() + ":" + node.span.end.toString(),
        );
      }
    }
  }
  const checks: Checked<null>[] = [];
  for (const expression of direct_slice_calls) {
    if (!has_source_span(expression)) continue;
    const span = source_span(expression);
    const key = span.start.toString() + ":" + span.end.toString();
    if (covered_spans.has(key)) continue;
    checks.push(fail(compiler_diagnostic(
      diagnostic_codes.partial_operation_unproved,
      "unknown: the compiler could not construct a slice proof obligation.",
      span,
    )));
  }
  for (const expression of escaped_slice_references) {
    checks.push(fail(compiler_diagnostic(
      diagnostic_codes.partial_operation_unproved,
      "unknown: partial intrinsic @slice cannot escape a directly checked call.",
      source_span(expression),
    )));
  }
  return diagnostics_of(all(checks));
}

function validate_integer_narrowing_obligation_coverage(
  facts: ReturnType<typeof source_facts>,
  control_flow: SemanticCfg | undefined,
  callable_control_flow: ReadonlyMap<ValueId, SemanticCallableControlFlow>,
): CompilerDiagnostic[] {
  const direct_calls: FrontExpr[] = [];
  const direct_callees = new Set<FrontExpr>();
  for (const expression of facts.expressions) {
    if (
      expression.tag !== "app" ||
      expression.func.tag !== "var" ||
      expression.func.name !== "@integer.narrow"
    ) {
      continue;
    }
    direct_calls.push(expression);
    direct_callees.add(expression.func);
  }
  const escaped_references = facts.expressions.filter((expression) =>
    expression.tag === "var" &&
    expression.name === "@integer.narrow" &&
    !direct_callees.has(expression) &&
    has_source_span(expression)
  );
  if (direct_calls.length === 0 && escaped_references.length === 0) {
    return [];
  }
  const covered_spans = new Set<string>();
  const control_flows: SemanticCfg[] = [];
  if (control_flow !== undefined) control_flows.push(control_flow);
  for (const callable of callable_control_flow.values()) {
    control_flows.push(callable.control_flow);
  }
  for (const candidate of control_flows) {
    for (const block of candidate.blocks) {
      for (const node of block.nodes) {
        if (node.operation.tag !== "narrow_integer") continue;
        covered_spans.add(
          node.span.start.toString() + ":" + node.span.end.toString(),
        );
      }
    }
  }
  const checks: Checked<null>[] = [];
  for (const expression of direct_calls) {
    if (!has_source_span(expression)) continue;
    const span = source_span(expression);
    const key = span.start.toString() + ":" + span.end.toString();
    if (covered_spans.has(key)) continue;
    checks.push(fail(compiler_diagnostic(
      diagnostic_codes.partial_operation_unproved,
      "unknown: the compiler could not construct an integer narrowing proof obligation.",
      span,
    )));
  }
  for (const expression of escaped_references) {
    checks.push(fail(compiler_diagnostic(
      diagnostic_codes.partial_operation_unproved,
      "unknown: partial intrinsic @integer.narrow cannot escape a directly checked call.",
      source_span(expression),
    )));
  }
  return diagnostics_of(all(checks));
}

function validate_primitive_obligation_coverage(
  facts: ReturnType<typeof source_facts>,
  control_flow: SemanticCfg | undefined,
  callable_control_flow: ReadonlyMap<ValueId, SemanticCallableControlFlow>,
): CompilerDiagnostic[] {
  const covered_spans = new Set<string>();
  const control_flows: SemanticCfg[] = [];
  if (control_flow !== undefined) control_flows.push(control_flow);
  for (const callable of callable_control_flow.values()) {
    control_flows.push(callable.control_flow);
  }
  for (const candidate of control_flows) {
    for (const block of candidate.blocks) {
      for (const node of block.nodes) {
        if (
          node.operation.tag !== "primitive" ||
          primitive_trap_conditions(node.operation.name).length === 0
        ) {
          continue;
        }
        covered_spans.add(
          node.span.start.toString() + ":" + node.span.end.toString(),
        );
      }
    }
  }
  const checks: Checked<null>[] = [];
  for (const expression of facts.expressions) {
    if (
      (expression.tag === "var" || expression.tag === "linear") &&
      expression.name.startsWith("@wasm.") &&
      has_source_span(expression)
    ) {
      const primitive = wasm_intrinsic_prim(
        expression.name.slice("@wasm.".length),
      );
      if (
        primitive !== undefined &&
        primitive_trap_conditions(primitive).length > 0
      ) {
        checks.push(fail(compiler_diagnostic(
          diagnostic_codes.partial_operation_unproved,
          "unknown: partial intrinsic " + expression.name +
            " cannot escape a directly checked call.",
          source_span(expression),
        )));
      }
      continue;
    }
    if (
      expression.tag !== "prim" ||
      primitive_trap_conditions(expression.prim).length === 0 ||
      !has_source_span(expression)
    ) {
      continue;
    }
    const span = source_span(expression);
    const key = span.start.toString() + ":" + span.end.toString();
    if (covered_spans.has(key)) continue;
    checks.push(fail(compiler_diagnostic(
      diagnostic_codes.partial_operation_unproved,
      "unknown: the compiler could not construct a primitive trap obligation.",
      span,
    )));
  }
  return diagnostics_of(all(checks));
}

function validate_index_obligations(
  control_flow: SemanticCfg | undefined,
  callable_control_flow: ReadonlyMap<ValueId, SemanticCallableControlFlow>,
): {
  diagnostics: CompilerDiagnostic[];
  proofs: ReadonlyMap<string, CheckedKernelCertificate>;
} {
  const checks: Checked<
    { key: string; proof: CheckedKernelCertificate } | undefined
  >[] = [];
  const control_flows: SemanticCfg[] = [];
  if (control_flow !== undefined) control_flows.push(control_flow);
  for (const callable of callable_control_flow.values()) {
    control_flows.push(callable.control_flow);
  }
  for (let flow_index = 0; flow_index < control_flows.length; flow_index += 1) {
    const candidate = control_flows[flow_index];
    expect(candidate !== undefined, `Index validation lost CFG ${flow_index}.`);
    const producers = new Map<ValueId, SemanticNode>();
    for (const block of candidate.blocks) {
      for (const node of block.nodes) {
        for (const output of node.outputs) producers.set(output, node);
      }
    }
    for (const block of candidate.blocks) {
      for (const node of block.nodes) {
        if (node.operation.tag !== "index") continue;
        if (semantic_index_is_unreachable(candidate, node.span)) {
          expect(
            verify_semantic_index_unreachable(candidate, node.span),
            "FactGraph and the independent verifier disagree about an unreachable index.",
          );
          continue;
        }
        const index = node.inputs[1];
        expect(index !== undefined, "Semantic index lost its index ValueId.");
        const length = node.operation.length;
        if (length === undefined) {
          const object = node.inputs[0];
          expect(
            object !== undefined,
            "Semantic index lost its object ValueId.",
          );
          let found_dynamic_length = false;
          let handled_dynamic_length = false;
          for (const candidate_block of candidate.blocks) {
            for (const candidate_node of candidate_block.nodes) {
              if (
                candidate_node.operation.tag !== "call" ||
                candidate_node.operation.function_name !== "@len" ||
                candidate_node.inputs.length !== 1 ||
                candidate_node.outputs.length !== 1
              ) {
                continue;
              }
              const length_value = candidate_node.outputs[0];
              expect(
                length_value !== undefined,
                "Semantic length measure lost its ValueId.",
              );
              const requirement: SemanticIndexBoundsRequirement = {
                index,
                length_value,
                object,
              };
              if (
                !semantic_index_has_length_measure(
                  candidate,
                  node.span,
                  requirement,
                )
              ) {
                continue;
              }
              expect(
                verify_semantic_index_length_measure(
                  candidate,
                  node.span,
                  requirement,
                ),
                "FactGraph and the independent verifier disagree about a dynamic length measure.",
              );
              found_dynamic_length = true;
              const certificate = infer_semantic_index_bounds_certificate(
                candidate,
                node.span,
                requirement,
              );
              if (certificate === undefined) {
                if (
                  !semantic_index_is_disproved(
                    candidate,
                    node.span,
                    requirement,
                  )
                ) {
                  continue;
                }
                expect(
                  verify_semantic_index_disproved(
                    candidate,
                    node.span,
                    requirement,
                  ),
                  "FactGraph and the independent verifier disagree about a disproved dynamic index.",
                );
                checks.push(fail(compiler_diagnostic(
                  diagnostic_codes.partial_operation_unproved,
                  "disproved: cannot prove index bounds 0 <= index < length(value).",
                  node.span,
                )));
                handled_dynamic_length = true;
                break;
              }
              expect(
                verify_semantic_index_bounds_certificate(
                  certificate,
                  candidate,
                  node.span,
                  requirement,
                ),
                "FactGraph produced an invalid dynamic index bounds certificate.",
              );
              const environment = KernelEnvironment.empty();
              const term_context = snapshot_kernel_context([]);
              const kernel_certificate = check_proof(
                { tag: "true_intro" },
                { tag: "true" },
                {
                  allow_unsafe: false,
                  require_safe: true,
                  environment,
                  term_context,
                },
              );
              checks.push(ok({
                key: "index:" + flow_index.toString() + ":" +
                  node.span.start.toString() + ":" + node.span.end.toString(),
                proof: Object.freeze({
                  certificate: kernel_certificate,
                  environment,
                  term_context,
                  semantic_certificate: certificate,
                }),
              }));
              handled_dynamic_length = true;
              break;
            }
            if (handled_dynamic_length) break;
          }
          if (handled_dynamic_length) continue;
          if (found_dynamic_length) {
            checks.push(
              fail(
                compiler_diagnostic(
                  diagnostic_codes.partial_operation_unproved,
                  "unknown: cannot prove index bounds 0 <= index < length(value).",
                  node.span,
                ),
              ),
            );
            continue;
          }
          checks.push(
            fail(
              compiler_diagnostic(
                diagnostic_codes.partial_operation_unproved,
                "unknown: cannot prove index bounds 0 <= index < length(value); this value has no compile-time length measure.",
                node.span,
              ),
            ),
          );
          continue;
        }
        const requirement: SemanticIndexBoundsRequirement = { index, length };
        const certificate = infer_semantic_index_bounds_certificate(
          candidate,
          node.span,
          requirement,
        );
        if (certificate === undefined) {
          let status = "unknown";
          if (
            semantic_index_is_disproved(candidate, node.span, requirement)
          ) {
            expect(
              verify_semantic_index_disproved(
                candidate,
                node.span,
                requirement,
              ),
              "FactGraph and the independent verifier disagree about a disproved static index.",
            );
            status = "disproved";
          } else {
            const producer = producers.get(index);
            if (
              producer?.operation.tag === "constant" &&
              (typeof producer.operation.value === "number" ||
                typeof producer.operation.value === "bigint")
            ) {
              const constant = producer.operation.value;
              if (
                typeof constant === "bigint" ||
                Number.isSafeInteger(constant)
              ) {
                const value = BigInt(constant);
                if (value < 0n || value >= BigInt(length)) {
                  status = "disproved";
                }
              }
            }
          }
          checks.push(
            fail(
              compiler_diagnostic(
                diagnostic_codes.partial_operation_unproved,
                `${status}: cannot prove index bounds 0 <= index < ${length}.`,
                node.span,
              ),
            ),
          );
          continue;
        }
        expect(
          verify_semantic_index_bounds_certificate(
            certificate,
            candidate,
            node.span,
            requirement,
          ),
          "FactGraph produced an invalid semantic index bounds certificate.",
        );
        const environment = KernelEnvironment.empty();
        const term_context = snapshot_kernel_context([]);
        const kernel_certificate = check_proof(
          { tag: "true_intro" },
          { tag: "true" },
          {
            allow_unsafe: false,
            require_safe: true,
            environment,
            term_context,
          },
        );
        checks.push(
          ok({
            key: "index:" + flow_index.toString() + ":" +
              node.span.start.toString() + ":" + node.id.toString(),
            proof: Object.freeze({
              certificate: kernel_certificate,
              environment,
              term_context,
              semantic_certificate: certificate,
            }),
          }),
        );
      }
    }
  }
  const proofs = new Map<string, CheckedKernelCertificate>();
  for (const check of checks) {
    const checked = checked_value(check);
    if (checked !== undefined) proofs.set(checked.key, checked.proof);
  }
  return {
    diagnostics: diagnostics_of(all(checks)),
    proofs,
  };
}

function validate_slice_obligations(
  control_flow: SemanticCfg | undefined,
  callable_control_flow: ReadonlyMap<ValueId, SemanticCallableControlFlow>,
): {
  diagnostics: CompilerDiagnostic[];
  proofs: ReadonlyMap<string, CheckedKernelCertificate>;
} {
  const checks: Checked<
    { key: string; proof: CheckedKernelCertificate } | undefined
  >[] = [];
  const control_flows: SemanticCfg[] = [];
  if (control_flow !== undefined) control_flows.push(control_flow);
  for (const callable of callable_control_flow.values()) {
    control_flows.push(callable.control_flow);
  }
  for (let flow_index = 0; flow_index < control_flows.length; flow_index += 1) {
    const candidate = control_flows[flow_index];
    expect(candidate !== undefined, `Slice validation lost CFG ${flow_index}.`);
    const producers = new Map<ValueId, SemanticNode>();
    for (const block of candidate.blocks) {
      for (const node of block.nodes) {
        for (const output of node.outputs) producers.set(output, node);
      }
    }
    for (const block of candidate.blocks) {
      for (const node of block.nodes) {
        if (node.operation.tag !== "slice") continue;
        if (semantic_slice_is_unreachable(candidate, node.span)) {
          expect(
            verify_semantic_slice_unreachable(candidate, node.span),
            "FactGraph and the independent verifier disagree about an unreachable slice.",
          );
          continue;
        }
        const object = node.inputs[0];
        const start = node.inputs[1];
        const end = node.inputs[2];
        expect(object !== undefined, "Semantic slice lost its object ValueId.");
        expect(start !== undefined, "Semantic slice lost its start ValueId.");
        expect(end !== undefined, "Semantic slice lost its end ValueId.");
        let object_type = candidate.values.find((value) =>
          value.value === object
        )?.type;
        expect(
          object_type !== undefined,
          "Semantic slice lost its object representation.",
        );
        while (object_type.tag === "owned") object_type = object_type.value;
        let utf8_boundaries: "static_literal" | undefined;
        if (
          object_type.tag === "scalar" && object_type.name === "Text"
        ) {
          utf8_boundaries = "static_literal";
        }
        let certificate: SemanticSliceBoundsCertificate | undefined;
        if (node.operation.length !== undefined) {
          const requirement: SemanticSliceBoundsRequirement = {
            object,
            start,
            end,
            length: node.operation.length,
            utf8_boundaries,
          };
          certificate = infer_semantic_slice_bounds_certificate(
            candidate,
            node.span,
            requirement,
          );
          if (certificate === undefined) {
            let status = "unknown";
            let goal = "slice bounds 0 <= start <= end <= " +
              node.operation.length.toString();
            if (
              semantic_slice_is_disproved(
                candidate,
                node.span,
                requirement,
              )
            ) {
              expect(
                verify_semantic_slice_disproved(
                  candidate,
                  node.span,
                  requirement,
                ),
                "FactGraph and the independent verifier disagree about a disproved static slice.",
              );
              status = "disproved";
            }
            const start_producer = producers.get(start);
            const end_producer = producers.get(end);
            let start_constant:
              | string
              | number
              | bigint
              | boolean
              | undefined;
            let end_constant:
              | string
              | number
              | bigint
              | boolean
              | undefined;
            if (start_producer?.operation.tag === "constant") {
              start_constant = start_producer.operation.value;
            }
            if (end_producer?.operation.tag === "constant") {
              end_constant = end_producer.operation.value;
            }
            if (
              (typeof start_constant === "number" &&
                  Number.isSafeInteger(start_constant) ||
                typeof start_constant === "bigint") &&
              (typeof end_constant === "number" &&
                  Number.isSafeInteger(end_constant) ||
                typeof end_constant === "bigint")
            ) {
              const start_value = BigInt(start_constant);
              const end_value = BigInt(end_constant);
              if (
                start_value < 0n || start_value > end_value ||
                end_value > BigInt(node.operation.length)
              ) {
                status = "disproved";
              } else if (
                utf8_boundaries === "static_literal" &&
                start_producer?.operation.tag === "constant" &&
                end_producer?.operation.tag === "constant"
              ) {
                const object_producer = producers.get(object);
                if (
                  object_producer?.operation.tag === "constant" &&
                  typeof object_producer.operation.value === "string" &&
                  (
                    !text_byte_offset_is_boundary(
                      object_producer.operation.value,
                      Number(start_value),
                    ) ||
                    !text_byte_offset_is_boundary(
                      object_producer.operation.value,
                      Number(end_value),
                    )
                  )
                ) {
                  status = "disproved";
                  goal = "Text slice endpoints are UTF-8 boundaries";
                }
              }
            }
            checks.push(fail(compiler_diagnostic(
              diagnostic_codes.partial_operation_unproved,
              `${status}: cannot prove ${goal}.`,
              node.span,
            )));
            continue;
          }
          expect(
            verify_semantic_slice_bounds_certificate(
              certificate,
              candidate,
              node.span,
              requirement,
            ),
            "FactGraph produced an invalid static slice bounds certificate.",
          );
        } else {
          let slice_disproved = false;
          for (const candidate_block of candidate.blocks) {
            for (const candidate_node of candidate_block.nodes) {
              if (
                candidate_node.operation.tag !== "call" ||
                candidate_node.operation.function_name !== "@len" ||
                candidate_node.inputs.length !== 1 ||
                candidate_node.outputs.length !== 1
              ) {
                continue;
              }
              const length_value = candidate_node.outputs[0];
              expect(
                length_value !== undefined,
                "Semantic slice length measure lost its ValueId.",
              );
              const requirement: SemanticSliceBoundsRequirement = {
                object,
                start,
                end,
                length_value,
                utf8_boundaries,
              };
              certificate = infer_semantic_slice_bounds_certificate(
                candidate,
                node.span,
                requirement,
              );
              if (certificate === undefined) {
                if (
                  !semantic_slice_is_disproved(
                    candidate,
                    node.span,
                    requirement,
                  )
                ) {
                  continue;
                }
                expect(
                  verify_semantic_slice_disproved(
                    candidate,
                    node.span,
                    requirement,
                  ),
                  "FactGraph and the independent verifier disagree about a disproved dynamic slice.",
                );
                checks.push(fail(compiler_diagnostic(
                  diagnostic_codes.partial_operation_unproved,
                  "disproved: cannot prove slice bounds 0 <= start <= end <= length(value).",
                  node.span,
                )));
                slice_disproved = true;
                break;
              }
              expect(
                verify_semantic_slice_bounds_certificate(
                  certificate,
                  candidate,
                  node.span,
                  requirement,
                ),
                "FactGraph produced an invalid dynamic slice bounds certificate.",
              );
              break;
            }
            if (certificate !== undefined || slice_disproved) break;
          }
          if (slice_disproved) continue;
          if (certificate === undefined) {
            let message =
              "unknown: cannot prove slice bounds 0 <= start <= end <= length(value).";
            if (utf8_boundaries === "static_literal") {
              message =
                "unknown: cannot prove Text slice endpoints are UTF-8 boundaries.";
            }
            checks.push(fail(compiler_diagnostic(
              diagnostic_codes.partial_operation_unproved,
              message,
              node.span,
            )));
            continue;
          }
        }
        const environment = KernelEnvironment.empty();
        const term_context = snapshot_kernel_context([]);
        const kernel_certificate = check_proof(
          { tag: "true_intro" },
          { tag: "true" },
          {
            allow_unsafe: false,
            require_safe: true,
            environment,
            term_context,
          },
        );
        checks.push(ok({
          key: "slice:" + flow_index.toString() + ":" +
            node.span.start.toString() + ":" + node.id.toString(),
          proof: Object.freeze({
            certificate: kernel_certificate,
            environment,
            term_context,
            semantic_certificate: certificate,
          }),
        }));
      }
    }
  }
  const proofs = new Map<string, CheckedKernelCertificate>();
  for (const check of checks) {
    const checked = checked_value(check);
    if (checked !== undefined) proofs.set(checked.key, checked.proof);
  }
  return {
    diagnostics: diagnostics_of(all(checks)),
    proofs,
  };
}

function validate_integer_narrowing_obligations(
  control_flow: SemanticCfg | undefined,
  callable_control_flow: ReadonlyMap<ValueId, SemanticCallableControlFlow>,
): {
  diagnostics: CompilerDiagnostic[];
  proofs: ReadonlyMap<string, CheckedKernelCertificate>;
} {
  const checks: Checked<
    { key: string; proof: CheckedKernelCertificate } | undefined
  >[] = [];
  const control_flows: SemanticCfg[] = [];
  if (control_flow !== undefined) control_flows.push(control_flow);
  for (const callable of callable_control_flow.values()) {
    control_flows.push(callable.control_flow);
  }
  for (let flow_index = 0; flow_index < control_flows.length; flow_index += 1) {
    const candidate = control_flows[flow_index];
    expect(
      candidate !== undefined,
      `Integer narrowing validation lost CFG ${flow_index}.`,
    );
    const producers = new Map<ValueId, SemanticNode>();
    for (const block of candidate.blocks) {
      for (const node of block.nodes) {
        for (const output of node.outputs) producers.set(output, node);
      }
    }
    for (const block of candidate.blocks) {
      for (const node of block.nodes) {
        if (node.operation.tag !== "narrow_integer") continue;
        if (
          semantic_integer_narrowing_is_unreachable(candidate, node.span)
        ) {
          expect(
            verify_semantic_integer_narrowing_unreachable(
              candidate,
              node.span,
            ),
            "FactGraph and the independent verifier disagree about an unreachable integer narrowing.",
          );
          continue;
        }
        const value = node.inputs[0];
        expect(
          value !== undefined,
          "Semantic integer narrowing lost its input ValueId.",
        );
        const requirement: SemanticIntegerNarrowingRequirement = {
          value,
          source: node.operation.source,
          target: node.operation.target,
        };
        const certificate = infer_semantic_integer_narrowing_certificate(
          candidate,
          node.span,
          requirement,
        );
        if (certificate === undefined) {
          let status = "unknown";
          if (
            semantic_integer_narrowing_is_disproved(candidate, node.span)
          ) {
            expect(
              verify_semantic_integer_narrowing_disproved(
                candidate,
                node.span,
              ),
              "FactGraph and the independent verifier disagree about a disproved integer narrowing.",
            );
            status = "disproved";
          } else {
            const producer = producers.get(value);
            let integer: bigint | undefined;
            if (producer?.operation.tag === "constant") {
              const constant = producer.operation.value;
              if (typeof constant === "bigint") {
                integer = constant;
              } else if (
                typeof constant === "number" &&
                Number.isSafeInteger(constant)
              ) {
                integer = BigInt(constant);
              }
            }
            if (
              integer !== undefined &&
              (
                integer < integer_minimum(requirement.target) ||
                integer > integer_maximum(requirement.target)
              )
            ) {
              status = "disproved";
            }
          }
          checks.push(fail(compiler_diagnostic(
            diagnostic_codes.partial_operation_unproved,
            status + ": cannot prove integer narrowing requirement " +
              integer_minimum(requirement.target).toString() +
              " <= value <= " +
              integer_maximum(requirement.target).toString() + ".",
            node.span,
          )));
          continue;
        }
        expect(
          verify_semantic_integer_narrowing_certificate(
            certificate,
            candidate,
            node.span,
            requirement,
          ),
          "FactGraph produced an invalid integer narrowing certificate.",
        );
        const environment = KernelEnvironment.empty();
        const term_context = snapshot_kernel_context([]);
        const kernel_certificate = check_proof(
          { tag: "true_intro" },
          { tag: "true" },
          {
            allow_unsafe: false,
            require_safe: true,
            environment,
            term_context,
          },
        );
        checks.push(ok({
          key: "integer-narrowing:" + flow_index.toString() + ":" +
            node.span.start.toString() + ":" + node.id.toString(),
          proof: Object.freeze({
            certificate: kernel_certificate,
            environment,
            term_context,
            semantic_certificate: certificate,
          }),
        }));
      }
    }
  }
  const proofs = new Map<string, CheckedKernelCertificate>();
  for (const check of checks) {
    const checked = checked_value(check);
    if (checked !== undefined) proofs.set(checked.key, checked.proof);
  }
  return {
    diagnostics: diagnostics_of(all(checks)),
    proofs,
  };
}

function validate_partial_primitive_obligations(
  control_flow: SemanticCfg | undefined,
  callable_control_flow: ReadonlyMap<ValueId, SemanticCallableControlFlow>,
): {
  diagnostics: CompilerDiagnostic[];
  proofs: ReadonlyMap<string, CheckedKernelCertificate>;
} {
  const checks: Checked<
    { key: string; proof: CheckedKernelCertificate } | undefined
  >[] = [];
  const control_flows: SemanticCfg[] = [];
  if (control_flow !== undefined) control_flows.push(control_flow);
  for (const callable of callable_control_flow.values()) {
    control_flows.push(callable.control_flow);
  }
  for (let flow_index = 0; flow_index < control_flows.length; flow_index += 1) {
    const candidate = control_flows[flow_index];
    expect(
      candidate !== undefined,
      `Primitive validation lost CFG ${flow_index}.`,
    );
    const producers = new Map<ValueId, SemanticNode>();
    for (const block of candidate.blocks) {
      for (const node of block.nodes) {
        for (const output of node.outputs) producers.set(output, node);
      }
    }
    for (const block of candidate.blocks) {
      for (const node of block.nodes) {
        if (node.operation.tag !== "primitive") continue;
        const trap_conditions = primitive_trap_conditions(
          node.operation.name,
        );
        if (trap_conditions.length === 0) continue;
        const primitive = node.operation.name as Prim;
        if (
          semantic_primitive_is_unreachable(candidate, node.span, primitive)
        ) {
          expect(
            verify_semantic_primitive_unreachable(
              candidate,
              node.span,
              primitive,
            ),
            "FactGraph and the independent verifier disagree about an unreachable primitive.",
          );
          continue;
        }
        const certificate = infer_semantic_primitive_safety_certificate(
          candidate,
          node.span,
          primitive,
        );
        if (certificate === undefined) {
          let status = "unknown";
          if (
            semantic_primitive_is_disproved(
              candidate,
              node.span,
              primitive,
            )
          ) {
            expect(
              verify_semantic_primitive_disproved(
                candidate,
                node.span,
                primitive,
              ),
              "FactGraph and the independent verifier disagree about a disproved primitive.",
            );
            status = "disproved";
          }
          const dividend = node.inputs[0];
          const divisor = node.inputs[1];
          expect(
            dividend !== undefined && divisor !== undefined,
            "Partial primitive lost its operands.",
          );
          const divisor_constant = producers.get(divisor);
          let divisor_value: bigint | undefined;
          if (
            divisor_constant?.operation.tag === "constant" &&
            (typeof divisor_constant.operation.value === "number" ||
              typeof divisor_constant.operation.value === "bigint") &&
            (typeof divisor_constant.operation.value === "bigint" ||
              Number.isSafeInteger(divisor_constant.operation.value))
          ) {
            divisor_value = BigInt(divisor_constant.operation.value);
          }
          if (divisor_value === 0n) status = "disproved";
          let goal = "divisor != 0";
          if (trap_conditions.includes("signed_division_overflow")) {
            const semantic_value = candidate.values.find((value) =>
              value.value === dividend
            );
            let integer: { signed: boolean; width: number } | undefined;
            if (semantic_value?.type.tag === "scalar") {
              integer = integer_type_from_name(semantic_value.type.name);
            } else if (semantic_value?.type.tag === "integer") {
              integer = {
                signed: semantic_value.type.signed,
                width: semantic_value.type.width,
              };
            }
            expect(
              integer !== undefined && integer.signed,
              "Signed division primitive lost its signed integer type.",
            );
            goal += " and (dividend != " +
              integer_minimum(integer).toString() + " or divisor != -1)";
            const dividend_node = producers.get(dividend);
            let dividend_value: bigint | undefined;
            if (
              dividend_node?.operation.tag === "constant" &&
              (typeof dividend_node.operation.value === "number" ||
                typeof dividend_node.operation.value === "bigint") &&
              (typeof dividend_node.operation.value === "bigint" ||
                Number.isSafeInteger(dividend_node.operation.value))
            ) {
              dividend_value = BigInt(dividend_node.operation.value);
            }
            if (
              dividend_value === integer_minimum(integer) &&
              divisor_value === -1n
            ) {
              status = "disproved";
            }
          }
          checks.push(fail(compiler_diagnostic(
            diagnostic_codes.partial_operation_unproved,
            status + ": cannot prove " + goal + " before " + primitive + ".",
            node.span,
          )));
          continue;
        }
        const requirement: SemanticPrimitiveSafetyRequirement =
          certificate.requirement;
        expect(
          verify_semantic_primitive_safety_certificate(
            certificate,
            candidate,
            node.span,
            requirement,
          ),
          "FactGraph produced an invalid primitive safety certificate.",
        );
        const environment = KernelEnvironment.empty();
        const term_context = snapshot_kernel_context([]);
        const kernel_certificate = check_proof(
          { tag: "true_intro" },
          { tag: "true" },
          {
            allow_unsafe: false,
            require_safe: true,
            environment,
            term_context,
          },
        );
        checks.push(ok({
          key: "primitive:" + flow_index.toString() + ":" +
            node.span.start.toString() + ":" + node.id.toString(),
          proof: Object.freeze({
            certificate: kernel_certificate,
            environment,
            term_context,
            semantic_certificate: certificate,
          }),
        }));
      }
    }
  }
  const proofs = new Map<string, CheckedKernelCertificate>();
  for (const check of checks) {
    const checked = checked_value(check);
    if (checked !== undefined) proofs.set(checked.key, checked.proof);
  }
  return {
    diagnostics: diagnostics_of(all(checks)),
    proofs,
  };
}

function validate_prefix_contracts(
  signatures: readonly PrefixSignature[],
  definitions: readonly PrefixDefinition[],
  source: SourceNode,
  cst_root: BabaCstNode | undefined,
  source_text: string,
  binding_index: BindingIndex,
  binding_values: ReadonlyMap<EntityId, ValueId>,
  control_flow: SemanticCfg | undefined,
  callable_control_flow: ReadonlyMap<ValueId, SemanticCallableControlFlow>,
  symbols: ReadonlyMap<string, readonly ValueId[]>,
  types: ReadonlyMap<ValueId, RepresentationType>,
  origins: ReadonlyMap<ValueId, SemanticOrigin>,
  transparent_types: TransparentTypeContext,
): {
  diagnostics: CompilerDiagnostic[];
  proofs: ReadonlyMap<string, CheckedKernelCertificate>;
} {
  const transparent_aliases = transparent_types.aliases;
  const transparent_type_definitions = transparent_types.definitions;
  const declared_type_names = new Set<string>();
  let declarations = source.declarations;
  if (declarations === undefined) declarations = [];
  for (const declaration of declarations) {
    if (declaration.tag !== "type") continue;
    declared_type_names.add(declaration.name);
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
    if (definition.unsafe_span === undefined) continue;
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
          diagnostic_codes.unsafe_proof_use,
          `Unsafe definition ${definition.name} requires a matching prefix signature with a Proof result.`,
          definition.unsafe_span,
        ),
      ),
    );
  }
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
        resolved_definitions,
        declared_type_names,
      ),
      check_prefix_refinement_formation(
        signature,
        resolved_signatures,
        resolved_definitions,
        declared_type_names,
      ),
      check_prefix_requires(
        signature,
        resolved_signatures,
        resolved_definitions,
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
  checks.push(
    ...check_prefix_call_obligations(
      source,
      source_text,
      resolved_signatures,
      resolved_definitions,
      declared_type_names,
      binding_index,
      binding_values,
      control_flow,
      callable_control_flow,
    ),
  );
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

type PrefixRuntimeContract = {
  signature: PrefixSignature;
  definition: PrefixDefinition;
  parameter_terms: ReadonlyMap<string, PrefixTerm>;
};

type PrefixCallObligation = {
  proposition: PrefixProposition;
  source_span: SourceSpan;
  description: string;
};

type PrefixCallHypothesis = {
  proposition: PrefixProposition;
  facts: ReadonlyMap<string, PrefixFactSignature>;
};

function check_prefix_call_obligations(
  source: SourceNode,
  source_text: string,
  signatures: readonly PrefixSignature[],
  definitions: readonly PrefixDefinition[],
  declared_type_names: ReadonlySet<string>,
  binding_index: BindingIndex,
  binding_values: ReadonlyMap<EntityId, ValueId>,
  control_flow: SemanticCfg | undefined,
  callable_control_flow: ReadonlyMap<ValueId, SemanticCallableControlFlow>,
): Checked<
  { key: string; proof: CheckedKernelCertificate } | undefined
>[] {
  const contracts_by_entity = new Map<EntityId, PrefixRuntimeContract>();
  const contracts: PrefixRuntimeContract[] = [];
  for (const signature of signatures) {
    if (
      signature.type.result.type.proof !== undefined ||
      (signature.requires.length === 0 &&
        !signature.type.parameters.some((parameter) =>
          parameter.type.proof !== undefined ||
          parameter.type.refinement !== undefined
        ))
    ) {
      continue;
    }
    const definition = definitions.find((candidate) =>
      candidate.name === signature.name &&
      candidate.scope === signature.scope &&
      candidate.span.start >= signature.span.end
    );
    if (definition === undefined) continue;
    const binding = find_source_binding(
      source,
      signature.name,
      definition.span,
    );
    if (binding === undefined) continue;
    const occurrence = binding_index.occurrence_of(binding, "name");
    if (occurrence?.entity === undefined) continue;
    expect(
      binding.value.tag === "lam" || binding.value.tag === "rec",
      `Proof-requiring callable ${signature.name} lost its function value.`,
    );
    const runtime_parameters = signature.type.parameters.filter((parameter) =>
      parameter.type.proof === undefined
    );
    if (binding.value.params.length !== runtime_parameters.length) continue;
    const parameter_terms = new Map<string, PrefixTerm>();
    for (let index = 0; index < runtime_parameters.length; index += 1) {
      const signature_parameter = runtime_parameters[index];
      const source_parameter = binding.value.params[index];
      expect(
        signature_parameter !== undefined && source_parameter !== undefined,
        `Proof-requiring callable ${signature.name} lost runtime parameter ${index}.`,
      );
      let parameter_entity: EntityId | undefined;
      for (const entity of binding_index.entities.values()) {
        if (
          entity.kind === "parameter" &&
          entity.definition_subject === source_parameter
        ) {
          parameter_entity = entity.id;
          break;
        }
      }
      expect(
        parameter_entity !== undefined,
        `Proof-requiring callable ${signature.name} parameter ${source_parameter.name} lost its semantic identity.`,
      );
      const semantic_name = logical_entity_name(parameter_entity);
      parameter_terms.set(signature_parameter.name, {
        text: source_parameter.name,
        references: [semantic_name],
        shape: { tag: "name", name: semantic_name },
        span: source_span(source_parameter),
      });
    }
    const contract = { signature, definition, parameter_terms };
    contracts_by_entity.set(occurrence.entity, contract);
    contracts.push(contract);
  }
  if (contracts_by_entity.size === 0) return [];

  const calls: Extract<FrontExpr, { tag: "app" }>[] = [];
  const aliases: Extract<Stmt, { tag: "bind" }>[] = [];
  const variables: Extract<FrontExpr, { tag: "var" }>[] = [];
  const pending: object[] = [source];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    expect(current !== undefined, "Call obligation traversal lost a node.");
    if (visited.has(current)) continue;
    visited.add(current);
    if ("tag" in current && current.tag === "app") {
      calls.push(current as Extract<FrontExpr, { tag: "app" }>);
    }
    if ("tag" in current && current.tag === "var") {
      variables.push(current as Extract<FrontExpr, { tag: "var" }>);
    }
    if (
      "tag" in current && current.tag === "bind" &&
      "value" in current &&
      (current as Extract<Stmt, { tag: "bind" }>).value.tag === "var"
    ) {
      aliases.push(current as Extract<Stmt, { tag: "bind" }>);
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

  const checks: Checked<
    { key: string; proof: CheckedKernelCertificate } | undefined
  >[] = [];
  let added_alias = true;
  while (added_alias) {
    added_alias = false;
    for (const alias of aliases) {
      const alias_occurrence = binding_index.occurrence_of(alias, "name");
      const target_occurrence = binding_index.occurrence_of(
        alias.value,
        "name",
      );
      if (
        alias_occurrence?.entity === undefined ||
        target_occurrence?.entity === undefined ||
        contracts_by_entity.has(alias_occurrence.entity)
      ) {
        continue;
      }
      const contract = contracts_by_entity.get(target_occurrence.entity);
      if (contract === undefined) continue;
      contracts_by_entity.set(alias_occurrence.entity, contract);
      added_alias = true;
    }
  }
  const fixity_declarations: FixityDeclaration[] = [];
  if (source.declarations !== undefined) {
    for (const declaration of source.declarations) {
      if (declaration.tag === "fixity") fixity_declarations.push(declaration);
    }
  }
  for (const declaration of fixity_declarations) {
    if (
      declaration.target.startsWith("@syntax.") ||
      declaration.target.includes(".")
    ) {
      continue;
    }
    const target = binding_index.visible_at(source_span(declaration).start)
      .find((entity) => entity.name === declaration.target);
    if (target === undefined) continue;
    const contract = contracts_by_entity.get(target.id);
    if (contract === undefined) continue;
    checks.push(
      fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_unproved,
          `Proof-requiring callable ${contract.signature.name} cannot be a custom fixity target until operator applications support contract checking.`,
          source_span(declaration),
          [{
            message: "The proof-requiring signature is here.",
            span: contract.signature.span,
          }],
        ),
      ),
    );
  }
  const allowed_contract_references = new WeakSet<object>();
  for (const call of calls) {
    if (call.func.tag === "var") allowed_contract_references.add(call.func);
  }
  for (const alias of aliases) {
    if (alias.value.tag === "var") {
      allowed_contract_references.add(alias.value);
    }
  }
  for (const variable of variables) {
    if (allowed_contract_references.has(variable)) continue;
    const occurrence = binding_index.occurrence_of(variable, "name");
    if (
      occurrence?.entity === undefined ||
      !contracts_by_entity.has(occurrence.entity)
    ) {
      continue;
    }
    const contract = contracts_by_entity.get(occurrence.entity);
    expect(contract !== undefined, "Contract reference lost its signature.");
    checks.push(
      fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_unproved,
          `Proof-requiring callable ${contract.signature.name} cannot be used as a runtime value without higher-order contract checking.`,
          source_span(variable),
          [{
            message: "The proof-requiring signature is here.",
            span: contract.signature.span,
          }],
        ),
      ),
    );
  }
  for (const call of calls) {
    if (call.func.tag !== "var") continue;
    const occurrence = binding_index.occurrence_of(call.func, "name");
    if (occurrence?.entity === undefined) continue;
    const contract = contracts_by_entity.get(occurrence.entity);
    if (contract === undefined) continue;
    const runtime_parameters = contract.signature.type.parameters.filter(
      (parameter) => parameter.type.proof === undefined,
    );
    if (call.args.length !== runtime_parameters.length) {
      checks.push(
        fail(
          compiler_diagnostic(
            diagnostic_codes.prefix_proof_invalid,
            `Call to ${contract.signature.name} supplies ${call.args.length} runtime arguments, but its erased signature accepts ${runtime_parameters.length}; proof arguments are implicit.`,
            source_span(call),
            [{
              message: "The erased signature is here.",
              span: contract.signature.span,
            }],
          ),
        ),
      );
      continue;
    }
    const substitutions = new Map<string, PrefixTerm>();
    const term_types = new Map<string, LogicalTermType>();
    for (let index = 0; index < runtime_parameters.length; index += 1) {
      const parameter = runtime_parameters[index];
      const argument = call.args[index];
      expect(
        parameter !== undefined && argument !== undefined,
        `Call to ${contract.signature.name} lost argument ${index}.`,
      );
      const term = prefix_term_from_front_expr(
        argument,
        source_text,
        binding_index,
      );
      substitutions.set(parameter.name, term);
      if (term.shape.tag === "name") {
        term_types.set(
          term.shape.name,
          logical_term_type_from_reference(parameter.type),
        );
      }
      record_front_expr_logical_types(argument, binding_index, term_types);
    }
    const call_span = source_span(call);
    const caller = enclosing_prefix_runtime_contract(call, contracts);
    let caller_scope = contract.signature.scope;
    let caller_reference_at = contract.signature.span.start;
    if (caller !== undefined) {
      caller_scope = caller.signature.scope;
      caller_reference_at = caller.signature.span.start;
    }
    const caller_facts = prefix_fact_signatures(
      signatures,
      definitions,
      caller_scope,
      caller_reference_at,
      call_span.start,
    );
    const hypotheses = caller_prefix_hypotheses(caller).map((proposition) => ({
      proposition,
      facts: caller_facts,
    }));
    for (const [name, type] of caller_prefix_term_types(caller)) {
      term_types.set(name, type);
    }
    const obligations = instantiate_prefix_call_obligations(
      contract.signature,
      substitutions,
    );
    const facts = prefix_fact_signatures(
      signatures,
      definitions,
      contract.signature.scope,
      contract.signature.span.start,
      call_span.start,
    );
    if (
      call_is_verified_unreachable(
        call_span,
        control_flow,
        callable_control_flow,
      )
    ) {
      continue;
    }
    for (let index = 0; index < obligations.length; index += 1) {
      const obligation = obligations[index];
      expect(
        obligation !== undefined,
        `Call to ${contract.signature.name} lost obligation ${index}.`,
      );
      const branch_hypotheses = verified_branch_hypotheses(
        contract.signature.name,
        obligation.proposition,
        source_span(call),
        binding_values,
        term_types,
        facts,
        hypotheses,
        control_flow,
        callable_control_flow,
      );
      checks.push(
        check_prefix_call_obligation(
          contract.signature,
          obligation,
          call_span,
          [
            ...hypotheses,
            ...branch_hypotheses.propositions.map((proposition) => ({
              proposition,
              facts,
            })),
          ],
          term_types,
          signatures,
          definitions,
          declared_type_names,
          index,
          branch_hypotheses.certificate,
        ),
      );
    }
  }
  return checks;
}

type VerifiedBranchHypotheses = {
  propositions: readonly PrefixProposition[];
  certificate: SemanticControlFlowCertificate | undefined;
};

function verified_branch_hypotheses(
  declaration_name: string,
  proposition: PrefixProposition,
  call_span: SourceSpan,
  binding_values: ReadonlyMap<EntityId, ValueId>,
  term_types: ReadonlyMap<string, LogicalTermType>,
  facts: ReadonlyMap<string, PrefixFactSignature>,
  hypotheses: readonly PrefixCallHypothesis[],
  control_flow: SemanticCfg | undefined,
  callable_control_flow: ReadonlyMap<ValueId, SemanticCallableControlFlow>,
): VerifiedBranchHypotheses {
  const candidate = unique_control_flow_for_call(
    call_span,
    control_flow,
    callable_control_flow,
  );
  if (candidate === undefined) {
    return {
      propositions: [],
      certificate: undefined,
    };
  }
  const normalized = unfold_transparent_prefix_proposition(
    declaration_name,
    proposition,
    term_types,
    facts,
  );
  const type_requirement = prefix_type_requirement(
    normalized,
    binding_values,
  );
  if (type_requirement !== undefined) {
    const certificate = infer_semantic_type_certificate(
      candidate,
      call_span,
      type_requirement,
    );
    if (
      certificate !== undefined &&
      verify_semantic_type_certificate(
        certificate,
        candidate,
        call_span,
        type_requirement,
      )
    ) {
      return {
        propositions: [proposition],
        certificate,
      };
    }
  }
  const machine_requirement = prefix_machine_requirement(
    normalized,
    binding_values,
  );
  if (machine_requirement !== undefined) {
    const certificate = infer_semantic_machine_certificate(
      candidate,
      call_span,
      machine_requirement,
    );
    if (certificate !== undefined) {
      expect(
        verify_semantic_machine_certificate(
          certificate,
          candidate,
          call_span,
          machine_requirement,
        ),
        "FactGraph produced an invalid semantic machine certificate.",
      );
      return {
        propositions: [proposition],
        certificate,
      };
    }
    const bounded_offset = prefix_bounded_offset_requirement(
      machine_requirement,
      candidate,
    );
    if (bounded_offset !== undefined) {
      const certificate = infer_semantic_bounded_offset_certificate(
        candidate,
        call_span,
        bounded_offset,
      );
      if (
        certificate !== undefined &&
        verify_semantic_bounded_offset_certificate(
          certificate,
          candidate,
          call_span,
          bounded_offset,
        )
      ) {
        return {
          propositions: [proposition],
          certificate,
        };
      }
    }
  }
  for (
    const remainder_requirement of prefix_remainder_requirements(
      normalized,
      binding_values,
      candidate,
    )
  ) {
    const certificate = infer_semantic_remainder_certificate(
      candidate,
      call_span,
      remainder_requirement,
    );
    if (certificate === undefined) continue;
    if (
      !verify_semantic_remainder_certificate(
        certificate,
        candidate,
        call_span,
        remainder_requirement,
      )
    ) {
      continue;
    }
    return {
      propositions: [proposition],
      certificate,
    };
  }
  const congruence_requirement = prefix_remainder_congruence_requirement(
    normalized,
    binding_values,
  );
  if (congruence_requirement !== undefined) {
    const certificate = infer_semantic_machine_certificate(
      candidate,
      call_span,
      congruence_requirement,
    );
    if (
      certificate !== undefined &&
      verify_semantic_machine_certificate(
        certificate,
        candidate,
        call_span,
        congruence_requirement,
      )
    ) {
      return {
        propositions: [proposition],
        certificate,
      };
    }
  }
  for (
    const divisibility_requirement
      of prefix_remainder_divisibility_requirements(
        normalized,
        binding_values,
        candidate,
      )
  ) {
    const certificate = infer_semantic_remainder_divisibility_certificate(
      candidate,
      call_span,
      divisibility_requirement,
    );
    if (certificate === undefined) continue;
    if (
      !verify_semantic_remainder_divisibility_certificate(
        certificate,
        candidate,
        call_span,
        divisibility_requirement,
      )
    ) {
      continue;
    }
    return {
      propositions: [proposition],
      certificate,
    };
  }
  const goal_atom = prefix_opaque_predicate_atom(
    declaration_name,
    proposition,
    binding_values,
    term_types,
    facts,
  );
  if (goal_atom !== undefined) {
    for (const hypothesis of hypotheses) {
      const premise_atom = prefix_opaque_predicate_atom(
        declaration_name,
        hypothesis.proposition,
        binding_values,
        term_types,
        hypothesis.facts,
      );
      if (
        premise_atom === undefined ||
        premise_atom.predicate !== goal_atom.predicate
      ) {
        continue;
      }
      const certificate = semantic_predicate_certificate(
        call_span,
        premise_atom,
        goal_atom,
      );
      if (
        !verify_semantic_predicate_certificate(
          certificate,
          candidate,
          call_span,
          [premise_atom],
          goal_atom,
        )
      ) {
        continue;
      }
      return {
        propositions: [proposition],
        certificate,
      };
    }
  }
  return {
    propositions: [],
    certificate: undefined,
  };
}

function call_is_verified_unreachable(
  call_span: SourceSpan,
  control_flow: SemanticCfg | undefined,
  callable_control_flow: ReadonlyMap<ValueId, SemanticCallableControlFlow>,
): boolean {
  const candidate = unique_control_flow_for_call(
    call_span,
    control_flow,
    callable_control_flow,
  );
  if (candidate === undefined) return false;
  const certificate = infer_semantic_unreachable_certificate(
    candidate,
    call_span,
  );
  if (certificate === undefined) return false;
  expect(
    verify_semantic_unreachable_certificate(
      certificate,
      candidate,
      call_span,
    ),
    "FactGraph produced an invalid unreachable-path certificate.",
  );
  return true;
}

function unique_control_flow_for_call(
  call_span: SourceSpan,
  control_flow: SemanticCfg | undefined,
  callable_control_flow: ReadonlyMap<ValueId, SemanticCallableControlFlow>,
): SemanticCfg | undefined {
  const candidates: SemanticCfg[] = [];
  if (control_flow !== undefined) candidates.push(control_flow);
  for (const callable of callable_control_flow.values()) {
    candidates.push(callable.control_flow);
  }
  let found: SemanticCfg | undefined;
  for (const candidate of candidates) {
    const calls = semantic_calls_at_span(candidate, call_span);
    for (const _call of calls) {
      if (found !== undefined) return undefined;
      found = candidate;
    }
  }
  return found;
}

function prefix_semantic_value(
  term: PrefixTerm,
  binding_values: ReadonlyMap<EntityId, ValueId>,
): ValueId | undefined {
  if (term.shape.tag !== "name") return undefined;
  const prefix = "semantic:";
  if (!term.shape.name.startsWith(prefix)) return undefined;
  const entity = term.shape.name.slice(prefix.length) as EntityId;
  return binding_values.get(entity);
}

function prefix_constant_matches(
  term: PrefixTerm,
  value: string | number | bigint | boolean,
): boolean {
  if (term.shape.tag !== "number") return false;
  const literal = parse_number_expr(term.text);
  if (literal.tag !== "num") return false;
  return literal.value === value;
}

function prefix_machine_requirement(
  proposition: PrefixProposition,
  binding_values: ReadonlyMap<EntityId, ValueId>,
): SemanticMachineRequirement | undefined {
  if (
    proposition.tag !== "equal" && proposition.tag !== "not_equal" &&
    proposition.tag !== "less" && proposition.tag !== "less_equal"
  ) {
    return undefined;
  }
  const left_value = prefix_semantic_value(
    proposition.left,
    binding_values,
  );
  const right_value = prefix_semantic_value(
    proposition.right,
    binding_values,
  );
  const left_constant = prefix_integer_constant(proposition.left);
  const right_constant = prefix_integer_constant(proposition.right);
  if (left_value !== undefined && right_constant !== undefined) {
    return prefix_value_constant_requirement(
      proposition.tag,
      left_value,
      right_constant,
      false,
    );
  }
  if (right_value !== undefined && left_constant !== undefined) {
    return prefix_value_constant_requirement(
      proposition.tag,
      right_value,
      left_constant,
      true,
    );
  }
  if (
    left_value !== undefined && right_value !== undefined &&
    (proposition.tag === "equal" || proposition.tag === "not_equal")
  ) {
    let tag: "equality" | "disequality" = "disequality";
    if (proposition.tag === "equal") tag = "equality";
    return {
      tag,
      left: left_value,
      right: right_value,
    };
  }
  if (
    left_value !== undefined && right_value !== undefined &&
    (proposition.tag === "less" || proposition.tag === "less_equal")
  ) {
    let maximum = 0n;
    if (proposition.tag === "less") maximum = -1n;
    return {
      tag: "difference",
      left: left_value,
      right: right_value,
      maximum,
    };
  }
  return undefined;
}

function prefix_type_requirement(
  proposition: PrefixProposition,
  binding_values: ReadonlyMap<EntityId, ValueId>,
): SemanticTypeRequirement | undefined {
  let membership = proposition;
  let expected = true;
  if (
    proposition.tag === "not" && proposition.proposition.tag === "is"
  ) {
    membership = proposition.proposition;
    expected = false;
  }
  if (membership.tag !== "is") return undefined;
  const value = prefix_semantic_value(membership.value, binding_values);
  if (value === undefined) return undefined;
  let type = membership.type.canonical;
  if (membership.type.expression !== undefined) {
    type = format_type_expr(membership.type.expression);
  }
  return {
    value,
    type,
    expected,
  };
}

function prefix_opaque_predicate_atom(
  declaration_name: string,
  proposition: PrefixProposition,
  binding_values: ReadonlyMap<EntityId, ValueId>,
  term_types: ReadonlyMap<string, LogicalTermType>,
  facts: ReadonlyMap<string, PrefixFactSignature>,
  active_facts: ReadonlySet<string> = new Set(),
): SemanticPredicateAtom | undefined {
  if (proposition.tag !== "holds") return undefined;
  const application = prefix_fact_application(proposition.value);
  if (application === undefined) return undefined;
  const fact = facts.get(application.name);
  if (fact === undefined) return undefined;
  if (fact.opaque) {
    if (application.arguments.length !== fact.parameters.length) {
      return undefined;
    }
    const arguments_: ValueId[] = [];
    for (const argument of application.arguments) {
      const value = prefix_semantic_value(argument, binding_values);
      if (value === undefined) return undefined;
      arguments_.push(value);
    }
    return {
      predicate: fact.kernel_name,
      arguments: arguments_,
    };
  }
  if (
    fact.body === undefined || fact.body_parameters === undefined ||
    active_facts.has(fact.kernel_name)
  ) {
    return undefined;
  }
  const body = instantiate_transparent_fact(
    declaration_name,
    application.name,
    fact,
    application.arguments,
    term_types,
    facts,
  );
  if (body === undefined) return undefined;
  const nested_active = new Set(active_facts);
  nested_active.add(fact.kernel_name);
  let body_facts = facts;
  if (fact.body_facts !== undefined) body_facts = fact.body_facts;
  return prefix_opaque_predicate_atom(
    declaration_name,
    body,
    binding_values,
    term_types,
    body_facts,
    nested_active,
  );
}

function prefix_remainder_requirements(
  proposition: PrefixProposition,
  binding_values: ReadonlyMap<EntityId, ValueId>,
  control_flow: SemanticCfg,
): readonly SemanticRemainderRequirement[] {
  if (proposition.tag !== "equal") return [];
  let expression = proposition.left;
  let expected_term = proposition.right;
  if (
    expression.shape.tag !== "binary" ||
    expression.shape.operator !== "%"
  ) {
    expression = proposition.right;
    expected_term = proposition.left;
  }
  if (
    expression.shape.tag !== "binary" ||
    expression.shape.operator !== "%"
  ) {
    return [];
  }
  const dividend = prefix_semantic_value(
    expression.shape.left,
    binding_values,
  );
  const expected = prefix_integer_constant(expected_term);
  if (dividend === undefined || expected === undefined) return [];
  const producers = new Map<ValueId, SemanticNode>();
  for (const block of control_flow.blocks) {
    for (const node of block.nodes) {
      for (const output of node.outputs) producers.set(output, node);
    }
  }
  const requirements: SemanticRemainderRequirement[] = [];
  for (const block of control_flow.blocks) {
    for (const node of block.nodes) {
      if (
        node.operation.tag !== "primitive" ||
        (!node.operation.name.endsWith(".rem_s") &&
          !node.operation.name.endsWith(".rem_u")) ||
        node.inputs.length !== 2
      ) {
        continue;
      }
      const left = node.inputs[0];
      const divisor = node.inputs[1];
      const remainder = node.outputs[0];
      if (
        left !== dividend || divisor === undefined ||
        remainder === undefined
      ) {
        continue;
      }
      const divisor_producer = producers.get(divisor);
      if (
        divisor_producer?.operation.tag !== "constant" ||
        !prefix_constant_matches(
          expression.shape.right,
          divisor_producer.operation.value,
        )
      ) {
        continue;
      }
      requirements.push({
        dividend,
        divisor,
        remainder,
        expected,
      });
    }
  }
  return requirements;
}

function prefix_bounded_offset_requirement(
  goal: SemanticMachineRequirement,
  control_flow: SemanticCfg,
): SemanticBoundedOffsetRequirement | undefined {
  if (goal.tag !== "fact" || goal.proposition.tag === "equal") {
    return undefined;
  }
  const logical_result = goal.proposition.value;
  const producers = new Map<ValueId, SemanticNode>();
  for (const block of control_flow.blocks) {
    for (const node of block.nodes) {
      for (const output of node.outputs) producers.set(output, node);
    }
  }
  const binding = producers.get(logical_result);
  if (
    binding?.operation.tag !== "primitive" ||
    !binding.operation.name.startsWith("bind:") ||
    binding.inputs.length !== 1 ||
    binding.outputs.length !== 1 ||
    binding.outputs[0] !== logical_result
  ) {
    return undefined;
  }
  const result = binding.inputs[0];
  if (result === undefined) return undefined;
  const operation = producers.get(result);
  if (
    operation?.operation.tag !== "primitive" ||
    operation.inputs.length !== 2 ||
    operation.outputs.length !== 1 ||
    operation.outputs[0] !== result
  ) {
    return undefined;
  }
  let offset_operation: "add" | "subtract";
  if (
    operation.operation.name === "i32.add" ||
    operation.operation.name === "i64.add"
  ) {
    offset_operation = "add";
  } else if (
    operation.operation.name === "i32.sub" ||
    operation.operation.name === "i64.sub"
  ) {
    offset_operation = "subtract";
  } else {
    return undefined;
  }
  const input = operation.inputs[0];
  const offset = operation.inputs[1];
  if (
    input === undefined || offset === undefined ||
    producers.get(offset)?.operation.tag !== "constant"
  ) {
    return undefined;
  }
  return {
    operation: offset_operation,
    input,
    offset,
    result,
    logical_result,
    goal: {
      tag: "fact",
      proposition: { ...goal.proposition },
    },
  };
}

function prefix_remainder_divisibility_requirements(
  proposition: PrefixProposition,
  binding_values: ReadonlyMap<EntityId, ValueId>,
  control_flow: SemanticCfg,
): readonly SemanticRemainderDivisibilityRequirement[] {
  if (proposition.tag !== "equal") return [];
  let expression = proposition.left;
  let expected_term = proposition.right;
  if (
    expression.shape.tag !== "binary" ||
    expression.shape.operator !== "%"
  ) {
    expression = proposition.right;
    expected_term = proposition.left;
  }
  if (
    expression.shape.tag !== "binary" ||
    expression.shape.operator !== "%"
  ) {
    return [];
  }
  const dividend = prefix_semantic_value(
    expression.shape.left,
    binding_values,
  );
  const goal_divisor = prefix_integer_constant(expression.shape.right);
  const goal_expected = prefix_integer_constant(expected_term);
  if (
    dividend === undefined || goal_divisor === undefined ||
    goal_expected === undefined || goal_divisor <= 0n ||
    goal_expected !== 0n
  ) {
    return [];
  }
  const producers = new Map<ValueId, SemanticNode>();
  for (const block of control_flow.blocks) {
    for (const node of block.nodes) {
      for (const output of node.outputs) producers.set(output, node);
    }
  }
  const requirements: SemanticRemainderDivisibilityRequirement[] = [];
  for (const block of control_flow.blocks) {
    for (const node of block.nodes) {
      if (
        node.operation.tag !== "primitive" ||
        (!node.operation.name.endsWith(".rem_s") &&
          !node.operation.name.endsWith(".rem_u")) ||
        node.inputs.length !== 2
      ) {
        continue;
      }
      const left = node.inputs[0];
      const divisor = node.inputs[1];
      const remainder = node.outputs[0];
      if (
        left !== dividend || divisor === undefined ||
        remainder === undefined ||
        producers.get(divisor)?.operation.tag !== "constant"
      ) {
        continue;
      }
      requirements.push({
        premise: {
          dividend,
          divisor,
          remainder,
          expected: 0n,
        },
        goal_divisor,
      });
    }
  }
  return requirements;
}

function prefix_remainder_congruence_requirement(
  proposition: PrefixProposition,
  binding_values: ReadonlyMap<EntityId, ValueId>,
): SemanticMachineRequirement | undefined {
  if (proposition.tag !== "equal") return undefined;
  let expression = proposition.left;
  let expected_term = proposition.right;
  if (
    expression.shape.tag !== "binary" ||
    expression.shape.operator !== "%"
  ) {
    expression = proposition.right;
    expected_term = proposition.left;
  }
  if (
    expression.shape.tag !== "binary" ||
    expression.shape.operator !== "%"
  ) {
    return undefined;
  }
  const value = prefix_semantic_value(
    expression.shape.left,
    binding_values,
  );
  const modulus = prefix_integer_constant(expression.shape.right);
  const expected = prefix_integer_constant(expected_term);
  if (
    value === undefined || modulus === undefined || expected === undefined ||
    modulus <= 0n || expected !== 0n
  ) {
    return undefined;
  }
  return {
    tag: "congruence",
    value,
    modulus,
    residue: 0n,
  };
}

function prefix_integer_constant(term: PrefixTerm): bigint | undefined {
  if (term.shape.tag !== "number") return undefined;
  const literal = parse_number_expr(term.text);
  if (literal.tag !== "num") return undefined;
  if (typeof literal.value === "bigint") return literal.value;
  if (!Number.isSafeInteger(literal.value)) return undefined;
  return BigInt(literal.value);
}

function prefix_value_constant_requirement(
  relation: "equal" | "not_equal" | "less" | "less_equal",
  value: ValueId,
  expected: bigint,
  constant_is_left: boolean,
): SemanticMachineRequirement {
  if (relation === "equal") {
    return {
      tag: "fact",
      proposition: { tag: "equal", value, expected },
    };
  }
  if (relation === "not_equal") {
    return { tag: "exclusion", value, expected };
  }
  if (relation === "less") {
    if (constant_is_left) {
      return {
        tag: "fact",
        proposition: { tag: "greater_than", value, bound: expected },
      };
    }
    return {
      tag: "fact",
      proposition: { tag: "less_than", value, bound: expected },
    };
  }
  if (constant_is_left) {
    return {
      tag: "fact",
      proposition: { tag: "greater_equal", value, bound: expected },
    };
  }
  return {
    tag: "fact",
    proposition: { tag: "less_equal", value, bound: expected },
  };
}

function enclosing_prefix_runtime_contract(
  call: FrontExpr,
  contracts: readonly PrefixRuntimeContract[],
): PrefixRuntimeContract | undefined {
  const span = source_span(call);
  let enclosing: PrefixRuntimeContract | undefined;
  let width = Number.POSITIVE_INFINITY;
  for (const contract of contracts) {
    const body = contract.definition.callable_body;
    if (
      body === undefined || body.span.start > span.start ||
      body.span.end < span.end
    ) {
      continue;
    }
    const candidate_width = body.span.end - body.span.start;
    if (candidate_width >= width) continue;
    enclosing = contract;
    width = candidate_width;
  }
  return enclosing;
}

function caller_prefix_substitutions(
  contract: PrefixRuntimeContract | undefined,
): ReadonlyMap<string, PrefixTerm> {
  if (contract === undefined) return new Map();
  return contract.parameter_terms;
}

function caller_prefix_hypotheses(
  contract: PrefixRuntimeContract | undefined,
): readonly PrefixProposition[] {
  if (contract === undefined) return [];
  const substitutions = caller_prefix_substitutions(contract);
  return instantiate_prefix_contract_propositions(
    contract.signature,
    substitutions,
  );
}

function caller_prefix_term_types(
  contract: PrefixRuntimeContract | undefined,
): ReadonlyMap<string, LogicalTermType> {
  const types = new Map<string, LogicalTermType>();
  if (contract === undefined) return types;
  for (const parameter of contract.signature.type.parameters) {
    if (parameter.type.proof !== undefined) continue;
    const term = contract.parameter_terms.get(parameter.name);
    expect(
      term !== undefined && term.shape.tag === "name",
      `Callable ${contract.signature.name} parameter ${parameter.name} lost its logical identity.`,
    );
    types.set(
      term.shape.name,
      logical_term_type_from_reference(parameter.type),
    );
  }
  return types;
}

function instantiate_prefix_call_obligations(
  signature: PrefixSignature,
  substitutions: ReadonlyMap<string, PrefixTerm>,
): readonly PrefixCallObligation[] {
  const obligations: PrefixCallObligation[] = [];
  for (const requirement of signature.requires) {
    obligations.push({
      proposition: substitute_prefix_proposition(requirement, substitutions),
      source_span: requirement.span,
      description: "requires " + requirement_text(requirement),
    });
  }
  for (const parameter of signature.type.parameters) {
    if (parameter.type.proof !== undefined) {
      obligations.push({
        proposition: substitute_prefix_proposition(
          parameter.type.proof,
          substitutions,
        ),
        source_span: parameter.type.proof.span,
        description: "proof parameter " + parameter.name,
      });
    }
    const refinement = parameter.type.refinement;
    if (refinement === undefined) continue;
    const renamed = rename_prefix_proposition_reference(
      refinement.proposition,
      refinement.binder,
      parameter.name,
    );
    obligations.push({
      proposition: substitute_prefix_proposition(renamed, substitutions),
      source_span: refinement.span,
      description: "parameter refinement " + refinement.text,
    });
  }
  return obligations;
}

function instantiate_prefix_contract_propositions(
  signature: PrefixSignature,
  substitutions: ReadonlyMap<string, PrefixTerm>,
): readonly PrefixProposition[] {
  return instantiate_prefix_call_obligations(signature, substitutions).map(
    (obligation) => obligation.proposition,
  );
}

function requirement_text(proposition: PrefixProposition): string {
  if (proposition.tag === "true") return "True";
  if (proposition.tag === "false") return "False";
  if (proposition.tag === "holds") return proposition.value.text;
  if (
    proposition.tag === "equal" || proposition.tag === "not_equal" ||
    proposition.tag === "less" || proposition.tag === "less_equal"
  ) {
    const operators = {
      equal: "=",
      not_equal: "!=",
      less: "<",
      less_equal: "<=",
    } as const;
    return proposition.left.text + " " + operators[proposition.tag] + " " +
      proposition.right.text;
  }
  if (proposition.tag === "is") {
    return proposition.value.text + " is " + proposition.type.text;
  }
  if (proposition.tag === "not") {
    return "not " + requirement_text(proposition.proposition);
  }
  if (
    proposition.tag === "and" || proposition.tag === "or" ||
    proposition.tag === "implies"
  ) {
    return requirement_text(proposition.left) + " " + proposition.tag + " " +
      requirement_text(proposition.right);
  }
  if (proposition.tag !== "forall" && proposition.tag !== "exists") {
    throw new Error("Unknown call obligation proposition.");
  }
  return proposition.tag + " (" + proposition.binder.name + ": " +
    proposition.binder.type.text + "). " +
    requirement_text(proposition.proposition);
}

function check_prefix_call_obligation(
  signature: PrefixSignature,
  obligation: PrefixCallObligation,
  call_span: SourceSpan,
  hypotheses: readonly PrefixCallHypothesis[],
  term_types: ReadonlyMap<string, LogicalTermType>,
  signatures: readonly PrefixSignature[],
  definitions: readonly PrefixDefinition[],
  declared_type_names: ReadonlySet<string>,
  obligation_index: number,
  semantic_certificate: SemanticControlFlowCertificate | undefined,
): Checked<{ key: string; proof: CheckedKernelCertificate } | undefined> {
  const declarations = new Map<string, KernelType>();
  const term_context: KernelType[] = [];
  const term_indices = new Map<string, number>();
  for (const [name, logical_type] of term_types) {
    const type: KernelType = {
      tag: "constant",
      name: logical_type.representation,
    };
    declarations.set(logical_type.representation, type_sort(0));
    term_indices.set(name, term_context.length);
    term_context.push(type);
  }
  const facts = prefix_fact_signatures(
    signatures,
    definitions,
    signature.scope,
    signature.span.start,
    call_span.start,
  );
  const context: PrefixKernelProofContext = {
    allow_unsafe: false,
    declaration_name: signature.name,
    declarations,
    facts,
    proof_indices: new Map(),
    proof_propositions: new Map(),
    term_context,
    term_indices,
    term_types,
    type_names: signature_type_names(signature, declared_type_names),
  };
  const goal = prefix_kernel_proposition(
    signature.name,
    obligation.proposition,
    context,
    facts,
    context.type_names,
  );
  const kernel_hypotheses = hypotheses.map((hypothesis) =>
    prefix_kernel_proposition(
      signature.name,
      hypothesis.proposition,
      context,
      hypothesis.facts,
      context.type_names,
    )
  );
  const environment = KernelEnvironment.from(declarations);
  const stable_term_context = snapshot_kernel_context(term_context);
  let proof: ProofTerm | undefined;
  let certificate_goal = goal;
  for (const hypothesis of kernel_hypotheses) {
    if (
      !proposition_equal(hypothesis, goal, {
        environment,
        term_context: stable_term_context,
      })
    ) {
      continue;
    }
    certificate_goal = {
      tag: "implies",
      premise: hypothesis,
      conclusion: goal,
    };
    proof = {
      tag: "implies_intro",
      premise: hypothesis,
      body: { tag: "assumption", index: 0 },
    };
    break;
  }
  if (proof === undefined) {
    proof = automatic_prefix_proof(
      obligation.proposition,
      goal,
      environment,
    );
  }
  if (proof !== undefined) {
    const certificate = check_proof(proof, certificate_goal, {
      allow_unsafe: false,
      require_safe: true,
      environment,
      term_context: stable_term_context,
    });
    return ok({
      key: signature.scope + ":" + signature.name + ":call:" +
        call_span.start.toString() + ":" + obligation_index.toString(),
      proof: Object.freeze({
        certificate,
        environment,
        term_context: stable_term_context,
        semantic_certificate,
      }),
    });
  }
  let status = "unknown";
  if (prefix_proposition_is_definitely_false(obligation.proposition)) {
    status = "disproved";
  }
  return fail(
    compiler_diagnostic(
      diagnostic_codes.prefix_signature_unproved,
      `${status}: call to ${signature.name} cannot prove ${obligation.description}.`,
      call_span,
      [{
        message: "The proof obligation is declared here.",
        span: obligation.source_span,
      }],
    ),
  );
}

function automatic_prefix_proof(
  source: PrefixProposition,
  proposition: Proposition,
  environment: KernelEnvironment,
): ProofTerm | undefined {
  if (
    proposition.tag === "true" &&
    (source.tag === "true" ||
      (source.tag === "holds" && source.value.text === "true"))
  ) {
    return { tag: "true_intro" };
  }
  if (
    source.tag === "equal" && proposition.tag === "equal" &&
    prefix_term_surface_key(source.left) ===
      prefix_term_surface_key(source.right)
  ) {
    return {
      tag: "refl",
      type: proposition.type,
      term: proposition.left,
    };
  }
  if (source.tag !== "and" || proposition.tag !== "and") {
    if (machine_reflection_holds(proposition, environment)) {
      return { tag: "machine_reflect", proposition };
    }
    return undefined;
  }
  const left = automatic_prefix_proof(
    source.left,
    proposition.left,
    environment,
  );
  const right = automatic_prefix_proof(
    source.right,
    proposition.right,
    environment,
  );
  if (left === undefined || right === undefined) return undefined;
  return { tag: "and_intro", left, right };
}

function prefix_proposition_is_definitely_false(
  proposition: PrefixProposition,
): boolean {
  if (proposition.tag === "false") return true;
  if (proposition.tag === "holds") return proposition.value.text === "false";
  if (proposition.tag === "not_equal") {
    return prefix_term_surface_key(proposition.left) ===
      prefix_term_surface_key(proposition.right);
  }
  if (proposition.tag === "and") {
    return prefix_proposition_is_definitely_false(proposition.left) ||
      prefix_proposition_is_definitely_false(proposition.right);
  }
  return false;
}

function prefix_term_surface_key(term: PrefixTerm): string {
  const shape = term.shape;
  if (shape.tag === "name") return JSON.stringify(["name", shape.name]);
  if (
    shape.tag === "number" || shape.tag === "string" ||
    shape.tag === "character" || shape.tag === "boolean"
  ) {
    return JSON.stringify([shape.tag, term.text]);
  }
  if (shape.tag === "binary") {
    return JSON.stringify([
      "binary",
      shape.operator,
      prefix_term_surface_key(shape.left),
      prefix_term_surface_key(shape.right),
    ]);
  }
  if (shape.tag === "unary") {
    return JSON.stringify([
      "unary",
      shape.operator,
      prefix_term_surface_key(shape.operand),
    ]);
  }
  if (shape.tag === "call") {
    return JSON.stringify([
      "call",
      prefix_term_surface_key(shape.function),
      shape.arguments.map(prefix_term_surface_key),
    ]);
  }
  if (shape.tag === "field") {
    return JSON.stringify([
      "field",
      prefix_term_surface_key(shape.object),
      shape.field,
    ]);
  }
  if (shape.tag === "parenthesized") {
    return prefix_term_surface_key(shape.value);
  }
  return JSON.stringify(["source", term.text]);
}

function substitute_prefix_proposition(
  proposition: PrefixProposition,
  substitutions: ReadonlyMap<string, PrefixTerm>,
): PrefixProposition {
  if (proposition.tag === "true" || proposition.tag === "false") {
    return proposition;
  }
  if (proposition.tag === "holds") {
    return {
      ...proposition,
      value: substitute_prefix_term(proposition.value, substitutions),
    };
  }
  if (
    proposition.tag === "equal" || proposition.tag === "not_equal" ||
    proposition.tag === "less" || proposition.tag === "less_equal"
  ) {
    return {
      ...proposition,
      left: substitute_prefix_term(proposition.left, substitutions),
      right: substitute_prefix_term(proposition.right, substitutions),
    };
  }
  if (proposition.tag === "is") {
    return {
      ...proposition,
      value: substitute_prefix_term(proposition.value, substitutions),
    };
  }
  if (proposition.tag === "not") {
    return {
      ...proposition,
      proposition: substitute_prefix_proposition(
        proposition.proposition,
        substitutions,
      ),
    };
  }
  if (
    proposition.tag === "and" || proposition.tag === "or" ||
    proposition.tag === "implies"
  ) {
    return {
      ...proposition,
      left: substitute_prefix_proposition(proposition.left, substitutions),
      right: substitute_prefix_proposition(proposition.right, substitutions),
    };
  }
  if (proposition.tag !== "forall" && proposition.tag !== "exists") {
    throw new Error("Unknown substituted prefix proposition.");
  }
  let binder = proposition.binder;
  let body = proposition.proposition;
  const captures_binder = [...substitutions.values()].some((term) =>
    term.references.includes(binder.name)
  );
  if (captures_binder) {
    const renamed = "$duck:substitution:" + binder.name + ":" +
      binder.span.start.toString();
    binder = { ...binder, name: renamed };
    body = rename_prefix_proposition_reference(
      body,
      proposition.binder.name,
      renamed,
    );
  }
  const nested_substitutions = new Map(substitutions);
  nested_substitutions.delete(binder.name);
  nested_substitutions.delete(proposition.binder.name);
  return {
    ...proposition,
    binder,
    proposition: substitute_prefix_proposition(
      body,
      nested_substitutions,
    ),
  };
}

function substitute_prefix_term(
  term: PrefixTerm,
  substitutions: ReadonlyMap<string, PrefixTerm>,
): PrefixTerm {
  const shape = term.shape;
  if (shape.tag === "name") {
    const replacement = substitutions.get(shape.name);
    if (replacement !== undefined) return replacement;
    return term;
  }
  if (shape.tag === "binary") {
    const left = substitute_prefix_term(shape.left, substitutions);
    const right = substitute_prefix_term(shape.right, substitutions);
    return {
      ...term,
      text: left.text + " " + shape.operator + " " + right.text,
      references: [...left.references, ...right.references],
      shape: { ...shape, left, right },
    };
  }
  if (shape.tag === "unary") {
    const operand = substitute_prefix_term(shape.operand, substitutions);
    return {
      ...term,
      text: shape.operator + operand.text,
      references: operand.references,
      shape: { ...shape, operand },
    };
  }
  if (shape.tag === "call") {
    const function_term = substitute_prefix_term(
      shape.function,
      substitutions,
    );
    const arguments_ = shape.arguments.map((argument) =>
      substitute_prefix_term(argument, substitutions)
    );
    return {
      ...term,
      references: [
        ...function_term.references,
        ...arguments_.flatMap((argument) => argument.references),
      ],
      shape: {
        ...shape,
        function: function_term,
        arguments: arguments_,
      },
    };
  }
  if (shape.tag === "field" || shape.tag === "index") {
    const object = substitute_prefix_term(shape.object, substitutions);
    return {
      ...term,
      references: object.references,
      shape: { ...shape, object },
    };
  }
  if (shape.tag === "parenthesized") {
    const value = substitute_prefix_term(shape.value, substitutions);
    return {
      ...term,
      text: "(" + value.text + ")",
      references: value.references,
      shape: { ...shape, value },
    };
  }
  return term;
}

function prefix_term_from_front_expr(
  expression: FrontExpr,
  source_text: string,
  binding_index: BindingIndex,
): PrefixTerm {
  const span = source_span(expression);
  let text = source_text.slice(span.start, span.end);
  if (text.length === 0 && expression.tag === "var") text = expression.name;
  if (expression.tag === "var") {
    const occurrence = binding_index.occurrence_of(expression, "name");
    let name = expression.name;
    if (occurrence?.entity !== undefined) {
      name = logical_entity_name(occurrence.entity);
    }
    return {
      text,
      references: [name],
      shape: { tag: "name", name },
      span,
    };
  }
  if (expression.tag === "num") {
    return { text, references: [], shape: { tag: "number" }, span };
  }
  if (expression.tag === "bool") {
    return { text, references: [], shape: { tag: "boolean" }, span };
  }
  if (expression.tag === "text") {
    return { text, references: [], shape: { tag: "string" }, span };
  }
  if (expression.tag === "app") {
    const function_term = prefix_term_from_front_expr(
      expression.func,
      source_text,
      binding_index,
    );
    const arguments_ = expression.args.map((argument) =>
      prefix_term_from_front_expr(argument, source_text, binding_index)
    );
    return {
      text,
      references: [
        ...function_term.references,
        ...arguments_.flatMap((argument) => argument.references),
      ],
      shape: {
        tag: "call",
        function: function_term,
        arguments: arguments_,
      },
      span,
    };
  }
  if (expression.tag === "field") {
    const object = prefix_term_from_front_expr(
      expression.object,
      source_text,
      binding_index,
    );
    return {
      text,
      references: object.references,
      shape: { tag: "field", object, field: expression.name },
      span,
    };
  }
  if (expression.tag === "index") {
    const object = prefix_term_from_front_expr(
      expression.object,
      source_text,
      binding_index,
    );
    return {
      text,
      references: object.references,
      shape: { tag: "index", object },
      span,
    };
  }
  return { text, references: [], shape: { tag: "unsupported" }, span };
}

function record_front_expr_logical_types(
  expression: FrontExpr,
  binding_index: BindingIndex,
  term_types: Map<string, LogicalTermType>,
): void {
  if (expression.tag === "var") {
    const occurrence = binding_index.occurrence_of(expression, "name");
    if (occurrence?.entity === undefined) return;
    const semantic_name = logical_entity_name(occurrence.entity);
    if (term_types.has(semantic_name)) return;
    const representation = binding_index.facts.get(
      occurrence.entity,
    )?.representation;
    if (representation === undefined) return;
    const name = logical_representation_name(representation);
    term_types.set(semantic_name, {
      display_name: name,
      name,
      representation: name,
    });
    return;
  }
  if (expression.tag === "app") {
    record_front_expr_logical_types(
      expression.func,
      binding_index,
      term_types,
    );
    for (const argument of expression.args) {
      record_front_expr_logical_types(argument, binding_index, term_types);
    }
    return;
  }
  if (expression.tag === "field") {
    record_front_expr_logical_types(
      expression.object,
      binding_index,
      term_types,
    );
    return;
  }
  if (expression.tag === "index") {
    record_front_expr_logical_types(
      expression.object,
      binding_index,
      term_types,
    );
    record_front_expr_logical_types(
      expression.index,
      binding_index,
      term_types,
    );
  }
}

function logical_entity_name(entity: EntityId): string {
  return "semantic:" + entity;
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
  if (
    type.resolved === true && type.expression?.tag === "atom" &&
    /^[A-Z][A-Za-z0-9_]*$/.test(type.expression.name)
  ) {
    return resolved_type;
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
  definitions: readonly PrefixDefinition[],
  declared_type_names: ReadonlySet<string>,
): Checked<undefined> {
  const proof_parameters = signature.type.parameters.filter((parameter) =>
    parameter.type.proof !== undefined
  );
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
    definitions,
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
    const unstructured = first_unstructured_quantified_proposition(
      proposition,
      facts,
    );
    if (unstructured !== undefined) {
      checks.push(
        fail(
          compiler_diagnostic(
            diagnostic_codes.prefix_proof_invalid,
            `Proof declaration ${signature.name} cannot quantify over ${unstructured.tag} until every referenced logical term has a structured kernel representation.`,
            unstructured.span,
          ),
        ),
      );
      continue;
    }
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
    const unstructured = first_unstructured_quantified_proposition(
      result,
      facts,
    );
    if (unstructured !== undefined) {
      checks.push(
        fail(
          compiler_diagnostic(
            diagnostic_codes.prefix_proof_invalid,
            `Proof declaration ${signature.name} cannot quantify over ${unstructured.tag} until every referenced logical term has a structured kernel representation.`,
            unstructured.span,
          ),
        ),
      );
    } else {
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
  }
  return all(checks).map(() => undefined);
}

function first_unstructured_quantified_proposition(
  proposition: PrefixProposition,
  facts: ReadonlyMap<string, PrefixFactSignature>,
  quantified = false,
): PrefixProposition | undefined {
  if (proposition.tag === "forall" || proposition.tag === "exists") {
    return first_unstructured_quantified_proposition(
      proposition.proposition,
      facts,
      true,
    );
  }
  if (proposition.tag === "not") {
    return first_unstructured_quantified_proposition(
      proposition.proposition,
      facts,
      quantified,
    );
  }
  if (
    proposition.tag === "and" || proposition.tag === "or" ||
    proposition.tag === "implies"
  ) {
    const left = first_unstructured_quantified_proposition(
      proposition.left,
      facts,
      quantified,
    );
    if (left !== undefined) return left;
    return first_unstructured_quantified_proposition(
      proposition.right,
      facts,
      quantified,
    );
  }
  if (!quantified) return undefined;
  if (proposition.tag === "true" || proposition.tag === "false") {
    return undefined;
  }
  if (
    proposition.tag === "equal" || proposition.tag === "not_equal" ||
    proposition.tag === "less" || proposition.tag === "less_equal"
  ) {
    if (
      prefix_term_has_kernel_representation(proposition.left) &&
      prefix_term_has_kernel_representation(proposition.right)
    ) {
      return undefined;
    }
    return proposition;
  }
  if (
    proposition.tag === "holds" &&
    (proposition.value.text === "true" ||
      proposition.value.text === "false")
  ) {
    return undefined;
  }
  if (proposition.tag === "holds") {
    const shape = proposition.value.shape;
    if (prefix_term_has_kernel_representation(proposition.value)) {
      return undefined;
    }
    if (
      shape.tag === "call" && shape.function.shape.tag === "name" &&
      facts.has(shape.function.shape.name) &&
      shape.arguments.every(prefix_term_has_kernel_representation)
    ) {
      return undefined;
    }
    return proposition;
  }
  if (
    proposition.tag === "is" &&
    prefix_term_has_kernel_representation(proposition.value)
  ) {
    return undefined;
  }
  return proposition;
}

function prefix_term_has_kernel_representation(term: PrefixTerm): boolean {
  if (
    term.shape.tag === "name" || term.shape.tag === "number" ||
    term.shape.tag === "string" || term.shape.tag === "character" ||
    term.shape.tag === "boolean"
  ) {
    return true;
  }
  if (term.shape.tag === "parenthesized") {
    return prefix_term_has_kernel_representation(term.shape.value);
  }
  return false;
}

type PrefixKernelProofContext = {
  allow_unsafe: boolean;
  declaration_name: string;
  declarations: Map<string, KernelType>;
  facts: ReadonlyMap<string, PrefixFactSignature>;
  proof_indices: ReadonlyMap<string, number>;
  proof_propositions: ReadonlyMap<string, Proposition>;
  term_context: KernelType[];
  term_indices: ReadonlyMap<string, number>;
  term_types: ReadonlyMap<string, LogicalTermType>;
  type_names: ReadonlySet<string>;
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
  const facts = prefix_fact_signatures(
    signatures,
    definitions,
    signature.scope,
    signature.span.start,
    definition.span.start,
  );
  const type_names = signature_type_names(signature, declared_type_names);
  const context: PrefixKernelProofContext = {
    allow_unsafe: definition.unsafe_span !== undefined,
    declaration_name: signature.name,
    declarations,
    facts,
    proof_indices,
    proof_propositions,
    term_context,
    term_indices,
    term_types,
    type_names,
  };
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
  const proof_term_indices = new Map<string, number>();
  const proof_term_types = new Map<string, LogicalTermType>();
  for (let index = 0; index < signature.type.parameters.length; index += 1) {
    const parameter = signature.type.parameters[index];
    const definition_parameter = callable_parameters[index];
    expect(
      parameter !== undefined && definition_parameter !== undefined,
      `Proof term parameter ${index} disappeared.`,
    );
    if (parameter.type.proof !== undefined) continue;
    const term_index = term_indices.get(parameter.name);
    const term_type = term_types.get(parameter.name);
    expect(
      term_index !== undefined && term_type !== undefined,
      `Proof term parameter ${parameter.name} lost its logical type.`,
    );
    proof_term_indices.set(definition_parameter, term_index);
    proof_term_types.set(definition_parameter, term_type);
  }
  const proof_context: PrefixKernelProofContext = {
    ...context,
    term_indices: proof_term_indices,
    term_types: proof_term_types,
  };
  const elaborated = elaborate_prefix_proof(body, goal, proof_context);
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
    const allow_unsafe = definition.unsafe_span !== undefined;
    const certificate = check_proof(theorem_proof, theorem_goal, {
      allow_unsafe,
      require_safe: !allow_unsafe,
      environment,
      term_context: stable_term_context,
    });
    if (allow_unsafe && certificate.safety.tag === "safe") {
      expect(
        definition.unsafe_span !== undefined,
        `Unsafe proof declaration ${signature.name} lost its unsafe span.`,
      );
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          `Unsafe proof declaration ${signature.name} does not depend on unsafe evidence.`,
          definition.unsafe_span,
        ),
      );
    }
    return ok({
      key: signature.scope + ":" + signature.name + ":proof",
      proof: Object.freeze({
        certificate,
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
  active_facts: ReadonlySet<string> = new Set(),
): Proposition {
  if (proposition.tag === "true") return { tag: "true" };
  if (proposition.tag === "false") return { tag: "false" };
  if (proposition.tag === "holds") {
    if (proposition.value.text === "true") return { tag: "true" };
    if (proposition.value.text === "false") return { tag: "false" };
    const application = prefix_fact_application(proposition.value);
    if (application !== undefined) {
      const fact_name = application.name;
      const fact = facts.get(fact_name);
      if (
        fact?.body !== undefined && fact.body_parameters !== undefined &&
        fact.body_parameters.length === application.arguments.length &&
        !active_facts.has(fact.kernel_name)
      ) {
        const body = instantiate_transparent_fact(
          declaration_name,
          fact_name,
          fact,
          application.arguments,
          context.term_types,
          facts,
        );
        if (body !== undefined) {
          const nested_active = new Set(active_facts);
          nested_active.add(fact.kernel_name);
          let body_facts = facts;
          if (fact.body_facts !== undefined) body_facts = fact.body_facts;
          return prefix_kernel_proposition(
            declaration_name,
            body,
            context,
            body_facts,
            type_names,
            nested_active,
          );
        }
      }
    }
    return prefix_kernel_atom(
      declaration_name,
      proposition,
      context,
      facts,
    );
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
    return prefix_kernel_atom(
      declaration_name,
      proposition,
      context,
      facts,
    );
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
        active_facts,
      ),
    };
  }
  if (proposition.tag === "less" || proposition.tag === "less_equal") {
    return prefix_kernel_atom(
      declaration_name,
      proposition,
      context,
      facts,
    );
  }
  if (proposition.tag === "is") {
    return prefix_kernel_atom(
      declaration_name,
      proposition,
      context,
      facts,
    );
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
        active_facts,
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
      active_facts,
    );
    const right = prefix_kernel_proposition(
      declaration_name,
      proposition.right,
      context,
      facts,
      type_names,
      active_facts,
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
      active_facts,
    );
    if (proposition.tag === "forall") {
      return { tag: "forall", domain, body };
    }
    return { tag: "exists", domain, body };
  }
  throw new Error("Unknown prefix proof proposition.");
}

function prefix_kernel_atom(
  declaration_name: string,
  proposition: PrefixProposition,
  context: PrefixKernelProofContext,
  facts: ReadonlyMap<string, PrefixFactSignature>,
): Extract<Proposition, { tag: "atom" }> {
  if (proposition.tag === "holds") {
    const shape = proposition.value.shape;
    if (
      shape.tag === "call" && shape.function.shape.tag === "name" &&
      facts.has(shape.function.shape.name)
    ) {
      const fact = facts.get(shape.function.shape.name);
      expect(
        fact !== undefined,
        `Logical fact ${shape.function.shape.name} lost its signature.`,
      );
      const arguments_: KernelTerm[] = [];
      for (const source_argument of shape.arguments) {
        const checked = prefix_kernel_term(
          declaration_name,
          source_argument,
          context,
          facts,
        );
        if (checked === undefined) {
          return {
            tag: "atom",
            name: fact.kernel_name + ":" +
              prefix_proposition_atom_key(proposition, context),
            arguments: [],
          };
        }
        arguments_.push(checked.term);
      }
      return {
        tag: "atom",
        name: fact.kernel_name,
        arguments: arguments_,
      };
    }
    const checked = prefix_kernel_term(
      declaration_name,
      proposition.value,
      context,
      facts,
    );
    if (checked !== undefined) {
      return {
        tag: "atom",
        name: "builtin:Holds",
        arguments: [checked.term],
      };
    }
  }
  if (proposition.tag === "less" || proposition.tag === "less_equal") {
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
    if (left !== undefined && right !== undefined) {
      return {
        tag: "atom",
        name: "builtin:" + proposition.tag,
        arguments: [left.term, right.term],
      };
    }
  }
  if (proposition.tag === "is") {
    const checked = prefix_kernel_term(
      declaration_name,
      proposition.value,
      context,
      facts,
    );
    if (checked !== undefined) {
      return {
        tag: "atom",
        name: "builtin:is:" + proposition.type.canonical,
        arguments: [checked.term],
      };
    }
  }
  return {
    tag: "atom",
    name: prefix_proposition_atom_key(proposition, context),
    arguments: [],
  };
}

function prefix_proposition_atom_key(
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
  let signed_number: { literal: PrefixTerm; sign: bigint } | undefined;
  if (term.shape.tag === "unary") {
    let candidate = term;
    let sign = 1n;
    while (true) {
      if (candidate.shape.tag === "parenthesized") {
        candidate = candidate.shape.value;
        continue;
      }
      if (
        candidate.shape.tag !== "unary" ||
        (candidate.shape.operator !== "+" && candidate.shape.operator !== "-")
      ) {
        break;
      }
      if (candidate.shape.operator === "-") sign = -sign;
      candidate = candidate.shape.operand;
    }
    if (candidate.shape.tag === "number") {
      signed_number = { literal: candidate, sign };
    }
  }
  if (
    term.shape.tag !== "number" && term.shape.tag !== "string" &&
    term.shape.tag !== "character" && term.shape.tag !== "boolean" &&
    signed_number === undefined
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
  if (signed_number !== undefined) {
    const integer_type = integer_type_from_name(type_name);
    expect(
      integer_type !== undefined,
      `Signed proof literal has non-integer type ${type_name}.`,
    );
    let magnitude: bigint;
    const fixed_width = prefix_integer_literal(signed_number.literal.text);
    if (fixed_width !== undefined) {
      magnitude = fixed_width.value;
    } else {
      magnitude = BigInt(
        signed_number.literal.text.replaceAll("_", ""),
      );
    }
    literal_key = normalize_integer(
      integer_type,
      signed_number.sign * magnitude,
    ).toString();
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
  if (proof.tag === "tactics") {
    return elaborate_prefix_tactics(proof.commands, proof.span, goal, context);
  }
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
  if (proof.tag === "lambda") {
    if (goal.tag === "forall") {
      const body_context = extend_prefix_term_context(
        context,
        proof.name,
        goal.domain,
      );
      return elaborate_prefix_proof(
        proof.body,
        goal.body,
        body_context,
      ).map((body): ProofTerm => ({
        tag: "forall_intro",
        domain: goal.domain,
        body,
      }));
    }
    if (goal.tag === "implies") {
      const body_context = extend_prefix_proof_context(
        context,
        proof.name,
        goal.premise,
      );
      return elaborate_prefix_proof(
        proof.body,
        goal.conclusion,
        body_context,
      ).map((body): ProofTerm => ({
        tag: "implies_intro",
        premise: goal.premise,
        body,
      }));
    }
    if (goal.tag === "not") {
      const body_context = extend_prefix_proof_context(
        context,
        proof.name,
        goal.proposition,
      );
      return elaborate_prefix_proof(
        proof.body,
        { tag: "false" },
        body_context,
      ).map((body): ProofTerm => ({
        tag: "not_intro",
        premise: goal.proposition,
        body,
      }));
    }
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        "Proof lambda requires an implication, negation, or universal goal.",
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
  if (proof.tag === "exists_intro") {
    if (goal.tag !== "exists") {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "exists_intro requires an existential goal.",
          proof.span,
        ),
      );
    }
    const witness_check = check_prefix_proof_argument(
      proof.witness,
      goal.domain,
      context,
      "existential witness",
    );
    const witness = checked_value(witness_check);
    if (witness === undefined) {
      return witness_check.map((checked) => ({
        tag: "exists_intro",
        domain: goal.domain,
        body: goal.body,
        witness: checked.term,
        proof: { tag: "true_intro" },
      }));
    }
    const witness_goal = instantiate_proposition(
      goal.body,
      witness.term,
    );
    return elaborate_prefix_proof(
      proof.proof,
      witness_goal,
      context,
    ).map((inner): ProofTerm => ({
      tag: "exists_intro",
      domain: goal.domain,
      body: goal.body,
      witness: witness.term,
      proof: inner,
    }));
  }
  if (proof.tag === "exists_elim") {
    const existential_check = synthesize_prefix_proof(proof.proof, context);
    const existential = checked_value(existential_check);
    if (existential === undefined) {
      return existential_check.map((checked) => checked.term);
    }
    if (existential.proposition.tag !== "exists") {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "exists_elim requires an existential proof.",
          proof.proof.span,
        ),
      );
    }
    const witness_context = extend_prefix_term_context(
      context,
      proof.witness_name,
      existential.proposition.domain,
    );
    const body_context = extend_prefix_proof_context(
      witness_context,
      proof.evidence_name,
      existential.proposition.body,
    );
    const body_goal = lift_proposition(goal);
    return elaborate_prefix_proof(
      proof.body,
      body_goal,
      body_context,
    ).map((body): ProofTerm => ({
      tag: "exists_elim",
      proof: existential.term,
      target: goal,
      body,
    }));
  }
  if (proof.tag === "or_left" || proof.tag === "or_right") {
    if (goal.tag !== "or") {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "Disjunction introduction requires a disjunction goal.",
          proof.span,
        ),
      );
    }
    if (proof.tag === "or_left") {
      return elaborate_prefix_proof(
        proof.proof,
        goal.left,
        context,
      ).map((inner): ProofTerm => ({
        tag: "or_left",
        proof: inner,
        other: goal.right,
      }));
    }
    return elaborate_prefix_proof(
      proof.proof,
      goal.right,
      context,
    ).map((inner): ProofTerm => ({
      tag: "or_right",
      other: goal.left,
      proof: inner,
    }));
  }
  if (proof.tag === "false_elim") {
    return elaborate_prefix_proof(
      proof.proof,
      { tag: "false" },
      context,
    ).map((inner): ProofTerm => ({
      tag: "false_elim",
      proof: inner,
      target: goal,
    }));
  }
  if (proof.tag === "or_cases") {
    const disjunction_check = synthesize_prefix_proof(proof.proof, context);
    const disjunction = checked_value(disjunction_check);
    if (disjunction === undefined) {
      return disjunction_check.map((checked) => checked.term);
    }
    if (disjunction.proposition.tag !== "or") {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "or_cases requires a disjunction proof.",
          proof.proof.span,
        ),
      );
    }
    const left_context = extend_prefix_proof_context(
      context,
      proof.left_name,
      disjunction.proposition.left,
    );
    const right_context = extend_prefix_proof_context(
      context,
      proof.right_name,
      disjunction.proposition.right,
    );
    return Applicative.lift(
      (left_body: ProofTerm, right_body: ProofTerm): ProofTerm => ({
        tag: "or_cases",
        proof: disjunction.term,
        left_body,
        right_body,
      }),
      elaborate_prefix_proof(proof.left_body, goal, left_context),
      elaborate_prefix_proof(proof.right_body, goal, right_context),
    );
  }
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

type PendingPrefixTacticGoal = {
  goal: Proposition;
  context: PrefixKernelProofContext;
  accept: (proof: ProofTerm) => void;
};

function elaborate_prefix_tactics(
  commands: readonly PrefixTacticCommand[],
  block_span: PrefixSpan,
  goal: Proposition,
  context: PrefixKernelProofContext,
): Checked<ProofTerm> {
  if (commands.length > proof_limits.compiler_search_steps) {
    return fail(compiler_diagnostic(
      diagnostic_codes.prefix_proof_invalid,
      "Tactic block exceeds the compiler proof-search step budget of " +
        proof_limits.compiler_search_steps.toString() + ".",
      block_span,
    ));
  }
  let completed: ProofTerm | undefined;
  const pending: PendingPrefixTacticGoal[] = [{
    goal,
    context,
    accept: (proof) => {
      completed = proof;
    },
  }];
  for (const command of commands) {
    const current = pending.shift();
    if (current === undefined) {
      return fail(compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        `Tactic ${command.tag} has no remaining goal.`,
        command.span,
      ));
    }
    if (command.tag === "exact") {
      const exact = elaborate_prefix_proof(
        command.proof,
        current.goal,
        current.context,
      );
      const term = checked_value(exact);
      if (term === undefined) return exact;
      current.accept(term);
      continue;
    }
    if (command.tag === "apply") {
      const applied_check = synthesize_prefix_proof(
        command.proof,
        current.context,
      );
      const applied = checked_value(applied_check);
      if (applied === undefined) {
        return applied_check.map((proof) => proof.term);
      }
      const premises: Proposition[] = [];
      let conclusion = applied.proposition;
      while (conclusion.tag === "implies") {
        premises.push(conclusion.premise);
        conclusion = conclusion.conclusion;
      }
      const environment = KernelEnvironment.from(
        current.context.declarations,
      );
      const term_context = snapshot_kernel_context(
        current.context.term_context,
      );
      if (
        !proposition_equal(conclusion, current.goal, {
          environment,
          term_context,
        })
      ) {
        return fail(compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "apply proof conclusion does not match the current goal.",
          command.span,
        ));
      }
      if (premises.length === 0) {
        current.accept(applied.term);
        continue;
      }
      const premise_proofs: (ProofTerm | undefined)[] = new Array(
        premises.length,
      ).fill(undefined);
      const complete = () => {
        if (premise_proofs.some((proof) => proof === undefined)) return;
        let proof = applied.term;
        for (const premise_proof of premise_proofs) {
          expect(
            premise_proof !== undefined,
            "Completed apply tactic lost a premise proof.",
          );
          proof = {
            tag: "implies_apply",
            function: proof,
            argument: premise_proof,
          };
        }
        current.accept(proof);
      };
      const goals = premises.map((premise, index): PendingPrefixTacticGoal => ({
        goal: premise,
        context: current.context,
        accept: (proof) => {
          premise_proofs[index] = proof;
          complete();
        },
      }));
      pending.unshift(...goals);
      continue;
    }
    if (command.tag === "cases") {
      const scrutinee_check = synthesize_prefix_proof(
        command.proof,
        current.context,
      );
      const scrutinee = checked_value(scrutinee_check);
      if (scrutinee === undefined) {
        return scrutinee_check.map((proof) => proof.term);
      }
      if (scrutinee.proposition.tag === "false") {
        current.accept({
          tag: "false_elim",
          proof: scrutinee.term,
          target: current.goal,
        });
        continue;
      }
      if (scrutinee.proposition.tag === "or") {
        let left_body: ProofTerm | undefined;
        let right_body: ProofTerm | undefined;
        const complete = () => {
          if (left_body === undefined || right_body === undefined) return;
          current.accept({
            tag: "or_cases",
            proof: scrutinee.term,
            left_body,
            right_body,
          });
        };
        pending.unshift(
          {
            goal: current.goal,
            context: extend_prefix_proof_context(
              current.context,
              `case:left:${command.span.start.toString()}`,
              scrutinee.proposition.left,
            ),
            accept: (proof) => {
              left_body = proof;
              complete();
            },
          },
          {
            goal: current.goal,
            context: extend_prefix_proof_context(
              current.context,
              `case:right:${command.span.start.toString()}`,
              scrutinee.proposition.right,
            ),
            accept: (proof) => {
              right_body = proof;
              complete();
            },
          },
        );
        continue;
      }
      if (scrutinee.proposition.tag === "exists") {
        const witness_context = extend_prefix_term_context(
          current.context,
          `case:witness:${command.span.start.toString()}`,
          scrutinee.proposition.domain,
        );
        const body_context = extend_prefix_proof_context(
          witness_context,
          `case:evidence:${command.span.start.toString()}`,
          scrutinee.proposition.body,
        );
        pending.unshift({
          goal: lift_proposition(current.goal),
          context: body_context,
          accept: (body) =>
            current.accept({
              tag: "exists_elim",
              proof: scrutinee.term,
              target: current.goal,
              body,
            }),
        });
        continue;
      }
      return fail(compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        "cases requires disjunction, existential, or False evidence.",
        command.span,
      ));
    }
    if (command.tag === "rewrite") {
      const equality_check = synthesize_prefix_proof(
        command.proof,
        current.context,
      );
      const equality = checked_value(equality_check);
      if (equality === undefined) {
        return equality_check.map((proof) => proof.term);
      }
      if (equality.proposition.tag !== "equal") {
        return fail(compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "rewrite requires equality evidence.",
          command.span,
        ));
      }
      const rewritten = rewrite_prefix_tactic_goal(
        current.goal,
        equality.proposition.left,
        equality.proposition.right,
        equality.proposition.type,
        current.context,
      );
      if (rewritten.tag === "budget_exhausted") {
        return fail(compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "rewrite exceeded the compiler proof-search step budget of " +
            proof_limits.compiler_search_steps.toString() + ".",
          command.span,
        ));
      }
      if (rewritten.tag === "unchanged") {
        return fail(compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "rewrite found no matching occurrence in the current goal.",
          command.span,
        ));
      }
      pending.unshift({
        goal: rewritten.goal,
        context: current.context,
        accept: (proof) =>
          current.accept({
            tag: "transport",
            equality: { tag: "symm", proof: equality.term },
            motive: rewritten.motive,
            proof,
          }),
      });
      continue;
    }
    if (command.tag === "assumption") {
      let selected_index: number | undefined;
      const environment = KernelEnvironment.from(current.context.declarations);
      const term_context = snapshot_kernel_context(
        current.context.term_context,
      );
      for (
        const [name, index] of current.context.proof_indices
      ) {
        const proposition = current.context.proof_propositions.get(name);
        if (
          proposition === undefined ||
          !proposition_equal(proposition, current.goal, {
            environment,
            term_context,
          })
        ) {
          continue;
        }
        if (selected_index === undefined || index < selected_index) {
          selected_index = index;
        }
      }
      if (selected_index === undefined) {
        return fail(compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "assumption found no hypothesis matching the current goal.",
          command.span,
        ));
      }
      current.accept({ tag: "assumption", index: selected_index });
      continue;
    }
    if (command.tag === "intro") {
      if (current.goal.tag === "forall") {
        const domain = current.goal.domain;
        const body_goal = current.goal.body;
        const body_context = extend_prefix_term_context(
          current.context,
          command.name,
          domain,
        );
        pending.unshift({
          goal: body_goal,
          context: body_context,
          accept: (body) =>
            current.accept({
              tag: "forall_intro",
              domain,
              body,
            }),
        });
        continue;
      }
      if (current.goal.tag === "implies") {
        const premise = current.goal.premise;
        pending.unshift({
          goal: current.goal.conclusion,
          context: extend_prefix_proof_context(
            current.context,
            command.name,
            premise,
          ),
          accept: (body) =>
            current.accept({
              tag: "implies_intro",
              premise,
              body,
            }),
        });
        continue;
      }
      if (current.goal.tag === "not") {
        const premise = current.goal.proposition;
        pending.unshift({
          goal: { tag: "false" },
          context: extend_prefix_proof_context(
            current.context,
            command.name,
            premise,
          ),
          accept: (body) =>
            current.accept({
              tag: "not_intro",
              premise,
              body,
            }),
        });
        continue;
      }
      return fail(compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        "intro requires an implication, negation, or universal goal.",
        command.span,
      ));
    }
    if (command.tag === "constructor") {
      if (current.goal.tag === "true") {
        current.accept({ tag: "true_intro" });
        continue;
      }
      if (current.goal.tag !== "and") {
        return fail(compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "constructor requires a True or conjunction goal.",
          command.span,
        ));
      }
      let left: ProofTerm | undefined;
      let right: ProofTerm | undefined;
      const complete = () => {
        if (left === undefined || right === undefined) return;
        current.accept({ tag: "and_intro", left, right });
      };
      pending.unshift(
        {
          goal: current.goal.left,
          context: current.context,
          accept: (proof) => {
            left = proof;
            complete();
          },
        },
        {
          goal: current.goal.right,
          context: current.context,
          accept: (proof) => {
            right = proof;
            complete();
          },
        },
      );
      continue;
    }
    if (command.tag === "left" || command.tag === "right") {
      if (current.goal.tag !== "or") {
        return fail(compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          `${command.tag} requires a disjunction goal.`,
          command.span,
        ));
      }
      const left_goal = current.goal.left;
      const right_goal = current.goal.right;
      const choose_left = command.tag === "left";
      let selected_goal = right_goal;
      if (choose_left) selected_goal = left_goal;
      pending.unshift({
        goal: selected_goal,
        context: current.context,
        accept: (proof) => {
          if (choose_left) {
            current.accept({
              tag: "or_left",
              proof,
              other: right_goal,
            });
            return;
          }
          current.accept({
            tag: "or_right",
            other: left_goal,
            proof,
          });
        },
      });
      continue;
    }
    if (command.tag === "decide") {
      const environment = KernelEnvironment.from(
        current.context.declarations,
      );
      if (!machine_reflection_holds(current.goal, environment)) {
        return fail(compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "decide found no total compile-time decision for the current goal.",
          command.span,
        ));
      }
      current.accept({
        tag: "machine_reflect",
        proposition: current.goal,
      });
      continue;
    }
    throw new Error("Invalid prefix tactic command.");
  }
  if (pending.length > 0) {
    let goal_suffix = "s";
    if (pending.length === 1) goal_suffix = "";
    return fail(compiler_diagnostic(
      diagnostic_codes.prefix_proof_invalid,
      `Tactic block leaves ${pending.length.toString()} unresolved goal${goal_suffix}.`,
      block_span,
    ));
  }
  expect(
    completed !== undefined,
    "Completed tactic block lost its proof term.",
  );
  return ok(completed);
}

type PrefixTacticRewrite =
  | { tag: "rewritten"; motive: Proposition; goal: Proposition }
  | { tag: "unchanged" }
  | { tag: "budget_exhausted" };

function rewrite_prefix_tactic_goal(
  goal: Proposition,
  source: KernelTerm,
  target: KernelTerm,
  type: KernelType,
  context: PrefixKernelProofContext,
): PrefixTacticRewrite {
  const environment = KernelEnvironment.from(context.declarations);
  const outer_context = snapshot_kernel_context(context.term_context);
  const motive_context: KernelContext = [type, ...outer_context];
  const lifted_source = shift_kernel_term_variables(source, 1);
  let replacements = 0;
  let steps = 0;
  let budget_exhausted = false;

  const rewrite_term = (
    term: KernelTerm,
    matching: KernelTerm,
    term_context: KernelContext,
    binder_depth: number,
  ): KernelTerm => {
    steps += 1;
    if (steps > proof_limits.compiler_search_steps) {
      budget_exhausted = true;
      return term;
    }
    if (term_equal(term, matching, term_context, environment)) {
      replacements += 1;
      return { tag: "var", index: binder_depth };
    }
    if (term.tag === "var" || term.tag === "constant") return term;
    if (term.tag === "lam") {
      return {
        tag: "lam",
        domain: term.domain,
        body: rewrite_term(
          term.body,
          shift_kernel_term_variables(matching, 1),
          [term.domain, ...term_context],
          binder_depth + 1,
        ),
      };
    }
    return {
      tag: "app",
      function: rewrite_term(
        term.function,
        matching,
        term_context,
        binder_depth,
      ),
      argument: rewrite_term(
        term.argument,
        matching,
        term_context,
        binder_depth,
      ),
    };
  };

  const rewrite_proposition = (
    proposition: Proposition,
    matching: KernelTerm,
    term_context: KernelContext,
    binder_depth: number,
  ): Proposition => {
    steps += 1;
    if (steps > proof_limits.compiler_search_steps) {
      budget_exhausted = true;
      return proposition;
    }
    if (proposition.tag === "true" || proposition.tag === "false") {
      return proposition;
    }
    if (proposition.tag === "atom") {
      return {
        tag: "atom",
        name: proposition.name,
        arguments: proposition.arguments.map((argument) =>
          rewrite_term(argument, matching, term_context, binder_depth)
        ),
      };
    }
    if (proposition.tag === "equal") {
      return {
        tag: "equal",
        type: proposition.type,
        left: rewrite_term(
          proposition.left,
          matching,
          term_context,
          binder_depth,
        ),
        right: rewrite_term(
          proposition.right,
          matching,
          term_context,
          binder_depth,
        ),
      };
    }
    if (proposition.tag === "and" || proposition.tag === "or") {
      return {
        tag: proposition.tag,
        left: rewrite_proposition(
          proposition.left,
          matching,
          term_context,
          binder_depth,
        ),
        right: rewrite_proposition(
          proposition.right,
          matching,
          term_context,
          binder_depth,
        ),
      };
    }
    if (proposition.tag === "implies") {
      return {
        tag: "implies",
        premise: rewrite_proposition(
          proposition.premise,
          matching,
          term_context,
          binder_depth,
        ),
        conclusion: rewrite_proposition(
          proposition.conclusion,
          matching,
          term_context,
          binder_depth,
        ),
      };
    }
    if (proposition.tag === "not") {
      return {
        tag: "not",
        proposition: rewrite_proposition(
          proposition.proposition,
          matching,
          term_context,
          binder_depth,
        ),
      };
    }
    return {
      tag: proposition.tag,
      domain: proposition.domain,
      body: rewrite_proposition(
        proposition.body,
        shift_kernel_term_variables(matching, 1),
        [proposition.domain, ...term_context],
        binder_depth + 1,
      ),
    };
  };

  const motive = rewrite_proposition(
    lift_proposition(goal),
    lifted_source,
    motive_context,
    0,
  );
  if (budget_exhausted) return { tag: "budget_exhausted" };
  if (replacements === 0) return { tag: "unchanged" };
  return {
    tag: "rewritten",
    motive,
    goal: instantiate_proposition(motive, target),
  };
}

type SynthesizedPrefixProof = {
  term: ProofTerm;
  proposition: Proposition;
};

function extend_prefix_proof_context(
  context: PrefixKernelProofContext,
  name: string,
  proposition: Proposition,
): PrefixKernelProofContext {
  const proof_indices = new Map<string, number>();
  for (const [existing_name, index] of context.proof_indices) {
    proof_indices.set(existing_name, index + 1);
  }
  proof_indices.set(name, 0);
  const proof_propositions = new Map(context.proof_propositions);
  proof_propositions.set(name, proposition);
  return {
    ...context,
    proof_indices,
    proof_propositions,
  };
}

function extend_prefix_term_context(
  context: PrefixKernelProofContext,
  name: string,
  domain: KernelType,
): PrefixKernelProofContext {
  expect(
    domain.tag === "constant",
    "Surface quantified proof domain is not a representation type.",
  );
  const term_indices = new Map<string, number>();
  for (const [existing_name, index] of context.term_indices) {
    term_indices.set(existing_name, index + 1);
  }
  term_indices.set(name, 0);
  const term_types = new Map(context.term_types);
  term_types.set(name, {
    display_name: domain.name,
    name: domain.name,
    representation: domain.name,
  });
  const proof_propositions = new Map<string, Proposition>();
  for (
    const [proof_name, proposition] of context.proof_propositions
  ) {
    proof_propositions.set(
      proof_name,
      lift_proposition(proposition),
    );
  }
  return {
    ...context,
    proof_propositions,
    term_context: [domain, ...context.term_context],
    term_indices,
    term_types,
  };
}

function check_prefix_proof_argument(
  argument: PrefixTerm,
  expected_type: KernelType,
  context: PrefixKernelProofContext,
  role: string,
): Checked<{ term: KernelTerm; type: KernelType; type_name: string }> {
  const checked = prefix_kernel_term(
    context.declaration_name,
    argument,
    context,
    context.facts,
  );
  if (checked !== undefined) {
    if (
      checked.type.tag === "constant" && expected_type.tag === "constant" &&
      checked.type.name !== expected_type.name
    ) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          `${role} ${argument.text} has type ${checked.type.name}, expected ${expected_type.name}.`,
          argument.span,
        ),
      );
    }
    return ok(checked);
  }
  return fail(
    compiler_diagnostic(
      diagnostic_codes.prefix_proof_invalid,
      `Unsupported ${role} ${argument.text}.`,
      argument.span,
    ),
  );
}

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
  if (proof.tag === "unsafe_assume") {
    if (!context.allow_unsafe) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.unsafe_proof_use,
          "Unsafe proof assumption requires an unsafe proof declaration.",
          proof.span,
        ),
      );
    }
    const unstructured = first_unstructured_quantified_proposition(
      proof.proposition,
      context.facts,
      true,
    );
    if (unstructured !== undefined) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "Unsafe proof assumption requires structured kernel terms.",
          unstructured.span,
        ),
      );
    }
    const formation = check_prefix_proposition(
      context.declaration_name,
      proof.proposition,
      context.term_types,
      context.type_names,
      context.facts,
      new Set(),
    );
    const formation_diagnostics = diagnostics_of(formation);
    if (formation_diagnostics.length > 0) {
      return fail(
        ...formation_diagnostics.map((diagnostic) => ({
          ...diagnostic,
          code: diagnostic_codes.prefix_proof_invalid,
        })),
      );
    }
    const proposition = prefix_kernel_proposition(
      context.declaration_name,
      proof.proposition,
      context,
      context.facts,
      context.type_names,
    );
    return ok({
      term: {
        tag: "unsafe_assume",
        proposition,
        origin: {
          tag: "source",
          start: proof.span.start,
          end: proof.span.end,
        },
      },
      proposition,
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
  if (proof.tag === "lambda") {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        "Proof lambda requires an expected implication, negation, or universal goal.",
        proof.span,
      ),
    );
  }
  if (proof.tag === "exists_intro") {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        "exists_intro requires an expected existential goal.",
        proof.span,
      ),
    );
  }
  if (proof.tag === "exists_elim") {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        "exists_elim requires an expected proposition goal.",
        proof.span,
      ),
    );
  }
  if (proof.tag === "forall_apply") {
    const universal_check = synthesize_prefix_proof(proof.proof, context);
    const universal = checked_value(universal_check);
    if (universal === undefined) return universal_check;
    if (universal.proposition.tag !== "forall") {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "forall_apply requires a universal proof.",
          proof.proof.span,
        ),
      );
    }
    const universal_proposition = universal.proposition;
    const argument_check = check_prefix_proof_argument(
      proof.argument,
      universal_proposition.domain,
      context,
      "universal argument",
    );
    const argument = checked_value(argument_check);
    if (argument === undefined) {
      return argument_check.map((checked) => ({
        term: {
          tag: "forall_apply",
          proof: universal.term,
          argument: checked.term,
        },
        proposition: universal_proposition.body,
      }));
    }
    return ok({
      term: {
        tag: "forall_apply",
        proof: universal.term,
        argument: argument.term,
      },
      proposition: instantiate_proposition(
        universal_proposition.body,
        argument.term,
      ),
    });
  }
  if (proof.tag === "congr") {
    const equality_check = synthesize_prefix_proof(proof.proof, context);
    const equality = checked_value(equality_check);
    if (equality === undefined) return equality_check;
    if (equality.proposition.tag !== "equal") {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "congr requires an equality proof.",
          proof.proof.span,
        ),
      );
    }
    const function_context = extend_prefix_term_context(
      context,
      proof.parameter_name,
      equality.proposition.type,
    );
    const function_body = prefix_kernel_term(
      context.declaration_name,
      proof.function,
      function_context,
      context.facts,
    );
    if (function_body === undefined) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          `Unsupported congruence function ${proof.function.text}.`,
          proof.function.span,
        ),
      );
    }
    const function_term: KernelTerm = {
      tag: "lam",
      domain: equality.proposition.type,
      body: function_body.term,
    };
    return ok({
      term: {
        tag: "congr",
        function: function_term,
        proof: equality.term,
      },
      proposition: {
        tag: "equal",
        type: function_body.type,
        left: {
          tag: "app",
          function: function_term,
          argument: equality.proposition.left,
        },
        right: {
          tag: "app",
          function: function_term,
          argument: equality.proposition.right,
        },
      },
    });
  }
  if (proof.tag === "transport") {
    const equality_check = synthesize_prefix_proof(proof.equality, context);
    const equality = checked_value(equality_check);
    if (equality === undefined) return equality_check;
    if (equality.proposition.tag !== "equal") {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "transport requires an equality proof.",
          proof.equality.span,
        ),
      );
    }
    const motive_context = extend_prefix_term_context(
      context,
      proof.motive_name,
      equality.proposition.type,
    );
    const unstructured_motive = first_unstructured_quantified_proposition(
      proof.motive,
      context.facts,
      true,
    );
    if (unstructured_motive !== undefined) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.prefix_proof_invalid,
          "transport motive requires structured kernel terms.",
          unstructured_motive.span,
        ),
      );
    }
    const motive_formation = check_prefix_proposition(
      context.declaration_name,
      proof.motive,
      motive_context.term_types,
      context.type_names,
      context.facts,
      new Set(),
    );
    const motive_diagnostics = diagnostics_of(motive_formation);
    if (motive_diagnostics.length > 0) {
      return fail(
        ...motive_diagnostics.map((diagnostic) => ({
          ...diagnostic,
          code: diagnostic_codes.prefix_proof_invalid,
        })),
      );
    }
    const motive = prefix_kernel_proposition(
      context.declaration_name,
      proof.motive,
      motive_context,
      context.facts,
      context.type_names,
    );
    const source = instantiate_proposition(
      motive,
      equality.proposition.left,
    );
    const target = instantiate_proposition(
      motive,
      equality.proposition.right,
    );
    return elaborate_prefix_proof(
      proof.proof,
      source,
      context,
    ).map((transported): SynthesizedPrefixProof => ({
      term: {
        tag: "transport",
        equality: equality.term,
        motive,
        proof: transported,
      },
      proposition: target,
    }));
  }
  if (proof.tag === "or_left" || proof.tag === "or_right") {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        "Disjunction introduction requires an expected disjunction goal.",
        proof.span,
      ),
    );
  }
  if (proof.tag === "false_elim") {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        "False elimination requires an expected proposition goal.",
        proof.span,
      ),
    );
  }
  if (proof.tag === "or_cases") {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.prefix_proof_invalid,
        "Disjunction elimination requires an expected proposition goal.",
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
  if (
    proof.tag === "refl" || proof.tag === "lambda" ||
    proof.tag === "or_left" || proof.tag === "or_right" ||
    proof.tag === "false_elim" || proof.tag === "or_cases" ||
    proof.tag === "exists_intro" || proof.tag === "exists_elim"
  ) {
    return false;
  }
  if (
    proof.tag === "name" || proof.tag === "true_intro" ||
    proof.tag === "unsafe_assume"
  ) {
    return true;
  }
  if (
    proof.tag === "symm" || proof.tag === "and_left" ||
    proof.tag === "and_right"
  ) {
    return prefix_proof_synthesizes(proof.proof);
  }
  if (proof.tag === "forall_apply") {
    return prefix_proof_synthesizes(proof.proof);
  }
  if (proof.tag === "congr") {
    return prefix_proof_synthesizes(proof.proof);
  }
  if (proof.tag === "transport") {
    return prefix_proof_synthesizes(proof.equality);
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
  definitions: readonly PrefixDefinition[],
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
  const references = [
    ...signature.type.parameters.map((parameter) => parameter.type),
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
        definitions,
        signature.scope,
        signature.span.start,
      ),
      new Set(),
    );
    checks.push(formation);
  }
  return all(checks).map(() => undefined);
}

function check_prefix_requires(
  signature: PrefixSignature,
  signatures: readonly PrefixSignature[],
  definitions: readonly PrefixDefinition[],
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
        definitions,
        signature.scope,
        signature.span.start,
      ),
      new Set(),
    );
    if (diagnostics_of(formation).length > 0) {
      checks.push(formation);
      continue;
    }
    checks.push(ok(undefined));
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
        definitions,
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
      definitions,
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
    definitions,
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
  body?: PrefixProposition;
  body_facts?: ReadonlyMap<string, PrefixFactSignature>;
  body_parameters?: readonly string[];
  kernel_name: string;
  opaque: boolean;
  parameters: readonly LogicalTermType[];
  type_parameters: ReadonlySet<string>;
};

type PrefixFactSignatureCache = Map<
  string,
  ReadonlyMap<string, PrefixFactSignature>
>;

type LogicalTermType = {
  display_name?: string;
  expression?: TypeExpr;
  name: string;
  representation: string;
  refinement?: string;
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
  definitions: readonly PrefixDefinition[],
  scope: string,
  visible_at: number,
  definition_visible_at = visible_at,
  cache: PrefixFactSignatureCache = new Map(),
): ReadonlyMap<string, PrefixFactSignature> {
  const cache_key = JSON.stringify([
    scope,
    visible_at,
    definition_visible_at,
  ]);
  const cached = cache.get(cache_key);
  if (cached !== undefined) return cached;
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
    const fact: PrefixFactSignature = {
      kernel_name: "fact:" + signature.scope + ":" + signature.name,
      opaque: signature.kind === "opaque fact",
      parameters: signature.type.parameters.map((parameter) =>
        logical_term_type_from_reference(parameter.type)
      ),
      type_parameters: new Set(
        signature.type.binders.filter((binder) =>
          binder.type.canonical === "Type"
        ).map((binder) => binder.name),
      ),
    };
    if (signature.kind === "fact") {
      const definition = definitions.find((candidate) =>
        candidate.name === signature.name &&
        candidate.scope === signature.scope &&
        candidate.kind === "fact" &&
        candidate.span.start >= signature.span.end &&
        candidate.span.end <= definition_visible_at
      );
      if (
        definition?.fact_body !== undefined &&
        definition.fact_parameters !== undefined
      ) {
        fact.body = definition.fact_body;
        fact.body_facts = prefix_fact_signatures(
          signatures,
          definitions,
          signature.scope,
          definition.span.start,
          definition.span.start,
          cache,
        );
        fact.body_parameters = definition.fact_parameters;
      }
    }
    facts.set(signature.name, fact);
  }
  cache.set(cache_key, facts);
  return facts;
}

function instantiate_transparent_fact(
  declaration_name: string,
  fact_name: string,
  fact: PrefixFactSignature,
  arguments_: readonly PrefixTerm[],
  term_types: ReadonlyMap<string, LogicalTermType>,
  facts: ReadonlyMap<string, PrefixFactSignature>,
): PrefixProposition | undefined {
  if (
    fact.body === undefined || fact.body_parameters === undefined ||
    fact.body_parameters.length !== arguments_.length
  ) {
    return undefined;
  }
  const type_substitutions = new Map<string, LogicalTermType>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const expected = fact.parameters[index];
    if (argument === undefined || expected === undefined) return undefined;
    const actual = checked_value(
      check_prefix_term_type(
        declaration_name,
        argument,
        term_types,
        facts,
        new Set(),
      ),
    );
    if (
      actual === undefined ||
      (fact.type_parameters.size > 0 && actual.refinement !== undefined)
    ) {
      return undefined;
    }
    if (expected.expression !== undefined) {
      const candidates = new Map(type_substitutions);
      if (
        prefix_type_pattern_matches(
          expected.expression,
          actual,
          fact.type_parameters,
          candidates,
        )
      ) {
        for (const [name, type] of candidates) {
          type_substitutions.set(name, type);
        }
        continue;
      }
    }
    if (
      actual.name !== expected.name &&
      (expected.name !== expected.representation ||
        actual.representation !== expected.representation)
    ) {
      return undefined;
    }
  }
  for (const type_parameter of fact.type_parameters) {
    if (!type_substitutions.has(type_parameter)) return undefined;
  }
  const term_substitutions = new Map<string, PrefixTerm>();
  for (let index = 0; index < fact.body_parameters.length; index += 1) {
    const parameter = fact.body_parameters[index];
    const argument = arguments_[index];
    expect(
      parameter !== undefined && argument !== undefined,
      `Transparent fact ${fact_name} lost argument ${index}.`,
    );
    term_substitutions.set(parameter, argument);
  }
  const body = substitute_prefix_proposition(
    fact.body,
    term_substitutions,
  );
  return substitute_prefix_proposition_types(body, type_substitutions);
}

function substitute_prefix_proposition_types(
  proposition: PrefixProposition,
  substitutions: ReadonlyMap<string, LogicalTermType>,
): PrefixProposition {
  if (
    proposition.tag === "true" || proposition.tag === "false" ||
    proposition.tag === "holds" || proposition.tag === "equal" ||
    proposition.tag === "not_equal" || proposition.tag === "less" ||
    proposition.tag === "less_equal"
  ) {
    return proposition;
  }
  if (proposition.tag === "is") {
    return {
      ...proposition,
      type: substitute_prefix_type_reference(
        proposition.type,
        substitutions,
      ),
    };
  }
  if (proposition.tag === "not") {
    return {
      ...proposition,
      proposition: substitute_prefix_proposition_types(
        proposition.proposition,
        substitutions,
      ),
    };
  }
  if (
    proposition.tag === "and" || proposition.tag === "or" ||
    proposition.tag === "implies"
  ) {
    return {
      ...proposition,
      left: substitute_prefix_proposition_types(
        proposition.left,
        substitutions,
      ),
      right: substitute_prefix_proposition_types(
        proposition.right,
        substitutions,
      ),
    };
  }
  if (proposition.tag === "forall" || proposition.tag === "exists") {
    return {
      ...proposition,
      binder: {
        ...proposition.binder,
        type: substitute_prefix_type_reference(
          proposition.binder.type,
          substitutions,
        ),
      },
      proposition: substitute_prefix_proposition_types(
        proposition.proposition,
        substitutions,
      ),
    };
  }
  throw new Error("Unknown polymorphic fact proposition.");
}

function substitute_prefix_type_reference(
  reference: PrefixTypeReference,
  substitutions: ReadonlyMap<string, LogicalTermType>,
): PrefixTypeReference {
  const replacement = substitutions.get(reference.canonical);
  if (replacement === undefined) return reference;
  let text = replacement.representation;
  if (replacement.display_name !== undefined) {
    text = replacement.display_name;
  }
  return {
    text,
    canonical: replacement.name,
    expression: replacement.expression,
    representation: replacement.representation,
    resolved: true,
    span: reference.span,
  };
}

function unfold_transparent_prefix_proposition(
  declaration_name: string,
  proposition: PrefixProposition,
  term_types: ReadonlyMap<string, LogicalTermType>,
  facts: ReadonlyMap<string, PrefixFactSignature>,
  active_facts: ReadonlySet<string> = new Set(),
): PrefixProposition {
  if (proposition.tag === "true" || proposition.tag === "false") {
    return proposition;
  }
  if (proposition.tag === "holds") {
    const application = prefix_fact_application(proposition.value);
    if (application === undefined) return proposition;
    const fact_name = application.name;
    const fact = facts.get(fact_name);
    if (
      fact?.body === undefined || fact.body_parameters === undefined ||
      fact.body_parameters.length !== application.arguments.length ||
      active_facts.has(fact.kernel_name)
    ) {
      return proposition;
    }
    const body = instantiate_transparent_fact(
      declaration_name,
      fact_name,
      fact,
      application.arguments,
      term_types,
      facts,
    );
    if (body === undefined) return proposition;
    const nested_active = new Set(active_facts);
    nested_active.add(fact.kernel_name);
    let body_facts = facts;
    if (fact.body_facts !== undefined) body_facts = fact.body_facts;
    return unfold_transparent_prefix_proposition(
      declaration_name,
      body,
      term_types,
      body_facts,
      nested_active,
    );
  }
  if (
    proposition.tag === "equal" || proposition.tag === "not_equal" ||
    proposition.tag === "less" || proposition.tag === "less_equal" ||
    proposition.tag === "is"
  ) {
    return proposition;
  }
  if (proposition.tag === "not") {
    return {
      ...proposition,
      proposition: unfold_transparent_prefix_proposition(
        declaration_name,
        proposition.proposition,
        term_types,
        facts,
        active_facts,
      ),
    };
  }
  if (
    proposition.tag === "and" || proposition.tag === "or" ||
    proposition.tag === "implies"
  ) {
    return {
      ...proposition,
      left: unfold_transparent_prefix_proposition(
        declaration_name,
        proposition.left,
        term_types,
        facts,
        active_facts,
      ),
      right: unfold_transparent_prefix_proposition(
        declaration_name,
        proposition.right,
        term_types,
        facts,
        active_facts,
      ),
    };
  }
  if (proposition.tag === "forall" || proposition.tag === "exists") {
    return {
      ...proposition,
      proposition: unfold_transparent_prefix_proposition(
        declaration_name,
        proposition.proposition,
        term_types,
        facts,
        active_facts,
      ),
    };
  }
  throw new Error("Unknown transparent fact proposition.");
}

function prefix_fact_application(
  term: PrefixTerm,
): { name: string; arguments: readonly PrefixTerm[] } | undefined {
  let current = term;
  while (current.shape.tag === "parenthesized") {
    current = current.shape.value;
  }
  if (
    current.shape.tag !== "call" ||
    current.shape.function.shape.tag !== "name"
  ) {
    return undefined;
  }
  return {
    name: current.shape.function.shape.name,
    arguments: current.shape.arguments,
  };
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
    let literal_operand = shape.operand;
    while (literal_operand.shape.tag === "parenthesized") {
      literal_operand = literal_operand.shape.value;
    }
    if (
      shape.operator === "-" && literal_operand.shape.tag === "number"
    ) {
      return check_prefix_negative_number_type(
        declaration_name,
        literal_operand,
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
  const runtime_parameters = signature_parameters.filter((parameter) =>
    parameter.type.proof === undefined
  );
  const runtime_expected_index = runtime_parameters.findIndex((parameter) =>
    parameter.name === expected_name
  );
  const expected_representation = callable_type.params[runtime_expected_index];
  if (
    callable_type.params.length !== runtime_parameters.length ||
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
  if (signature.type.result.type.proof !== undefined) {
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
  const binding = find_source_binding(source, signature.name, definition.span);
  if (
    signature.type.parameters.some((parameter) =>
      parameter.type.proof !== undefined
    ) &&
    (binding?.value.tag === "lam" || binding?.value.tag === "rec") &&
    binding.value.params.length === signature.type.parameters.length
  ) {
    return ok(undefined);
  }
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
  const runtime_parameter_count = signature.type.parameters.filter(
    (parameter) => parameter.type.proof === undefined,
  ).length;
  if (callable.params.length !== runtime_parameter_count) {
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
    if (declared.type.proof !== undefined) continue;
    term_types.set(parameter, logical_term_type_from_reference(declared.type));
  }
  const checked_body = check_prefix_term_type(
    signature.name,
    body,
    term_types,
    new Map(),
    new Set(),
  );
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
  let actual_result_name: string | undefined;
  if (binding.value.tag === "lam" || binding.value.tag === "rec") {
    actual_result_name = source_facts(source).editor_type_of.get(
      binding.value.body,
    )?.resolved_name;
  }
  const body_type = checked_value(checked_body);
  if (body_type === undefined) {
    if (actual_result_name === signature.type.result.type.canonical) {
      return ok(undefined);
    }
    return checked_body.map(() => undefined);
  }
  const result_type = signature.type.result.type.canonical;
  if (body_type.name === result_type) return ok(undefined);
  if (body.text === result_type) return ok(undefined);
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
    const lowering_source = source_with_host_callable_exports(
      clone_source_tree(analysis.source),
    );
    return check_source_for_gpufuck(lowering_source).map((source) => {
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
