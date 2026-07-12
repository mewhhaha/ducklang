import { assert_equals, assert_throws } from "../assert.ts";
import { Ic } from "../ic.ts";
import { ic_no_gc_proof } from "./proof.ts";

Deno.test("pure Ic proof records the unmanaged static storage contract", () => {
  const proof = ic_no_gc_proof({
    tag: "prim",
    prim: "i32.load8_u",
    args: [{
      tag: "prim",
      prim: "i32.add",
      args: [
        { tag: "text", value: "hello" },
        { tag: "num", type: "i32", value: 4 },
      ],
    }],
  });

  assert_equals(proof.target_profile, "core-3-nonweb");
  assert_equals(proof.managed_storage, "disabled");
  assert_equals(proof.ok, true);
  assert_equals(proof.issues, []);
  assert_equals(
    proof.storage_rows.some((row) => row.storage_class === "static_data"),
    true,
  );
  assert_equals(proof.borrow_view_rows, []);
  assert_equals(proof.scratch_result_rows, []);
  assert_equals(proof.freeze_promotion_rows, []);
  assert_equals(proof.host_boundary_rows, []);
  assert_equals(proof.capability_method_rows, []);
  assert_equals(proof.runtime_slice_rows, []);
  assert_equals(proof.final_result, {
    storage_class: "scalar_local",
    escape: "module_result",
    decision: "allowed",
  });
});

Deno.test("pure Ic module gate rejects an unproved memory address", () => {
  assert_throws(
    () =>
      Ic.mod({
        tag: "prim",
        prim: "i32.load",
        args: [{ tag: "var", name: "address" }],
      }, { params: { address: "i32" } }),
    "Pure Ic no-GC proof requires an in-bounds static-data memory address " +
      "at root.args[0]",
  );
});

Deno.test("pure Ic module gate rejects a dynamic offset from static data", () => {
  assert_throws(
    () =>
      Ic.wat({
        tag: "prim",
        prim: "i32.load8_u",
        args: [{
          tag: "prim",
          prim: "i32.add",
          args: [
            { tag: "text", value: "hello" },
            { tag: "var", name: "offset" },
          ],
        }],
      }, { params: { offset: "i32" } }),
    "Pure Ic no-GC proof cannot preserve static address provenance at " +
      "root.args[0]",
  );
});

Deno.test("pure Ic module gate accepts a constant static address transform", () => {
  const mod = Ic.mod({
    tag: "prim",
    prim: "i32.load8_u",
    args: [{
      tag: "prim",
      prim: "i32.sub",
      args: [
        { tag: "text", value: "hello" },
        { tag: "num", type: "i32", value: 0 },
      ],
    }],
  });

  assert_equals(mod.memory?.pages, 1);
});

Deno.test("pure Ic module gate rejects an out-of-bounds static address", () => {
  assert_throws(
    () =>
      Ic.mod({
        tag: "prim",
        prim: "i32.load8_u",
        args: [{
          tag: "prim",
          prim: "i32.add",
          args: [
            { tag: "text", value: "x" },
            { tag: "num", type: "i32", value: 99 },
          ],
        }],
      }),
    "Pure Ic no-GC proof requires an in-bounds static-data memory address",
  );
});

Deno.test("pure Ic proof accepts a scalar recursive call result", () => {
  const proof = ic_no_gc_proof({
    tag: "fix",
    name: "loop",
    expr: {
      tag: "lam",
      name: "value",
      body: { tag: "var", name: "value" },
    },
    body: {
      tag: "app",
      func: { tag: "var", name: "loop" },
      arg: { tag: "num", type: "i32", value: 1 },
    },
  });

  assert_equals(proof.ok, true);
  assert_equals(proof.final_result.storage_class, "scalar_local");
});

Deno.test("pure Ic proof rejects an unknown recursive main result", () => {
  const proof = ic_no_gc_proof({
    tag: "fix",
    name: "loop",
    expr: {
      tag: "lam",
      name: "value",
      body: { tag: "var", name: "value" },
    },
    body: {
      tag: "lam",
      name: "nested",
      body: { tag: "var", name: "nested" },
    },
  });

  assert_equals(proof.ok, false);
  assert_equals(proof.final_result, {
    storage_class: "unknown",
    escape: "module_result",
    decision: "rejected",
  });
});

Deno.test("pure Ic proof rejects a recursive interior pointer result", () => {
  const proof = ic_no_gc_proof({
    tag: "fix",
    name: "loop",
    expr: {
      tag: "lam",
      name: "value",
      body: { tag: "var", name: "value" },
    },
    body: {
      tag: "prim",
      prim: "i32.add",
      args: [
        { tag: "text", value: "hello" },
        { tag: "num", type: "i32", value: 1 },
      ],
    },
  });

  assert_equals(proof.ok, false);
  assert_equals(proof.final_result.decision, "rejected");
});
