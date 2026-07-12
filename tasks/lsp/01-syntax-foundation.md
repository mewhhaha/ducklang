# Syntax Foundation: Spans, Trivia, And Error Recovery

## Goal

Give every AST node a source span, keep trivia recoverable, and make the parser
produce a usable tree plus multiple diagnostics for broken buffers. This is the
substrate every other language-server feature stands on; rust-analyzer's
equivalent is its lossless, error-resilient syntax tree.

## Work

- Attach `{ start, end }` token spans to `FrontExpr`, `Stmt`, `Declaration`, and
  pattern nodes. Prefer a side table keyed by node identity if inline fields
  would disturb existing structural equality checks.
- Preserve trivia: the tokenizer already positions comments behind the
  `comments` option; expose a shared "token stream with trivia" view so the
  formatter, symbols, and future doc-comment attachment read one source of
  truth.
- Add statement-boundary error recovery to the parser: on failure inside a
  statement, record the diagnostic, skip to the next statement start or matching
  close brace, and continue parsing.
- Collect multiple parse diagnostics per document instead of throwing on the
  first. Keep the throwing API for the compiler pipeline; add a
  `parse_with_diagnostics` entry that never throws.
- Replace string-matching on `Error.message` positions (`at line:column`) with
  structured diagnostic values carrying spans.

## Acceptance Criteria

- Every node reachable from `Source.parse` output has a resolvable span.
- A buffer with three independent statement-level errors reports three
  diagnostics, and symbols/navigation still work for the valid statements.
- The compiler pipeline behavior and all existing tests are unchanged.

## Verification

- Span round-trip test: for each example in `examples/`, walking the tree and
  slicing spans out of the source reproduces each node's formatted text modulo
  whitespace.
- Recovery fixtures with deliberate errors at top level, inside blocks, and
  inside aggregates.

## Implementation Status

Implemented.

- The lossless scanner records trivia, invalid pieces, raw token text, and
  half-open UTF-16 offsets. Strict and tolerant parsing share that syntax.
- Parser side tables give every reachable AST object a concrete or derived span
  without changing structural AST equality. Source-written aggregate,
  declaration, effect, handler, and parenthesized children retain exact slices.
- Tolerant parsing records ordered scanner/parser diagnostics and recovers at
  top-level, block, delimiter, and aggregate boundaries while the strict API
  remains fail-fast.
- LSP diagnostics and symbols consume structured offsets through the shared
  `PositionIndex`; no error-message position parsing remains.

Verified by the syntax/parser/LSP suites, an all-example span-containment and
strict/tolerant compatibility sweep, malformed-buffer recovery probes, and an
independent final review with no remaining findings.
