import { assert_equals } from "../../src/assert.ts";
import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL(
  "./current_time_adapter_fixture.duck",
  import.meta.url,
);
const host_interface_url = new URL(
  "./current_time_host.duck",
  import.meta.url,
);

Deno.test("Codex keeps clock mechanics behind source-owned tool policy", async () => {
  const sleep_durations: bigint[] = [];
  const init: FunctionalWasmAsyncInit = {
    CurrentTimeHost: {
      $resource: { kind: "resource", id: 1 },
      current_time: () => signed_integer_64_value(1_781_717_655n),
      sleep: (argument) => {
        const duration_ms = signed_integer_64_argument(
          argument,
          "clock sleep duration",
        );
        sleep_durations.push(duration_ms);
        return {
          kind: "constructor",
          name: "duck::$DuckStruct:CurrentTimeSleepHostResult",
          fields: [
            { kind: "integer", value: 1 },
            signed_integer_64_value(1_000_000n),
          ],
        };
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
      fields: [{ kind: "integer", value: 11 }],
    });
    assert_equals(execution.stats.thunkEvaluations, 1);
  } finally {
    compiler.destroy();
  }

  assert_equals(sleep_durations, [1_000n]);
});

function signed_integer_64_value(value: bigint): FunctionalWasmHostValue {
  return { kind: "signed-integer-64", value };
}

function signed_integer_64_argument(
  value: FunctionalWasmHostValue,
  operation: string,
): bigint {
  if (value.kind !== "signed-integer-64") {
    throw new Error(operation + " must be I64; received " + value.kind);
  }
  return value.value;
}
