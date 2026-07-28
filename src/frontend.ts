export { Source } from "./frontend/source.ts";
export type {
  SourceAnalysis,
  SourceAnalyzeOptions,
} from "./frontend/source.ts";
export type { ParseSourceResult } from "./frontend/parser.ts";
export {
  type BabaCst,
  type BabaCstNode,
  type BabaParseResult,
  type BabaSourceNodeId,
  type BabaToken,
  parse_duck_source,
} from "./frontend/baba_parser.ts";
export type { SourceImportResolver } from "./frontend/import_diagnostic.ts";
export {
  SemanticIdentityAllocator,
  value_id_text,
} from "./frontend/semantic_identity.ts";
export {
  check_certificate,
  check_proof,
  false_proposition,
  format_proposition,
  proposition_equal,
  true_proposition,
} from "./frontend/proof_kernel.ts";
export {
  check_term,
  check_type,
  infer_term,
  prop_sort,
  type_assignable,
  type_sort,
  universe_of_sort,
} from "./frontend/kernel_terms.ts";
export type {
  KernelContext,
  KernelEnvironment,
  KernelTerm,
  KernelType,
  Universe,
} from "./frontend/kernel_terms.ts";
export {
  assume_fact,
  assume_machine_fact,
  assume_state,
  establish_fact,
  exclude_fact,
  exclude_machine_fact,
  exclude_state,
  fact_implies,
  implies_fact,
  implies_machine_fact,
  join_environments,
  join_facts,
  join_machine_domains,
  join_states,
  machine_fact_domain,
  machine_fact_evidence,
  machine_range,
  meet_facts,
  normalize_machine_integer,
  reachable_state,
  unknown_fact,
  unreachable_state,
  widen_facts,
  widen_machine_facts,
} from "./frontend/fact_graph.ts";
export type {
  FactEnvironment,
  FactEvidence,
  FactOrigin,
  FactProposition,
  FactSafety,
  FactState,
  MachineFactDomain,
  MachineInteger,
  ScalarFact,
} from "./frontend/fact_graph.ts";
export type {
  KernelCertificate,
  KernelCertificateCheckOptions,
  KernelCheckOptions,
  ProofSafety,
  ProofTerm,
  Proposition,
} from "./frontend/proof_kernel.ts";
export type {
  BindingGeneration,
  PhiValue,
  SemanticOrigin,
  ValueId,
} from "./frontend/semantic_identity.ts";
export { SemanticCfgBuilder } from "./frontend/semantic_cfg.ts";
export type {
  SemanticBlock,
  SemanticBlockId,
  SemanticCfg,
  SemanticNode,
  SemanticNodeId,
  SemanticOperation,
  SemanticPhiInput,
  SemanticTerminator,
} from "./frontend/semantic_cfg.ts";
export {
  computational_existential_family_type,
  computational_existential_type,
  erase_decision,
  erase_semantic_type,
  logical_existential_type,
  no_decision,
  open_computational_existential,
  owned_runtime_value,
  pack_computational_existential,
  proof_type,
  refinement_proves,
  refinement_type,
  representation_type,
  weaken_refinement,
  yes_decision,
} from "./frontend/refinement.ts";
export type {
  ComputationalPackage,
  ErasedDecision,
  LogicalDecision,
  RepresentationCase,
  RepresentationField,
  RepresentationOwnership,
  RepresentationType,
  RepresentationValue,
  SemanticType,
} from "./frontend/refinement.ts";
export type {
  SourceImportMeta,
  SourceImportMetaAtom,
  SourceImportMetaLiteral,
} from "./frontend/import_meta.ts";
export type {
  SourcePosition,
  SourceSpan,
  SourceSyntax,
  SyntaxDiagnostic,
} from "./frontend/syntax.ts";
export {
  check_contract_compatibility,
  summary_matches,
} from "./frontend/function_summary.ts";
export type {
  ContractBinder,
  ContractCompatibilityCertificates,
  ContractFunction,
  FunctionFactSummary,
} from "./frontend/function_summary.ts";
export { analyze_duck_source, lower_duck_source } from "./semantic_program.ts";
export type {
  DuckAnalysis,
  DuckAnalyzeOptions,
  DuckSemanticProgram,
  DuckSourceAnalysis,
  FunctionFactIndex,
  KernelCertificateIndex,
  RefinementIndex,
  SemanticSymbolIndex,
  SemanticTypeIndex,
  SourceOriginIndex,
} from "./semantic_program.ts";
export { associate_prefix_signatures } from "./frontend/prefix_signature.ts";
export type {
  PrefixDefinition,
  PrefixSignature,
  PrefixSignatureAssociation,
  PrefixSignatureIndex,
  PrefixSignatureKind,
} from "./frontend/prefix_signature.ts";
export { extract_prefix_source_metadata } from "./frontend/prefix_signature_source.ts";
export type { PrefixSourceMetadata } from "./frontend/prefix_signature_source.ts";

export {
  compiler_diagnostic,
  CompilerDiagnosticError,
  diagnostic_codes,
  diagnostic_registry,
  diagnostic_sequence,
  registered_diagnostic,
} from "./diagnostic.ts";
export type {
  CompilerDiagnostic,
  CompilerDiagnosticRelated,
  DiagnosticCategory,
  DiagnosticCode,
  DiagnosticName,
  DiagnosticSeverity,
  DiagnosticSpan,
  RegisteredDiagnostic,
} from "./diagnostic.ts";
export { SourceDiagnosticError } from "./frontend/semantic_diagnostic.ts";
export type {
  SourceDiagnostic,
  SourceDiagnosticRelated,
  SourceDiagnosticSeverity,
} from "./frontend/semantic_diagnostic.ts";
