# Document Store And Incremental Sync

## Goal

Make the server's view of open documents correct, incremental, and cheap. The v1
server stores full text and requires full-document didChange.

## Work

- Implement incremental `textDocument/didChange` (textDocumentSync kind 2):
  apply range edits to the stored buffer; fall back to full sync when the client
  sends full content.
- Handle position encodings correctly: negotiate `positionEncoding` in the
  initialize handshake (utf-16 default, offer utf-8), and convert spans through
  one shared module used by every feature. Ix source is UTF-8 bytes; LSP
  defaults to UTF-16 code units. This is a classic drift source — keep the
  conversion in exactly one place with property tests over multibyte text.
- Track document versions; stamp published diagnostics with the version they
  were computed for and drop stale results.
- Cache the parse (tree + diagnostics + token stream) per document version so
  repeated feature requests against one buffer state parse once.
- Support `didSave`/`willSave` and `workspace/didChangeWatchedFiles` so on-disk
  edits from outside the editor invalidate caches.

## Acceptance Criteria

- Typing at the top of a large file sends range edits and the server's buffer
  matches the editor byte-for-byte (fixture-verified).
- Multibyte content (emoji, CJK) round-trips positions correctly in both
  encodings.
- Two feature requests against the same version parse the document once
  (observable via an internal counter in tests).

## Verification

- Property test: random edit scripts applied through the incremental path equal
  full-text replacement.
- Encoding tests with mixed-width lines asserting exact `line:character` values.

## Implementation Status

Implemented.

- `DocumentStore` applies ordered incremental edits, accepts full-text fallback
  updates, enforces increasing signed 32-bit versions, and caches analysis
  artifacts by document version.
- One shared position module handles UTF-16 and UTF-8 negotiation/conversion,
  LF/CRLF/lone-CR lines, surrogate boundaries, and range lengths.
- Open/change/save/close and watched-file notifications invalidate the right
  caches; published diagnostics carry the analyzed version and stale work is
  discarded.
- Formatting, symbols, and diagnostics reuse the same per-version parse
  artifact.

Verified by randomized ASCII/Unicode edit scripts, mixed-width exact-position
tests, a 10,000-line top-edit regression, parse-count assertions, focused LSP
tests, and an independent final review with no remaining findings.
