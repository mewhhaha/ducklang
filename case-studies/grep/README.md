# Grep Case Study

This directory grows a ripgrep-shaped command-line program in Ix. The current
vertical slice establishes the synchronous, mockable host boundary and proves
that arbitrary byte chunks can travel from a file, through Wasm, and back to the
host without UTF-8 decoding.

It is not a ripgrep replacement yet. Regex matching, line buffering across
chunks, ignore files, traversal policy, binary detection, and output formatting
remain Ix-side work for later slices.

## Run

Compile the Ix module, read the first 64 KiB of a file, and copy that chunk to
stdout:

```sh
deno run --allow-read --allow-run=wat2wasm \
  case-studies/grep/grep.ts case-studies/grep/fixtures/input.txt
```

Run its contract tests:

```sh
deno test --no-check --allow-read --allow-run \
  case-studies/grep/grep.test.ts
```

## Boundary

`host.ix` declares six capabilities:

- `Process` provides indexed raw argv and the current directory.
- `Walk` provides an unfiltered depth-first cursor with explicit enter/leave
  events and pruning. Ix will own hidden-file, glob, and ignore policy.
- `FileReader` owns one synchronous stream per runner.
- `Stdin`, `Stdout`, and `Stderr` exchange byte chunks and terminal facts.

Expected I/O failures are typed union values. ABI violations and invalid host
state are exceptions. Paths are UTF-8 `Text` in this Deno-first slice. File and
stream payloads are owned `Bytes`; output calls receive bounded borrows.

The live and mock implementations are selected by the TypeScript runner. The Ix
module receives only the capability objects supplied through `Init`.
