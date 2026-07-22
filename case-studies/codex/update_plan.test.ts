import { assert_equals } from "../../src/assert.ts";
import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL(
  "./update_plan_adapter_fixture.duck",
  import.meta.url,
);
const host_interface_url = new URL(
  "./update_plan_host.duck",
  import.meta.url,
);

Deno.test("Codex publishes typed plan updates through the host boundary", async () => {
  const published_plans: FunctionalWasmHostValue[] = [];
  const init: FunctionalWasmAsyncInit = {
    UpdatePlanHost: {
      $resource: { kind: "resource", id: 1 },
      publish: (argument) => {
        published_plans.push(argument);
        return { kind: "unit" };
      },
    },
  };

  const compiler = await DuckCompiler.create();
  try {
    const execution = await compiler.run_async_file(source_url.href, {
      host_interface: host_interface_url.href,
      init,
    });
    assert_equals(execution.value, {
      kind: "constructor",
      name: "duck::$DuckStruct:duck_entry_result_type",
      fields: [{ kind: "integer", value: 1 }],
    });
    assert_equals(execution.stats.thunkEvaluations, 1);
  } finally {
    compiler.destroy();
  }

  assert_equals(published_plans, [{
    kind: "constructor",
    name: "duck::$DuckStruct:UpdatePlanArgs",
    fields: [
      {
        kind: "constructor",
        name: "duck::$DuckUnion:UpdatePlanTextOption:Some",
        fields: [{ kind: "text", value: "Publish the typed plan" }],
      },
      {
        kind: "constructor",
        name: "duck::$DuckUnion:UpdatePlanSteps:Cons",
        fields: [{
          kind: "constructor",
          name: "duck::$DuckStruct:UpdatePlanStepNode",
          fields: [
            {
              kind: "constructor",
              name: "duck::$DuckStruct:UpdatePlanStep",
              fields: [
                { kind: "text", value: "Port update_plan" },
                {
                  kind: "constructor",
                  name: "duck::$DuckUnion:UpdatePlanStepStatus:InProgress",
                  fields: [{ kind: "unit" }],
                },
              ],
            },
            {
              kind: "constructor",
              name: "duck::$DuckUnion:UpdatePlanSteps:Nil",
              fields: [{ kind: "unit" }],
            },
          ],
        }],
      },
    ],
  }]);
});
