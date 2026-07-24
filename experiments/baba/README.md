# Baba compatibility probe

This experiment verifies that Baba can generate a portable Wasm lexer and parser
for the contextual application tokens currently implemented by
`tree-sitter-duck/src/scanner.c`:

- horizontal whitespace for value application;
- horizontal whitespace for condition application;
- horizontal whitespace for type application;

Run the executable probe with:

```sh
deno task baba:test
```

Baba 6.1 generates both the portable Wasm parser and a Tree-sitter `grammar.js`.
The compatibility grammar expresses contextual whitespace through parser state
so both targets share one source grammar. Duck's Tree-sitter target still uses
three external whitespace tokens because Baba's generated token regexes cannot
inspect the following token before deciding whether whitespace starts an
application. Statement and extension boundaries are ordinary `;` and `,` grammar
tokens and no longer require scanner support.

Generate both targets with:

```sh
deno task baba:generate
```

Validate the generated `grammar.js` with Tree-sitter itself:

```sh
deno task baba:tree-sitter
```

This probe covers the contextual scanner behavior that previously blocked a full
Duck grammar migration. The complete language grammar now lives in
`tree-sitter-duck/grammar.baba`; `tree-sitter-duck/grammar.js` is generated from
it.
