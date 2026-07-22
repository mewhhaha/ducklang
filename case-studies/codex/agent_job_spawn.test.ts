import { assert_equals } from "../../src/assert.ts";
import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL(
  "./agent_job_spawn_adapter_fixture.duck",
  import.meta.url,
);
const host_interface_url = new URL(
  "./agent_job_spawn_host.duck",
  import.meta.url,
);

Deno.test("Codex runs a blocking CSV agent job through typed capabilities", async () => {
  const actions: string[] = [];
  const finalized: {
    job_id: string;
    total_items: number;
    completed_items: number;
    failed_items: number;
    cancelled: boolean;
  }[] = [];
  let spawn_attempt = 0;
  let wait_count = 0;
  const init: FunctionalWasmAsyncInit = {
    AgentJobSpawnHost: {
      $resource: { kind: "resource", id: 1 },
      create: (argument) => {
        const job = constructor_fields(
          argument,
          "duck::$DuckStruct:AgentJobCreateRequest",
          9,
        );
        actions.push("create:" + text_value(job[0]));
        return union("AgentJobCreateOutcome", "JobCreated", unit_value);
      },
      spawn: (argument) => {
        const request = constructor_fields(
          argument,
          "duck::$DuckStruct:AgentJobSpawnWorkerRequest",
          3,
        );
        const item_id = text_value(request[1]);
        actions.push("spawn:" + item_id);
        spawn_attempt += 1;
        if (spawn_attempt === 1) {
          return union(
            "AgentJobSpawnOutcome",
            "WorkerSpawned",
            text("thread-1"),
          );
        }
        if (spawn_attempt === 2) {
          return union(
            "AgentJobSpawnOutcome",
            "WorkerSpawnDeferred",
            unit_value,
          );
        }
        if (spawn_attempt === 3) {
          return union(
            "AgentJobSpawnOutcome",
            "WorkerSpawned",
            text("thread-2"),
          );
        }
        return union(
          "AgentJobSpawnOutcome",
          "WorkerSpawnFailed",
          text("failed to spawn worker: unavailable"),
        );
      },
      wait: (argument) => {
        const request = constructor_fields(
          argument,
          "duck::$DuckStruct:AgentJobWaitRequest",
          3,
        );
        actions.push("wait:" + active_worker_count(request[1]).toString());
        wait_count += 1;
        if (wait_count === 1) {
          return worker_completed("thread-1", true, false);
        }
        return worker_completed("thread-2", false, true);
      },
      finalize: (argument) => {
        const request = constructor_fields(
          argument,
          "duck::$DuckStruct:AgentJobFinalizeRequest",
          7,
        );
        const summary = {
          job_id: text_value(request[0]),
          total_items: integer_value(request[2]),
          completed_items: integer_value(request[3]),
          failed_items: integer_value(request[4]),
          cancelled: boolean_value(request[5]),
        };
        finalized.push(summary);
        actions.push("finalize:" + summary.job_id);
        return union(
          "AgentJobFinalizeOutcome",
          "JobFinalized",
          finalize_facts(),
        );
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

  assert_equals(actions, [
    "create:job-1",
    "spawn:row-1",
    "spawn:row-2",
    "wait:1",
    "spawn:row-2",
    "spawn:row-3",
    "wait:1",
    "finalize:job-1",
  ]);
  assert_equals(finalized, [{
    job_id: "job-1",
    total_items: 3,
    completed_items: 1,
    failed_items: 2,
    cancelled: true,
  }]);
});

const unit_value: FunctionalWasmHostValue = { kind: "unit" };

function text(value: string): FunctionalWasmHostValue {
  return { kind: "text", value };
}

function integer(value: number): FunctionalWasmHostValue {
  return { kind: "integer", value };
}

function union(
  type_name: string,
  case_name: string,
  payload: FunctionalWasmHostValue,
): FunctionalWasmHostValue {
  return {
    kind: "constructor",
    name: "duck::$DuckUnion:" + type_name + ":" + case_name,
    fields: [payload],
  };
}

function worker_completed(
  thread_id: string,
  reported: boolean,
  cancel_requested: boolean,
): FunctionalWasmHostValue {
  const completion: FunctionalWasmHostValue = {
    kind: "constructor",
    name: "duck::$DuckStruct:AgentJobWorkerCompletion",
    fields: [
      text(thread_id),
      integer(boolean_representation(reported)),
      integer(boolean_representation(cancel_requested)),
    ],
  };
  return union("AgentJobWaitOutcome", "WorkerCompleted", completion);
}

function finalize_facts(): FunctionalWasmHostValue {
  const second = failure_summary(
    "row-2",
    union("AgentJobTextOption", "None", unit_value),
    "worker finished without calling report_agent_job_result",
  );
  const first = failure_summary(
    "row-3",
    union("AgentJobTextOption", "None", unit_value),
    "failed to spawn worker: unavailable",
  );
  let failures = union("AgentJobFailureSummaries", "Nil", unit_value);
  failures = failure_node(second, failures);
  failures = failure_node(first, failures);
  return {
    kind: "constructor",
    name: "duck::$DuckStruct:AgentJobFinalizeFacts",
    fields: [
      union(
        "AgentJobTextOption",
        "Some",
        text("cancelled by worker request"),
      ),
      failures,
      union("AgentJobFinalItems", "Nil", unit_value),
    ],
  };
}

function failure_summary(
  item_id: string,
  source_id: FunctionalWasmHostValue,
  last_error: string,
): FunctionalWasmHostValue {
  return {
    kind: "constructor",
    name: "duck::$DuckStruct:AgentJobFailureSummary",
    fields: [text(item_id), source_id, text(last_error)],
  };
}

function failure_node(
  failure: FunctionalWasmHostValue,
  tail: FunctionalWasmHostValue,
): FunctionalWasmHostValue {
  const node: FunctionalWasmHostValue = {
    kind: "constructor",
    name: "duck::$DuckStruct:AgentJobFailureSummaryNode",
    fields: [failure, tail],
  };
  return union("AgentJobFailureSummaries", "Cons", node);
}

function active_worker_count(value: FunctionalWasmHostValue): number {
  let count = 0;
  let current = value;
  while (
    current.kind === "constructor" &&
    current.name === "duck::$DuckUnion:AgentJobActiveThreads:Cons"
  ) {
    const node = constructor_fields(
      current.fields[0],
      "duck::$DuckStruct:AgentJobActiveThreadNode",
      2,
    );
    count += 1;
    current = node[1];
  }
  constructor_fields(
    current,
    "duck::$DuckUnion:AgentJobActiveThreads:Nil",
    1,
  );
  return count;
}

function constructor_fields(
  value: FunctionalWasmHostValue,
  name: string,
  arity: number,
): readonly FunctionalWasmHostValue[] {
  if (value.kind !== "constructor" || value.name !== name) {
    throw new Error("expected " + name + "; received " + value.kind);
  }
  if (value.fields.length !== arity) {
    throw new Error(name + " expected " + arity.toString() + " fields");
  }
  return value.fields;
}

function text_value(value: FunctionalWasmHostValue): string {
  if (value.kind !== "text") {
    throw new Error("expected Text; received " + value.kind);
  }
  return value.value;
}

function integer_value(value: FunctionalWasmHostValue): number {
  if (value.kind !== "integer") {
    throw new Error("expected I32; received " + value.kind);
  }
  return value.value;
}

function boolean_value(value: FunctionalWasmHostValue): boolean {
  const representation = integer_value(value);
  if (representation === 0) {
    return false;
  }
  if (representation === 1) {
    return true;
  }
  throw new Error("expected Bool representation; received " + representation);
}

function boolean_representation(value: boolean): number {
  if (value) {
    return 1;
  }
  return 0;
}
