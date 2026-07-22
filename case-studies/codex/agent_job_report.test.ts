import { assert_equals } from "../../src/assert.ts";
import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL(
  "./agent_job_report_adapter_fixture.duck",
  import.meta.url,
);
const host_interface_url = new URL("./agent_job_host.duck", import.meta.url);

Deno.test("Codex records agent-job results through a typed capability", async () => {
  const reports: {
    job_id: string;
    item_id: string;
    result_json: string;
    stop: boolean;
  }[] = [];
  const cancellations: string[] = [];
  const init: FunctionalWasmAsyncInit = {
    AgentJobHost: {
      $resource: { kind: "resource", id: 1 },
      record: (argument) => {
        const fields = constructor_fields(
          argument,
          "duck::$DuckStruct:AgentJobReportArgs",
          4,
        );
        const report = {
          job_id: text_value(fields[0]),
          item_id: text_value(fields[1]),
          result_json: text_value(fields[2]),
          stop: bool_value(fields[3]),
        };
        reports.push(report);
        if (report.item_id === "row-1") {
          return { kind: "integer", value: 1 };
        }
        return { kind: "integer", value: 0 };
      },
      cancel: (argument) => {
        cancellations.push(text_value(argument));
        return { kind: "unit" };
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

  assert_equals(reports, [
    {
      job_id: "job-1",
      item_id: "row-1",
      result_json: '{"answer":42}',
      stop: true,
    },
    {
      job_id: "job-1",
      item_id: "row-2",
      result_json: "{}",
      stop: false,
    },
  ]);
  assert_equals(cancellations, ["job-1"]);
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

function bool_value(value: FunctionalWasmHostValue): boolean {
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
