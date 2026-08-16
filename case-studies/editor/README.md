# Terminal editor

This case study keeps editor state, editing, selection movement, rendering, and
terminal policy in Duck. The gpufuck target compiles the program to Wasm, while
Deno is a thin synchronous boundary for terminal and file I/O: it enters the
alternate screen, enables raw input, supplies typed terminal capabilities, and
restores the terminal in `finally` blocks.

The document implementation lives in [`piece_tree.duck`](./piece_tree.duck).
Every original or inserted run is an immutable backing buffer; tree leaves are
spans containing a buffer identity, start, and length. Inserts and deletes split
and join spans without slicing their backing bytes, while branches cache byte
counts and height. Materialization walks spans in order without exposing tree
internals to the editor.

Selections follow the Helix model: every normal-mode cursor is an inclusive
selection, `v` toggles an anchored extension, and edits operate on the selected
range. This proof of concept carries a single selection; multi-selection stays a
source-level extension rather than another host concern.

Editing modes and save status are source-defined sum types. Normal and insert
modes carry one cursor, while extend mode alone carries an anchored selection.
Key reduction returns an explicit continue-or-quit result and an ordered,
source-defined save sequence. Each save retains the persistent document root
from its exact input position, and quit stops the rest of that input batch. A
source-defined bounded decoder retains incomplete CSI control sequences across
reads while treating a lone Escape at a read boundary as an immediate key.
Rendering walks visible piece-tree bytes directly into a pure bounded output
builder instead of materializing the complete document.

Save sequences still use a monomorphic recursive union. Moving them to the
prelude's generic `List` remains blocked on a gpufuck compilation failure when
the iterator and nominal editor model are linked; `TASKS.md` records the
reproduction boundary.

Run it with:

```sh
deno run -A case-studies/editor/editor.ts path/to/file
```

Normal mode supports `h`/`l` or left/right arrows, `v`, `d`, `c`, `i`, `a`, `w`,
and `q`. Insert mode accepts terminal bytes, backspace, Enter, Tab, and Escape.

This proof of concept moves by UTF-8 code points. It does not yet segment
extended grapheme clusters or calculate terminal display width, so combining
sequences and wide glyphs are not full cursor cells yet. Insert-mode input is
currently applied byte by byte; restoring run batching is tracked alongside the
target-compiler blocker. A production editor would apply edit commands to every
selection without changing the piece-tree or host boundaries.
