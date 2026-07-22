import { assert_equals } from "../../src/assert.ts";
import { DuckHost, Source } from "../../src/frontend.ts";
import { wasm_from_wat } from "../../src/wasm_test_util.ts";

const source_url = new URL(
  "./apply_patch_adapter_fixture.duck",
  import.meta.url,
);
const host_interface_url = new URL("./apply_patch_host.duck", import.meta.url);

Deno.test({
  name: "Codex derives patch contents before invoking filesystem mechanics",
  ignore: true,
  fn: async () => {
    const files = new Map<string, string>([
      ["/repo/old.txt", "old\n"],
      ["/repo/gone.txt", "gone\n"],
    ]);
    const events: string[] = [];
    const artifact = Source.artifact_file(source_url.pathname, {
      host_interface: host_interface_url.pathname,
    });
    const wasm = await wasm_from_wat(artifact.wat);
    const host = await DuckHost.instantiate(wasm, artifact.abi);

    try {
      const result = host.run({
        apply_patch_host: {
          read(argument) {
            if (typeof argument !== "string") {
              throw new Error("apply_patch read expected a Text path");
            }
            events.push("read:" + argument);
            const content = files.get(argument);
            if (content === undefined) {
              return {
                tag: "PatchReadFailed",
                value: ["Failed to read file to update " + argument],
              };
            }
            return { tag: "PatchFile", value: [content] };
          },
          write(argument) {
            const request = write_request(argument);
            events.push(
              "write:" + request.path + ":" +
                request.content.replaceAll("\n", "\\n"),
            );
            files.set(request.path, request.content);
            return { tag: "PatchChanged" };
          },
          remove(argument) {
            if (typeof argument !== "string") {
              throw new Error("apply_patch remove expected a Text path");
            }
            events.push("remove:" + argument);
            if (!files.delete(argument)) {
              return {
                tag: "PatchChangeFailed",
                value: ["Failed to delete file " + argument],
              };
            }
            return { tag: "PatchChanged" };
          },
        },
      });
      assert_equals(result, [11]);
    } finally {
      host.dispose();
    }

    assert_equals(events, [
      "write:/repo/added.txt:added\\n",
      "read:/repo/old.txt",
      "write:/repo/moved/new.txt:new\\n",
      "remove:/repo/old.txt",
      "remove:/repo/gone.txt",
      "write:/repo/partial.txt:partial\\n",
      "read:/repo/missing.txt",
    ]);
    assert_equals([...files.entries()], [
      ["/repo/added.txt", "added\n"],
      ["/repo/moved/new.txt", "new\n"],
      ["/repo/partial.txt", "partial\n"],
    ]);
  },
});

function write_request(value: unknown): { path: string; content: string } {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error("apply_patch write expected a two-field request");
  }
  const path = value[0];
  const content = value[1];
  if (typeof path !== "string" || typeof content !== "string") {
    throw new Error("apply_patch write request fields must be Text");
  }
  return { path, content };
}
