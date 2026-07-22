import { assert_equals } from "../../src/assert.ts";
import { type FunctionalWasmAsyncInit } from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL(
  "./wait_for_environment_adapter_fixture.duck",
  import.meta.url,
);
const host_interface_url = new URL(
  "./wait_for_environment_host.duck",
  import.meta.url,
);

Deno.test("Codex waits through a typed environment capability", async () => {
  const environment_ids: string[] = [];
  const init: FunctionalWasmAsyncInit = {
    WaitForEnvironmentHost: {
      $resource: { kind: "resource", id: 1 },
      wait: (argument) => {
        if (argument.kind !== "text") {
          throw new Error(
            "wait_for_environment id must be Text; received " + argument.kind,
          );
        }
        environment_ids.push(argument.value);
        return { kind: "integer", value: 1 };
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

  assert_equals(environment_ids, ["gpu"]);
});
