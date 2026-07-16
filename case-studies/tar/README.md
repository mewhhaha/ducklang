# Tar Case Study

This directory contains a Ducklang inspector for a bounded POSIX ustar archive.
The program receives one owned `Bytes` archive from the host, walks its 512-byte
headers, validates the POSIX checksum, parses octal sizes, classifies type
flags, skips the padded payload blocks, and requires the two zero-block end
marker.

The result is a deterministic summary with entry, regular-file, directory, and
other-entry counts; the sum of declared entry sizes; and a NUL-delimited ledger
of raw header path bytes. Prefix and name fields are joined with `/` in Duck.
Paths remain `Bytes`: Duck has no explicit UTF-8 byte-decoding API yet, so the
host deliberately does not decode or reinterpret archive names. Consumers that
know their archive paths are UTF-8 may decode the returned bytes at their own
boundary.

Malformed data returns a typed error with an archive byte offset. The covered
failures are truncated headers and payload blocks, invalid checksums, malformed
or out-of-range octal sizes, missing end markers, and overflowing total size.
Because Duck byte arithmetic is currently `I32`, this case study intentionally
rejects individual sizes and totals above `2_147_483_647` instead of silently
wrapping. GNU base-256 numeric fields, sparse files, PAX records, long-name
extensions, links, permissions, timestamps, and extraction are out of scope.

## Run

Inspect an archive:

```sh
deno run --allow-read --allow-run=wat2wasm \
  case-studies/tar/tar.ts archive.tar
```

Run the independently constructed archive-fixture tests:

```sh
deno test --no-check --allow-read --allow-run \
  case-studies/tar/tar.test.ts
```

## Boundary

`host.duck` exposes exactly one `Archive.read: () => Bytes` capability. The live
TypeScript adapter reads the selected file before evaluation; the mock adapter
returns a fresh copy for every read. Neither adapter parses headers, validates
checksums, steps blocks, nor decodes names. Those are all Duck responsibilities.
