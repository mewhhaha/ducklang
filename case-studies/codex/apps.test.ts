import { assert_equals } from "../../src/assert.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const visibility_source_url = new URL(
  "./apps_visibility_fixture.duck",
  import.meta.url,
);
const world_state_source_url = new URL(
  "./apps_world_state_fixture.duck",
  import.meta.url,
);

Deno.test("Codex renders Apps guidance only for visible connectors", async () => {
  const compiler = await DuckCompiler.create();

  try {
    const execution = await compiler.run_file(visibility_source_url.href);

    assert_equals(execution.value, {
      kind: "constructor",
      name: "duck::$DuckStruct:duck_entry_result_type",
      fields: [
        omitted_section(),
        omitted_section(),
        rendered_section(),
      ],
    });
  } finally {
    compiler.destroy();
  }
});

Deno.test("Codex restores missing Apps world-state guidance once", async () => {
  const compiler = await DuckCompiler.create();

  try {
    const execution = await compiler.run_file(world_state_source_url.href);

    assert_equals(execution.value, {
      kind: "constructor",
      name: "duck::$DuckStruct:duck_entry_result_type",
      fields: [
        rendered_section(),
        rendered_section(),
        omitted_section(),
        omitted_section(),
      ],
    });
  } finally {
    compiler.destroy();
  }
});

function omitted_section() {
  return {
    kind: "constructor" as const,
    name: "duck::$DuckUnion:AppsSection:OmitAppsSection",
    fields: [{ kind: "unit" as const }],
  };
}

function rendered_section() {
  return {
    kind: "constructor" as const,
    name: "duck::$DuckUnion:AppsSection:RenderAppsSection",
    fields: [{
      kind: "text" as const,
      value:
        "<apps_instructions>\n## Apps (Connectors)\nApps (Connectors) can be explicitly triggered in user messages in the format `[$app-name](app://doconnector_idend)`. Apps can also be implicitly triggered as long as the context suggests usage of available apps.\nAn app is equivalent to a set of MCP tools within the `codex_apps` MCP.\nAn installed app's MCP tools are either provided to you already, or can be lazy-loaded through the `tool_search` tool. If `tool_search` is available, the apps that are searchable by `tools_search` will be listed by it.\nDo not additionally call list_mcp_resources or list_mcp_resource_templates for apps.\n</apps_instructions>",
    }],
  };
}
