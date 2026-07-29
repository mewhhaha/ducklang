import { assert_equals, assert_throws } from "../assert.ts";
import {
  type RepresentationType,
  same_representation_type,
  snapshot_representation_type,
  snapshot_runtime_representation_type,
} from "./representation_type.ts";

Deno.test("representation snapshots retain generic semantic types", () => {
  const type: RepresentationType = {
    tag: "forall",
    quantified_variables: [7],
    body: {
      tag: "function",
      params: [{ tag: "variable", id: 7, hint: "input" }],
      effects: [{ effect: "Console", operation: "write" }],
      result: {
        tag: "union",
        members: [
          { tag: "variable", id: 7, hint: "output" },
          { tag: "scalar", name: "Unit" },
        ],
      },
    },
  };
  const snapshot = snapshot_representation_type(type);
  assert_equals(snapshot, type);
  assert_equals(Object.isFrozen(snapshot), true);
  if (snapshot.tag !== "forall" || snapshot.body.tag !== "function") {
    throw new Error("Expected a generic function snapshot.");
  }
  assert_equals(Object.isFrozen(snapshot.quantified_variables), true);
  assert_equals(Object.isFrozen(snapshot.body.params), true);
  assert_equals(Object.isFrozen(snapshot.body.effects), true);
});

Deno.test("runtime representation snapshots reject semantic-only forms", () => {
  const runtime: RepresentationType = {
    tag: "function",
    params: [{ tag: "scalar", name: "I32" }],
    effects: [],
    result: {
      tag: "owned",
      ownership: "unique_heap",
      value: { tag: "scalar", name: "Bytes" },
    },
  };
  assert_equals(snapshot_runtime_representation_type(runtime), runtime);
  assert_throws(
    () =>
      snapshot_runtime_representation_type({
        tag: "named",
        name: "Box",
        args: [{ tag: "variable", id: 3, hint: "element" }],
      }),
    "Representation type variable is not a concrete runtime layout.",
  );
  assert_throws(
    () =>
      snapshot_runtime_representation_type({
        tag: "function",
        params: [],
        effects: [{ effect: "Io" } as never],
        result: { tag: "scalar", name: "Unit" },
      }),
    "Representation value is missing operation.",
  );
});

Deno.test("representation equality alpha-renames forall binders", () => {
  const first: RepresentationType = {
    tag: "forall",
    quantified_variables: [1],
    body: {
      tag: "function",
      params: [{ tag: "variable", id: 1, hint: "left" }],
      effects: [],
      result: { tag: "variable", id: 1, hint: "result" },
    },
  };
  const second: RepresentationType = {
    tag: "forall",
    quantified_variables: [9],
    body: {
      tag: "function",
      params: [{ tag: "variable", id: 9, hint: undefined }],
      effects: [],
      result: { tag: "variable", id: 9, hint: undefined },
    },
  };
  assert_equals(same_representation_type(first, second), true);
  assert_equals(
    same_representation_type(
      { tag: "variable", id: 1, hint: undefined },
      { tag: "variable", id: 9, hint: undefined },
    ),
    false,
  );
});

Deno.test("representation equality distinguishes delimiter-shaped labels", () => {
  const one_field: RepresentationType = {
    tag: "product",
    fields: [{
      label: "a:scalar(I32),b",
      type: { tag: "scalar", name: "I32" },
    }],
  };
  const two_fields: RepresentationType = {
    tag: "product",
    fields: [
      { label: "a", type: { tag: "scalar", name: "I32" } },
      { label: "b", type: { tag: "scalar", name: "I32" } },
    ],
  };
  assert_equals(same_representation_type(one_field, two_fields), false);
});

Deno.test("representation snapshots reject forged and cyclic inputs", () => {
  assert_throws(
    () =>
      snapshot_representation_type(
        Object.create({ tag: "scalar", name: "I32" }),
      ),
    "plain record",
  );
  const cyclic = {
    tag: "owned",
    ownership: "unique_heap",
  } as unknown as Extract<RepresentationType, { tag: "owned" }>;
  Object.assign(cyclic, { value: cyclic });
  assert_throws(
    () => snapshot_representation_type(cyclic),
    "cannot be cyclic",
  );
  const params: RepresentationType[] = [];
  Object.defineProperty(params, Symbol.iterator, {
    get() {
      throw new Error("iteration hook executed");
    },
  });
  assert_throws(
    () =>
      snapshot_representation_type({
        tag: "function",
        params,
        effects: [],
        result: { tag: "scalar", name: "Unit" },
      }),
    "cannot contain symbol properties",
  );
});

Deno.test("representation snapshots never dispatch through caller arrays", () => {
  const expected: RepresentationType = {
    tag: "product",
    fields: [{
      label: "value",
      type: { tag: "scalar", name: "I32" },
    }],
  };
  const fields = new Proxy(expected.fields, {
    get(target, key, receiver) {
      if (key === "map") {
        return () => [{
          label: "unchecked",
          type: { tag: "scalar", name: "unchecked" },
        }];
      }
      return Reflect.get(target, key, receiver);
    },
  });
  assert_equals(
    snapshot_runtime_representation_type({
      tag: "product",
      fields,
    }),
    expected,
  );
});
