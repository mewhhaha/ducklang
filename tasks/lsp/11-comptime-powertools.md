# Comptime And Pipeline Powertools

## Goal

Ix's equivalents of rust-analyzer's Expand Macro and View HIR/MIR: make the
compile-time machinery and the lowering pipeline inspectable from the editor.
The project's ethos is explicit, inspectable stages — surface them.

## Work

- Custom request `ix/expandComptime`: for a `comptime` expression, const call,
  or const-parameter call site at a position, return the folded value or
  specialized closure rendered as Ix source, plus the evaluation trace of
  `fail`-checked facts. Reuses the frontend evaluator, no new semantics.
- Custom request `ix/viewStage` with `stage: "ic" | "expr" | "mod" | "wat"`:
  compile the current buffer through the demo pipeline routes and return the
  rendered stage dump for a side-buffer. Route selection follows the document's
  manifest route when the file is an example, else the pure Ic route with
  graceful rejection messages.
- Code lens: `▸ compile to WAT` on the module header and `▸ expand` on
  `comptime` expressions, wired to the custom requests through
  `workspace/executeCommand`.
- Runnables: code lens `▸ run example` on files listed in
  `examples/manifest.ts`, returning the `just`/`deno` invocation for the client
  terminal rather than executing inside the server.
- Document the custom protocol extensions in `docs/` so non-Helix clients can
  adopt them; keep all of them optional capabilities.
- Helix integration notes: key bindings invoking the commands via
  `:lsp-workspace-command`.

## Acceptance Criteria

- Expanding `comptime make_adder(3)` returns the specialized closure source with
  captured `n = 3`.
- `ix/viewStage` on a scalar example returns the same WAT the CLI pipeline
  writes for that route.
- All powertools respond with structured errors (not crashes) on broken or
  route-unsupported buffers.

## Verification

- Request/response fixtures over compile-time examples; stage dumps compared
  against `Source.*` outputs in tests.

## Implementation Status

Implemented.

- Added structured `ix/expandComptime` and `ix/viewStage` requests, optional
  code lenses, and `workspace/executeCommand` routing for view, expand, and run
  commands.
- Expansion validates through the frontend evaluator, renders the hover-aligned
  editor value, reports capture/result trace steps, records successful fact
  checks, and returns structured failures for active `fail` calls and invalid
  positions.
- Stage views follow success, failure, and trap manifest routes, with the pure
  Ic route for other files. Runnables return a terminal invocation without
  executing it in the server.
- Added direct and server request fixtures, CLI-output comparisons, protocol
  documentation, and Helix command notes in `docs/lsp-powertools.md`.
