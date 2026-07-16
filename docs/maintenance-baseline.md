# Maintenance Baseline

This baseline was captured on 2026-07-16 after Rank-N polymorphism landed in
commit `12e1c7a`. Splitting the broad Core and frontend integration tests in
`24522ad` changed only their file boundaries.

## Toolchain And Tests

- Deno 2.9.2
- Tree-sitter CLI 0.26.3
- WABT 1.0.41
- 1,299 source and example tests
- 36 case-study tests
- 1,335 total tests
- 27 Tree-sitter corpus cases
- 96 example parses and 3 prelude parses

The complete suite passed. The generated grammar artifacts matched byte for
byte, and all six Tree-sitter query files ran successfully.

## Performance

The compiler completed all 72 successful examples in 307.29 ms. Its largest
single compile took 53.44 ms for
`examples/compile_time/13_derived_nested_equality.duck`; the largest output was
12,779 WAT bytes for `examples/showcases/02_text_analyzer.duck`.

The LSP measurement used `case-studies/grep/grep.duck`: cold initialization was
91.14 ms, edit diagnostics were 74.99 ms, completion was 1.88 ms, and measured
heap growth was 30,488,080 bytes. These measurements are reference values from
one local run; the absolute budgets in the performance scripts remain the CI
gate.

## Dependencies

The initial dependency report contained seven multi-file strongly connected
components, with 143 files in the largest component, and 77 forbidden layer
imports. These historical counts remain recorded here; the checked
`scripts/dependency-baseline.json` is updated as findings are removed.

## Product Barrel

`src/frontend.ts` exposed these 129 symbols at the baseline:

```txt
Source
ParseSourceResult
derive_missing_source_spans
has_concrete_source_span
mark_source_span
source_span
source_span_origin
source_syntax
SourcePosition
SourceSpan
SourceSyntax
SyntaxDiagnostic
SourceAnalysis
SourceAnalyzeOptions
SourceArtifact
SourceArtifactFileOptions
SourceArtifactOptions
SourceFacts
SourceFieldTypeFact
SourceTypeFact
SourceTypeSetFact
SourceDiagnostic
SourceDiagnosticRelated
SourceDiagnosticSeverity
SourceImportResolver
SourceDiagnosticError
build_binding_index
BindingEntity
BindingEntityKind
BindingIndex
BindingOccurrence
BindingRole
BindingScope
EntityFacts
EntityId
OccurrenceId
ScopeId
UnresolvedReason
name_sites
NameSite
FrontEffectAnalysis
FrontEffectFunction
AbiCallable
AbiCallableValueContract
AbiEffect
AbiEffectFunctionRequirement
AbiEffectOperation
AbiEffectRef
AbiEffectRequirements
AbiEntry
AbiImport
AbiInit
AbiInitField
AbiManifest
AbiOwnership
AbiStructField
AbiType
AbiTypeRef
AbiValueContract
abi_fixed_array_schema_name
duck_abi_name
duck_abi_version
DuckAbiError
DuckEffectObject
DuckHost
DuckHostHandler
DuckHostInstance
DuckInitValue
DuckRunner
DuckStateToken
DuckValue
Core
CoreExpr
CoreField
CoreStmt
CoreTypeField
ArrayLengthExpr
Binding
Declaration
EffectRowExpr
Env
Field
FrontExpr
FrontType
HandlerClause
HandlerReturnClause
HandlerState
MatchArm
Param
Pattern
PatternLiteral
PatternMode
ProductExprEntry
ProductPatternEntry
RecordPatternField
ResolvedCallTarget
ResolvedFrontExpr
SourceNode
Stmt
Token
TokenKind
TypeDeclaration
TypeExpr
TypeField
TypePattern
TypeProductEntry
format_inference_type
monomorphic_type_binding
scalar_representation_compatible
statically_known_const_type_binding
TypeInference
ComptimeType
ComptimeTypeField
ComptimeValue
ComptimeValueHooks
comptime_type_key
resolve_comptime_type
resolve_comptime_value
InferenceAliasNormalizer
InferenceBinding
InferenceEffect
InferenceOwnership
InferenceProductField
InferenceRecordField
InferenceScalar
InferenceSumCase
InferenceType
TypeConstraint
TypeScheme
```

## Campaign Result

The final campaign gate runs 1,317 source, example, API, tooling, and
architecture tests plus all 36 case-study tests. The grammar corpus, 96 example
parses, three prelude parses, and all six queries remain unchanged and green.

The dependency baseline is empty: there are no multi-file import cycles and no
forbidden layer imports. The supported frontend barrel contains 59 symbols, down
from 129; the migration is documented in `docs/typescript-api-migration.md`. The
Deno lockfile still contains only `@mewhhaha/typeclasses` 0.5.0.

In the final local performance run, all 72 successful examples compiled in
308.78 ms. The largest compile took 53.29 ms and the largest output remained
12,779 WAT bytes. LSP cold initialization was 88.45 ms, edit diagnostics were
80.22 ms, completion was 1.95 ms, and measured heap growth was 30,143,184 bytes.
Every value remains well within its absolute budget; generated program output
and the `duck-js-1` ABI are unchanged.
