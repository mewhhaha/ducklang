import { assert_equals, assert_throws } from "../assert.ts";
import { Core, type Core as CoreNode } from "../core.ts";
import {
  check_core_allocation_permits,
  consume_core_allocation_permit,
  create_core_allocation_permit_state,
} from "./allocation_emission.ts";
import type { CoreAllocationPlan } from "./allocation.ts";
import { core_allocation_fact_subject } from "./allocation.ts";
import {
  register_core_allocation_fact,
  set_core_allocation_fact_external,
} from "./allocation/metadata.ts";

Deno.test("Core allocation emission consumes a matching proof permit", () => {
  const plan = allocation_plan();
  const state = create_core_allocation_permit_state(plan);
  const fact = plan.facts[0];
  if (!fact) throw new Error("Missing allocation fixture");
  const subject = core_allocation_fact_subject(fact);
  if (!subject) throw new Error("Missing allocation fixture subject");

  consume_core_allocation_permit(state, {
    subject,
    reason: "runtime_text",
    storage: "persistent_unique_heap",
    layout: "runtime_text.length_prefixed_utf8",
    emission_site: "runtime_text.concat",
  });

  assert_equals(state.permits, []);
  check_core_allocation_permits(state);
});

Deno.test("Core allocation emission rejects an unregistered allocation before WAT", () => {
  const state = create_core_allocation_permit_state({ facts: [] });

  assert_throws(
    () =>
      consume_core_allocation_permit(state, {
        subject: { tag: "prim", prim: "i32.add", args: [] },
        reason: "runtime_text",
        storage: "persistent_unique_heap",
        layout: "runtime_text.length_prefixed_utf8",
        emission_site: "runtime_text.concat",
      }),
    "Core allocation emission has no permit",
  );
});

Deno.test("Core allocation emission rejects a same-shaped wrong subject", () => {
  const plan = allocation_plan();
  const state = create_core_allocation_permit_state(plan);

  assert_throws(
    () =>
      consume_core_allocation_permit(state, {
        subject: { tag: "prim", prim: "i32.add", args: [] },
        reason: "runtime_text",
        storage: "persistent_unique_heap",
        layout: "runtime_text.length_prefixed_utf8",
        emission_site: "runtime_text.concat",
      }),
    "Core allocation emission has no permit",
  );
});

Deno.test("Core allocation emission keeps identical sites tied to their subjects", () => {
  const plan = allocation_plan();
  const first = plan.facts[0];
  if (!first) throw new Error("Missing first allocation fixture");
  const second = {
    ...first,
    id: "allocation#text-second",
    allocation_id: "allocation#text-second",
  };
  const second_subject = {
    tag: "prim" as const,
    prim: "i32.add" as const,
    args: [],
  };
  plan.facts.push(second);
  register_core_allocation_fact(second, second_subject, "runtime_text.concat");
  const state = create_core_allocation_permit_state(plan);

  consume_core_allocation_permit(state, {
    subject: second_subject,
    reason: "runtime_text",
    storage: "persistent_unique_heap",
    layout: "runtime_text.length_prefixed_utf8",
    emission_site: "runtime_text.concat",
  });

  assert_equals(state.permits, [first]);
});

Deno.test("Core allocation emission allows unused scanner permits", () => {
  const state = create_core_allocation_permit_state(allocation_plan());
  check_core_allocation_permits(state);
});

Deno.test("Core allocation emission excludes host-owned external permits", () => {
  const plan = allocation_plan();
  const fact = plan.facts[0];
  if (!fact) {
    throw new Error("Missing external allocation fixture");
  }
  set_core_allocation_fact_external(fact);

  const state = create_core_allocation_permit_state(plan);
  assert_equals(state.permits, []);
  check_core_allocation_permits(state);
});

Deno.test("Core allocation emitters use the registered allocator boundary", async () => {
  const files = [
    "src/core/closure_emit.ts",
    "src/core/app_emit.ts",
    "src/core/runtime_text/concat.ts",
    "src/core/runtime_text/slice.ts",
    "src/core/runtime_aggregate/emit.ts",
    "src/core/runtime_aggregate/freeze_copy.ts",
    "src/core/runtime_union_emit/value.ts",
    "src/core/runtime_union/freeze_copy.ts",
  ];

  for (const file of files) {
    const source = await Deno.readTextFile(file);
    assert_equals(source.includes("emit_persistent_alloc("), true);
  }
});

Deno.test("Core emission recreates permits for each artifact", () => {
  const core: CoreNode = {
    tag: "program",
    statements: [{ tag: "expr", expr: { tag: "num", type: "i32", value: 1 } }],
  };

  assert_equals(Core.emit(core), "i32.const 1");
  assert_equals(Core.mod(core).funcs.main.body, "i32.const 1");
});

function allocation_plan(): CoreAllocationPlan {
  const plan: CoreAllocationPlan = {
    facts: [{
      id: "allocation#text",
      allocation_id: "allocation#text",
      scope: "program#0",
      storage: "persistent_unique_heap",
      ownership: { tag: "unique_heap", reason: "text" },
      reason: "runtime_text",
      expression: "prim",
      byte_size: { tag: "runtime", formula: "4 + runtime_byte_length" },
      alignment: 4,
      layout: "runtime_text.length_prefixed_utf8",
    }],
  };
  const fact = plan.facts[0];
  if (!fact) throw new Error("Missing allocation fixture");
  register_core_allocation_fact(
    fact,
    { tag: "prim", prim: "i32.add", args: [] },
    "runtime_text.concat",
  );
  return plan;
}
