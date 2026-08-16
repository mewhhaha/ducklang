import { assert_equals } from "../assert.ts";
import {
  type KernelDefinition,
  KernelEnvironment,
  prop_sort,
  type_equal,
  type_sort,
} from "../frontend.ts";

Deno.test("public frontend exports checked kernel environments", () => {
  const definitions: KernelDefinition[] = [
    {
      tag: "transparent",
      name: "Proposition",
      module: "logic",
      type: type_sort(0),
      value: prop_sort,
      total: true,
    },
  ];
  const environment = KernelEnvironment.from_definitions(definitions);

  assert_equals(
    type_equal(
      { tag: "constant", name: "Proposition" },
      prop_sort,
      environment,
    ),
    true,
  );
});
