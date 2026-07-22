import { assert_equals } from "../../src/assert.ts";
import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL(
  "./request_plugin_install_adapter_fixture.duck",
  import.meta.url,
);
const host_interface_url = new URL(
  "./request_plugin_install_host.duck",
  import.meta.url,
);

Deno.test("Codex requests plugin installation through a typed capability", async () => {
  const observed: { suggestion_id: string; reason: string; tool_id: string }[] =
    [];
  const init: FunctionalWasmAsyncInit = {
    RequestPluginInstallHost: {
      $resource: { kind: "resource", id: 1 },
      request: (argument) => {
        const request = constructor_fields(
          argument,
          "duck::$DuckStruct:RequestPluginInstallHostRequest",
          3,
        );
        const candidate = constructor_fields(
          request[2],
          "duck::$DuckStruct:PluginInstallCandidate",
          9,
        );
        observed.push({
          suggestion_id: text_value(request[0]),
          reason: text_value(request[1]),
          tool_id: text_value(candidate[0]),
        });
        return {
          kind: "constructor",
          name: "duck::$DuckStruct:RequestPluginInstallHostResponse",
          fields: [
            { kind: "integer", value: 1 },
            {
              kind: "constructor",
              name: "duck::$DuckUnion:PluginInstallElicitationAction:Accept",
              fields: [{ kind: "unit" }],
            },
            { kind: "integer", value: 0 },
            { kind: "integer", value: 1 },
          ],
        };
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

  assert_equals(observed, [{
    suggestion_id: "request_plugin_install_call-1",
    reason: "Plan events",
    tool_id: "calendar",
  }]);
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
    throw new Error(name + " expected " + arity + " fields");
  }
  return value.fields;
}

function text_value(value: FunctionalWasmHostValue): string {
  if (value.kind !== "text") {
    throw new Error("expected Text; received " + value.kind);
  }
  return value.value;
}
