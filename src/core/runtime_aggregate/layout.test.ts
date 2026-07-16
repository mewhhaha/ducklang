import { assert_equals, assert_throws } from "../../assert.ts";
import type { CoreExpr } from "../ast.ts";
import { runtime_aggregate_layout_for_type } from "./layout.ts";

Deno.test("runtime aggregate layout rejects a field without a layout fact", () => {
  const aggregate_type: CoreExpr = {
    tag: "struct_type",
    fields: [{ name: "payload", type_name: "MissingLayout" }],
  };

  assert_throws(
    () =>
      runtime_aggregate_layout_for_type(aggregate_type, {
        statics: new Map<string, CoreExpr>(),
      }),
    "Missing runtime aggregate layout for type: MissingLayout",
  );
});

Deno.test("runtime aggregate layout stores f32 fields at four-byte alignment", () => {
  const aggregate_type: CoreExpr = {
    tag: "struct_type",
    fields: [
      { name: "tag", type_name: "I32" },
      { name: "weight", type_name: "F32" },
    ],
  };

  assert_equals(
    runtime_aggregate_layout_for_type(aggregate_type, {
      statics: new Map<string, CoreExpr>(),
    }),
    {
      align: 4,
      fields: [
        {
          name: "tag",
          offset: 0,
          resume: false,
          tag: "value",
          text: false,
          type: "i32",
          union_type_expr: undefined,
        },
        {
          name: "weight",
          offset: 4,
          resume: false,
          tag: "value",
          text: false,
          type: "f32",
          union_type_expr: undefined,
        },
      ],
      size: 8,
      type_expr: aggregate_type,
    },
  );
});

Deno.test("runtime aggregate layout aligns F32x4 fields to 16 bytes", () => {
  const aggregate_type: CoreExpr = {
    tag: "struct_type",
    fields: [
      { name: "prefix", type_name: "I32" },
      { name: "lanes", type_name: "F32x4" },
    ],
  };

  assert_equals(
    runtime_aggregate_layout_for_type(aggregate_type, {
      statics: new Map<string, CoreExpr>(),
    }),
    {
      align: 16,
      fields: [
        {
          name: "prefix",
          offset: 0,
          resume: false,
          tag: "value",
          text: false,
          type: "i32",
          union_type_expr: undefined,
        },
        {
          name: "lanes",
          offset: 16,
          resume: false,
          tag: "value",
          text: false,
          type: "v128",
          union_type_expr: undefined,
        },
      ],
      size: 32,
      type_expr: aggregate_type,
    },
  );
});
