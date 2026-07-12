import { assert_throws } from "../../assert.ts";
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
