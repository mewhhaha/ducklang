import { assert_equals } from "../../src/assert.ts";
import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL("./hook_adapter_fixture.duck", import.meta.url);
const host_interface_url = new URL("./hook_host.duck", import.meta.url);

Deno.test("Codex keeps hook process mechanics behind source-owned policy", async () => {
  const requests: {
    command: string;
    input: string;
    cwd: string;
    timeout: number;
  }[] = [];
  const init: FunctionalWasmAsyncInit = {
    HookCommandHost: {
      $resource: { kind: "resource", id: 1 },
      run: (argument) => {
        const fields = struct_fields(argument, "HookCommandRequest", 4);
        requests.push({
          command: text_argument(fields[0], "hook command"),
          input: text_argument(fields[1], "hook input"),
          cwd: text_argument(fields[2], "hook cwd"),
          timeout: integer_argument(fields[3], "hook timeout"),
        });
        return struct_value("HookCommandResult", [
          union_value("HookTextOption", "None", unit_value),
          union_value("HookI32Option", "Some", integer_value(0)),
          text_value(""),
          text_value(""),
        ]);
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
      fields: [{ kind: "integer", value: 3 }],
    });
    assert_equals(execution.stats.thunkEvaluations, 1);
  } finally {
    compiler.destroy();
  }

  assert_equals(requests, [{
    command: "cleanup",
    input:
      '{"session_id":"session","transcript_path":"/repo/rollout.jsonl","cwd":"/repo","hook_event_name":"SessionEnd","reason":"other"}',
    cwd: "/repo",
    timeout: 3,
  }]);
});

const unit_value: FunctionalWasmHostValue = { kind: "unit" };

function struct_value(
  name: string,
  fields: FunctionalWasmHostValue[],
): FunctionalWasmHostValue {
  return {
    kind: "constructor",
    name: "duck::$DuckStruct:" + name,
    fields,
  };
}

function union_value(
  type_name: string,
  case_name: string,
  field: FunctionalWasmHostValue,
): FunctionalWasmHostValue {
  return {
    kind: "constructor",
    name: "duck::$DuckUnion:" + type_name + ":" + case_name,
    fields: [field],
  };
}

function struct_fields(
  value: FunctionalWasmHostValue,
  name: string,
  field_count: number,
): readonly FunctionalWasmHostValue[] {
  const expected_name = "duck::$DuckStruct:" + name;
  if (
    value.kind !== "constructor" ||
    value.name !== expected_name ||
    value.fields.length !== field_count
  ) {
    throw new Error(
      name + " must have " + field_count.toString() + " fields",
    );
  }
  return value.fields;
}

function text_value(value: string): FunctionalWasmHostValue {
  return { kind: "text", value };
}

function integer_value(value: number): FunctionalWasmHostValue {
  return { kind: "integer", value };
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

function integer_argument(
  value: FunctionalWasmHostValue,
  operation: string,
): number {
  if (value.kind !== "integer") {
    throw new Error(operation + " must be an integer; received " + value.kind);
  }
  return value.value;
}
