# Completion

## Goal

Context-aware completion competitive with rust-analyzer's: scope names, members,
effect operations, union cases, keywords, and import paths, with useful detail
text and sorted relevance.

## Work

- Scope completion: visible bindings at the cursor position from the task 4
  index, annotated with their kind (const, runtime, linear `!name`, type,
  effect) and type fact where known.
- Member completion after `.`: struct fields, union case constructors, and
  effect operations when the receiver's type fact is statically known; degrade
  to nothing (not noise) when unknown. Include `.case` completion in shorthand
  union positions with declared-context payload types.
- Keyword completion filtered by position (statement start vs expression vs type
  position vs handler body), including snippet-style insertions for `if let`,
  `for ... in`, `effect { }`, `type =` alternatives, and `module () where`.
- Import path completion inside `import ... from "..."` string literals, listing
  sibling `.ix` files.
- Completion resolve (`completionItem/resolve`) supplying documentation from
  attached doc comments (task 1 trivia) and layout facts for type items.
- Sort text: locals before outer scopes before keywords; exact-prefix before
  fuzzy matches. No wall-clock, frequency, or history inputs — deterministic
  ordering only.
- Trigger characters: `.`, `"`, and identifier characters; support
  incomplete-list refinement.

## Acceptance Criteria

- Completing after `user.` on a value with a known struct fact lists exactly the
  declared fields with their types.
- Completing after `Io.` inside a module with `declare effect Io` lists the
  declared operations with parameter signatures.
- Completion inside a broken statement still offers scope names from the
  recovered tree.

## Verification

- Fixture-driven completion tests asserting full item lists (label, kind,
  detail, sortText) at caret positions.

## Implementation Status

Implemented.

The server advertises completion with deterministic incomplete-list refinement,
resolve support, and `.`, `"`, `_`, and identifier trigger characters. Scope
items come from lexical index visibility and include const/runtime/linear, type,
effect, nominal, and inferred type detail. Sort keys rank inner scopes before
outer scopes, symbols before keywords, and prefix matches before fuzzy
subsequence matches.

Member completion resolves declared struct fields, union cases, and effect
operations through nominal facts and owner-member maps, emits exact declared
payload/signature details, supports annotated shorthand `.case` contexts, and
returns no noise for unknown receivers. Handler bodies offer operation and
return-clause snippets; statement, expression, and type contexts receive
filtered keywords and snippets; import strings list deterministic sibling `.ix`
paths from disk and open documents.

Completion resolve attaches contiguous `///` documentation and computable
aggregate layout facts. Verification asserts complete item shapes for typed
fields, effect operations, shorthand cases, recovered broken statements, scope
ordering, handler snippets, type filtering, unknown members, import paths,
resolved documentation/layout, linear insertion, server routing, and capability
advertisement.
