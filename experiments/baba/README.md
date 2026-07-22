# Baba compatibility probe

This experiment verifies that Baba can generate a portable Wasm lexer and parser
for the contextual tokens currently implemented by
`tree-sitter-duck/src/scanner.c`:

- horizontal whitespace for value application;
- horizontal whitespace for type application;
- whitespace separating `break` from a value;
- trailing whitespace after a valueless `break`;
- newlines terminating extension members.

Run the executable probe with:

```sh
deno task baba:test
```

Baba 6.1 generates both the portable Wasm parser and a Tree-sitter `grammar.js`.
The compatibility grammar expresses contextual whitespace through parser state
so both targets share one source grammar.

Generate both targets with:

```sh
deno task baba:generate
```

Validate the generated `grammar.js` with Tree-sitter itself:

```sh
deno task baba:tree-sitter
```

This probe covers the contextual scanner behavior that previously blocked a full
Duck grammar migration. `tree-sitter-duck/grammar.js` remains authoritative
until the complete language grammar has been ported into Baba.
