import { assert_equals } from "../../src/assert.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL(
  "./user_shell_command_fixture.duck",
  import.meta.url,
);

Deno.test("Codex formats user shell command records", async () => {
  const compiler = await DuckCompiler.create();

  try {
    const execution = await compiler.run_file(source_url.href);

    assert_equals(execution.value, {
      kind: "constructor",
      name: "duck::$DuckStruct:duck_entry_result_type",
      fields: [
        {
          kind: "text",
          value:
            "<user_shell_command>\n<command>\necho hi\n</command>\n<result>\nExit code: 0\nDuration: 1.0000 seconds\nOutput:\nhi\n</result>\n</user_shell_command>",
        },
        {
          kind: "text",
          value:
            "<user_shell_command>\n<command>\nfalse\n</command>\n<result>\nExit code: 42\nDuration: 0.1200 seconds\nOutput:\ncombined output wins\n</result>\n</user_shell_command>",
        },
        {
          kind: "text",
          value:
            "<user_shell_command>\n<command>\nsleep 2\n</command>\n<result>\nExit code: 124\nDuration: 1.5000 seconds\nOutput:\ncommand timed out after 1500 milliseconds\npartial\n</result>\n</user_shell_command>",
        },
      ],
    });
  } finally {
    compiler.destroy();
  }
});
