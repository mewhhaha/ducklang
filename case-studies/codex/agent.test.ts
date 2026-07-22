import { assert_equals } from "../../src/assert.ts";
import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL("./agent_adapter_fixture.duck", import.meta.url);
const host_interface_url = new URL("./agent_host.duck", import.meta.url);

Deno.test("Codex keeps agent mechanics behind source-owned coordination policy", async () => {
  const spawns: { path: string; prompt: string }[] = [];
  const sends: { agent_id: string; message: string }[] = [];
  const interrupts: string[] = [];
  const waits: { agent_ids: string[]; timeout_ms: number }[] = [];
  const closes: string[] = [];
  const init: FunctionalWasmAsyncInit = {
    AgentHost: {
      $resource: { kind: "resource", id: 1 },
      spawn: (argument) => {
        const fields = constructor_fields(
          argument,
          "duck::$DuckStruct:AgentSpawnRequest",
          2,
          "agent spawn request",
        );
        const path = text_argument(fields[0], "agent spawn path");
        const prompt = text_argument(fields[1], "agent spawn prompt");
        spawns.push({ path, prompt });
        return {
          kind: "constructor",
          name: "duck::$DuckStruct:AgentSpawnSnapshot",
          fields: [text_value("agent-1"), text_value(path), running_status()],
        };
      },
      send: (argument) => {
        const fields = constructor_fields(
          argument,
          "duck::$DuckStruct:AgentSendRequest",
          2,
          "agent send request",
        );
        sends.push({
          agent_id: text_argument(fields[0], "agent send id"),
          message: text_argument(fields[1], "agent send message"),
        });
        return running_status();
      },
      interrupt: (argument) => {
        interrupts.push(text_argument(argument, "agent interrupt id"));
        return status("Interrupted", unit_value);
      },
      wait: (argument) => {
        const fields = constructor_fields(
          argument,
          "duck::$DuckStruct:AgentWaitRequest",
          2,
          "agent wait request",
        );
        const agent_ids = agent_id_arguments(fields[0]);
        const timeout_ms = signed_integer_64_argument(
          fields[1],
          "agent wait timeout",
        );
        waits.push({ agent_ids, timeout_ms });
        const completed = status(
          "Completed",
          union("AgentTextOption", "Some", text_value("finished")),
        );
        return {
          kind: "constructor",
          name: "duck::$DuckStruct:AgentWaitSnapshot",
          fields: [status_entries([["agent-1", completed]]), integer_value(0)],
        };
      },
      close: (argument) => {
        closes.push(text_argument(argument, "agent close id"));
        return status("Shutdown", unit_value);
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
      fields: [{ kind: "integer", value: 11_111 }],
    });
    assert_equals(execution.stats.thunkEvaluations, 1);
  } finally {
    compiler.destroy();
  }

  assert_equals(spawns, [{
    path: "/root/reviewer",
    prompt: "inspect the compiler",
  }]);
  assert_equals(sends, [{ agent_id: "agent-1", message: "report status" }]);
  assert_equals(interrupts, ["agent-1"]);
  assert_equals(waits, [{ agent_ids: ["agent-1"], timeout_ms: 10_000 }]);
  assert_equals(closes, ["agent-1"]);
});

const unit_value: FunctionalWasmHostValue = { kind: "unit" };

function text_value(value: string): FunctionalWasmHostValue {
  return { kind: "text", value };
}

function integer_value(value: number): FunctionalWasmHostValue {
  return { kind: "integer", value };
}

function status(
  name: string,
  payload: FunctionalWasmHostValue,
): FunctionalWasmHostValue {
  return union("AgentStatus", name, payload);
}

function running_status(): FunctionalWasmHostValue {
  return status("Running", unit_value);
}

function union(
  type_name: string,
  case_name: string,
  payload: FunctionalWasmHostValue,
): FunctionalWasmHostValue {
  return {
    kind: "constructor",
    name: "duck::$DuckUnion:" + type_name + ":" + case_name,
    fields: [payload],
  };
}

function status_entries(
  entries: [string, FunctionalWasmHostValue][],
): FunctionalWasmHostValue {
  let result = union("AgentStatusEntries", "Nil", unit_value);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const [agent_id, agent_status] = entries[index];
    const entry: FunctionalWasmHostValue = {
      kind: "constructor",
      name: "duck::$DuckStruct:AgentStatusEntry",
      fields: [text_value(agent_id), agent_status],
    };
    const node: FunctionalWasmHostValue = {
      kind: "constructor",
      name: "duck::$DuckStruct:AgentStatusEntryNode",
      fields: [entry, result],
    };
    result = union("AgentStatusEntries", "Cons", node);
  }
  return result;
}

function agent_id_arguments(value: FunctionalWasmHostValue): string[] {
  const ids: string[] = [];
  let current = value;
  while (
    current.kind === "constructor" &&
    current.name === "duck::$DuckUnion:AgentIds:Cons"
  ) {
    const node = constructor_fields(
      current.fields[0],
      "duck::$DuckStruct:AgentIdNode",
      2,
      "agent id node",
    );
    ids.push(text_argument(node[0], "agent wait id"));
    current = node[1];
  }
  constructor_fields(
    current,
    "duck::$DuckUnion:AgentIds:Nil",
    1,
    "agent id list tail",
  );
  return ids;
}

function constructor_fields(
  value: FunctionalWasmHostValue,
  expected_name: string,
  expected_count: number,
  operation: string,
): readonly FunctionalWasmHostValue[] {
  if (value.kind !== "constructor") {
    throw new Error(
      operation + " must be a constructor; received " + value.kind,
    );
  }
  if (value.name !== expected_name) {
    throw new Error(
      operation + " must be " + expected_name + "; received " + value.name,
    );
  }
  if (value.fields.length !== expected_count) {
    throw new Error(
      operation + " must contain " + expected_count.toString() +
        " fields; received " + value.fields.length.toString(),
    );
  }
  return value.fields;
}

function text_argument(
  value: FunctionalWasmHostValue,
  operation: string,
): string {
  if (value.kind !== "text") {
    throw new Error(operation + " must be Text; received " + value.kind);
  }
  return value.value;
}

function signed_integer_64_argument(
  value: FunctionalWasmHostValue,
  operation: string,
): number {
  if (value.kind !== "signed-integer-64") {
    throw new Error(operation + " must be I64; received " + value.kind);
  }
  const converted = Number(value.value);
  if (BigInt(converted) !== value.value) {
    throw new Error(operation + " is outside the exact Number range");
  }
  return converted;
}
