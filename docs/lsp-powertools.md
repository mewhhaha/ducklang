# LSP powertools

The powertools are optional LSP extensions. Clients can call them directly or
expose the supplied commands as editor actions. Each response is either
`{ ok: true, value }` or `{ ok: false, code, message }`; broken source and a
route that cannot provide a requested stage are normal structured failures.

`duck/expandComptime` takes `{ textDocument: { uri }, position }` for an open
document. It returns rendered Duck source for the folded value or specialized
closure and a list of captured compile-time facts.

`duck.expandComptime` and `duck.runExample` are the corresponding workspace
commands. The run command only returns a Deno test invocation for the client
terminal; the language server does not execute it.

For Helix, bind a key to a workspace command, for example:

```toml
[keys.normal]
space-e = ":lsp-workspace-command duck.expandComptime"
space-r = ":lsp-workspace-command duck.runExample"
```

Helix currently leaves command arguments to the client integration, so an
adapter should attach the active document URI, buffer text, and position for
expansion.
