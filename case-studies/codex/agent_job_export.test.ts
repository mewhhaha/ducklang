import { assert_equals } from "../../src/assert.ts";
import {
  type WasmAsyncInit,
  type WasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL(
  "./agent_job_export_adapter_fixture.duck",
  import.meta.url,
);
const host_interface_url = new URL(
  "./agent_job_export_host.duck",
  import.meta.url,
);

Deno.test("Codex renders agent-job CSV before the host writes it", async () => {
  const writes: { output_path: string; content: string }[] = [];
  const init: WasmAsyncInit = {
    AgentJobExportHost: {
      $resource: { kind: "resource", id: 1 },
      write: (argument) => {
        const request = constructor_fields(
          argument,
          "duck::$DuckStruct:AgentJobCsvWriteRequest",
          2,
        );
        writes.push({
          output_path: text_value(request[0]),
          content: text_value(request[1]),
        });
        return union("AgentJobCsvWriteOutcome", "CsvWritten", {
          kind: "unit",
        });
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

  assert_equals(writes, [{
    output_path: "/repo/output.csv",
    content:
      "name,job_id,item_id,row_index,source_id,status,attempt_count,last_error,result_json,reported_at,completed_at\n" +
      'Ada,job-1,row-1,0,,completed,1,,"{""answer"":42}",,\n',
  }]);
});

function constructor_fields(
  value: WasmHostValue,
  name: string,
  arity: number,
): readonly WasmHostValue[] {
  if (value.kind !== "constructor" || value.name !== name) {
    throw new Error("expected " + name + "; received " + value.kind);
  }
  if (value.fields.length !== arity) {
    throw new Error(name + " expected " + arity.toString() + " fields");
  }
  return value.fields;
}

function text_value(value: WasmHostValue): string {
  if (value.kind !== "text") {
    throw new Error("expected Text; received " + value.kind);
  }
  return value.value;
}

function union(
  type_name: string,
  case_name: string,
  payload: WasmHostValue,
): WasmHostValue {
  return {
    kind: "constructor",
    name: "duck::$DuckUnion:" + type_name + ":" + case_name,
    fields: [payload],
  };
}
