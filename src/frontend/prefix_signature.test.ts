import { assert_equals, assert_throws } from "../assert.ts";
import { diagnostics_of } from "./checked.ts";
import {
  associate_prefix_signatures,
  type PrefixDefinition,
  type PrefixSignature,
  type PrefixTerm,
} from "./prefix_signature.ts";

function signature(overrides: Partial<PrefixSignature> = {}): PrefixSignature {
  return {
    name: "identity",
    kind: "let",
    scope: "root",
    type: {
      binders: [],
      parameters: [{
        name: "value",
        type: {
          text: "I32",
          canonical: "I32",
          span: { start: 1, end: 4 },
        },
        span: { start: 1, end: 10 },
      }],
      result: {
        type: {
          text: "I32",
          canonical: "I32",
          span: { start: 11, end: 14 },
        },
        span: { start: 11, end: 14 },
      },
      span: { start: 1, end: 14 },
    },
    requires: [],
    ensures: [],
    decreases: [],
    span: { start: 0, end: 10 },
    ...overrides,
  };
}

function definition(
  overrides: Partial<PrefixDefinition> = {},
): PrefixDefinition {
  return {
    name: "identity",
    kind: "let",
    scope: "root",
    span: { start: 11, end: 30 },
    ...overrides,
  };
}

Deno.test("prefix signatures associate with one same-scope definition", () => {
  const result = associate_prefix_signatures([signature()], [definition()]);
  assert_equals(diagnostics_of(result), []);
});

Deno.test("prefix signatures reject duplicates and orphans", () => {
  const result = associate_prefix_signatures(
    [signature(), signature({ span: { start: 31, end: 40 } })],
    [],
  );
  const codes = diagnostics_of(result).map((diagnostic) => diagnostic.code);
  assert_equals(codes.includes("DUCK2600"), true);
  assert_equals(codes.includes("DUCK2601"), true);
});

Deno.test("prefix signatures reject cross-scope and kind mismatches", () => {
  const cross_scope = associate_prefix_signatures(
    [signature()],
    [definition({ scope: "nested" })],
  );
  const kind_mismatch = associate_prefix_signatures(
    [signature()],
    [definition({ kind: "fact" })],
  );
  assert_equals(diagnostics_of(cross_scope)[0]?.code, "DUCK2602");
  assert_equals(diagnostics_of(kind_mismatch)[0]?.code, "DUCK2602");
});

Deno.test("prefix signatures require definitions to follow signatures", () => {
  const result = associate_prefix_signatures(
    [signature({ span: { start: 10, end: 20 } })],
    [definition({ span: { start: 0, end: 5 } })],
  );
  assert_equals(diagnostics_of(result)[0]?.code, "DUCK2602");
});

Deno.test("prefix signature keys keep scope and name components distinct", () => {
  const result = associate_prefix_signatures(
    [signature({ scope: "a\u0000b", name: "c" })],
    [definition({ scope: "a", name: "b\u0000c" })],
  );
  assert_equals(diagnostics_of(result)[0]?.code, "DUCK2601");
});

Deno.test("prefix signature mismatches retain related definition spans", () => {
  const result = associate_prefix_signatures(
    [signature()],
    [definition({ scope: "nested" })],
  );
  assert_equals(
    diagnostics_of(result)[0]?.related?.[0]?.span,
    definition({ scope: "nested" }).span,
  );
});

Deno.test("prefix signature snapshots do not trust changing proxy fields", () => {
  let reads = 0;
  const target = signature();
  const proxied = new Proxy(target, {
    getOwnPropertyDescriptor(value, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (key === "kind") {
        reads += 1;
        if (reads > 1) {
          return {
            configurable: true,
            enumerable: true,
            writable: true,
            value: "forged",
          };
        }
      }
      return descriptor;
    },
  });
  assert_throws(
    () => associate_prefix_signatures([proxied], [definition()]),
    "Invalid prefix signature kind",
  );
});

Deno.test("prefix signature snapshots reject cyclic logical terms", () => {
  const cyclic: PrefixTerm = {
    text: "(value)",
    references: ["value"],
    shape: { tag: "unsupported" },
    span: { start: 4, end: 11 },
  };
  cyclic.shape = { tag: "parenthesized", value: cyclic };
  assert_throws(
    () =>
      associate_prefix_signatures(
        [signature({ decreases: [cyclic] })],
        [definition()],
      ),
    "Prefix term cannot be cyclic",
  );
});

Deno.test("prefix signatures reject repeated decreases clauses", () => {
  const result = associate_prefix_signatures(
    [signature({
      decreases: [
        {
          text: "n",
          references: ["n"],
          shape: { tag: "name", name: "n" },
          span: { start: 4, end: 5 },
        },
        {
          text: "m",
          references: ["m"],
          shape: { tag: "name", name: "m" },
          span: { start: 6, end: 7 },
        },
      ],
    })],
    [definition()],
  );
  assert_equals(diagnostics_of(result)[0]?.code, "DUCK2603");
});
