import { assert_equals, assert_throws } from "../assert.ts";
import { check_proof, type Proposition } from "./proof_kernel.ts";
import { type_sort } from "./kernel_terms.ts";
import type { RepresentationType } from "./representation_type.ts";
import { TypeEngine } from "./type_engine.ts";
import {
  computational_existential_family_type,
  computational_existential_type,
  decision_type,
  erase_semantic_type,
  erase_semantic_value,
  logical_existential_type,
  no_decision,
  open_computational_existential,
  owned_runtime_value,
  pack_computational_existential,
  proof_type,
  refinement_proves,
  refinement_type,
  representation_type,
  unsafe_no_decision,
  unsafe_refinement_type,
  weaken_refinement,
  yes_decision,
} from "./refinement.ts";

const proposition: Proposition = {
  tag: "equal",
  type: type_sort(0),
  left: { tag: "var", index: 0 },
  right: { tag: "var", index: 0 },
};
const certificate = check_proof(
  {
    tag: "refl",
    type: type_sort(0),
    term: { tag: "var", index: 0 },
  },
  proposition,
  {
    allow_unsafe: false,
    term_context: [type_sort(0)],
  },
);
const proof_context = { term_context: [type_sort(0)] };
const scalar: RepresentationType = { tag: "scalar", name: "I32" };

Deno.test("refinements weaken to their representation without proof fields", () => {
  const refined = refinement_type(
    scalar,
    proposition,
    certificate,
    proof_context,
  );
  assert_equals(weaken_refinement(refined), scalar);
  assert_equals(erase_semantic_type(refined), scalar);
  assert_equals(refinement_proves(refined, proposition), true);
});

Deno.test("type inference and refinement share canonical representations", () => {
  const engine = new TypeEngine();
  const inferred = engine.normalize({
    tag: "record",
    fields: [
      { label: "second", type: { tag: "integer", signed: false, width: 8 } },
      { label: "first", type: scalar },
    ],
  });
  const semantic = representation_type(inferred);
  assert_equals(semantic.representation, {
    tag: "record",
    fields: [
      { label: "first", type: scalar },
      { label: "second", type: { tag: "integer", signed: false, width: 8 } },
    ],
  });

  const package_type = computational_existential_type(inferred, scalar);
  const package_value = pack_computational_existential(
    package_type,
    {
      tag: "product",
      fields: [
        { tag: "scalar", type: "I32", value: 4 },
        { tag: "scalar", type: "U8", value: 255 },
      ],
    },
    { tag: "scalar", type: "I32", value: 7 },
  );
  assert_equals(open_computational_existential(package_value).witness, {
    tag: "product",
    fields: [
      { tag: "scalar", type: "I32", value: 4 },
      { tag: "scalar", type: "U8", value: 255 },
    ],
  });
});

Deno.test("refinement rejects unresolved inference representations", () => {
  const engine = new TypeEngine();
  assert_throws(
    () => representation_type(engine.fresh_variable("element")),
    "Representation type variable is not a concrete runtime layout.",
  );
  assert_throws(
    () =>
      representation_type({
        tag: "integer",
        signed: false,
        width: 65,
      }),
    "Representation integer width 65 is invalid.",
  );
});

Deno.test("refinement construction rejects unsafe certificates", () => {
  const unsafe = check_proof(
    { tag: "unsafe_assume", proposition },
    proposition,
    { allow_unsafe: true, term_context: [type_sort(0)] },
  );
  assert_throws(
    () => refinement_type(scalar, proposition, unsafe, proof_context),
    "Kernel certificate depends on unsafe evidence.",
  );
  const refined = unsafe_refinement_type(
    scalar,
    proposition,
    unsafe,
    proof_context,
  );
  assert_equals(refined.safety.tag, "unsafe");
  assert_equals(refinement_proves(refined, proposition), false);
  assert_equals(
    erase_semantic_value(
      refined,
      { tag: "scalar", type: "I32", value: 7 },
    ),
    { tag: "scalar", type: "I32", value: 7 },
  );
});

Deno.test("logical proof and existential types erase completely", () => {
  assert_equals(
    erase_semantic_type(proof_type(proposition, proof_context)),
    undefined,
  );
  assert_equals(
    erase_semantic_type(
      logical_existential_type(type_sort(0), proposition),
    ),
    undefined,
  );
});

Deno.test("logical existential formation binds only its witness", () => {
  const bound: Proposition = {
    tag: "equal",
    type: type_sort(0),
    left: { tag: "var", index: 0 },
    right: { tag: "var", index: 0 },
  };
  const type = logical_existential_type(type_sort(0), bound);
  assert_equals(type.proposition, {
    tag: "exists",
    domain: type_sort(0),
    body: bound,
  });

  const escaped: Proposition = {
    tag: "equal",
    type: type_sort(0),
    left: { tag: "var", index: 1 },
    right: { tag: "var", index: 1 },
  };
  assert_throws(
    () => logical_existential_type(type_sort(0), escaped),
    "Kernel variable 1 is out of scope.",
  );
});

Deno.test("checked semantic values erase through one runtime boundary", () => {
  const proof = proof_type(proposition, proof_context);
  assert_equals(erase_semantic_value(proof, certificate), undefined);

  const logical_exists = logical_existential_type(
    type_sort(0),
    proposition,
    proof_context,
  );
  const existence = check_proof(
    {
      tag: "exists_intro",
      domain: type_sort(0),
      body: proposition,
      witness: { tag: "var", index: 0 },
      proof: {
        tag: "refl",
        type: type_sort(0),
        term: { tag: "var", index: 0 },
      },
    },
    logical_exists.proposition,
    {
      allow_unsafe: false,
      term_context: [type_sort(0)],
    },
  );
  assert_equals(erase_semantic_value(logical_exists, existence), undefined);

  const refined = refinement_type(
    scalar,
    proposition,
    certificate,
    proof_context,
  );
  const runtime_value = { tag: "scalar" as const, type: "I32", value: 7 };
  assert_equals(
    erase_semantic_value(refined, runtime_value),
    runtime_value,
  );

  const decision = decision_type(proposition, proof_context);
  assert_equals(
    erase_semantic_value(decision, yes_decision(decision, certificate)),
    {
      tag: "sum",
      case: "Yes",
      payload: { tag: "unit" },
    },
  );

  const package_type = computational_existential_type(scalar, scalar);
  const package_value = pack_computational_existential(
    package_type,
    runtime_value,
    runtime_value,
  );
  assert_equals(
    erase_semantic_value(package_type, package_value),
    {
      tag: "product",
      fields: [runtime_value, runtime_value],
    },
  );
});

Deno.test("semantic erasure consumes unique runtime values", () => {
  const unique_type = {
    tag: "owned" as const,
    ownership: "unique_heap" as const,
    value: scalar,
  };
  const runtime_value = { tag: "scalar" as const, type: "I32", value: 7 };
  const representation_value = owned_runtime_value(unique_type, runtime_value);
  const representation = representation_type(unique_type);
  assert_equals(
    erase_semantic_value(representation, representation_value),
    representation_value,
  );
  assert_throws(
    () => erase_semantic_value(representation, representation_value),
    "Unique runtime value was already consumed.",
  );

  const refinement_value = owned_runtime_value(unique_type, runtime_value);
  const refined = refinement_type(
    unique_type,
    proposition,
    certificate,
    proof_context,
  );
  assert_equals(
    erase_semantic_value(refined, refinement_value),
    refinement_value,
  );
  assert_throws(
    () => erase_semantic_value(refined, refinement_value),
    "Unique runtime value was already consumed.",
  );
});

Deno.test("semantic value erasure rejects mismatched dependent values", () => {
  const left = decision_type(proposition, proof_context);
  const equivalent = decision_type(proposition, proof_context);
  const value = yes_decision(left, certificate);
  assert_equals(
    erase_semantic_value(equivalent, value),
    {
      tag: "sum",
      case: "Yes",
      payload: { tag: "unit" },
    },
  );
  const right = decision_type({ tag: "false" }, proof_context);
  assert_throws(
    () => erase_semantic_value(right, value),
    "Logical decision value has a different semantic type.",
  );

  const first_package_type = computational_existential_type(scalar, scalar);
  const equivalent_package_type = computational_existential_type(
    scalar,
    scalar,
  );
  const runtime_value = { tag: "scalar" as const, type: "I32", value: 7 };
  const package_value = pack_computational_existential(
    first_package_type,
    runtime_value,
    runtime_value,
  );
  assert_equals(
    erase_semantic_value(equivalent_package_type, package_value),
    {
      tag: "product",
      fields: [runtime_value, runtime_value],
    },
  );
  const second_package_type = computational_existential_type(
    scalar,
    { tag: "scalar", name: "U32" },
  );
  const second_package_value = pack_computational_existential(
    first_package_type,
    runtime_value,
    runtime_value,
  );
  assert_throws(
    () => erase_semantic_value(second_package_type, second_package_value),
    "Computational package has a different semantic type.",
  );
});

Deno.test("logical types reject malformed and oversized propositions", () => {
  const missing_type = { tag: "constant" as const, name: "MissingType" };
  const missing_term = {
    tag: "constant" as const,
    name: "missing",
    type: missing_type,
  };
  const malformed: Proposition = {
    tag: "equal",
    type: missing_type,
    left: missing_term,
    right: missing_term,
  };
  assert_throws(
    () => proof_type(malformed),
    "Kernel type constant MissingType requires a trusted environment.",
  );
  assert_throws(
    () => logical_existential_type(type_sort(0), malformed),
    "Kernel type constant MissingType requires a trusted environment.",
  );

  let oversized: Proposition = { tag: "true" };
  for (let depth = 0; depth < 15; depth += 1) {
    oversized = { tag: "and", left: oversized, right: oversized };
  }
  assert_throws(
    () => proof_type(oversized),
    "Proof snapshot exceeded 20000 nodes.",
  );
});

Deno.test("computational existentials retain witness and payload layout", () => {
  const package_type = computational_existential_type(
    { tag: "scalar", name: "U32" },
    { tag: "owned", ownership: "unique_heap", value: scalar },
  );
  assert_equals(erase_semantic_type(package_type), {
    tag: "product",
    fields: [
      { label: "witness", type: { tag: "scalar", name: "U32" } },
      {
        label: "payload",
        type: { tag: "owned", ownership: "unique_heap", value: scalar },
      },
    ],
  });
});

Deno.test("decision erasure keeps only the runtime branch tag", () => {
  const type = decision_type(proposition, proof_context);
  assert_equals(erase_semantic_type(type), {
    tag: "sum",
    cases: [
      { label: "Yes", payload: { tag: "scalar", name: "Unit" } },
      { label: "No", payload: { tag: "scalar", name: "Unit" } },
    ],
  });
  assert_equals(
    erase_semantic_value(type, yes_decision(type, certificate)),
    {
      tag: "sum",
      case: "Yes",
      payload: { tag: "unit" },
    },
  );
  const unsafe = check_proof(
    { tag: "unsafe_assume", proposition: { tag: "not", proposition } },
    { tag: "not", proposition },
    { allow_unsafe: true, term_context: [type_sort(0)] },
  );
  assert_throws(
    () => no_decision(type, unsafe),
    "Kernel certificate depends on unsafe evidence.",
  );
  const unsafe_decision = unsafe_no_decision(type, unsafe);
  assert_equals(unsafe_decision.safety.tag, "unsafe");
  assert_equals(erase_semantic_value(type, unsafe_decision), {
    tag: "sum",
    case: "No",
    payload: { tag: "unit" },
  });
  assert_equals(
    erase_semantic_type(decision_type({ tag: "true" })),
    erase_semantic_type(decision_type({ tag: "false" })),
  );
});

Deno.test("computational packages are sealed and can be opened", () => {
  const package_type = computational_existential_type(scalar, scalar);
  const runtime_value = { tag: "scalar" as const, type: "I32", value: 7 };
  const package_value = pack_computational_existential(
    package_type,
    runtime_value,
    runtime_value,
  );
  assert_equals(open_computational_existential(package_value), {
    type: package_type,
    witness: runtime_value,
    payload: runtime_value,
  });
  const opened = open_computational_existential(package_value);
  assert_throws(
    () => {
      (opened as { payload: unknown }).payload = {
        tag: "scalar",
        type: "Text",
        value: "forged",
      };
    },
    "Cannot assign to read only property",
  );
  assert_throws(
    () =>
      open_computational_existential({
        type: package_type,
        witness: runtime_value,
        payload: runtime_value,
      } as never),
    "Computational existential package is not sealed.",
  );
});

Deno.test("computational package values are snapshotted before storage", () => {
  const package_type = computational_existential_type(
    { tag: "product", fields: [{ label: "value", type: scalar }] },
    scalar,
  );
  const witness = {
    tag: "product" as const,
    fields: [{ tag: "scalar" as const, type: "I32", value: 7 }],
  };
  const payload = { tag: "scalar" as const, type: "I32", value: 8 };
  const package_value = pack_computational_existential(
    package_type,
    witness,
    payload,
  );
  witness.fields[0]!.value = 99;
  payload.value = 100;
  assert_equals(open_computational_existential(package_value), {
    type: package_type,
    witness: {
      tag: "product",
      fields: [{ tag: "scalar", type: "I32", value: 7 }],
    },
    payload: { tag: "scalar", type: "I32", value: 8 },
  });

  let reads = 0;
  const changing_payload = new Proxy(
    { tag: "scalar" as const, type: "I32", value: 1 },
    {
      get(target, key, receiver) {
        if (key === "value") {
          reads += 1;
          if (reads === 1) return 1;
          return { unchecked: true };
        }
        return Reflect.get(target, key, receiver);
      },
    },
  );
  const scalar_package = pack_computational_existential(
    computational_existential_type(scalar, scalar),
    { tag: "scalar", type: "I32", value: 0 },
    changing_payload,
  );
  assert_equals(open_computational_existential(scalar_package).payload, {
    tag: "scalar",
    type: "I32",
    value: 1,
  });
  assert_equals(reads, 0);
});

Deno.test("sealed layouts reject nested mutation and object scalar payloads", () => {
  const product_type = computational_existential_type(
    { tag: "product", fields: [{ label: "value", type: scalar }] },
    scalar,
  );
  const fields = (product_type.witness as Extract<
    typeof product_type.witness,
    { tag: "product" }
  >).fields;
  assert_throws(
    () => {
      (fields[0] as { type: unknown }).type = {
        tag: "scalar",
        name: "Unit",
      };
    },
    "Cannot assign to read only property",
  );
  assert_throws(
    () =>
      pack_computational_existential(product_type, {
        tag: "product",
        fields: [{ tag: "scalar", type: "I32", value: 1 }],
      }, {
        tag: "scalar",
        type: "I32",
        value: { forged: true },
      } as never),
    "Scalar runtime value does not match I32.",
  );
});

Deno.test("computational existential packages validate runtime layouts", () => {
  const package_type = computational_existential_type(scalar, scalar);
  const runtime_value = { tag: "scalar" as const, type: "I32", value: 7 };
  assert_throws(
    () =>
      pack_computational_existential(package_type, runtime_value, {
        tag: "scalar",
        type: "Text",
        value: "forged",
      }),
    "Runtime value does not match scalar layout I32.",
  );
  const fixed_type = computational_existential_type(scalar, {
    tag: "fixed_array",
    length: 2,
    element: scalar,
  });
  const valid = { tag: "scalar" as const, type: "I32", value: 1 };
  const fields = new Proxy([
    valid,
    { tag: "scalar" as const, type: "Text", value: "unchecked" },
  ], {
    get(target, key, receiver) {
      if (key === "map") return () => [valid, valid];
      return Reflect.get(target, key, receiver);
    },
  });
  assert_throws(
    () =>
      pack_computational_existential(fixed_type, runtime_value, {
        tag: "product",
        fields,
      }),
    "Runtime value does not match scalar layout I32.",
  );
});

Deno.test("dependent layout families reject non-uniform payloads", () => {
  assert_throws(
    () =>
      computational_existential_family_type(scalar, [
        scalar,
        { tag: "scalar", name: "Unit" },
      ]),
    "Computational existential has non-uniform payload layouts.",
  );
  const payloads = new Proxy([
    scalar,
    { tag: "scalar" as const, name: "Bool" as const },
  ], {
    get(target, key, receiver) {
      if (key === "map") return () => [scalar];
      return Reflect.get(target, key, receiver);
    },
  });
  assert_throws(
    () => computational_existential_family_type(scalar, payloads),
    "Computational existential has non-uniform payload layouts.",
  );
  const uniform = computational_existential_family_type(scalar, [
    scalar,
    scalar,
  ]);
  assert_equals(uniform.payload, scalar);
});

Deno.test("representation layouts reject duplicate labels and scalar kind mismatches", () => {
  assert_throws(
    () =>
      representation_type({
        tag: "product",
        fields: [
          { label: "value", type: scalar },
          { label: "value", type: scalar },
        ],
      }),
    "Duplicate product field value.",
  );
  const bool_type = computational_existential_type(
    { tag: "scalar", name: "Bool" },
    { tag: "scalar", name: "Bool" },
  );
  assert_throws(
    () =>
      pack_computational_existential(bool_type, {
        tag: "scalar",
        type: "Bool",
        value: 1,
      } as never, {
        tag: "scalar",
        type: "Bool",
        value: true,
      }),
    "Scalar runtime value does not match Bool.",
  );
});

Deno.test("unique computational packages cannot be reused", () => {
  const package_type = computational_existential_type(
    scalar,
    { tag: "owned", ownership: "unique_heap", value: scalar },
  );
  const owned_type = {
    tag: "owned" as const,
    ownership: "unique_heap" as const,
    value: scalar,
  };
  const owned = owned_runtime_value(owned_type, {
    tag: "scalar",
    type: "I32",
    value: 4,
  });
  const package_value = pack_computational_existential(
    package_type,
    { tag: "scalar", type: "I32", value: 1 },
    owned,
  );
  assert_throws(
    () =>
      pack_computational_existential(
        package_type,
        { tag: "scalar", type: "I32", value: 2 },
        owned,
      ),
    "Unique runtime value was already consumed.",
  );
  const opened = open_computational_existential(package_value);
  assert_throws(
    () => open_computational_existential(package_value),
    "Unique computational existential package was already opened.",
  );
  const repacked = pack_computational_existential(
    package_type,
    opened.witness,
    opened.payload,
  );
  assert_equals(
    open_computational_existential(repacked).payload,
    opened.payload,
  );
});

Deno.test("nested unique values are consumed through their containing layout", () => {
  const inner_type = {
    tag: "owned" as const,
    ownership: "unique_heap" as const,
    value: scalar,
  };
  const outer_type = computational_existential_type(
    scalar,
    { tag: "product", fields: [{ label: "inner", type: inner_type }] },
  );
  const inner = owned_runtime_value(inner_type, {
    tag: "scalar",
    type: "I32",
    value: 3,
  });
  const outer = {
    tag: "product" as const,
    fields: [inner],
  };
  pack_computational_existential(
    outer_type,
    { tag: "scalar", type: "I32", value: 1 },
    outer,
  );
  assert_throws(
    () =>
      pack_computational_existential(
        computational_existential_type(scalar, inner_type),
        { tag: "scalar", type: "I32", value: 2 },
        inner,
      ),
    "Unique runtime value was already consumed.",
  );

  const nested_inner = owned_runtime_value(inner_type, {
    tag: "scalar",
    type: "I32",
    value: 5,
  });
  const nested_type = {
    tag: "owned" as const,
    ownership: "unique_heap" as const,
    value: inner_type,
  };
  const nested_outer = owned_runtime_value(nested_type, nested_inner);
  const nested_package = pack_computational_existential(
    computational_existential_type(scalar, nested_type),
    { tag: "scalar", type: "I32", value: 6 },
    nested_outer,
  );
  assert_equals(
    open_computational_existential(nested_package).payload.tag,
    "owned",
  );
});

Deno.test("owned runtime values require nominal handles", () => {
  const owned_type = {
    tag: "owned" as const,
    ownership: "unique_heap" as const,
    value: scalar,
  };
  const package_type = computational_existential_type(scalar, owned_type);
  assert_throws(
    () =>
      pack_computational_existential(package_type, {
        tag: "scalar",
        type: "I32",
        value: 1,
      }, {
        tag: "owned",
        ownership: "unique_heap",
        value: { tag: "scalar", type: "I32", value: 2 },
      } as never),
    "Owned runtime value is not a sealed handle.",
  );
});

Deno.test("owned handles retain and enforce their canonical layout", () => {
  const u32_type = {
    tag: "owned" as const,
    ownership: "unique_heap" as const,
    value: { tag: "scalar" as const, name: "U32" as const },
  };
  const i32_type = {
    tag: "owned" as const,
    ownership: "unique_heap" as const,
    value: scalar,
  };
  const handle = owned_runtime_value(u32_type, {
    tag: "scalar",
    type: "U32",
    value: 1,
  });
  assert_throws(
    () =>
      pack_computational_existential(
        computational_existential_type(scalar, i32_type),
        { tag: "scalar", type: "I32", value: 0 },
        handle,
      ),
    "Owned runtime value layout does not match its expected type.",
  );
});

Deno.test("owned handles use the canonical ownership descriptor", () => {
  let ownership_reads = 0;
  const owned_type = new Proxy({
    tag: "owned" as const,
    ownership: "unique_heap" as const,
    value: scalar,
  }, {
    get(target, key, receiver) {
      if (key === "ownership") {
        ownership_reads += 1;
        if (ownership_reads === 1) {
          return "unique_heap";
        }
        return "scalar";
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const owned = owned_runtime_value(owned_type, {
    tag: "scalar",
    type: "I32",
    value: 5,
  });

  assert_equals(owned, {
    tag: "owned",
    ownership: "unique_heap",
    value: { tag: "scalar", type: "I32", value: 5 },
  });
  assert_equals(ownership_reads, 0);
});

Deno.test("failed duplicate ownership checks do not consume handles", () => {
  const owned_type = {
    tag: "owned" as const,
    ownership: "unique_heap" as const,
    value: scalar,
  };
  const duplicate_type = computational_existential_type(owned_type, owned_type);
  const owned = owned_runtime_value(owned_type, {
    tag: "scalar",
    type: "I32",
    value: 6,
  });
  assert_throws(
    () => pack_computational_existential(duplicate_type, owned, owned),
    "Unique runtime value appears more than once.",
  );
  const single_type = computational_existential_type(scalar, owned_type);
  pack_computational_existential(
    single_type,
    { tag: "scalar", type: "I32", value: 0 },
    owned,
  );
});

Deno.test("machine scalar layouts reject invalid numeric values", () => {
  const i32_type = computational_existential_type(
    { tag: "scalar", name: "I32" },
    { tag: "scalar", name: "I32" },
  );
  for (const value of [NaN, Infinity, 1.5, 2 ** 31]) {
    assert_throws(
      () =>
        pack_computational_existential(i32_type, {
          tag: "scalar",
          type: "I32",
          value,
        }, { tag: "scalar", type: "I32", value: 0 }),
      "Scalar runtime value does not match I32.",
    );
  }
  const u32_type = computational_existential_type(
    { tag: "scalar", name: "U32" },
    { tag: "scalar", name: "U32" },
  );
  assert_throws(
    () =>
      pack_computational_existential(u32_type, {
        tag: "scalar",
        type: "U32",
        value: -1,
      }, { tag: "scalar", type: "U32", value: 0 }),
    "Scalar runtime value does not match U32.",
  );
  const f32_type = computational_existential_type(
    { tag: "scalar", name: "F32" },
    { tag: "scalar", name: "F32" },
  );
  assert_throws(
    () =>
      pack_computational_existential(f32_type, {
        tag: "scalar",
        type: "F32",
        value: 0.1,
      }, { tag: "scalar", type: "F32", value: 0 }),
    "Scalar runtime value does not match F32.",
  );
});

Deno.test("runtime packages reject accessor-backed aggregates", () => {
  const package_type = computational_existential_type(
    scalar,
    { tag: "product", fields: [{ label: "value", type: scalar }] },
  );
  const aggregate = { tag: "product" as const, fields: [] as unknown[] };
  Object.defineProperty(aggregate, "fields", {
    get() {
      return [{ tag: "scalar", type: "I32", value: 1 }];
    },
  });
  assert_throws(
    () =>
      pack_computational_existential(
        package_type,
        { tag: "scalar", type: "I32", value: 0 },
        aggregate as never,
      ),
    "Runtime value cannot contain accessor properties.",
  );
  const hidden_accessor = { tag: "product", fields: [] as unknown[] };
  Object.defineProperty(hidden_accessor, "tag", {
    enumerable: false,
    get() {
      return "product";
    },
  });
  assert_throws(
    () =>
      pack_computational_existential(
        package_type,
        { tag: "scalar", type: "I32", value: 0 },
        hidden_accessor as never,
      ),
    "Runtime value cannot contain accessor properties.",
  );
});

Deno.test("erasure rejects forged semantic types", () => {
  assert_throws(
    () =>
      erase_semantic_type({
        tag: "refinement",
        value: scalar,
        proposition,
        certificate,
      } as never),
    "Semantic type is not sealed by the refinement layer.",
  );
});

Deno.test("representation snapshots reject cycles and invalid ownership", () => {
  const cyclic = { tag: "product", fields: [] as unknown[] } as never;
  (cyclic as { fields: unknown[] }).fields.push({
    label: "self",
    type: cyclic,
  });
  assert_throws(
    () => representation_type(cyclic),
    "Representation type cannot be cyclic.",
  );
  assert_throws(
    () =>
      representation_type({
        tag: "owned",
        ownership: "forged",
        value: scalar,
      } as never),
    "Invalid representation ownership forged.",
  );
  assert_throws(
    () => representation_type({ tag: "forged" } as never),
    "Invalid representation type tag forged.",
  );
  assert_throws(
    () =>
      representation_type({
        tag: "product",
        fields: [
          { label: "value", type: { tag: "forged" } },
        ],
      } as never),
    "Invalid representation type tag forged.",
  );
});

Deno.test("representation function layouts require plain parameter arrays", () => {
  assert_throws(
    () =>
      representation_type({
        tag: "function",
        params: {
          map() {
            return [];
          },
        },
        effects: [],
        result: scalar,
      } as never),
    "Function parameters must be an array.",
  );
});

Deno.test("representation field wrappers cannot contain accessors", () => {
  const field = { type: scalar } as { label?: string; type: typeof scalar };
  Object.defineProperty(field, "label", {
    get() {
      return "value";
    },
  });
  assert_throws(
    () => representation_type({ tag: "product", fields: [field] } as never),
    "Representation property label must be an own data property.",
  );
});

Deno.test("representation fields require own type properties", () => {
  const field = { label: undefined } as {
    label: string | undefined;
    type: typeof scalar;
  };
  assert_throws(
    () => representation_type({ tag: "product", fields: [field] } as never),
    "Representation value is missing type.",
  );
});

Deno.test("refinement propositions reject inherited fields", () => {
  const inherited = Object.create({ tag: "equal", left: "x", right: "x" });
  assert_throws(
    () =>
      refinement_type(
        scalar,
        inherited as never,
        certificate,
        proof_context,
      ),
    "Proposition must be a plain record.",
  );
});

Deno.test("representation and runtime values reject inherited discriminators", () => {
  assert_throws(
    () => representation_type(Object.create({ tag: "scalar", name: "I32" })),
    "Representation type must be a plain record.",
  );
  const package_type = computational_existential_type(scalar, scalar);
  assert_throws(
    () =>
      pack_computational_existential(
        package_type,
        Object.create({ tag: "scalar", type: "I32", value: 1 }),
        { tag: "scalar", type: "I32", value: 0 },
      ),
    "Runtime value must be a plain record.",
  );
});

Deno.test("representation and runtime arrays reject inherited elements", () => {
  const fields = new Array(1) as unknown[];
  const inherited = Object.create(Array.prototype) as unknown[];
  inherited[0] = { label: "value", type: scalar };
  Object.setPrototypeOf(fields, inherited);
  assert_throws(
    () => representation_type({ tag: "product", fields } as never),
    "Product fields must be an ordinary array.",
  );
});

Deno.test("representation snapshots are independent of caller mutation", () => {
  const fields = [{ label: "value", type: scalar }];
  const type = representation_type({ tag: "product", fields });
  fields.push({ label: "forged", type: scalar });
  assert_equals(erase_semantic_type(type), {
    tag: "product",
    fields: [{ label: "value", type: scalar }],
  });
});
