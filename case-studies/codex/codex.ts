import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL("./codex.duck", import.meta.url);
const host_interface_url = new URL("./host.duck", import.meta.url);

export type CodexStartResult =
  | { tag: "Started" }
  | { tag: "Err"; message: string };

export type CodexApprovalDecision =
  | { tag: "Approved" }
  | { tag: "Denied"; message: string };

export type CodexCapabilities = {
  input: {
    prompt: () => string;
  };
  model: {
    start: (input_json: string) => MaybePromise<CodexStartResult>;
    next: () => MaybePromise<string>;
    submit: (output_json: string) => MaybePromise<CodexStartResult>;
  };
  tool: {
    run: (name: string, arguments_json: string) => MaybePromise<string>;
  };
  approval: {
    request: (
      call_id: string,
      name: string,
      arguments_json: string,
    ) => MaybePromise<CodexApprovalDecision>;
  };
  events: {
    message: (text: string) => void;
    tool_started: (call_id: string, name: string) => void;
    tool_finished: (call_id: string) => void;
    tool_denied: (call_id: string) => void;
    failed: (message: string) => void;
    completed: () => void;
  };
};

type MaybePromise<value> = value | PromiseLike<value>;

export async function run_turn(
  capabilities: CodexCapabilities,
): Promise<number> {
  const compiler = await DuckCompiler.create();
  try {
    const execution = await compiler.run_async_file(source_url.href, {
      host_interface: host_interface_url.href,
      init: functional_capabilities(capabilities),
    });
    return decode_tool_count(execution.value);
  } finally {
    compiler.destroy();
  }
}

function functional_capabilities(
  capabilities: CodexCapabilities,
): FunctionalWasmAsyncInit {
  return {
    Input: {
      $resource: { kind: "resource", id: 1 },
      prompt: () => text_value(capabilities.input.prompt()),
    },
    Model: {
      $resource: { kind: "resource", id: 2 },
      start: async (argument) => {
        return start_result(
          await capabilities.model.start(expect_text(argument, "model input")),
        );
      },
      next: async () => text_value(await capabilities.model.next()),
      submit: async (argument) => {
        return start_result(
          await capabilities.model.submit(
            expect_text(argument, "model output"),
          ),
        );
      },
    },
    Tool: {
      $resource: { kind: "resource", id: 3 },
      run: async (argument) => {
        const [name, arguments_json] = expect_text_arguments(
          argument,
          2,
          "tool run",
        );
        return text_value(await capabilities.tool.run(name, arguments_json));
      },
    },
    Approval: {
      $resource: { kind: "resource", id: 4 },
      request: async (argument) => {
        const [call_id, name, arguments_json] = expect_text_arguments(
          argument,
          3,
          "approval request",
        );
        return approval_decision(
          await capabilities.approval.request(call_id, name, arguments_json),
        );
      },
    },
    Events: {
      $resource: { kind: "resource", id: 5 },
      message: (argument) => {
        capabilities.events.message(expect_text(argument, "message event"));
        return unit_value;
      },
      tool_started: (argument) => {
        const [call_id, name] = expect_text_arguments(
          argument,
          2,
          "tool started event",
        );
        capabilities.events.tool_started(call_id, name);
        return unit_value;
      },
      tool_finished: (argument) => {
        capabilities.events.tool_finished(
          expect_text(argument, "tool finished event"),
        );
        return unit_value;
      },
      tool_denied: (argument) => {
        capabilities.events.tool_denied(
          expect_text(argument, "tool denied event"),
        );
        return unit_value;
      },
      failed: (argument) => {
        capabilities.events.failed(expect_text(argument, "failure event"));
        return unit_value;
      },
      completed: () => {
        capabilities.events.completed();
        return unit_value;
      },
    },
  };
}

const unit_value: FunctionalWasmHostValue = { kind: "unit" };

function text_value(value: string): FunctionalWasmHostValue {
  return { kind: "text", value };
}

function start_result(result: CodexStartResult): FunctionalWasmHostValue {
  if (result.tag === "Started") {
    return {
      kind: "constructor",
      name: "duck::$DuckUnion:StartResult:Started",
      fields: [unit_value],
    };
  }
  return {
    kind: "constructor",
    name: "duck::$DuckUnion:StartResult:Err",
    fields: [text_value(result.message)],
  };
}

function approval_decision(
  decision: CodexApprovalDecision,
): FunctionalWasmHostValue {
  if (decision.tag === "Approved") {
    return {
      kind: "constructor",
      name: "duck::$DuckUnion:ApprovalDecision:Approved",
      fields: [unit_value],
    };
  }
  return {
    kind: "constructor",
    name: "duck::$DuckUnion:ApprovalDecision:Denied",
    fields: [text_value(decision.message)],
  };
}

function expect_text(value: FunctionalWasmHostValue, name: string): string {
  if (value.kind !== "text") {
    throw new Error(name + " must be Text; received " + value.kind);
  }
  return value.value;
}

function expect_text_arguments(
  value: FunctionalWasmHostValue,
  expected_count: number,
  name: string,
): string[] {
  const values: FunctionalWasmHostValue[] = [];
  let current = value;
  while (values.length < expected_count - 1) {
    if (current.kind !== "tuple") {
      throw new Error(
        name + " must contain " + expected_count.toString() +
          " arguments; received " + current.kind,
      );
    }
    const [first, rest] = current.values;
    values.push(first);
    current = rest;
  }
  values.push(current);
  return values.map((argument, index) => {
    return expect_text(argument, name + " argument " + index.toString());
  });
}

function decode_tool_count(value: FunctionalWasmHostValue): number {
  if (
    value.kind !== "constructor" ||
    value.name !== "duck::$DuckStruct:duck_entry_result_type" ||
    value.fields.length !== 1
  ) {
    throw new Error(
      "Codex turn must return its duck_entry_result_type product",
    );
  }
  const tool_count = value.fields[0];
  if (tool_count?.kind !== "integer") {
    throw new Error("Codex turn returned a non-I32 tool count");
  }
  return tool_count.value;
}
