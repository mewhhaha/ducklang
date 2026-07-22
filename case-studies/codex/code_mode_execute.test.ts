import { assert_equals } from "../../src/assert.ts";
import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL(
  "./code_mode_execute_adapter_fixture.duck",
  import.meta.url,
);
const host_interface_url = new URL(
  "./code_mode_execute_host.duck",
  import.meta.url,
);

Deno.test("Codex executes code-mode cells in source-owned lifecycle order", async () => {
  const events: string[] = [];
  const init: FunctionalWasmAsyncInit = {
    CodeModeExecuteHost: {
      $resource: { kind: "resource", id: 1 },
      start_timer: () => {
        events.push("timer");
        return {
          kind: "constructor",
          name: "duck::$DuckStruct:CodeModeExecuteTimer",
          fields: [text_value("timer-1")],
        };
      },
      execute: (argument) => {
        const request = constructor_fields(
          argument,
          "duck::$DuckStruct:CodeModeExecuteRequest",
          5,
        );
        const call_id = text_argument(request[0]);
        events.push("execute:" + call_id);
        if (call_id === "call-fail") {
          return union(
            "CodeModeExecuteStartResult",
            "CodeModeExecuteStartFailed",
            text_value("runtime unavailable"),
          );
        }
        return union(
          "CodeModeExecuteStartResult",
          "CodeModeExecuteStarted",
          {
            kind: "constructor",
            name: "duck::$DuckStruct:CodeModeStartedCell",
            fields: [text_value("cell-1")],
          },
        );
      },
      start_trace: (argument) => {
        const trace = constructor_fields(
          argument,
          "duck::$DuckStruct:CodeModeExecuteTraceStart",
          4,
        );
        events.push(
          "trace:" + text_argument(trace[0]) + ":" +
            text_argument(trace[1]) + ":" + text_argument(trace[2]),
        );
        return {
          kind: "constructor",
          name: "duck::$DuckStruct:CodeModeExecuteTrace",
          fields: [text_value("trace-1")],
        };
      },
      mark_cell_ready: (argument) => {
        events.push("ready:" + text_argument(argument));
        return unit_value;
      },
      initial_response: (argument) => {
        events.push("initial:" + text_argument(argument));
        return union(
          "CodeModeExecuteInitialResponseResult",
          "CodeModeInitialResponse",
          runtime_result("cell-1", "done"),
        );
      },
      record_initial_response: (argument) => {
        const [trace] = tuple_values(argument);
        events.push("record-initial:" + trace_id(trace));
        return unit_value;
      },
      record_ended: (argument) => {
        const [trace] = tuple_values(argument);
        events.push("record-ended:" + trace_id(trace));
        return unit_value;
      },
      close_cell: (argument) => {
        events.push("close:" + text_argument(argument));
        return unit_value;
      },
      wait_until_elicitations_clear: () => {
        events.push("elicitations");
        return unit_value;
      },
      elapsed_microseconds: (argument) => {
        const timer = constructor_fields(
          argument,
          "duck::$DuckStruct:CodeModeExecuteTimer",
          1,
        );
        events.push("elapsed:" + text_argument(timer[0]));
        return { kind: "signed-integer-64", value: 150_000n };
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
    "timer",
    "execute:call-ok",
    "trace:turn-sub:cell-1:call-ok",
    "ready:cell-1",
    "initial:cell-1",
    "record-initial:trace-1",
    "record-ended:trace-1",
    "close:cell-1",
    "elicitations",
    "elapsed:timer-1",
    "timer",
    "execute:call-fail",
  ]);
});

const unit_value: FunctionalWasmHostValue = { kind: "unit" };

function text_value(text: string): FunctionalWasmHostValue {
  return { kind: "text", value: text };
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

function runtime_result(
  cell_id: string,
  text: string,
): FunctionalWasmHostValue {
  const content = union(
    "CodeModeRuntimeContentItems",
    "RuntimeItemsCons",
    {
      kind: "constructor",
      name: "duck::$DuckStruct:CodeModeRuntimeContentItemNode",
      fields: [
        union(
          "CodeModeRuntimeContentItem",
          "RuntimeInputText",
          text_value(text),
        ),
        union("CodeModeRuntimeContentItems", "RuntimeItemsNil", unit_value),
      ],
    },
  );
  const result: FunctionalWasmHostValue = {
    kind: "constructor",
    name: "duck::$DuckStruct:CodeModeRuntimeResult",
    fields: [
      text_value(cell_id),
      content,
      union("CodeModeRuntimeError", "RuntimeErrorMissing", unit_value),
    ],
  };
  return union("CodeModeRuntimeResponse", "RuntimeResult", result);
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

function trace_id(value: FunctionalWasmHostValue): string {
  const trace = constructor_fields(
    value,
    "duck::$DuckStruct:CodeModeExecuteTrace",
    1,
  );
  return text_argument(trace[0]);
}

function tuple_values(
  value: FunctionalWasmHostValue,
): readonly [FunctionalWasmHostValue, FunctionalWasmHostValue] {
  if (value.kind !== "tuple") {
    throw new Error("expected tuple; received " + value.kind);
  }
  return value.values;
}
