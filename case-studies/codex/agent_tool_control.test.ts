import { assert_equals } from "../../src/assert.ts";
import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
  type FunctionalWasmInit,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler, type DuckProgram } from "../../src/compiler.ts";

const source_url = new URL(
  "./agent_tool_control_adapter_fixture.duck",
  import.meta.url,
);
const host_interface_url = new URL("./agent_tool_host.duck", import.meta.url);
const interrupt_output_stage_url = new URL(
  "./agent_tool_interrupt_output_stage.duck",
  import.meta.url,
);
const interrupt_output_stage_host_url = new URL(
  "./agent_tool_interrupt_output_stage_host.duck",
  import.meta.url,
);
const wait_output_stage_url = new URL(
  "./agent_tool_wait_output_stage.duck",
  import.meta.url,
);
const wait_output_stage_host_url = new URL(
  "./agent_tool_wait_output_stage_host.duck",
  import.meta.url,
);
const list_output_stage_url = new URL(
  "./agent_tool_list_output_stage.duck",
  import.meta.url,
);
const list_output_stage_host_url = new URL(
  "./agent_tool_list_output_stage_host.duck",
  import.meta.url,
);

Deno.test("Codex controls V2 agents through typed collaboration capabilities", async () => {
  const messages: { operation: string; target: string; message: string }[] = [];
  const interrupts: string[] = [];
  const waits: bigint[] = [];
  const lists: string[] = [];
  const stage_calls: string[] = [];
  const events: string[] = [];
  const compiler = await DuckCompiler.create();
  let interrupt_output_program: DuckProgram | undefined;
  let wait_output_program: DuckProgram | undefined;
  let list_output_program: DuckProgram | undefined;

  try {
    interrupt_output_program = await compiler.prepare_file(
      interrupt_output_stage_url.href,
      { host_interface: interrupt_output_stage_host_url.href },
    );
    wait_output_program = await compiler.prepare_file(
      wait_output_stage_url.href,
      { host_interface: wait_output_stage_host_url.href },
    );
    list_output_program = await compiler.prepare_file(
      list_output_stage_url.href,
      { host_interface: list_output_stage_host_url.href },
    );
    const init: FunctionalWasmAsyncInit = {
      AgentCollaborationHost: {
        $resource: { kind: "resource", id: 1 },
        spawn: () => {
          throw new Error("control fixture must not spawn an agent");
        },
        send: (argument) => {
          messages.push(message_request("send", argument));
          return unit_value;
        },
        followup: (argument) => {
          messages.push(message_request("followup", argument));
          return unit_value;
        },
        interrupt: (argument) => {
          interrupts.push(text_argument(argument, "interrupt target"));
          return status("Interrupted", unit_value);
        },
        wait: (argument) => {
          const fields = constructor_fields(
            argument,
            "duck::$DuckStruct:AgentToolWaitRequest",
            1,
            "wait request",
          );
          waits.push(i64_argument(fields[0], "wait timeout"));
          return {
            kind: "constructor",
            name: "duck::$DuckStruct:AgentToolMailboxSnapshot",
            fields: [integer_value(2), integer_value(0), integer_value(0)],
          };
        },
        list: (argument) => {
          lists.push(option_text_argument(argument, "list path prefix"));
          return status_entries([[
            "/root/reviewer",
            status("Running", unit_value),
          ]]);
        },
        event: (argument) => {
          events.push(lifecycle_event(argument));
          return unit_value;
        },
      },
      AgentCollaborationStages: {
        $resource: { kind: "resource", id: 2 },
        interrupt_output: async (argument) => {
          stage_calls.push("interrupt_output");
          if (interrupt_output_program === undefined) {
            throw new Error("interrupt-output stage was not prepared");
          }
          const execution = await interrupt_output_program.run({
            maximumResultNodes: 4_096,
            init: stage_init(argument, 3),
          });
          return stage_result(execution.value, "interrupt-output");
        },
        wait_output: async (argument) => {
          stage_calls.push("wait_output");
          if (wait_output_program === undefined) {
            throw new Error("wait-output stage was not prepared");
          }
          const execution = await wait_output_program.run({
            maximumResultNodes: 4_096,
            init: stage_init(argument, 4),
          });
          return stage_result(execution.value, "wait-output");
        },
        list_output: async (argument) => {
          stage_calls.push("list_output");
          if (list_output_program === undefined) {
            throw new Error("list-output stage was not prepared");
          }
          const execution = await list_output_program.run({
            maximumResultNodes: 4_096,
            init: stage_init(argument, 5),
          });
          return stage_result(execution.value, "list-output");
        },
      },
    };

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
    if (interrupt_output_program !== undefined) {
      interrupt_output_program.destroy();
    }
    if (wait_output_program !== undefined) {
      wait_output_program.destroy();
    }
    if (list_output_program !== undefined) {
      list_output_program.destroy();
    }
    compiler.destroy();
  }

  assert_equals(messages, [
    {
      operation: "send",
      target: "/root/reviewer",
      message: "report status",
    },
    {
      operation: "followup",
      target: "/root/reviewer",
      message: "check tests",
    },
  ]);
  assert_equals(interrupts, ["/root/reviewer"]);
  assert_equals(waits, [30_000n]);
  assert_equals(lists, ["/root"]);
  assert_equals(stage_calls, [
    "interrupt_output",
    "wait_output",
    "list_output",
  ]);
  assert_equals(events, [
    "AgentInteracted:call-send:/root/reviewer",
    "AgentInteracted:call-followup:/root/reviewer",
    "AgentInterrupted:call-interrupt:/root/reviewer",
    "WaitStarted:call-wait",
    "WaitCompleted:call-wait",
  ]);
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

function message_request(
  operation: string,
  value: FunctionalWasmHostValue,
): { operation: string; target: string; message: string } {
  const fields = constructor_fields(
    value,
    "duck::$DuckStruct:AgentSendRequest",
    2,
    operation + " request",
  );
  return {
    operation,
    target: text_argument(fields[0], operation + " target"),
    message: text_argument(fields[1], operation + " message"),
  };
}

function status_entries(
  entries: [string, FunctionalWasmHostValue][],
): FunctionalWasmHostValue {
  let result = union("AgentStatusEntries", "Nil", unit_value);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const [agent_name, agent_status] = entries[index];
    const entry: FunctionalWasmHostValue = {
      kind: "constructor",
      name: "duck::$DuckStruct:AgentStatusEntry",
      fields: [text_value(agent_name), agent_status],
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

function option_text_argument(
  value: FunctionalWasmHostValue,
  operation: string,
): string {
  const fields = constructor_fields(
    value,
    "duck::$DuckUnion:AgentTextOption:Some",
    1,
    operation,
  );
  return text_argument(fields[0], operation);
}

function i64_argument(
  value: FunctionalWasmHostValue,
  operation: string,
): bigint {
  if (value.kind !== "signed-integer-64") {
    throw new Error(operation + " must be I64; received " + value.kind);
  }
  return value.value;
}

function stage_init(
  argument: FunctionalWasmHostValue,
  resource_id: number,
): FunctionalWasmInit {
  return {
    StageInput: {
      $resource: { kind: "resource", id: resource_id },
      input: () => argument,
    },
  };
}

function stage_result(
  value: FunctionalWasmHostValue,
  operation: string,
): FunctionalWasmHostValue {
  const fields = constructor_fields(
    value,
    "duck::$DuckStruct:duck_entry_result_type",
    1,
    operation + " stage result",
  );
  return fields[0];
}

function lifecycle_event(value: FunctionalWasmHostValue): string {
  if (value.kind !== "constructor") {
    throw new Error("collaboration lifecycle event must be a constructor");
  }
  const prefix = "duck::$DuckUnion:AgentToolLifecycleEvent:";
  if (!value.name.startsWith(prefix)) {
    throw new Error("unexpected collaboration lifecycle event " + value.name);
  }
  if (value.fields.length !== 1 || value.fields[0] === undefined) {
    throw new Error("collaboration lifecycle event must contain one payload");
  }

  const event_name = value.name.slice(prefix.length);
  if (event_name === "WaitStarted" || event_name === "WaitCompleted") {
    return event_name + ":" + text_argument(value.fields[0], event_name);
  }

  const reference = constructor_fields(
    value.fields[0],
    "duck::$DuckStruct:AgentToolEventReference",
    2,
    event_name + " reference",
  );
  return event_name + ":" + text_argument(reference[0], event_name) + ":" +
    text_argument(reference[1], event_name);
}
