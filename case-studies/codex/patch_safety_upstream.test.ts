import { assert_equals } from "../../src/assert.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL(
  "./patch_safety_upstream_fixture.duck",
  import.meta.url,
);

Deno.test("Codex matches upstream patch safety policy", async () => {
  const compiler = await DuckCompiler.create();

  try {
    const execution = await compiler.run_file(source_url.href);

    assert_equals(execution.value, {
      kind: "constructor",
      name: "duck::$DuckStruct:duck_entry_result_type",
      fields: [
        boolean_value(true),
        boolean_value(false),
        boolean_value(true),
        auto_approved_without_sandbox(),
        ask_user(),
        ask_user(),
        rejected(
          "writing outside of the project; rejected by user approval settings",
        ),
        rejected(
          "writing is blocked by read-only sandbox; rejected by user approval settings",
        ),
        boolean_value(false),
        ask_user(),
        boolean_value(false),
        ask_user(),
        boolean_value(false),
        ask_user(),
      ],
    });
  } finally {
    compiler.destroy();
  }
});

function boolean_value(value: boolean) {
  let representation = 0;
  if (value) {
    representation = 1;
  }
  return { kind: "integer" as const, value: representation };
}

function ask_user() {
  return {
    kind: "constructor" as const,
    name: "duck::$DuckUnion:ToolPatchSafety:AskUser",
    fields: [{ kind: "unit" as const }],
  };
}

function rejected(reason: string) {
  return {
    kind: "constructor" as const,
    name: "duck::$DuckUnion:ToolPatchSafety:Reject",
    fields: [{ kind: "text" as const, value: reason }],
  };
}

function auto_approved_without_sandbox() {
  return {
    kind: "constructor" as const,
    name: "duck::$DuckUnion:ToolPatchSafety:AutoApprove",
    fields: [{
      kind: "constructor" as const,
      name: "duck::$DuckStruct:ToolPatchSafetyState",
      fields: [boolean_value(false), boolean_value(false)],
    }],
  };
}
