import { assert_equals } from "../../src/assert.ts";
import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL(
  "./network_approval_adapter_fixture.duck",
  import.meta.url,
);
const host_interface_url = new URL(
  "./network_approval_host.duck",
  import.meta.url,
);

Deno.test("Codex defers network outcome handling to source policy", async () => {
  const prompts: { target: string; reason: string; is_owner: boolean }[] = [];
  const init: FunctionalWasmAsyncInit = {
    NetworkApprovalHost: {
      $resource: { kind: "resource", id: 1 },
      request: (argument) => {
        if (argument.kind !== "tuple") {
          throw new Error("network approval request must receive three fields");
        }
        const [target_value, request_tail] = argument.values;
        if (request_tail.kind !== "tuple") {
          throw new Error("network approval request must receive three fields");
        }
        const [reason_value, owner_value] = request_tail.values;
        prompts.push({
          target: text_argument(target_value, "network target"),
          reason: text_argument(reason_value, "network reason"),
          is_owner: bool_argument(owner_value, "network prompt ownership"),
        });
        return {
          kind: "constructor",
          name: "duck::$DuckUnion:NetworkHostApprovalDecision:AllowOnce",
          fields: [unit_value],
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
      fields: [{ kind: "integer", value: 2 }],
    });
  } finally {
    compiler.destroy();
  }

  assert_equals(prompts, [{
    target: "https://example.com:443",
    reason: "example.com is not in the allowed_domains",
    is_owner: true,
  }]);
});

const unit_value: FunctionalWasmHostValue = { kind: "unit" };

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
  if (value.kind !== "integer") {
    throw new Error(operation + " must be Bool; received " + value.kind);
  }
  if (value.value !== 0 && value.value !== 1) {
    throw new Error(
      operation + " must be Bool; received " + value.value.toString(),
    );
  }
  return value.value === 1;
}
