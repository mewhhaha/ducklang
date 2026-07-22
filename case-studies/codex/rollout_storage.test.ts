import { assert_equals } from "../../src/assert.ts";
import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL(
  "./rollout_storage_adapter_fixture.duck",
  import.meta.url,
);
const host_interface_url = new URL(
  "./rollout_storage_host.duck",
  import.meta.url,
);

Deno.test("Codex rollout storage keeps filesystem mechanics at the host boundary", async () => {
  const appended: [string, string][] = [];
  let flushes = 0;
  const contents = [
    JSON.stringify({
      timestamp: "2025-01-03T09:00:00Z",
      type: "session_meta",
      payload: {
        id: "thread-live",
        timestamp: "2025-01-03T09:00:00Z",
        cwd: "/repo",
        source: "cli",
        model_provider: "openai",
      },
    }),
    JSON.stringify({
      timestamp: "2025-01-03T09:00:01Z",
      type: "event_msg",
      payload: { type: "user_message", message: "Live task" },
    }),
  ].join("\n");
  const snapshot: [string, string, string][] = [[
    "/home/sessions/2025/01/03/rollout-live.jsonl",
    "2025-01-03T09:00:01Z",
    contents,
  ]];
  const init: FunctionalWasmAsyncInit = {
    RolloutStore: {
      $resource: { kind: "resource", id: 1 },
      snapshot_length: () => integer_value(snapshot.length),
      snapshot_file: (argument) => {
        const index = integer_argument(argument, "rollout snapshot file");
        const file = snapshot[index];
        if (file === undefined) {
          throw new Error(
            "rollout snapshot file index " + index.toString() +
              " is outside " + snapshot.length.toString() + " files",
          );
        }
        return {
          kind: "constructor",
          name: "duck::$DuckStruct:RolloutStoredFile",
          fields: file.map(text_value),
        };
      },
      append: (argument) => {
        const [path, line] = text_arguments(argument, "rollout append");
        appended.push([path, line]);
        return unit_value;
      },
      flush: () => {
        flushes += 1;
        return unit_value;
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
  } finally {
    compiler.destroy();
  }

  assert_equals(appended, [[
    "/home/sessions/2025/01/03/rollout-live.jsonl",
    '{"type":"event_msg"}',
  ]]);
  assert_equals(flushes, 1);
});

const unit_value: FunctionalWasmHostValue = { kind: "unit" };

function text_value(value: string): FunctionalWasmHostValue {
  return { kind: "text", value };
}

function integer_value(value: number): FunctionalWasmHostValue {
  return { kind: "integer", value };
}

function integer_argument(
  value: FunctionalWasmHostValue,
  operation: string,
): number {
  if (value.kind !== "integer") {
    throw new Error(operation + " must receive an I32 argument");
  }
  return value.value;
}

function text_arguments(
  value: FunctionalWasmHostValue,
  operation: string,
): [string, string] {
  if (value.kind !== "tuple") {
    throw new Error(operation + " must receive two Text arguments");
  }
  const [left, right] = value.values;
  if (left.kind !== "text" || right.kind !== "text") {
    throw new Error(operation + " received non-Text arguments");
  }
  return [left.value, right.value];
}
