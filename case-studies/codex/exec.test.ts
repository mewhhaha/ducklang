import { assert_equals } from "../../src/assert.ts";
import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL("./exec_adapter_fixture.duck", import.meta.url);
const sandbox_source_url = new URL(
  "./exec_sandbox_adapter_fixture.duck",
  import.meta.url,
);
const host_interface_url = new URL("./exec_host.duck", import.meta.url);
const events_source_url = new URL(
  "./exec_events_adapter_fixture.duck",
  import.meta.url,
);
const events_host_interface_url = new URL(
  "./exec_events_host.duck",
  import.meta.url,
);

Deno.test("Codex process execution keeps spawn mechanics at the host boundary", async () => {
  const starts: {
    argv: string[];
    cwd: string;
    tty: boolean;
    yield_ms: number;
    bypass_sandbox: boolean;
  }[] = [];
  const writes: { process_id: number; input: string; yield_ms: number }[] = [];
  const init: FunctionalWasmAsyncInit = {
    ProcessHost: {
      $resource: { kind: "resource", id: 1 },
      start: (argument) => {
        if (
          argument.kind !== "constructor" ||
          argument.name !== "duck::$DuckStruct:ExecLaunch" ||
          argument.fields.length !== 9
        ) {
          throw new Error("process start must receive ExecLaunch");
        }
        const launch = argument.fields;
        const argv = launch.slice(0, 4).map((value) => {
          return text_argument(value, "process argv");
        });
        const argc = integer_argument(launch[4], "process argc");
        starts.push({
          argv: argv.slice(0, argc),
          cwd: text_argument(launch[5], "process cwd"),
          tty: bool_argument(launch[6], "process tty"),
          yield_ms: integer_argument(launch[7], "process yield"),
          bypass_sandbox: bool_argument(
            launch[8],
            "process sandbox bypass",
          ),
        });
        return process_snapshot(7, "abcde", false, undefined, false);
      },
      write: (argument) => {
        if (argument.kind !== "tuple") {
          throw new Error("process write must receive three arguments");
        }
        const [process_value, write_tail] = argument.values;
        if (write_tail.kind !== "tuple") {
          throw new Error("process write must receive three arguments");
        }
        const [input_value, yield_value] = write_tail.values;
        writes.push({
          process_id: integer_argument(process_value, "process id"),
          input: text_argument(input_value, "process input"),
          yield_ms: integer_argument(yield_value, "process poll yield"),
        });
        return process_snapshot(7, "fghijklmnop", true, 0, false);
      },
      terminate: () => unit_value,
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
  } finally {
    compiler.destroy();
  }

  assert_equals(starts, [{
    argv: ["/bin/zsh", "-c", "printf abcdefghijklmnop"],
    cwd: "/repo",
    tty: true,
    yield_ms: 250,
    bypass_sandbox: false,
  }]);
  assert_equals(writes, [{ process_id: 7, input: "", yield_ms: 5000 }]);
});

Deno.test("Codex retries sandbox denials from source policy", async () => {
  const bypasses: boolean[] = [];
  const init: FunctionalWasmAsyncInit = {
    ProcessHost: {
      $resource: { kind: "resource", id: 1 },
      start: (argument) => {
        if (
          argument.kind !== "constructor" ||
          argument.name !== "duck::$DuckStruct:ExecLaunch" ||
          argument.fields.length !== 9
        ) {
          throw new Error("process start must receive ExecLaunch");
        }
        const bypass = bool_argument(
          argument.fields[8],
          "process sandbox bypass",
        );
        bypasses.push(bypass);
        if (bypass) {
          return process_snapshot(8, "ok", true, 0, false);
        }
        return process_snapshot(7, "sandbox denied", true, 1, true);
      },
      write: () => {
        throw new Error("sandbox retry fixture must not poll a process");
      },
      terminate: () => unit_value,
    },
  };

  const compiler = await DuckCompiler.create();
  try {
    const execution = await compiler.run_async_file(sandbox_source_url.href, {
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

  assert_equals(bypasses, [false, true]);
});

Deno.test("Codex emits terminal lifecycle records selected by source", async () => {
  const events: { name: string; field_count: number }[] = [];
  const capture = (argument: FunctionalWasmHostValue) => {
    if (argument.kind !== "constructor") {
      throw new Error(
        "terminal event must be a constructor; received " + argument.kind,
      );
    }
    events.push({ name: argument.name, field_count: argument.fields.length });
    return unit_value;
  };
  const init: FunctionalWasmAsyncInit = {
    ExecEvents: {
      $resource: { kind: "resource", id: 1 },
      begin: capture,
      output_delta: capture,
      interaction: capture,
      end: capture,
    },
  };

  const compiler = await DuckCompiler.create();
  try {
    const execution = await compiler.run_async_file(events_source_url.href, {
      host_interface: events_host_interface_url.href,
      init,
    });
    assert_equals(execution.value, {
      kind: "constructor",
      name: "duck::$DuckStruct:duck_entry_result_type",
      fields: [{ kind: "integer", value: 4 }],
    });
  } finally {
    compiler.destroy();
  }

  assert_equals(events, [
    { name: "duck::$DuckStruct:ExecCommandBeginEvent", field_count: 8 },
    {
      name: "duck::$DuckStruct:ExecCommandOutputDeltaEvent",
      field_count: 3,
    },
    {
      name: "duck::$DuckStruct:ExecTerminalInteractionEvent",
      field_count: 3,
    },
    { name: "duck::$DuckStruct:ExecCommandEndEvent", field_count: 15 },
  ]);
});

const unit_value: FunctionalWasmHostValue = { kind: "unit" };

function process_snapshot(
  process_id: number,
  output: string,
  has_exited: boolean,
  exit_code: number | undefined,
  sandbox_denied: boolean,
): FunctionalWasmHostValue {
  let has_exited_value = 0;
  if (has_exited) {
    has_exited_value = 1;
  }
  let sandbox_denied_value = 0;
  if (sandbox_denied) {
    sandbox_denied_value = 1;
  }
  return {
    kind: "constructor",
    name: "duck::$DuckStruct:ExecProcessSnapshot",
    fields: [
      { kind: "integer", value: process_id },
      { kind: "text", value: output },
      {
        kind: "constructor",
        name: "duck::$DuckStruct:ExecProcessState",
        fields: [
          { kind: "integer", value: has_exited_value },
          optional_integer(exit_code),
          {
            kind: "constructor",
            name: "duck::$DuckUnion:ExecTextOption:None",
            fields: [unit_value],
          },
          { kind: "integer", value: sandbox_denied_value },
        ],
      },
    ],
  };
}

function optional_integer(value: number | undefined): FunctionalWasmHostValue {
  if (value === undefined) {
    return {
      kind: "constructor",
      name: "duck::$DuckUnion:ExecI32Option:None",
      fields: [unit_value],
    };
  }
  return {
    kind: "constructor",
    name: "duck::$DuckUnion:ExecI32Option:Some",
    fields: [{ kind: "integer", value }],
  };
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

function bool_argument(
  value: FunctionalWasmHostValue,
  operation: string,
): boolean {
  const integer = integer_argument(value, operation);
  if (integer !== 0 && integer !== 1) {
    throw new Error(
      operation + " must be Bool; received " + integer.toString(),
    );
  }
  return integer === 1;
}

function integer_argument(
  value: FunctionalWasmHostValue,
  operation: string,
): number {
  if (value.kind !== "integer") {
    throw new Error(operation + " must be I32; received " + value.kind);
  }
  return value.value;
}
