# LSP workspace configuration

The Ix language server accepts the same keys in `initializationOptions` and in
`workspace/didChangeConfiguration` under `settings.ix`. Dynamic settings may
also be sent at the top level of `settings`; `settings.ix` takes precedence for
keys present in both places.

```json
{
  "diagnosticsDepth": 64,
  "maxReanalysisFanout": 128,
  "formattingOnBrokenBuffer": false,
  "inlayHints": {
    "types": true,
    "effects": true,
    "ownership": false,
    "comptime": true,
    "loops": false
  }
}
```

- `diagnosticsDepth` is a non-negative integer limiting reverse-import graph
  traversal after an edit.
- `maxReanalysisFanout` is a positive integer limiting how many dependent
  modules a single edit can invalidate.
- `formattingOnBrokenBuffer` permits syntax-preserving recovery formatting on a
  buffer with parse diagnostics. It is disabled by default.
- Every inlay category is independently boolean. Unknown or wrongly typed
  settings are ignored; omitted settings retain their previous value.

Workspace folders are indexed at initialization. When the supplied folder is an
interior directory without Ix files, the server walks upward to the nearest
`AGENTS.md` or `.git` marker. Open editor buffers are overlays over disk files.
Clients that supply an initialization `workDoneToken` receive `$/progress`
begin/report/end notifications while files are indexed.

The CI performance gate is `deno task lsp:perf`. It records cold workspace
initialization, edit-to-diagnostics, completion latency, syntax-token count,
analysis computation/byte counters, and heap growth over the largest success
example. Exceeding a checked-in latency or heap budget fails the command.
