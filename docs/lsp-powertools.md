# LSP powertools

The powertools are optional LSP extensions. Clients can call them directly or
expose the supplied commands as editor actions. Each response is either
`{ ok: true, value }` or `{ ok: false, code, message }`; broken source and a
route that cannot provide a requested stage are normal structured failures.

`duck/expandComptime` takes `{ textDocument: { uri }, position }` for an open
document. It returns rendered Duck source for the folded value or specialized
closure and a list of captured compile-time facts. `duck/viewStage` takes
`{ textDocument: { uri }, stage }`, where the stage is one of `ic`, `expr`,
`mod`, or `wat`. Example paths select their route from `examples/manifest.ts`;
other files use the IC route. Core and managed routes do not expose IC or Expr,
so those requests return `unsupported_route`.

`duck.viewStage`, `duck.expandComptime`, and `duck.runExample` are the
corresponding workspace commands. The run command only returns a Deno test
invocation for the client terminal; the language server does not execute it.

For Helix, bind a key to a workspace command, for example:

```toml
[keys.normal]
space-w = ":lsp-workspace-command duck.viewStage"
space-e = ":lsp-workspace-command duck.expandComptime"
space-r = ":lsp-workspace-command duck.runExample"
```

Helix currently leaves command arguments to the client integration, so an
adapter should attach the active document URI, buffer text, position for expand,
and `wat` for the stage command.
