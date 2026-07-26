import { assert_equals } from "../../src/assert.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const render_source_url = new URL(
  "./realtime_render_fixture.duck",
  import.meta.url,
);
const world_state_source_url = new URL(
  "./realtime_world_state_fixture.duck",
  import.meta.url,
);
const delegation_source_url = new URL(
  "./realtime_delegation_fixture.duck",
  import.meta.url,
);
const contextual_source_url = new URL(
  "./contextual_apps_realtime_fixture.duck",
  import.meta.url,
);

const start =
  "<realtime_conversation>\nRealtime conversation started.\n\nYou are operating as a backend executor behind an intermediary. The user does not talk to you directly. Any response you produce will be consumed by the intermediary and may be summarized before the user sees it.\n\nWhen invoked, you receive the latest conversation transcript and any relevant mode or metadata. The intermediary may invoke you even when backend help is not actually needed. Use the transcript to decide whether you should do work. If backend help is unnecessary, avoid verbose responses that add user-visible latency.\n\nWhen user text is routed from realtime, treat it as a transcript. It may be unpunctuated or contain recognition errors.\n\n- Keep responses concise and action-oriented. Your updates should help the intermediary respond to the user.\n</realtime_conversation>";
const custom_start =
  "<realtime_conversation>\ncustom realtime instructions\n</realtime_conversation>";
const end =
  "<realtime_conversation>\nRealtime conversation ended.\n\nSubsequent user input will return to typed text rather than transcript-style text. Do not assume recognition errors or missing punctuation once realtime has ended. Resume normal chat behavior.\n\nReason: inactive\n</realtime_conversation>";

Deno.test("Codex renders exact realtime transition guidance", async () => {
  const compiler = await DuckCompiler.create();

  try {
    const execution = await compiler.run_file(render_source_url.href);

    assert_equals(execution.value, {
      kind: "constructor",
      name: "duck::$DuckStruct:duck_entry_result_type",
      fields: [
        { kind: "text", value: start },
        { kind: "text", value: custom_start },
        { kind: "text", value: end },
      ],
    });
  } finally {
    compiler.destroy();
  }
});

Deno.test("Codex diffs realtime world state by active status", async () => {
  const compiler = await DuckCompiler.create();

  try {
    const execution = await compiler.run_file(world_state_source_url.href);

    assert_equals(execution.value, {
      kind: "constructor",
      name: "duck::$DuckStruct:duck_entry_result_type",
      fields: [
        omitted_realtime_section(),
        rendered_realtime_section(start),
        rendered_realtime_section(custom_start),
        omitted_realtime_section(),
        rendered_realtime_section(end),
        rendered_realtime_section(start),
        omitted_realtime_section(),
      ],
    });
  } finally {
    compiler.destroy();
  }
});

Deno.test("Codex renders escaped realtime delegations", async () => {
  const compiler = await DuckCompiler.create();

  try {
    const execution = await compiler.run_file(delegation_source_url.href);

    assert_equals(execution.value, {
      kind: "constructor",
      name: "duck::$DuckStruct:duck_entry_result_type",
      fields: [
        {
          kind: "text",
          value:
            "<realtime_delegation>\n  <input>run &lt;now&gt; &amp; wait</input>\n</realtime_delegation>",
        },
        {
          kind: "text",
          value:
            "<realtime_delegation>\n  <source>transcript_tail_flush</source>\n  <input>continue</input>\n  <transcript_delta>last &lt;bit&gt; &amp; more</transcript_delta>\n</realtime_delegation>",
        },
        {
          kind: "text",
          value:
            "<realtime_delegation>\n  <source>transcript_tail_flush</source>\n  <input>continue</input>\n</realtime_delegation>",
        },
      ],
    });
  } finally {
    compiler.destroy();
  }
});

Deno.test("Codex recognizes Apps and realtime context markers", async () => {
  const compiler = await DuckCompiler.create();

  try {
    const execution = await compiler.run_file(contextual_source_url.href);

    assert_equals(execution.value, {
      kind: "constructor",
      name: "duck::$DuckStruct:duck_entry_result_type",
      fields: [{ kind: "integer", value: 11 }],
    });
  } finally {
    compiler.destroy();
  }
});

function omitted_realtime_section() {
  return {
    kind: "constructor" as const,
    name: "duck::$DuckUnion:RealtimeSection:OmitRealtimeSection",
    fields: [{ kind: "unit" as const }],
  };
}

function rendered_realtime_section(value: string) {
  return {
    kind: "constructor" as const,
    name: "duck::$DuckUnion:RealtimeSection:RenderRealtimeSection",
    fields: [{ kind: "text" as const, value }],
  };
}
