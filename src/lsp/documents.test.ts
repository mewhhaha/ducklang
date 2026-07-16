import { assert_equals, assert_throws } from "../assert.ts";
import {
  encoded_length,
  type LspPosition,
  offset_from_position,
  offsets_from_range,
  position_from_offset,
} from "./position.ts";
import { DocumentStore } from "./documents.ts";

Deno.test("positions round-trip mixed-width lines in both encodings", () => {
  const text = "A😀中\r\nβ\nlast";
  const cases: Array<["utf-16" | "utf-8", LspPosition, number]> = [
    ["utf-16", { line: 0, character: 1 }, 1],
    ["utf-16", { line: 0, character: 3 }, 3],
    ["utf-16", { line: 0, character: 4 }, 4],
    ["utf-8", { line: 0, character: 1 }, 1],
    ["utf-8", { line: 0, character: 5 }, 3],
    ["utf-8", { line: 0, character: 8 }, 4],
    ["utf-8", { line: 1, character: 2 }, 7],
  ];

  for (const [encoding, position, offset] of cases) {
    assert_equals(offset_from_position(text, position, encoding), offset);
    assert_equals(position_from_offset(text, offset, encoding), position);
  }
});

Deno.test("positions exclude LF, CRLF, and CR line terminators", () => {
  const cases: Array<[string, number, LspPosition, number]> = [
    ["ab\ncd", 2, { line: 0, character: 2 }, 3],
    ["ab\r\ncd", 2, { line: 0, character: 2 }, 4],
    ["ab\rcd", 2, { line: 0, character: 2 }, 3],
  ];

  for (const [text, content_end, position, next_start] of cases) {
    assert_equals(position_from_offset(text, content_end, "utf-16"), position);
    assert_equals(offset_from_position(text, position, "utf-16"), content_end);
    assert_equals(
      position_from_offset(text, next_start, "utf-16"),
      { line: 1, character: 0 },
    );
  }

  assert_throws(
    () => position_from_offset("ab\r\ncd", 3, "utf-16"),
    "inside a CRLF",
  );
  assert_throws(
    () => offset_from_position("ab\r\ncd", { line: 0, character: 3 }, "utf-16"),
    "outside the line",
  );
});

Deno.test("positions reject scalar splits and invalid ranges", () => {
  const text = "😀\n";
  assert_throws(
    () => offset_from_position(text, { line: 0, character: 1 }, "utf-16"),
    "outside the line",
  );
  assert_throws(
    () => position_from_offset(text, 1, "utf-8"),
    "splits a surrogate pair",
  );
  assert_throws(
    () =>
      offsets_from_range(text, {
        start: { line: 1, character: 0 },
        end: { line: 0, character: 0 },
      }, "utf-16"),
    "precedes",
  );
});

Deno.test("incremental changes apply in order with UTF-8 range lengths", () => {
  const documents = new DocumentStore("utf-8");
  documents.open("file:///demo.duck", 1, "a😀中\nbeta\n");
  const document = documents.apply_changes("file:///demo.duck", 2, [
    {
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 8 },
      },
      rangeLength: 7,
      text: "Q",
    },
    {
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 4 },
      },
      rangeLength: 4,
      text: "B",
    },
  ]);
  assert_equals(document, {
    uri: "file:///demo.duck",
    version: 2,
    text: "aQ\nB\n",
  });
});

Deno.test("full document change is the fallback and versions only increase", () => {
  const documents = new DocumentStore();
  documents.open("file:///demo.duck", 4, "old");
  assert_equals(
    documents.apply_changes("file:///demo.duck", 5, [{ text: "new😀" }]).text,
    "new😀",
  );
  assert_throws(
    () => documents.apply_changes("file:///demo.duck", 5, [{ text: "stale" }]),
    "must increase",
  );
  assert_throws(
    () => documents.open("file:///demo.duck", 4, "stale"),
    "must increase",
  );
});

Deno.test("document versions accept the signed LSP integer range", () => {
  const documents = new DocumentStore();
  documents.open("file:///signed.duck", -1, "old");
  assert_equals(
    documents.apply_changes("file:///signed.duck", 0, [{ text: "new" }]),
    { uri: "file:///signed.duck", version: 0, text: "new" },
  );
  assert_throws(
    () => documents.open("file:///large.duck", 2_147_483_648, "invalid"),
    "signed 32-bit integer",
  );
});

Deno.test("invalid changes leave the current document unchanged", () => {
  const documents = new DocumentStore();
  documents.open("file:///demo.duck", 1, "abc");
  assert_throws(
    () =>
      documents.apply_changes("file:///demo.duck", 2, [{
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        rangeLength: 2,
        text: "z",
      }]),
    "rangeLength",
  );
  assert_equals(documents.get("file:///demo.duck"), {
    uri: "file:///demo.duck",
    version: 1,
    text: "abc",
  });
});

Deno.test("incremental ASCII edit scripts match a direct text oracle", () => {
  const documents = new DocumentStore();
  let expected = "abcdefghij";
  documents.open("file:///demo.duck", 1, expected);
  let seed = 17;

  for (let version = 2; version <= 80; version += 1) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const start = seed % (expected.length + 1);
    seed = (seed * 1103515245 + 12345) >>> 0;
    const end = start + (seed % (expected.length - start + 1));
    const replacement = String.fromCharCode(65 + (seed % 26));
    expected = expected.slice(0, start) + replacement + expected.slice(end);
    const actual = documents.apply_changes("file:///demo.duck", version, [{
      range: {
        start: { line: 0, character: start },
        end: { line: 0, character: end },
      },
      rangeLength: end - start,
      text: replacement,
    }]);
    assert_equals(actual.text, expected);
  }
});

Deno.test("incremental Unicode edit scripts match a full-text oracle", () => {
  const encodings = ["utf-16", "utf-8"] as const;
  const replacements = ["😀", "中", "x\r\nβ", ""];

  for (const encoding of encodings) {
    const documents = new DocumentStore(encoding);
    const uri = "file:///" + encoding + ".duck";
    let expected = "alpha😀\r\n中beta\ngamma\rdelta";
    documents.open(uri, 1, expected);
    let seed = 29;

    for (let version = 2; version <= 60; version += 1) {
      const boundaries = representable_offsets(expected);
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const first = boundaries[seed % boundaries.length];
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const second = boundaries[seed % boundaries.length];

      if (first === undefined || second === undefined) {
        throw new Error("Missing Unicode edit boundary");
      }

      const start = Math.min(first, second);
      const end = Math.max(first, second);
      const replacement = replacements[version % replacements.length];

      if (replacement === undefined) {
        throw new Error("Missing Unicode replacement");
      }

      const actual = documents.apply_changes(uri, version, [{
        range: {
          start: position_from_offset(expected, start, encoding),
          end: position_from_offset(expected, end, encoding),
        },
        rangeLength: encoded_length(expected.slice(start, end), encoding),
        text: replacement,
      }]);
      expected = expected.slice(0, start) + replacement + expected.slice(end);
      assert_equals(actual.text, expected);
    }
  }
});

Deno.test("a top edit in a large document matches full replacement", () => {
  const lines: string[] = [];

  for (let index = 0; index < 10_000; index += 1) {
    lines.push("line_" + index.toString() + "_中😀");
  }

  const original = lines.join("\n");
  const replacement = "first_😀";

  for (const encoding of ["utf-16", "utf-8"] as const) {
    const documents = new DocumentStore(encoding);
    const uri = "file:///large_" + encoding + ".duck";
    documents.open(uri, 1, original);
    const end = original.indexOf("\n");
    const expected = replacement + original.slice(end);
    const actual = documents.apply_changes(uri, 2, [{
      range: {
        start: { line: 0, character: 0 },
        end: position_from_offset(original, end, encoding),
      },
      rangeLength: encoded_length(original.slice(0, end), encoding),
      text: replacement,
    }]);
    assert_equals(actual.text, expected);
  }
});

Deno.test("analysis results are content-keyed, measured, and invalidated", () => {
  const documents = new DocumentStore();
  documents.open("file:///demo.duck", 1, "one");
  let calls = 0;
  const analyze = (text: string): string => {
    calls += 1;
    return text.toUpperCase();
  };

  assert_equals(
    documents.compute("file:///demo.duck", "parse", analyze),
    "ONE",
  );
  assert_equals(
    documents.compute("file:///demo.duck", "parse", analyze),
    "ONE",
  );
  assert_equals(calls, 1);
  assert_equals(documents.compute_count("file:///demo.duck", "parse"), 1);
  const initial_metrics = documents.cache_metrics(
    "file:///demo.duck",
    "parse",
  );
  assert_equals(initial_metrics.computations, 1);
  assert_equals(initial_metrics.cache_hits, 1);
  assert_equals(initial_metrics.computed_bytes, 3);
  assert_equals(initial_metrics.invalidations, 1);

  documents.apply_changes("file:///demo.duck", 2, [{ text: "two" }]);
  const changed_hash = documents.cache_metrics(
    "file:///demo.duck",
    "parse",
  ).content_hash;
  assert_equals(changed_hash === initial_metrics.content_hash, false);
  assert_equals(
    documents.compute("file:///demo.duck", "parse", analyze),
    "TWO",
  );
  documents.did_save("file:///demo.duck");
  assert_equals(
    documents.compute("file:///demo.duck", "parse", analyze),
    "TWO",
  );
  documents.watched_file_changed("file:///demo.duck");
  assert_equals(
    documents.compute("file:///demo.duck", "parse", analyze),
    "TWO",
  );
  assert_equals(calls, 4);
  assert_equals(documents.cache_metrics("file:///demo.duck", "parse"), {
    content_hash: changed_hash,
    computations: 4,
    cache_hits: 1,
    computed_bytes: 12,
    invalidations: 4,
  });
});

function representable_offsets(text: string): number[] {
  const offsets: number[] = [];

  for (let offset = 0; offset <= text.length; offset += 1) {
    if (
      offset > 0 && offset < text.length &&
      text[offset - 1] === "\r" && text[offset] === "\n"
    ) {
      continue;
    }

    if (offset > 0 && offset < text.length) {
      const before = text.charCodeAt(offset - 1);
      const after = text.charCodeAt(offset);

      if (
        before >= 0xd800 && before <= 0xdbff &&
        after >= 0xdc00 && after <= 0xdfff
      ) {
        continue;
      }
    }

    offsets.push(offset);
  }

  return offsets;
}
