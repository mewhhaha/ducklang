# Navigation And Rename

## Goal

The bread-and-butter requests: goto definition, find references, document
highlights, workspace symbols, and safe rename, all backed by the task 4 index.

## Work

- `textDocument/definition`: name occurrences jump to their binding generation;
  member access jumps to the field/case/operation declaration; `import` names
  jump to the imported file (single-file fallback until task 12 lands cross-file
  resolution).
- `textDocument/typeDefinition`: a value with a known type fact jumps to the
  `type` declaration or type-value binding that produced it.
- `textDocument/references` with `includeDeclaration` support.
- `textDocument/documentHighlight`: occurrences of the symbol under the cursor,
  distinguishing read, write (shadowing assignment), and consume (linear use)
  highlight kinds.
- `workspace/symbol`: fuzzy query over all indexed declarations in open and
  workspace documents.
- `textDocument/prepareRename` + `rename`: reject rename of keywords, builtins,
  and unresolved names; apply edits to exactly the occurrences of the selected
  entity generation; renaming across a shadowing boundary must not capture the
  other generation. Rename of a struct field updates construction sites,
  patterns, and member accesses that resolve to it.
- Upgrade `documentSymbol` from the flat token scrape to the spanned AST: nested
  symbols (effect operations under the effect, fields under the type) with
  accurate ranges.

## Acceptance Criteria

- Rename fixtures covering shadowing generations, const-capture snapshots,
  fields, union cases, and effect operations produce exactly the expected edit
  sets.
- Goto/references work in buffers with parse errors elsewhere in the file.
- Document symbols show the same tree in a broken buffer as in its last valid
  parse for untouched regions.

## Verification

- Caret-marker fixtures for definition/references/highlights.
- Rename applied to fixtures must reparse and re-resolve to an isomorphic index
  (alpha-equivalence check).

## Implementation Status

Implemented.

The server now advertises and serves definition, type-definition, references,
document highlights, workspace symbols, prepare-rename, and rename requests from
the versioned binding index. Definitions preserve shadow generations and member
ownership; import aliases fall back to the imported file; nominal facts drive
type-definition; references honor `includeDeclaration`; and highlights
distinguish declarations/shadows, reads, and linear consumes.

Rename rejects unresolved selections, builtins, keywords, invalid casing, owner
member collisions, lexical capture, and same-scope conflicts. Edits include only
the selected entity generation, including resolved construction, pattern, case,
handler, and member sites. Workspace-symbol fuzzy matching covers open documents
and closed `.ix` files under initialized workspace roots.

Document symbols now come from the tolerant spanned AST, retain source order,
and nest effect operations, type parameters, fields, and union cases beneath
their owners with full and selection ranges. Verification covers navigation in a
buffer with unrelated recovery, shadow and const-capture rename boundaries,
field/case/effect-operation edit sets, applied-edit reparsing and binding-graph
isomorphism, UTF position encoding, closed workspace files, and stable nested
symbols around broken syntax.
