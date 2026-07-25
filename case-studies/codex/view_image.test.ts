import { assert_equals } from "../../src/assert.ts";
import {
  type WasmAsyncInit,
  type WasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL(
  "./view_image_adapter_fixture.duck",
  import.meta.url,
);
const host_interface_url = new URL("./view_image_host.duck", import.meta.url);

Deno.test("Codex loads and records viewed images through typed capabilities", async () => {
  const events: string[] = [];
  const init: WasmAsyncInit = {
    ViewImageHost: {
      $resource: { kind: "resource", id: 1 },
      read: (argument) => {
        const fields = constructor_fields(
          argument,
          "duck::$DuckStruct:ViewImageHostRequest",
          2,
        );
        const environment_id = text_value(fields[0]);
        const path = text_value(fields[1]);
        events.push("read:" + environment_id + ":" + path);

        if (path.endsWith("missing.png")) {
          return union("ViewImageHostResponse", "NotFile", {
            kind: "unit",
          });
        }

        return union("ViewImageHostResponse", "Loaded", {
          kind: "text",
          value: "data:application/octet-stream;base64,Zm9v",
        });
      },
      viewed: (argument) => {
        const fields = constructor_fields(
          argument,
          "duck::$DuckStruct:ViewImageViewEvent",
          2,
        );
        events.push(
          "viewed:" + text_value(fields[0]) + ":" + text_value(fields[1]),
        );
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

  assert_equals(events, [
    "read:local:/workspace/image.png",
    "viewed:call-loaded:/workspace/image.png",
    "read:local:/workspace/missing.png",
  ]);
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
    throw new Error(name + " expected " + arity + " fields");
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
