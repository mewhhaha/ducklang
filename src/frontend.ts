export { Source } from "./frontend/source.ts";
export type { ParseSourceResult } from "./frontend/parser.ts";
export {
  derive_missing_source_spans,
  has_concrete_source_span,
  mark_source_span,
  source_span,
  source_span_origin,
  source_syntax,
} from "./frontend/syntax.ts";
export type {
  SourcePosition,
  SourceSpan,
  SourceSyntax,
  SyntaxDiagnostic,
} from "./frontend/syntax.ts";
export type {
  SourceAnalysis,
  SourceAnalyzeOptions,
  SourceArtifact,
  SourceArtifactFileOptions,
  SourceArtifactOptions,
} from "./frontend/source.ts";
export type {
  SourceFacts,
  SourceFieldTypeFact,
  SourceTypeFact,
  SourceTypeSetFact,
} from "./frontend/source_facts.ts";
export type {
  SourceDiagnostic,
  SourceDiagnosticRelated,
  SourceDiagnosticSeverity,
} from "./frontend/semantic_diagnostic.ts";
export type { SourceImportResolver } from "./frontend/import_diagnostic.ts";
export { SourceDiagnosticError } from "./frontend/semantic_diagnostic.ts";
export { build_binding_index } from "./frontend/binding_index.ts";
export type {
  BindingEntity,
  BindingEntityKind,
  BindingIndex,
  BindingOccurrence,
  BindingRole,
  BindingScope,
  EntityFacts,
  EntityId,
  OccurrenceId,
  ScopeId,
  UnresolvedReason,
} from "./frontend/binding_index.ts";
export { name_sites } from "./frontend/name_site.ts";
export type { NameSite } from "./frontend/name_site.ts";
export type {
  FrontEffectAnalysis,
  FrontEffectFunction,
} from "./frontend/effect_analysis.ts";
export type {
  AbiCallable,
  AbiCallableValueContract,
  AbiEffect,
  AbiEffectFunctionRequirement,
  AbiEffectOperation,
  AbiEffectRef,
  AbiEffectRequirements,
  AbiEntry,
  AbiImport,
  AbiInit,
  AbiInitField,
  AbiManifest,
  AbiOwnership,
  AbiStructField,
  AbiType,
  AbiTypeRef,
  AbiValueContract,
} from "./abi.ts";
export {
  abi_fixed_array_schema_name,
  duck_abi_name,
  duck_abi_version,
} from "./abi.ts";
export {
  DuckAbiError,
  type DuckEffectObject,
  DuckHost,
  type DuckHostHandler,
  type DuckHostInstance,
  type DuckInitValue,
  DuckRunner,
  type DuckStateToken,
  type DuckValue,
} from "./host.ts";
export type {
  Core,
  CoreExpr,
  CoreField,
  CoreStmt,
  CoreTypeField,
} from "./core.ts";
export type {
  ArrayLengthExpr,
  Binding,
  Declaration,
  EffectRowExpr,
  Env,
  Field,
  FrontExpr,
  FrontType,
  HandlerClause,
  HandlerReturnClause,
  HandlerState,
  MatchArm,
  Param,
  Pattern,
  PatternLiteral,
  PatternMode,
  ProductExprEntry,
  ProductPatternEntry,
  RecordPatternField,
  ResolvedCallTarget,
  ResolvedFrontExpr,
  Source as SourceNode,
  Stmt,
  Token,
  TokenKind,
  TypeDeclaration,
  TypeExpr,
  TypeField,
  TypePattern,
  TypeProductEntry,
} from "./frontend/ast.ts";
export type {
  ComptimeType,
  ComptimeTypeField,
  ComptimeValue,
  ComptimeValueHooks,
} from "./frontend/comptime_value.ts";
export {
  comptime_type_key,
  resolve_comptime_type,
  resolve_comptime_value,
} from "./frontend/comptime_value.ts";
