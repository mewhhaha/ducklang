import { assert_equals } from "../../src/assert.ts";
import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL("./test_sync_adapter_fixture.duck", import.meta.url);
const host_interface_url = new URL("./test_sync_host.duck", import.meta.url);

Deno.test("Codex runs synchronization mechanics in source order", async () => {
  const events: string[] = [];
  const init: FunctionalWasmAsyncInit = {
    TestSyncHost: {
      $resource: { kind: "resource", id: 1 },
      sleep: (argument) => {
        events.push("sleep:" + text_argument(argument));
        return { kind: "unit" };
      },
      barrier: (argument) => {
        const fields = constructor_fields(
          argument,
          "duck::$DuckStruct:TestSyncBarrier",
          3,
        );
        const barrier_id = text_argument(fields[0]);
        events.push(
          "barrier:" + barrier_id + ":" +
            text_argument(fields[1]) + ":" + text_argument(fields[2]),
        );
        if (barrier_id === "timeout") {
          return {
            kind: "constructor",
            name: "duck::$DuckUnion:TestSyncBarrierHostResult:TimedOut",
            fields: [{ kind: "unit" }],
          };
        }
        return {
          kind: "constructor",
          name: "duck::$DuckUnion:TestSyncBarrierHostResult:Released",
          fields: [{ kind: "unit" }],
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

  assert_equals(events, [
    "sleep:2",
    "barrier:shared:1:1000",
    "sleep:3",
    "barrier:timeout:2:5",
  ]);
});

function constructor_fields(
  value: FunctionalWasmHostValue,
  name: string,
  arity: number,
): readonly FunctionalWasmHostValue[] {
  if (value.kind !== "constructor" || value.name !== name) {
    throw new Error("expected " + name + "; received " + value.kind);
  }
  if (value.fields.length !== arity) {
    throw new Error(name + " expected " + arity + " fields");
  }
  return value.fields;
}

function text_argument(value: FunctionalWasmHostValue): string {
  if (value.kind !== "text") {
    throw new Error("expected Text; received " + value.kind);
  }
  return value.value;
}
