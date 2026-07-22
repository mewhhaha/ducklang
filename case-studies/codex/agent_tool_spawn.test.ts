import { assert_equals } from "../../src/assert.ts";
import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler, type DuckProgram } from "../../src/compiler.ts";

const source_url = new URL(
  "./agent_tool_spawn_adapter_fixture.duck",
  import.meta.url,
);
const rejection_source_url = new URL(
  "./agent_tool_spawn_rejection_adapter_fixture.duck",
  import.meta.url,
);
const host_interface_url = new URL("./agent_tool_host.duck", import.meta.url);
const output_stage_url = new URL(
  "./agent_tool_spawn_output_stage.duck",
  import.meta.url,
);
const output_stage_host_url = new URL(
  "./agent_tool_spawn_output_stage_host.duck",
  import.meta.url,
);
const override_stage_url = new URL(
  "./agent_spawn_override_stage.duck",
  import.meta.url,
);
const override_stage_host_url = new URL(
  "./agent_spawn_override_stage_host.duck",
  import.meta.url,
);

Deno.test("Codex spawns V2 agents through a typed collaboration capability", async () => {
  const requests: {
    path: string;
    message: string;
    recent_turns: bigint;
    model: string;
    reasoning_effort: string;
  }[] = [];
  const stage_calls: string[] = [];
  const events: string[] = [];
  const telemetry: string[] = [];
  const compiler = await DuckCompiler.create();
  const override_compiler = await DuckCompiler.create();
  let output_program: DuckProgram | undefined;
  let override_program: DuckProgram | undefined;

  try {
    override_program = await override_compiler.prepare_file(
      override_stage_url.href,
      {
        host_interface: override_stage_host_url.href,
      },
    );
    output_program = await compiler.prepare_file(output_stage_url.href, {
      host_interface: output_stage_host_url.href,
    });
    const init: FunctionalWasmAsyncInit = {
      AgentCollaborationHost: {
        $resource: { kind: "resource", id: 1 },
        spawn_override_facts: () => spawn_override_facts(),
        spawn: (argument) => {
          const fields = constructor_fields(
            argument,
            "duck::$DuckStruct:AgentToolSpawnPlanRequest",
            5,
            "spawn request",
          );
          requests.push({
            path: text_argument(fields[0], "spawn path"),
            message: text_argument(fields[1], "spawn message"),
            recent_turns: union_i64_argument(
              fields[2],
              "AgentToolForkTurns",
              "ForkRecentTurns",
              "fork turns",
            ),
            model: option_text_argument(fields[3], "spawn model"),
            reasoning_effort: option_text_argument(
              fields[4],
              "spawn reasoning effort",
            ),
          });
          return {
            kind: "constructor",
            name: "duck::$DuckStruct:AgentToolSpawnSnapshot",
            fields: [
              text_value("/root/reviewer"),
              union("AgentTextOption", "Some", text_value("reviewer")),
              union("AgentStatus", "Running", unit_value),
            ],
          };
        },
        event: (argument) => {
          const event = constructor_fields(
            argument,
            "duck::$DuckUnion:AgentToolLifecycleEvent:AgentStarted",
            1,
            "spawn lifecycle event",
          );
          const reference = constructor_fields(
            event[0],
            "duck::$DuckStruct:AgentToolEventReference",
            2,
            "spawn lifecycle reference",
          );
          events.push(
            text_argument(reference[0], "spawn lifecycle call id") + ":" +
              text_argument(reference[1], "spawn lifecycle path"),
          );
          return unit_value;
        },
        spawn_telemetry: (argument) => {
          const fields = constructor_fields(
            argument,
            "duck::$DuckStruct:AgentToolSpawnTelemetry",
            2,
            "spawn telemetry",
          );
          telemetry.push(
            text_argument(fields[0], "spawn telemetry role") + ":" +
              text_argument(fields[1], "spawn telemetry version"),
          );
          return unit_value;
        },
      },
      AgentCollaborationStages: {
        $resource: { kind: "resource", id: 2 },
        spawn_override: async (argument) => {
          stage_calls.push("spawn_override");
          if (override_program === undefined) {
            throw new Error("spawn-override stage was not prepared");
          }
          const execution = await override_program.run({
            maximumResultNodes: 4_096,
            init: {
              StageInput: {
                $resource: { kind: "resource", id: 4 },
                input: () => argument,
              },
            },
          });
          return stage_result(execution.value);
        },
        spawn_output: async (argument) => {
          stage_calls.push("spawn_output");
          if (output_program === undefined) {
            throw new Error("spawn-output stage was not prepared");
          }
          const execution = await output_program.run({
            maximumResultNodes: 4_096,
            init: {
              StageInput: {
                $resource: { kind: "resource", id: 3 },
                input: () => argument,
              },
            },
          });
          return stage_result(execution.value);
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
      fields: [{ kind: "integer", value: 1 }],
    });
    assert_equals(execution.stats.thunkEvaluations, 1);
  } finally {
    if (override_program !== undefined) {
      override_program.destroy();
    }
    if (output_program !== undefined) {
      output_program.destroy();
    }
    override_compiler.destroy();
    compiler.destroy();
  }

  assert_equals(requests, [{
    path: "/root/reviewer",
    message: "inspect the compiler",
    recent_turns: 3n,
    model: "gpt-5.6",
    reasoning_effort: "high",
  }]);
  assert_equals(stage_calls, ["spawn_override", "spawn_output"]);
  assert_equals(events, ["call-spawn:/root/reviewer"]);
  assert_equals(telemetry, ["default:v2"]);
});

Deno.test("Codex rejects an unavailable V2 model before spawning", async () => {
  let spawn_calls = 0;
  const compiler = await DuckCompiler.create();
  const override_compiler = await DuckCompiler.create();
  let override_program: DuckProgram | undefined;

  try {
    override_program = await override_compiler.prepare_file(
      override_stage_url.href,
      { host_interface: override_stage_host_url.href },
    );
    const init: FunctionalWasmAsyncInit = {
      AgentCollaborationHost: {
        $resource: { kind: "resource", id: 1 },
        spawn_override_facts: () => spawn_override_facts(),
        spawn: () => {
          spawn_calls += 1;
          throw new Error("rejected spawn must not reach the host");
        },
        spawn_telemetry: () => {
          throw new Error("rejected spawn must not emit telemetry");
        },
        event: () => {
          throw new Error("rejected spawn must not emit lifecycle events");
        },
      },
      AgentCollaborationStages: {
        $resource: { kind: "resource", id: 2 },
        spawn_override: async (argument) => {
          if (override_program === undefined) {
            throw new Error("spawn-override stage was not prepared");
          }
          const execution = await override_program.run({
            maximumResultNodes: 4_096,
            init: {
              StageInput: {
                $resource: { kind: "resource", id: 3 },
                input: () => argument,
              },
            },
          });
          return stage_result(execution.value);
        },
        spawn_output: () => {
          throw new Error("rejected spawn must not render spawn output");
        },
      },
    };

    const execution = await compiler.run_async_file(
      rejection_source_url.href,
      { host_interface: host_interface_url.href, init },
    );
    assert_equals(execution.value, {
      kind: "constructor",
      name: "duck::$DuckStruct:duck_entry_result_type",
      fields: [{ kind: "integer", value: 1 }],
    });
    assert_equals(execution.stats.thunkEvaluations, 1);
  } finally {
    if (override_program !== undefined) {
      override_program.destroy();
    }
    override_compiler.destroy();
    compiler.destroy();
  }

  assert_equals(spawn_calls, 0);
});

const unit_value: FunctionalWasmHostValue = { kind: "unit" };

function text_value(value: string): FunctionalWasmHostValue {
  return { kind: "text", value };
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

function structure(
  type_name: string,
  fields: FunctionalWasmHostValue[],
): FunctionalWasmHostValue {
  return {
    kind: "constructor",
    name: "duck::$DuckStruct:" + type_name,
    fields,
  };
}

function spawn_override_facts(): FunctionalWasmHostValue {
  const efforts = spawn_override_efforts(["medium", "high"]);
  const model = structure("AgentSpawnOverrideModel", [
    text_value("gpt-5.6"),
    { kind: "integer", value: 1 },
    { kind: "integer", value: 1 },
    union("AgentTextOption", "Some", text_value("medium")),
    efforts,
  ]);
  const models = union(
    "AgentSpawnOverrideModels",
    "Cons",
    structure("AgentSpawnOverrideModelNode", [
      model,
      union("AgentSpawnOverrideModels", "Nil", unit_value),
    ]),
  );
  return structure("AgentSpawnOverrideFacts", [
    text_value("gpt-5.6"),
    union("AgentTextOption", "Some", text_value("medium")),
    spawn_override_efforts(["medium", "high"]),
    union("AgentTextOption", "None", unit_value),
    union("AgentTextOption", "None", unit_value),
    models,
  ]);
}

function spawn_override_efforts(
  names: readonly string[],
): FunctionalWasmHostValue {
  let efforts = union("AgentSpawnOverrideEfforts", "Nil", unit_value);
  for (let index = names.length - 1; index >= 0; index -= 1) {
    efforts = union(
      "AgentSpawnOverrideEfforts",
      "Cons",
      structure("AgentSpawnOverrideEffortNode", [
        text_value(names[index]),
        efforts,
      ]),
    );
  }
  return efforts;
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

function union_i64_argument(
  value: FunctionalWasmHostValue,
  type_name: string,
  case_name: string,
  operation: string,
): bigint {
  const fields = constructor_fields(
    value,
    "duck::$DuckUnion:" + type_name + ":" + case_name,
    1,
    operation,
  );
  const payload = fields[0];
  if (payload.kind !== "signed-integer-64") {
    throw new Error(operation + " must contain I64; received " + payload.kind);
  }
  return payload.value;
}

function stage_result(
  value: FunctionalWasmHostValue,
): FunctionalWasmHostValue {
  const fields = constructor_fields(
    value,
    "duck::$DuckStruct:duck_entry_result_type",
    1,
    "spawn-output stage result",
  );
  return fields[0];
}
