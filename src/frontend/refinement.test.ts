import { assert_equals, assert_throws } from "../assert.ts";
import { check_proof, type Proposition } from "./proof_kernel.ts";
import {
  computational_existential_family_type,
  computational_existential_type,
  erase_decision,
  erase_semantic_type,
  logical_existential_type,
  no_decision,
  open_computational_existential,
  owned_runtime_value,
  pack_computational_existential,
  proof_type,
  refinement_proves,
  refinement_type,
  representation_type,
  weaken_refinement,
  yes_decision,
} from "./refinement.ts";

const proposition: Proposition = { tag: "equal", left: "x", right: "x" };
const certificate = check_proof({ tag: "refl", term: "x" }, proposition);
const scalar = { tag: "scalar" as const, name: "I32" };

Deno.test("refinements weaken to their representation without proof fields", () => {
  const refined = refinement_type(scalar, proposition, certificate);
  assert_equals(weaken_refinement(refined), scalar);
  assert_equals(erase_semantic_type(refined), scalar);
  assert_equals(refinement_proves(refined, proposition), true);
});

Deno.test("refinement construction rejects unsafe certificates", () => {
  const unsafe = check_proof(
    { tag: "unsafe_assume", proposition },
    proposition,
    { allow_unsafe: true },
  );
  assert_throws(
    () => refinement_type(scalar, proposition, unsafe),
    "Kernel certificate depends on unsafe evidence.",
  );
});

Deno.test("logical proof and existential types erase completely", () => {
  assert_equals(
    erase_semantic_type(proof_type(proposition)),
    undefined,
  );
  assert_equals(
    erase_semantic_type(logical_existential_type(scalar, proposition)),
    undefined,
  );
});

Deno.test("computational existentials retain witness and payload layout", () => {
  const package_type = computational_existential_type(
    { tag: "scalar", name: "U32" },
    { tag: "owned", ownership: "unique", value: scalar },
  );
  assert_equals(erase_semantic_type(package_type), {
    tag: "product",
    fields: [
      { label: "witness", type: { tag: "scalar", name: "U32" } },
      {
        label: "payload",
        type: { tag: "owned", ownership: "unique", value: scalar },
      },
    ],
  });
});

Deno.test("decision erasure keeps only the runtime branch tag", () => {
  assert_equals(erase_decision(yes_decision(proposition, certificate)), {
    tag: "yes",
  });
  const unsafe = check_proof(
    { tag: "unsafe_assume", proposition: { tag: "not", proposition } },
    { tag: "not", proposition },
    { allow_unsafe: true },
  );
  assert_throws(
    () => no_decision(proposition, unsafe),
    "Kernel certificate depends on unsafe evidence.",
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
      (fields[0] as { type: unknown }).type = { tag: "unit" };
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
});

Deno.test("dependent layout families reject non-uniform payloads", () => {
  assert_throws(
    () =>
      computational_existential_family_type(scalar, [scalar, { tag: "unit" }]),
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
    "Duplicate representation field value.",
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
    { tag: "owned", ownership: "unique", value: scalar },
  );
  const owned_type = {
    tag: "owned" as const,
    ownership: "unique" as const,
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
  open_computational_existential(package_value);
  assert_throws(
    () => open_computational_existential(package_value),
    "Unique computational existential package was already opened.",
  );
});

Deno.test("nested unique values are consumed through their containing layout", () => {
  const inner_type = {
    tag: "owned" as const,
    ownership: "unique" as const,
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
});

Deno.test("owned runtime values require nominal handles", () => {
  const owned_type = {
    tag: "owned" as const,
    ownership: "unique" as const,
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
        ownership: "unique",
        value: { tag: "scalar", type: "I32", value: 2 },
      } as never),
    "Owned runtime value is not a sealed handle.",
  );
});

Deno.test("owned handles retain and enforce their canonical layout", () => {
  const u32_type = {
    tag: "owned" as const,
    ownership: "unique" as const,
    value: { tag: "scalar" as const, name: "U32" },
  };
  const i32_type = {
    tag: "owned" as const,
    ownership: "unique" as const,
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

Deno.test("failed duplicate ownership checks do not consume handles", () => {
  const owned_type = {
    tag: "owned" as const,
    ownership: "unique" as const,
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
    "Cyclic representation type.",
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
        result: scalar,
      } as never),
    "Representation type members must be an array.",
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
    "Representation type cannot contain accessor properties.",
  );
});

Deno.test("representation fields require own type properties", () => {
  const field = {} as { label?: string; type: typeof scalar };
  assert_throws(
    () => representation_type({ tag: "product", fields: [field] } as never),
    "Missing own layout property type.",
  );
});

Deno.test("refinement propositions reject inherited fields", () => {
  const inherited = Object.create({ tag: "equal", left: "x", right: "x" });
  const certificate = check_proof({ tag: "refl", term: "x" }, proposition);
  assert_throws(
    () => refinement_type(scalar, inherited as never, certificate),
    "Refinement proposition must be a plain record.",
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
    "Representation type members must be an ordinary array.",
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
