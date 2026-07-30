import { assert_equals, assert_throws } from "../assert.ts";
import { checked_value, diagnostics_of } from "./checked.ts";
import {
  associate_prefix_signatures,
  type PrefixDefinition,
  type PrefixProofTerm,
  type PrefixProposition,
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

Deno.test("prefix signature snapshots seal refinement propositions", () => {
  const source_signature = signature();
  const parameter = source_signature.type.parameters[0];
  if (parameter === undefined) throw new Error("Expected source parameter.");
  parameter.type.refinement = {
    binder: "refined",
    proposition: { tag: "true", span: { start: 4, end: 8 } },
    text: "{refined: I32 | True}",
    span: { start: 1, end: 22 },
  };
  const result = checked_value(
    associate_prefix_signatures([source_signature], [definition()]),
  );
  if (result === undefined) throw new Error("Expected associated signature.");
  parameter.type.refinement.binder = "forged";
  const associated = [...result.values()][0];
  assert_equals(
    associated?.signature.type.parameters[0]?.type.refinement?.binder,
    "refined",
  );
  assert_equals(
    Object.isFrozen(
      associated?.signature.type.parameters[0]?.type.refinement?.proposition,
    ),
    true,
  );
});

Deno.test("prefix signature snapshots reject cyclic refinements", () => {
  const source_signature = signature();
  const parameter = source_signature.type.parameters[0];
  if (parameter === undefined) throw new Error("Expected source parameter.");
  parameter.type.refinement = {
    binder: "refined",
    proposition: {
      tag: "is",
      value: {
        text: "refined",
        references: ["refined"],
        shape: { tag: "name", name: "refined" },
        span: { start: 4, end: 11 },
      },
      type: parameter.type,
      span: { start: 4, end: 18 },
    },
    text: "{refined: I32 | refined is I32}",
    span: { start: 1, end: 33 },
  };
  assert_throws(
    () => associate_prefix_signatures([source_signature], [definition()]),
    "Prefix dependent type cannot be cyclic",
  );
});

Deno.test("prefix signature snapshots seal proof propositions", () => {
  const source_signature = signature();
  source_signature.type.result.type.proof = {
    tag: "true",
    span: { start: 11, end: 15 },
  };
  const result = checked_value(
    associate_prefix_signatures([source_signature], [definition()]),
  );
  if (result === undefined) throw new Error("Expected associated signature.");
  (source_signature.type.result.type.proof as {
    tag: "true" | "false";
  }).tag = "false";
  const associated = [...result.values()][0];
  assert_equals(
    associated?.signature.type.result.type.proof?.tag,
    "true",
  );
  assert_equals(
    Object.isFrozen(associated?.signature.type.result.type.proof),
    true,
  );
});

Deno.test("prefix signature snapshots reject cyclic proof terms", () => {
  const cyclic: PrefixProofTerm = {
    tag: "symm",
    proof: { tag: "refl", span: { start: 20, end: 24 } },
    span: { start: 15, end: 25 },
  };
  cyclic.proof = cyclic;
  assert_throws(
    () =>
      associate_prefix_signatures(
        [signature()],
        [definition({ callable_proof_body: cyclic })],
      ),
    "Prefix proof term cannot be cyclic",
  );
});

Deno.test("prefix signature snapshots reject cyclic proof binders", () => {
  const cyclic: PrefixProofTerm = {
    tag: "lambda",
    name: "evidence",
    body: { tag: "true_intro", span: { start: 20, end: 30 } },
    span: { start: 15, end: 30 },
  };
  cyclic.body = cyclic;

  assert_throws(
    () =>
      associate_prefix_signatures(
        [signature()],
        [definition({ callable_proof_body: cyclic })],
      ),
    "Prefix proof term cannot be cyclic",
  );
});

Deno.test("prefix proof snapshots reject cyclic quantified witnesses", () => {
  const witness: PrefixTerm = {
    text: "(value)",
    references: ["value"],
    shape: {
      tag: "name",
      name: "value",
    },
    span: { start: 20, end: 27 },
  };
  witness.shape = { tag: "parenthesized", value: witness };
  const proof: PrefixProofTerm = {
    tag: "exists_intro",
    witness,
    proof: { tag: "true_intro", span: { start: 29, end: 39 } },
    span: { start: 15, end: 40 },
  };

  assert_throws(
    () =>
      associate_prefix_signatures(
        [signature()],
        [definition({ callable_proof_body: proof })],
      ),
    "Prefix term cannot be cyclic",
  );
});

Deno.test("prefix proof snapshots seal quantified arguments", () => {
  const argument: PrefixTerm = {
    text: "value",
    references: ["value"],
    shape: { tag: "name", name: "value" },
    span: { start: 30, end: 35 },
  };
  const proof: PrefixProofTerm = {
    tag: "forall_apply",
    proof: {
      tag: "name",
      name: "universal",
      span: { start: 15, end: 24 },
    },
    argument,
    span: { start: 15, end: 36 },
  };
  const index = checked_value(
    associate_prefix_signatures(
      [signature()],
      [definition({ callable_proof_body: proof })],
    ),
  );
  if (index === undefined) throw new Error("Expected associated signature.");
  argument.shape = { tag: "name", name: "changed" };
  const associated = [...index.values()][0];
  const body = associated?.definition.callable_proof_body;

  assert_equals(body?.tag, "forall_apply");
  if (body?.tag !== "forall_apply") {
    throw new Error("Expected snapshotted universal application.");
  }
  assert_equals(body.argument.shape, { tag: "name", name: "value" });
  assert_equals(Object.isFrozen(body.argument), true);
});

Deno.test("prefix signature snapshots seal disjunction case binders", () => {
  const proof: PrefixProofTerm = {
    tag: "or_cases",
    proof: {
      tag: "name",
      name: "choice",
      span: { start: 20, end: 26 },
    },
    left_name: "left",
    left_body: {
      tag: "name",
      name: "left",
      span: { start: 28, end: 32 },
    },
    right_name: "right",
    right_body: {
      tag: "name",
      name: "right",
      span: { start: 34, end: 39 },
    },
    span: { start: 15, end: 40 },
  };
  const index = checked_value(
    associate_prefix_signatures(
      [signature()],
      [definition({ callable_proof_body: proof })],
    ),
  );
  if (index === undefined) throw new Error("Expected associated signature.");
  const associated = [...index.values()][0];
  proof.left_name = "changed";
  proof.left_body = { tag: "true_intro", span: { start: 0, end: 0 } };

  assert_equals(associated?.definition.callable_proof_body?.tag, "or_cases");
  if (associated?.definition.callable_proof_body?.tag !== "or_cases") {
    throw new Error("Expected snapshotted disjunction elimination.");
  }
  assert_equals(
    associated.definition.callable_proof_body.left_name,
    "left",
  );
  assert_equals(
    associated.definition.callable_proof_body.left_body.tag,
    "name",
  );
});

Deno.test("quantified proof snapshots share one structural node budget", () => {
  let inner: PrefixProofTerm = {
    tag: "true_intro",
    span: { start: 15, end: 25 },
  };
  for (let depth = 0; depth < 12; depth += 1) {
    inner = {
      tag: "and_intro",
      left: inner,
      right: inner,
      span: { start: 15, end: 25 },
    };
  }
  let argument: PrefixTerm = {
    text: "value",
    references: ["value"],
    shape: { tag: "name", name: "value" },
    span: { start: 30, end: 35 },
  };
  for (let depth = 0; depth < 13; depth += 1) {
    argument = {
      text: "value + value",
      references: ["value"],
      shape: {
        tag: "binary",
        operator: "+",
        left: argument,
        right: argument,
      },
      span: { start: 30, end: 43 },
    };
  }
  const proof: PrefixProofTerm = {
    tag: "forall_apply",
    proof: inner,
    argument,
    span: { start: 15, end: 44 },
  };

  assert_throws(
    () =>
      associate_prefix_signatures(
        [signature()],
        [definition({ callable_proof_body: proof })],
      ),
    "snapshot exceeded 20000 nodes",
  );
});

Deno.test("prefix proof snapshots have one structural node budget", () => {
  let shared: PrefixProofTerm = {
    tag: "true_intro",
    span: { start: 15, end: 25 },
  };
  for (let depth = 0; depth < 15; depth += 1) {
    shared = {
      tag: "and_intro",
      left: shared,
      right: shared,
      span: { start: 15, end: 25 },
    };
  }

  assert_throws(
    () =>
      associate_prefix_signatures(
        [signature()],
        [definition({ callable_proof_body: shared })],
      ),
    "Prefix proof snapshot exceeded 20000 nodes.",
  );
});

Deno.test("prefix proposition snapshots have one structural node budget", () => {
  let shared: PrefixProposition = {
    tag: "true",
    span: { start: 15, end: 25 },
  };
  for (let depth = 0; depth < 15; depth += 1) {
    shared = {
      tag: "and",
      left: shared,
      right: shared,
      span: { start: 15, end: 25 },
    };
  }

  assert_throws(
    () =>
      associate_prefix_signatures(
        [signature({ ensures: [shared] })],
        [definition()],
      ),
    "Prefix proposition snapshot exceeded 20000 nodes.",
  );
});

Deno.test("prefix logical term snapshots have one structural node budget", () => {
  let shared: PrefixTerm = {
    text: "value",
    references: ["value"],
    shape: { tag: "name", name: "value" },
    span: { start: 15, end: 25 },
  };
  for (let depth = 0; depth < 15; depth += 1) {
    shared = {
      text: "value + value",
      references: ["value"],
      shape: {
        tag: "binary",
        operator: "+",
        left: shared,
        right: shared,
      },
      span: { start: 15, end: 25 },
    };
  }

  assert_throws(
    () =>
      associate_prefix_signatures(
        [signature({ decreases: [shared] })],
        [definition()],
      ),
    "Prefix term snapshot exceeded 20000 nodes.",
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
