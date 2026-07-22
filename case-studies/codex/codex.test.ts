import { assert_equals } from "../../src/assert.ts";
import { type CodexCapabilities, run_turn } from "./codex.ts";

Deno.test("Codex turn runs approved tools and returns their output", async () => {
  const events: string[] = [];
  const submissions: string[] = [];
  let next_event = 0;
  let approval_requests = 0;
  const capabilities: CodexCapabilities = {
    input: { prompt: () => "Read the README" },
    model: {
      start(input_json) {
        assert_equals(
          input_json,
          '{"type":"message","role":"user","content":[{"type":"input_text","text":"Read the README"}]}',
        );
        return { tag: "Started" };
      },
      next(): string {
        next_event += 1;
        if (next_event === 1) {
          return '{"type":"response.output_item.done","item":{"type":"function_call","name":"read_file","arguments":"{\\"path\\":\\"README.md\\"}","call_id":"call-1"}}';
        }
        if (next_event === 2) {
          return '{"type":"response.output_item.done","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"README inspected"}]}}';
        }
        return '{"type":"response.completed","response":{"id":"resp-1"}}';
      },
      submit(output_json) {
        submissions.push(output_json);
        return { tag: "Started" };
      },
    },
    tool: {
      run(name, arguments_json): string {
        assert_equals(name, "read_file");
        assert_equals(arguments_json, '{"path":"README.md"}');
        return "# Binned";
      },
    },
    approval: {
      request(call_id, name, arguments_json) {
        approval_requests += 1;
        assert_equals(call_id, "call-1");
        assert_equals(name, "read_file");
        assert_equals(arguments_json, '{"path":"README.md"}');
        return { tag: "Approved" };
      },
    },
    events: {
      message: (text) => events.push("message:" + text),
      tool_started: (call_id, name) => {
        events.push("started:" + call_id + ":" + name);
      },
      tool_finished: (call_id) => events.push("finished:" + call_id),
      tool_denied: (call_id) => events.push("denied:" + call_id),
      failed: (message) => events.push("failed:" + message),
      completed: () => events.push("completed"),
    },
  };

  const tool_count = await run_turn(capabilities);
  assert_equals(events, [
    "started:call-1:read_file",
    "finished:call-1",
    "message:README inspected",
    "completed",
  ]);
  assert_equals(tool_count, 1);
  assert_equals(approval_requests, 1);
  assert_equals(submissions, [
    '{"type":"function_call_output","call_id":"call-1","output":"# Binned"}',
  ]);
});

Deno.test("Codex turn returns denied tool calls to the model", async () => {
  const events: string[] = [];
  const submissions: string[] = [];
  let next_event = 0;
  let tool_runs = 0;
  const capabilities: CodexCapabilities = {
    input: { prompt: () => "Delete the repository" },
    model: {
      start: () => ({ tag: "Started" }),
      next(): string {
        next_event += 1;
        if (next_event === 1) {
          return '{"type":"response.output_item.done","item":{"type":"function_call","name":"exec_command","arguments":"{\\"cmd\\":\\"rm -rf repo\\"}","call_id":"call-danger"}}';
        }
        return '{"type":"response.completed","response":{"id":"resp-2"}}';
      },
      submit(output_json) {
        submissions.push(output_json);
        return { tag: "Started" };
      },
    },
    tool: {
      run(): string {
        tool_runs += 1;
        return "unexpected";
      },
    },
    approval: {
      request: () => ({ tag: "Denied", message: "user denied" }),
    },
    events: {
      message: () => undefined,
      tool_started: () => undefined,
      tool_finished: () => undefined,
      tool_denied: (call_id) => events.push("denied:" + call_id),
      failed: () => undefined,
      completed: () => events.push("completed"),
    },
  };

  const tool_count = await run_turn(capabilities);
  assert_equals(events, ["denied:call-danger", "completed"]);
  assert_equals(tool_count, 0);
  assert_equals(tool_runs, 0);
  assert_equals(submissions, [
    '{"type":"function_call_output","call_id":"call-danger","output":"Tool call denied"}',
  ]);
});

Deno.test("Codex turn strips citations from model messages in Duck", async () => {
  const messages: string[] = [];
  let next_event = 0;
  const capabilities: CodexCapabilities = {
    input: { prompt: () => "Explain the sources" },
    model: {
      start: () => ({ tag: "Started" }),
      next(): string {
        next_event += 1;
        if (next_event === 1) {
          return '{"type":"response.output_item.done","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Hello <oai-mem-citation>doc A</oai-mem-citation> world <oai"}]}}';
        }
        return '{"type":"response.completed","response":{"id":"resp-3"}}';
      },
      submit(): never {
        throw new Error("Codex submitted an unexpected tool result");
      },
    },
    tool: {
      run(): never {
        throw new Error("Codex ran an unexpected tool");
      },
    },
    approval: {
      request(): never {
        throw new Error("Codex requested unexpected approval");
      },
    },
    events: {
      message: (text) => messages.push(text),
      tool_started: () => undefined,
      tool_finished: () => undefined,
      tool_denied: () => undefined,
      failed: () => undefined,
      completed: () => undefined,
    },
  };

  const tool_count = await run_turn(capabilities);
  assert_equals(tool_count, 0);
  assert_equals(messages, ["Hello  world <oai"]);
});
