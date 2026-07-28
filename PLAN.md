A previous agent produced the plan below to accomplish the user's task. Implement the plan in a fresh context. Treat the plan as the
  source of user intent, re-read files as needed, and carry the work through implementation and verification.

  # Inferred symbolic facts and full proof-carrying types for Ducklang

  ## Summary

  Duck should adopt the essay’s central model, with three concepts kept deliberately separate:

  1. A representation type describes runtime layout: `I32`, products, sums, functions, ownership, and so on.
  2. A contextual fact describes what is known about one semantic value at one program point.
  3. A proof or refinement preserves a proposition across calls, containers, modules, and control-flow boundaries.

  The default experience remains ordinary inferred Duck. The compiler creates proof obligations, propagates facts, infers function
  requirements and guarantees, and fills implicit proof arguments automatically. Users write contracts or proofs only when inference
  reaches a deliberate decidability boundary.

  The final pipeline is:

  ```text
  Duck source
    → Baba parse/CST
    → names, representation types, effects, ownership
    → typed semantic CFG with stable ValueIds
    → fact inference and function summaries
    → proof elaboration and kernel checking
    → proof erasure
    → semantic Core
    → gpufuck
    → Wasm
  ```

  Decisions already fixed:

  - Full proofs are the final target, delivered through gated milestones.
  - Automatic proof search uses deterministic in-process domains, not SMT.
  - Duck keeps wrapping machine-integer semantics.
  - Runtime validation is always explicit; the compiler never inserts hidden checks.
  - Ordinary partial operations become proof-requiring by default.
  - Proofs are erased; computational existential witnesses remain at runtime.
  - Both ordinary proof terms and tactic blocks are included.
  - Unsafe assumptions are supported but remain transitively visible and unsafe.
  - The new prefix function-signature syntax uses lowercase `type name = ...`.
  - Runtime Core remains free of proposition and proof nodes.

  ## Surface language and semantics

  ### Prefix function signatures

  PascalCase declarations remain ordinary types:

  ```duck
  type Identity = I32
  ```

  A lowercase `type` declaration is a semantic signature for a same-name value:

  ```duck
  type identity =
    forall (a: Type).
    (value: a) -> (result: a)
    ensures result = value

  let identity = value => value;
  ```

  Rules:

  - A lowercase signature creates one pending signature in its lexical scope.
  - It associates with exactly one later same-scope definition named identically.
  - Valid definition kinds are `let`, `const`, `fact`, and `opaque fact`.
  - Duplicate signatures, duplicate definitions, cross-scope matches, kind changes, and signatures left unmatched at scope exit are
  errors.
  - The signature predeclares the type for mutual inference but does not authorize recursion. Existing `rec` and mutual-binding rules
  still control recursion.
  - Several signatures may precede one mutual-recursion group.
  - Attributes remain attached to the definition.
  - Navigation treats signature and definition as two occurrences of one semantic entity.
  - Mismatch diagnostics point to both the signature and definition.
  - The formatter places associated signatures immediately before their definitions.
  - Prefix signatures are canonical for named callables, facts, and theorem/proof declarations.
  - Inline annotations remain for ordinary non-callable values and parameters.
  - Existing named callable annotations are migrated to prefix signatures and then rejected to avoid two competing contract syntaxes.

  Signature parameter names introduce logical binders. Lambda parameters are associated positionally and alpha-renamed to those binders
  during checking.

  The reserved result form is:

  ```duck
  (result: ResultType)
  ```

  It introduces `result` for postconditions.

  Contract clauses may repeat and are interpreted conjunctively:

  ```duck
  type divide =
    (numerator: I32, denominator: I32) -> (result: I32)
    requires denominator != 0
    ensures numerator =
      result * denominator + numerator % denominator
  ```

  - `requires P` is an implicit erased proof parameter.
  - `ensures P` is checked on every normal return.
  - Diverging, trapping, or unreachable paths do not establish an `ensures`.
  - `(evidence: Proof P)` is used when code needs to name evidence explicitly.
  - `decreases metric` declares a totality metric.
  - At most one `decreases` clause is accepted; use a product for lexicographic descent.

  ### Universes, propositions, and equality

  The proof kernel uses cumulative predicative universes:

  ```text
  Prop   : Type 0
  Type n : Type (n + 1)
  Type n <: Type (n + 1)
  ```

  Surface `Type` means `Type 0`. Higher levels are inferred; write an explicit level only when inference cannot solve it. `Type : Type`
  is rejected.

  Runtime and logical equality remain distinct:

  ```duck
  left == right   // Bool, requires runtime equality support
  left = right    // Prop, propositional equality
  ```

  Generic contracts therefore use `=`:

  ```duck
  ensures result = value
  ```

  Proposition syntax includes:

  ```text
  True
  False
  P and Q
  P or Q
  not P
  P implies Q
  left = right
  left != right
  left < right
  left <= right
  left is T
  forall (x: T). P
  exists (x: T). P
  predicate(arguments)
  ```

  Runtime `&&`, `||`, `!`, and `==` remain Boolean operations. A `Bool` used in proposition position elaborates to `Holds(value)`.

  Branching on a runtime Boolean introduces:

  ```text
  true edge:  Holds(condition)
  false edge: not Holds(condition)
  ```

  Kernel definitional equality performs only:

  - beta reduction;
  - local-binding/zeta reduction;
  - inductive-pattern/iota reduction;
  - unfolding of transparent, total definitions;
  - evaluation of total primitive operations.

  Opaque definitions do not unfold outside their defining module. Function and record eta equality are not included initially.

  ### Proofs and refinements

  ```duck
  Proof P
  ```

  is proof-irrelevant and erased. Two proofs of the same proposition have no observable identity.

  A refinement type is:

  ```duck
  { value: T | P }
  ```

  It stores only the runtime representation of `T`.

  Rules:

  - `{value: T | P} <: T` is an implicit zero-cost weakening.
  - Strengthening `T` into the refinement requires a proof of `P`.
  - Strengthening never inserts a runtime check.
  - Refinement ownership is exactly the ownership of `T`.
  - Refining a unique value does not make it copyable.
  - Proofs cannot be inspected to choose runtime data.
  - Proof-dependent branches must erase to the same runtime term and layout.
  - `False` elimination is restricted to proving another proposition; it cannot manufacture runtime data.
  - Equality transport into a computational type must preserve erased representation and ownership, even in unsafe code.

  A proof referring to a linear value does not consume or borrow that value. The proof remains unrestricted, but:

  - it cannot escape the referenced value’s dependent scope;
  - after the value is consumed, it cannot authorize an operation on a replacement `ValueId`;
  - transferring the fact requires an explicit equality or typestate-transition proof.

  Runtime capabilities remain owned or linear typestate handles, not logical proof values.

  ### Existentials and computational packages

  Logical existence is entirely erased:

  ```duck
  exists (x: T). P
  ```

  A witness from `Proof (exists (x:T). P)` may be opened only while proving another proposition.

  A computational existential is distinct:

  ```duck
  some (x: T). U
  ```

  It stores both the witness and the erased runtime payload of `U`.

  Canonical operations are:

  ```duck
  pack witness, payload as some (x: T). U
  open package as (x, payload)
  ```

  Opening introduces the witness and all refinements attached to the payload.

  A computational dependent type is accepted only when its erased layout is known. If different possible indices imply incompatible
  layouts, compilation fails before Core construction.

  ### User-defined facts and validators

  A transparent fact is a pure, total, unfoldable proposition-valued function:

  ```duck
  type multiple_of =
    (value: I32, divisor: I32) -> Prop

  fact multiple_of =
    (value, divisor) =>
      divisor != 0 and value % divisor = 0;
  ```

  An opaque fact hides its definition from importers:

  ```duck
  type sorted =
    forall (a: Type).
    (values: Vector a) -> Prop

  opaque fact sorted = values => ...;
  ```

  Rules:

  - Transparent facts may be unfolded by definitional equality.
  - Opaque fact bodies are checked in the defining module.
  - Importers use exported introduction, elimination, preservation, and decision theorems.
  - A bodyless fact declaration does not create evidence.
  - Facts return `Prop`, not `Bool`; `if multiple_of(...)` is invalid.

  Runtime testing is separate. A validator returns either:

  ```duck
  Decision P
  ```

  or:

  ```duck
  Option { value: T | P }
  ```

  `Decision` is:

  ```duck
  type Decision p =
    | #Yes (Proof p)
    | #No (Proof (not p))
  ```

  Its proof payload erases, but its runtime sum tag remains. Matching `Yes` or `No` introduces the corresponding fact.

  The existing unrelated two-payload prelude type named `Decision` must be renamed to `Outcome` before reserving `Decision P` for logical
  decisions.

  A Boolean predicate may refine through explicit postconditions:

  ```duck
  type is_multiple_of =
    (value: I32, divisor: I32) -> (result: Bool)
    ensures result implies multiple_of(value, divisor)
    ensures not result implies not multiple_of(value, divisor)
  ```

  The compiler never inserts a validator call.

  ### Explicit proof terms and tactics

  The kernel term language includes:

  - hypotheses;
  - proof lambdas and applications;
  - reflexivity, symmetry, transitivity, and congruence;
  - equality transport;
  - conjunction introduction and elimination;
  - disjunction introduction and elimination;
  - implication and negation;
  - universal introduction and application;
  - existential introduction and elimination into `Prop`;
  - inductive constructors and recursors;
  - reflection certificates;
  - explicitly unsafe assumptions.

  Proof terms may be written directly:

  ```duck
  by proof_term
  ```

  Tactic blocks use:

  ```duck
  by {
    intro value
    assumption
    ...
  }
  ```

  The initial tactic set is fixed:

  ```text
  exact term
  assumption
  intro name
  apply term
  constructor
  left
  right
  cases term
  rewrite term
  simp
  decide
  omega
  ```

  Rules:

  - Tactics generate kernel terms; the kernel rechecks the result.
  - `simp` without arguments uses definitional and built-in reductions only.
  - `simp [lemma_a, lemma_b]` adds that explicit finite rewrite set.
  - Rewrites use deterministic orientation and a visited-term guard.
  - `decide` uses an existing `Decision P` or a total compile-time decider; it never inserts a runtime validator call.
  - `omega` covers the internal bounded linear/difference/congruence fragment under machine-integer semantics and emits a reflection
  certificate.
  - No tactic plugins, user-defined tactics, tactic metaprogramming, or arbitrary compile-time execution are accepted initially.
  - Every subgoal retains the source span that created it.
  - No hole may survive compilation or an exported interface.
  - `induction` is added only after recursive algebraic types and structural totality are implemented.

  ### Totality

  The following must be pure and total:

  - transparent facts;
  - type-level functions;
  - proof definitions;
  - recursively generated tactic terms;
  - any computation erased as proof-only work.

  Ordinary runtime functions remain partial unless explicitly total.

  Structural recursion is allowed only over supported recursive algebraic types and only on strict subterms. Recursive algebraic types
  are therefore a prerequisite for structural proof recursion.

  `decreases` initially supports:

  - signed fixed-width integers under their declared strict order;
  - unsigned fixed-width integers under their declared strict order;
  - lexicographic products of those metrics.

  Every recursive edge in an SCC must prove:

  ```text
  next_metric < current_metric
  ```

  using wrapping machine semantics. Mutual recursion shares one lexicographic metric. Unsafe evidence cannot make a definition eligible
  for type-level reduction.

  ### Unsafe evidence

  Unsafe assumptions use an explicit unsafe context:

  ```duck
  unsafe {
    assume proposition
  }
  ```

  Definitions containing them must be declared unsafe.

  Evidence carries transitive safety metadata:

  ```text
  safe
  unsafe { origin spans }
  ```

  Safety is propagated through:

  - proof terms;
  - inferred facts;
  - refinements;
  - theorems;
  - function summaries;
  - validators;
  - imported module metadata;
  - reflection certificates.

  A safe declaration cannot depend on unsafe evidence. Calling an unsafe function requires an unsafe context.

  Unsafe evidence may not:

  - change representation or ownership;
  - fabricate a host capability;
  - escape dependent scope rules;
  - remove a runtime check or trap;
  - justify a representation-changing equality transport;
  - eliminate `False` into runtime data.

  Every host proposition is unsafe/trusted unless the compiler distribution provides a kernel-checked certificate for it.

  ## Compiler architecture

  ### Semantic result

  Successful analysis returns:

  ```ts
  type DuckSemanticProgram = {
    core: Core;
    symbols: SemanticSymbolIndex;
    types: SemanticTypeIndex;
    facts: RefinementIndex;
    proofs: KernelCertificateIndex;
    origins: SourceOriginIndex;
    function_summaries: FunctionFactIndex;
  };
  ```

  Editor analysis returns the same indexes partially even when recoverable diagnostics prevent Core construction.

  The public stages are:

  ```ts
  parse_duck_source(text): BabaParseResult
  analyze_duck_source(parsed, options): DuckAnalysis
  lower_duck_source(analysis): Checked<DuckSemanticProgram>
  ```

  `DuckAnalysis` accumulates diagnostics using the existing `Checked` discipline. New passes must not thread mutable diagnostic arrays.

  ### Canonical representation types

  Consolidate the current duplicated semantic/base type representations into one `RepresentationType` used for:

  - unification;
  - runtime layout;
  - ownership;
  - effects;
  - Core annotations;
  - ABI compatibility.

  Do not add predicates to `TypeEngine.Type`.

  The dependent semantic layer wraps a representation with:

  - term binders;
  - refinements;
  - function contracts;
  - proof types;
  - logical existentials;
  - computational existentials.

  Finite type sets are divided by representation:

  - members sharing one representation become a base representation plus a membership proposition;
  - heterogeneous members retain the existing tagged-sum representation plus possible-constructor facts.

  This preserves existing unions, intersections, differences, literal singleton types, atoms, and `is` behavior without turning the
  representation solver into a theorem prover.

  ### Stable semantic identities and CFG

  Complete the direct Baba-to-Core migration before implementing refinements:

  - Baba owns grammar, scanning, parsing, tokens, spans, and recovery.
  - Generated portable/Wasm artifacts are the only parser runtime.
  - No handwritten lexer/parser imports remain.
  - Every Baba source node receives a stable `SourceNodeId`.
  - Every binding generation receives a `ValueId`.
  - Rebinding and assignment create new `ValueId`s.
  - Control-flow joins create phi-like `ValueId`s.
  - Every semantic node records its Baba origin and source span.

  Build a typed semantic CFG, not another source-language AST. Nodes contain only semantic operations:

  - constants and primitive applications;
  - projections and constructors;
  - calls;
  - branches and matches;
  - loops and backedges;
  - ownership/effect transitions;
  - returns, breaks, continues, and traps.

  The graph exists only for semantic inference and proof checking, then lowers to Core.

  ### Proof kernel and trusted computing base

  Kernel proof terms use de Bruijn indices and explicit universe levels.

  The trusted computing base is limited to:

  - the proof kernel;
  - universe and primitive semantic definitions;
  - the reflection-certificate verifier;
  - the erasure checker;
  - refinement-to-representation validation;
  - Core lowering for computational dependent values.

  Baba parsing, tactics, abstract interpretation, function-summary inference, and normal elaboration remain outside the trusted base
  because their results are rechecked.

  Abstract domains must emit either:

  - ordinary kernel proof terms; or
  - reflection certificates checked by an independent total verifier.

  Malformed certificates are compiler invariant failures, never source diagnostics.

  ### FactGraph

  The fact engine is a reduced product of these domains:

  - possible sum/type-set constructors;
  - exact scalar values and bounded alternatives;
  - machine-integer intervals;
  - congruence and bitmask facts;
  - finite exclusions;
  - equality congruence closure;
  - affine difference constraints;
  - symbolic measures such as `length(value)`;
  - positive and negative opaque predicate atoms.

  Core operations are:

  ```ts
  meet(left, right)
  join(left, right)
  assume(environment, proposition)
  exclude(environment, proposition)
  implies(environment, goal)
  transfer(operation, operands)
  widen(previous, next)
  ```

  Every retained fact carries:

  - its canonical proposition;
  - safe/unsafe status;
  - proof term or certificate;
  - establishing source spans;
  - the `ValueId`s it references.

  `unknown` never means false. It silently loses optional precision and becomes a diagnostic only when an explicit proof obligation
  remains.

  ### Dependent elaboration limits

  Dependent checking is bidirectional:

  - synthesize a type when the term determines one;
  - check a term when an expected dependent type is available.

  Unification is first-order pattern unification only. Do not implement general higher-order unification.

  Explicit signatures are required for:

  - dependent definitions;
  - polymorphic recursion;
  - named theorem declarations;
  - recursive proof definitions;
  - existential packages whose type cannot be checked from context.

  “Infer everything possible” applies inside these declared decidability boundaries.

  ### Integer and primitive semantics

  Facts use exact Duck machine semantics:

  - values are normalized with `BigInt` to their declared width;
  - signed interpretation uses two’s-complement;
  - `I<N>` and `U<N>` wrap exactly as runtime operations do;
  - intervals and congruences propagate through arithmetic only when overflow is ruled out or a specific bitvector rule remains sound
  under wrapping;
  - possible overflow widens intervals to the full machine range and drops invalid congruences;
  - bitmask/power-of-two reasoning uses bitvector-specific rules;
  - signed remainder facts match the backend primitive exactly;
  - floating-point analysis initially retains exact literals and sound equality facts only; no real-number interval assumptions are
  allowed.

  Primitive trap conditions belong to the primitive metadata table. The proof engine reads that table rather than duplicating rules.

  Operations inside propositions or type-level computations must be total. Division, remainder, indexing, narrowing, and similar
  operations generate formation obligations for every trap condition represented by the primitive table.

  ### Control-flow inference

  For `if`:

  - the true edge calls `assume`;
  - the false edge calls `exclude`;
  - contradictory environments become unreachable;
  - unreachable paths continue name/base-type checking but do not emit cascading refinement failures.

  For `match` and `if let`:

  - each arm restricts constructor possibilities;
  - payload `ValueId`s receive constructor-specific types and facts;
  - prior arms contribute negative constructor information;
  - exhaustiveness follows from the remaining constructor set becoming empty.

  For joins:

  - only live predecessors participate;
  - constructor sets are unioned;
  - intervals take their sound hull;
  - exclusions are intersected;
  - congruence join computes the weakest shared congruence;
  - relational and opaque facts survive only with proofs from every predecessor;
  - phi values retain bounded path-conditioned equalities;
  - no fact may be introduced merely because it is convenient.

  For loops:

  - combine entry and backedge environments;
  - iterate to a fixed point;
  - widen expanding intervals to machine bounds;
  - union constructor possibilities;
  - discard unstable alternatives, congruences, and relations unless preservation is proved;
  - include every `break` environment in the loop-exit join;
  - exclude `return`, trap, and non-fallthrough branches;
  - infer range-loop bounds only after accounting for inclusive/exclusive end, step sign, and wrapping.

  Indexed updates rebuild aggregates and create new identities. Length/layout facts transfer automatically; content properties such as
  sortedness transfer only through a proved preservation theorem.

  ### Function summaries

  A summary records:

  ```ts
  type FunctionFactSummary = {
    requires: Proposition;
    ensures: Proposition;
    ensures_when_true: Proposition;
    ensures_when_false: Proposition;
    total: boolean;
    safety: ProofSafety;
    certificate: KernelCertificate;
  };
  ```

  For unannotated functions:

  1. Generate obligations from partial operations and called contracts.
  2. Discharge them from current facts where possible.
  3. Back-propagate unresolved obligations to parameters as representable weakest preconditions.
  4. Normalize multiple sufficient paths into a deterministic disjunction.
  5. Reanalyze the body under the inferred requirement.
  6. Derive the strongest representable facts common to every normal return.
  7. Project summaries to parameters, result, immutable captures, and visible constants; existentially eliminate locals.
  8. Emit a kernel-checkable certificate.

  If a weakest condition is outside the supported formula/domain budget, reject the body and request an explicit contract or proof. Never
  pick a requirement based on traversal order.

  For explicit signatures:

  - declared requirements are assumed on entry;
  - they must cover every body obligation;
  - declared guarantees are proved on every normal return;
  - no hidden stronger requirement may be added;
  - stronger inferred guarantees may be retained internally but exported interfaces use the declared abstraction.

  Recursive SCC summaries use monotone iteration and widening. Failure to stabilize is a precision-loss diagnostic, not an assumed
  contract.

  Implicit proof synthesis at ordinary calls is deliberately limited to:

  - an exact contextual proof;
  - definitional equality;
  - a FactGraph certificate.

  There is no arbitrary global theorem search. Named theorems must be applied explicitly or through a tactic block.

  Higher-order contract compatibility uses these exact rules. If actual function `A` is used where expected function `E` is required:

  - ordinary parameter, result, effect, and ownership variance must hold;
  - `E.requires implies A.requires`;
  - under `E.requires`, `A.ensures implies E.ensures`;
  - the same implication applies to true/false result facts;
  - a total expected function requires a total actual function;
  - a safe expected function rejects an unsafe actual function.

  Each implication is checked after substituting corresponding binders and must have a kernel certificate.

  ### Effects, ownership, and state

  Runtime effectful functions may have contracts. Those contracts may mention:

  - immutable arguments;
  - the result;
  - returned typestate handles;
  - explicit proof or capability inputs.

  They may not mention hidden external state. Effect operations contribute facts only through declared summaries.

  Type-level functions, facts, proofs, tactics, and certificate checkers are effect-free.

  Host state transitions use owned/linear indexed handles:

  ```text
  Connection<Unauthenticated>
  → Connection<Authenticated>
  ```

  They are not modeled as timeless propositions about a mutable external object.

  Current immutable values and shadowing simplify invalidation:

  - ordinary calls cannot mutate caller lexical values through immutable borrows;
  - consuming an owner invalidates later use of dependent facts for that identity;
  - freezing preserves structural facts;
  - a borrow may project facts while its owner and lifetime remain valid;
  - future mutable borrows must explicitly havoc reachable content facts.

  ### Safe-by-default partial operations

  The following generate proof obligations:

  - dynamic indexing and slicing;
  - integer division and remainder;
  - numeric narrowing;
  - operations whose primitive metadata declares another trap condition;
  - user APIs with `requires`.

  The backend’s existing defensive traps remain initially even after static proof. Removing them is a later optimization with separate
  equivalence tests.

  When proof is unavailable, users choose explicitly:

  - call a `Decision`/`Option` validator and branch;
  - call an unsafe low-level operation inside `unsafe`;
  - provide an explicit theorem or proof.

  The compiler never inserts runtime validation.

  ### Deterministic limits

  Centralize and document these limits:

  ```text
  maximum formula disjuncts:          16
  maximum exclusions per ValueId:     16
  maximum congruences per ValueId:     8
  maximum relational terms/function:  64
  loop growth iterations before widen: 3
  function-SCC summary iterations:     8
  compiler proof-search steps:         10,000
  compiler proof-search depth:         16
  editor proof-search steps:           2,000
  editor proof-search depth:           8
  ```

  Limits are structural, never wall-clock timeouts.

  Exhaustion produces `unknown`. Optional facts disappear silently; required goals report that the compiler could not prove them and show
  the remaining goal and hypotheses.

  ## Gated implementation sequence

  ### Gate 1: Baba semantic foundation

  - Finish the generated in-process/portable parser boundary.
  - Return real Baba tokens, CST/AST nodes, recovery intervals, diagnostics, and stable source-node IDs.
  - Route compiler and LSP parsing exclusively through Baba.
  - Establish the direct Baba semantic-lowering entry point.
  - Preserve the current legacy semantic path only as a parity oracle, not as a compiler dependency.
  - Require grammar validation with zero conflicts, state-limit failures, or lexer-overlap diagnostics.

  Exit criterion: representative source reaches unchanged Core through Baba without a handwritten parser import.

  ### Gate 2: Canonical representation types and semantic identities

  - Consolidate the duplicate base-type algebras.
  - Separate representation/layout from refinements.
  - Introduce `ValueId`, phi identities, symbol indexes, and source origins.
  - Build the typed semantic CFG for expressions, branches, matches, loops, calls, effects, and ownership transitions.
  - Reproduce existing finite type-set and `is` behavior.

  Exit criterion: every existing type-set test passes through the semantic graph and produces the same runtime Core shapes.

  ### Gate 3: Universe and proof kernel

  - Add cumulative universes, `Prop`, propositional equality, logic, and kernel term IR.
  - Implement bidirectional checking and first-order pattern unification.
  - Implement proof irrelevance, transparent normalization, module opacity, and safety metadata.
  - Add direct ordinary proof terms without tactic blocks.
  - Add adversarial negative kernel tests.

  Exit criterion: the kernel accepts valid proof terms and rejects universe escapes, forged equality, invalid eliminations, and non-total
  transparent definitions.

  ### Gate 4: Erasure and dependent values

  - Add `Proof P`, refinement types, logical `exists`, computational `some`, `Decision`, pack/open, and erased proof parameters.
  - Implement the erasure checker and uniform-layout validation.
  - Lower refinements to their base representation.
  - Lower `Decision` to a runtime tag.
  - Lower computational witnesses to ordinary Core products/sums.
  - Rename the existing unrelated prelude `Decision` to `Outcome`.

  Exit criterion: source → Baba → proof check → erased Core produces the same ABI and Wasm values as equivalent proof-free code.

  ### Gate 5: Prefix signatures and contracts

  - Extend `grammar.baba` with lowercase `type` signatures, named dependent binders, contract clauses, proposition syntax, proof terms,
  fact definitions, and unsafe contexts.
  - Regenerate every parser/scanner artifact from Baba.
  - Implement signature-definition association and diagnostics.
  - Check explicit `requires`, `ensures`, totality, and unsafe propagation.
  - Serialize exported signatures and kernel certificates.
  - Migrate named callable annotations across the prelude, examples, tests, formatter, and LSP.

  Exit criterion: explicit contracts work end to end and no accepted syntax has placeholder semantics.

  ### Gate 6: Path-sensitive FactGraph

  - Implement each abstract domain and its certificate producer.
  - Implement meet, join, assume, exclude, implication, transfer, and widening.
  - Analyze conditions, patterns, short-circuit control flow, loops, returns, breaks, assignments, indexed rebuilds, and traps.
  - Add safe-by-default obligations to primitive and indexing metadata.

  Exit criterion: local refinements prove representative bounds, constructor, range, and divisibility obligations with exact source
  provenance.

  ### Gate 7: Interprocedural inference

  - Infer weakest representable requirements.
  - Infer return, true-result, and false-result guarantees.
  - Instantiate summaries at calls.
  - Implement higher-order contract subtyping.
  - Implement recursive SCC fixed points and widening.
  - Export inferred summaries with certificates.

  Exit criterion: unannotated helper functions preserve and transform facts across calls without proof syntax at call sites.

  ### Gate 8: User predicates and proof-preserving APIs

  - Add transparent and opaque facts.
  - Add `Decision` validators and Boolean result contracts.
  - Add refined-container element types and zero-cost weakening.
  - Provide prelude validators for nonzero divisors, bounds, narrowing, and common finite-set checks.
  - Add non-empty, typestate, and modular-arithmetic case studies over currently supported runtime representations.

  Exit criterion: facts can be introduced dynamically, preserved by APIs, stored in supported containers, and consumed without repeated
  validation.

  ### Gate 9: Recursive data and totality

  - Implement safe recursive algebraic layouts and ownership first.
  - Add inductive recursors.
  - Implement structural recursion checks.
  - Implement `decreases` for machine integers and lexicographic products.
  - Check mutual-recursion descent on every SCC edge.

  Exit criterion: recursive proof functions cannot bypass termination, and recursive runtime ownership remains sound.

  ### Gate 10: Tactic elaboration

  - Add `by { ... }`.
  - Implement the fixed tactic set.
  - Add proof-by-reflection certificate generation for `omega`.
  - Add induction after recursive recursors are available.
  - Enforce deterministic budgets and unresolved-goal diagnostics.

  Exit criterion: every tactic result is reproducible as a kernel term and independently rechecked.

  ### Gate 11: Computational dependent and generative packages

  - Generalize `some` packages to relational and generative witnesses.
  - Preserve runtime witnesses only when computationally required.
  - Reject non-uniform layouts before Core.
  - Integrate lifetimes and identity-scoped facts.
  - Integrate dynamic-length arrays only after the runtime-collection representation exists.

  Exit criterion: an existential package can safely hide an index while preserving usable relationships after opening.

  ### Gate 12: Tooling and legacy removal

  - Make semantic IDs the only LSP symbol identity.
  - Move hover, completion, navigation, semantic tokens, and diagnostics to Baba spans and semantic indexes.
  - Delete the legacy `source_facts.ts`, `type_set_elaborate.ts`, normalized frontend AST, and handwritten parser paths after parity.
  - Keep `src/core/ast.ts` as the proof-erased semantic runtime boundary.

  Exit criterion: no compiler or tooling import depends on the handwritten parser or legacy AST-only fact passes.

  ## Diagnostics and tooling

  Add a dedicated proof/refinement diagnostic category with stable codes for:

  - duplicate, orphaned, or mismatched signatures;
  - malformed dependent types;
  - unproved obligations;
  - definitely false obligations;
  - invalid proof terms;
  - invalid contract guarantees;
  - non-total proof computation;
  - failed `decreases`;
  - unsafe proof use outside unsafe context;
  - non-uniform dependent layout;
  - proof-search budget exhaustion;
  - malformed imported certificates.

  Diagnostics distinguish:

  ```text
  disproved: the current facts imply the requirement is false
  unknown:   the compiler cannot establish the requirement
  invariant: the compiler produced or accepted an invalid certificate
  ```

  Every proof diagnostic includes:

  - the exact obligation span;
  - the normalized goal;
  - relevant hypotheses;
  - related spans where evidence was introduced;
  - the signature or operation that required the proof;
  - unsafe provenance where applicable.

  Tooling behavior:

  - Hover leads with the ordinary source type.
  - It adds a collapsed `Known here:` section only when facts are useful.
  - Unsafe facts are labeled with their origin.
  - Proof and refinement inlays are a separate category, disabled by default.
  - Completion removes impossible sum constructors and uses refined receiver types.
  - Navigation from a predicate or theorem reaches its definition.
  - Signature help displays `requires` and `ensures` but does not count implicit proofs as runtime arguments.
  - Code actions can insert an inferred prefix signature, create a `by` skeleton for an unresolved goal, or introduce a standard
  validator match.
  - Parse-recovery regions yield unknown facts without poisoning unaffected nodes.

  ## Verification plan

  ### Kernel and language soundness

  Test:

  - `Type : Type` rejection and universe escape attempts;
  - cumulative universe acceptance;
  - forged equality;
  - invalid equality transport;
  - proof-dependent runtime branching;
  - `False` elimination into runtime data;
  - erased logical witness misuse;
  - non-uniform computational packages;
  - refinement attempts that duplicate unique owners;
  - nonterminating transparent definitions;
  - opaque predicate unfolding across modules;
  - unsafe proof laundering through lemmas, summaries, refinements, imports, and validators;
  - malformed certificates;
  - unsolved holes and tactic-budget exhaustion.

  ### Abstract domains

  Use exhaustive small-width tests for `I3`, `U3`, and other tiny integers:

  1. Enumerate every concrete operand.
  2. Run the concrete machine operation.
  3. Run the abstract transfer.
  4. Assert every concrete result belongs to the abstract result.
  5. Assert every emitted proof certificate is kernel-valid.

  Cover:

  - signed and unsigned limits;
  - wraparound;
  - negative remainder behavior;
  - division trap cases from primitive metadata;
  - interval intersections and hulls;
  - congruence meet/join;
  - bitmask facts;
  - exclusions;
  - affine relations;
  - contradiction detection;
  - widening monotonicity.

  Property-test lattice laws:

  - normalization;
  - idempotence;
  - commutativity;
  - associativity where required;
  - meet/join monotonicity;
  - top/bottom behavior;
  - widening never invents a fact.

  ### Control flow and summaries

  Cover:

  - true and false comparisons;
  - modulo branches;
  - nested short-circuit conditions;
  - literal and constructor elimination;
  - negative information;
  - branch joins;
  - early return and trap;
  - break and continue;
  - rebinding and type-changing shadowing;
  - indexed rebuilds;
  - range loops with positive and negative steps;
  - loops that stabilize and loops that widen;
  - recursive summary SCCs;
  - higher-order contracts;
  - inferred weakest preconditions;
  - inferred postconditions;
  - traversal-order independence.

  ### User facts and APIs

  Cover:

  - transparent unfolding;
  - opaque module boundaries;
  - explicit theorems;
  - Decision-based validators;
  - Bool true/false result contracts;
  - non-empty values;
  - multiples and modular transformations;
  - safe indexing;
  - nonzero division;
  - typestate transitions;
  - refined container insertion/retrieval;
  - weakening and attempted unsound strengthening;
  - computational existential pack/open.

  ### End-to-end behavior

  For each major feature, test:

  ```text
  source
  → Baba
  → semantic CFG
  → inferred facts
  → kernel certificate
  → erased Core
  → gpufuck
  → Wasm
  ```

  Assert:

  - proofs add no ABI parameters or fields;
  - refinement wrappers keep the base layout;
  - `Decision` keeps only its runtime tag;
  - computational `some` retains its witness;
  - safe and proof-free equivalents produce matching runtime results;
  - defensive traps remain until separately optimized;
  - existing gpufuck tests remain unchanged where behavior is preserved.

  ### Grammar and editor behavior

  Require:

  - Baba grammar parse success;
  - Tree-sitter generation success;
  - portable/Wasm validation without conflicts, overlap diagnostics, or state-limit failures;
  - formatter round trips for signatures, contracts, propositions, refinements, facts, unsafe blocks, packages, proof terms, and tactics;
  - exact Baba spans for every proof goal and related diagnostic;
  - LSP recovery on incomplete signatures and tactic blocks;
  - navigation between signatures and definitions;
  - narrowed completion and hover tests.

  ### Performance

  Keep the existing warm analysis budget for proof-free code:

  ```text
  largest existing example: under 100 ms
  ```

  Add a representative proof-heavy fixture:

  ```text
  nested branches, two loops, contracts, and tactics: under 200 ms warm
  ```

  Performance tests verify structural budgets, cache reuse, and incremental reanalysis. They must not depend on wall-clock proof-search
  cancellation.

  ## Assumptions and boundaries

  - This is a multi-PR language program, not one reviewable patch.
  - The full proof feature is not declared complete until the tactic, totality, tooling, and erasure gates pass.
  - Mathematical unbounded integers are not introduced.
  - Floating-point theorem automation remains intentionally limited.
  - No SMT dependency is added.
  - No implicit runtime validation is permitted.
  - Recursive algebraic types and runtime collections remain prerequisites for proof examples that require their layouts.
  - Proof facts initially validate programs and improve tooling; they do not remove backend traps or introduce a second optimizer.
  - Existing runtime behavior is preserved only where it remains sound under the new safe-by-default obligations.
  - Core remains the stable proof-erased boundary consumed by gpufuck.
