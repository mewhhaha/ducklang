import { assert_equals } from "../../src/assert.ts";
import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler, type DuckProgram } from "../../src/compiler.ts";

const source_url = new URL(
  "./mcp_resource_adapter_fixture.duck",
  import.meta.url,
);
const host_interface_url = new URL(
  "./mcp_resource_adapter_host.duck",
  import.meta.url,
);
const list_output_stage_url = new URL(
  "./mcp_resource_list_output_stage.duck",
  import.meta.url,
);
const list_output_stage_host_url = new URL(
  "./mcp_resource_list_output_stage_host.duck",
  import.meta.url,
);
const read_output_stage_url = new URL(
  "./mcp_resource_read_output_stage.duck",
  import.meta.url,
);
const read_output_stage_host_url = new URL(
  "./mcp_resource_read_output_stage_host.duck",
  import.meta.url,
);

Deno.test("Codex accesses MCP resources through a typed transport", async () => {
  const events: string[] = [];
  const lists: string[] = [];
  const reads: { server: string; uri: string }[] = [];
  const stage_calls: string[] = [];
  const compiler = await DuckCompiler.create();
  let list_output_program: DuckProgram | undefined;
  let read_output_program: DuckProgram | undefined;

  try {
    list_output_program = await compiler.prepare_file(
      list_output_stage_url.href,
      { host_interface: list_output_stage_host_url.href },
    );
    read_output_program = await compiler.prepare_file(
      read_output_stage_url.href,
      { host_interface: read_output_stage_host_url.href },
    );
    const init: FunctionalWasmAsyncInit = {
      McpResourceHost: {
        $resource: { kind: "resource", id: 1 },
        event: (argument) => {
          const fields = constructor_fields(
            argument,
            "duck::$DuckStruct:McpResourceEvent",
            6,
          );
          events.push(
            text_value(fields[0]) + ":" + boolean_value(fields[3]).toString() +
              ":" + boolean_value(fields[4]).toString(),
          );
          return { kind: "unit" };
        },
        invoke: (argument) => {
          const request = constructor_fields(
            argument,
            "duck::$DuckStruct:McpResourceHostRequest",
            1,
          );
          const raw_operation = request[0];
          if (
            raw_operation.kind === "constructor" &&
            raw_operation.name ===
              "duck::$DuckUnion:McpResourceOperation:ListResources"
          ) {
            lists.push("list_mcp_resources");
            return listed_response();
          }
          const operation = constructor_fields(
            raw_operation,
            "duck::$DuckUnion:McpResourceOperation:ReadResource",
            1,
          );
          const read = constructor_fields(
            operation[0],
            "duck::$DuckStruct:McpResourceReadArgs",
            2,
          );
          const server = text_value(read[0]);
          const uri = text_value(read[1]);
          reads.push({ server, uri });

          if (uri.endsWith("missing")) {
            return union(
              "McpResourceHostResponse",
              "Failed",
              text("resource not found: " + uri),
            );
          }

          return union(
            "McpResourceHostResponse",
            "Read",
            text('{"contents":[{"text":"hello"}]}'),
          );
        },
      },
      McpResourceStages: {
        $resource: { kind: "resource", id: 2 },
        list_output: async (argument) => {
          stage_calls.push("list_output");
          if (list_output_program === undefined) {
            throw new Error("MCP list-output stage was not prepared");
          }
          const execution = await list_output_program.run({
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
        read_output: async (argument) => {
          stage_calls.push("read_output");
          if (read_output_program === undefined) {
            throw new Error("MCP read-output stage was not prepared");
          }
          const execution = await read_output_program.run({
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
      },
    };

    const execution = await compiler.run_async_file(source_url.href, {
      host_interface: host_interface_url.href,
      init,
    });
    assert_equals(execution.value, {
      kind: "constructor",
      name: "duck::$DuckStruct:duck_entry_result_type",
      fields: [{ kind: "integer", value: 111 }],
    });
    assert_equals(execution.stats.thunkEvaluations, 1);
  } finally {
    if (list_output_program !== undefined) {
      list_output_program.destroy();
    }
    if (read_output_program !== undefined) {
      read_output_program.destroy();
    }
    compiler.destroy();
  }

  assert_equals(lists, ["list_mcp_resources"]);
  assert_equals(reads, [
    { server: "docs", uri: "skill://alpha" },
    { server: "docs", uri: "skill://missing" },
  ]);
  assert_equals(events, [
    "call-list:false:true",
    "call-list:true:true",
    "call-read:false:true",
    "call-read:true:true",
    "call-missing:false:true",
    "call-missing:true:false",
  ]);
  assert_equals(stage_calls, ["list_output", "read_output"]);
});

function stage_result(
  value: FunctionalWasmHostValue,
): FunctionalWasmHostValue {
  if (value.kind !== "constructor") {
    throw new Error(
      "MCP output stage returned " + value.kind + " instead of a struct",
    );
  }
  if (value.name !== "duck::$DuckStruct:duck_entry_result_type") {
    throw new Error("MCP output stage returned unexpected " + value.name);
  }
  if (value.fields.length !== 1 || value.fields[0] === undefined) {
    throw new Error("MCP output stage must return exactly one result");
  }
  return value.fields[0];
}

function constructor_fields(
  value: FunctionalWasmHostValue,
  name: string,
  arity: number,
): readonly FunctionalWasmHostValue[] {
  if (value.kind !== "constructor" || value.name !== name) {
    throw new Error("expected " + name + "; received " + value.kind);
  }
  if (value.fields.length !== arity) {
    throw new Error(name + " expected " + arity.toString() + " fields");
  }
  return value.fields;
}

function text_value(value: FunctionalWasmHostValue): string {
  if (value.kind !== "text") {
    throw new Error("expected Text; received " + value.kind);
  }
  return value.value;
}

function boolean_value(value: FunctionalWasmHostValue): boolean {
  if (value.kind !== "integer") {
    throw new Error("expected Bool; received " + value.kind);
  }
  if (value.value === 0) {
    return false;
  }
  if (value.value === 1) {
    return true;
  }
  throw new Error("expected Bool representation; received " + value.value);
}

function text(value: string): FunctionalWasmHostValue {
  return { kind: "text", value };
}

function listed_response(): FunctionalWasmHostValue {
  const values = union(
    "McpResourceTexts",
    "Cons",
    {
      kind: "constructor",
      name: "duck::$DuckStruct:McpResourceTextNode",
      fields: [
        text('{"uri":"skill://alpha","name":"alpha"}'),
        union("McpResourceTexts", "Nil", { kind: "unit" }),
      ],
    },
  );
  const page: FunctionalWasmHostValue = {
    kind: "constructor",
    name: "duck::$DuckStruct:McpResourcePage",
    fields: [
      text("docs"),
      values,
      union("McpResourceTextOption", "None", { kind: "unit" }),
    ],
  };
  const pages = union(
    "McpResourcePages",
    "Cons",
    {
      kind: "constructor",
      name: "duck::$DuckStruct:McpResourcePageNode",
      fields: [
        page,
        union("McpResourcePages", "Nil", { kind: "unit" }),
      ],
    },
  );
  return union("McpResourceHostResponse", "Listed", pages);
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
