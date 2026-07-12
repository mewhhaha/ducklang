import { assert_equals } from "../assert.ts";
import { core_baseline_proof } from "./proof/baseline.ts";
import { core_value_inventory } from "./proof/inventory.ts";
import type { CoreBaselineProofInput } from "./proof/types.ts";
import { record_core_diagnostic_subject } from "./source_origin.ts";
import { register_core_allocation_fact } from "./allocation/metadata.ts";
import { core_allocation_fact_subject } from "./allocation.ts";
import { core_lifetime_plan } from "./lifetime_scope.ts";
import type { CoreExpr } from "./ast.ts";

Deno.test("Core value inventory gives representative storage values one terminal", () => {
  const input = representative_input();
  const rows = core_value_inventory(input);

  assert_equals(
    rows.map((row) => ({
      value_id: row.value_id,
      owner_id: row.owner_id,
      lifetime_id: row.lifetime_id,
      origin_id: row.origin_id,
      terminal: row.terminal.tag,
    })),
    [
      {
        value_id: "value:final_result",
        owner_id: "owner:unique_heap",
        lifetime_id: "lifetime:program#0",
        origin_id: "origin:final_result",
        terminal: "returned_owner",
      },
      {
        value_id: "value:allocation#text",
        owner_id: "owner:text:allocation#text",
        lifetime_id: "lifetime:program#0",
        origin_id: "origin:allocation#text",
        terminal: "drop",
      },
      {
        value_id: "value:allocation#aggregate",
        owner_id: "owner:aggregate:allocation#aggregate",
        lifetime_id: "lifetime:program#0",
        origin_id: "origin:allocation#aggregate",
        terminal: "missing_temporary_cleanup",
      },
      {
        value_id: "value:allocation#union",
        owner_id: "owner:allocation#union",
        lifetime_id: "lifetime:program#0",
        origin_id: "origin:allocation#union",
        terminal: "freeze",
      },
      {
        value_id: "value:allocation#closure",
        owner_id: "owner:closure:allocation#closure",
        lifetime_id: "lifetime:program#0",
        origin_id: "origin:allocation#closure",
        terminal: "drop",
      },
      {
        value_id: "value:allocation#scratch",
        owner_id: "owner:allocation#scratch",
        lifetime_id: "lifetime:scratch#0",
        origin_id: "origin:allocation#scratch",
        terminal: "scratch_reset",
      },
    ],
  );
});

Deno.test("Core baseline proof rejects an omitted inventory terminal", () => {
  const input = representative_input();
  const rows = core_value_inventory(input);
  const first_allocation = rows[1];
  if (!first_allocation) {
    throw new Error("Missing inventory allocation fixture");
  }
  input.inventory_rows = [
    rows[0]!,
    {
      ...first_allocation,
      terminal: undefined,
    } as unknown as typeof first_allocation,
  ];

  const proof = core_baseline_proof(input);
  assert_equals(proof.ok, false);
  assert_equals(proof.issues[0]?.missing_edge, "missing_value_terminal");
  assert_equals(proof.issues[1]?.missing_edge, "orphan_value_inventory");
});

Deno.test("Core baseline proof rejects duplicate and orphan inventory rows", () => {
  const input = representative_input();
  const rows = core_value_inventory(input);
  const allocation = rows[1];
  if (!allocation) {
    throw new Error("Missing inventory allocation fixture");
  }
  input.inventory_rows = [
    rows[0]!,
    allocation,
    { ...allocation, allocation_id: "allocation#missing" },
  ];

  const proof = core_baseline_proof(input);
  assert_equals(proof.ok, false);
  assert_equals(proof.issues.map((issue) => issue.missing_edge), [
    "duplicate_value_inventory",
    "duplicate_value_inventory",
    "orphan_value_inventory",
    "orphan_value_inventory",
    "orphan_value_inventory",
    "orphan_value_inventory",
    "orphan_value_inventory",
  ]);
});

Deno.test("Core inventory keeps nested scratch resets distinct and rejects ambiguous freezes", () => {
  const input = representative_input();
  const scratch = input.allocations.facts.find((fact) => {
    return fact.allocation_id === "allocation#scratch";
  });
  const frozen = input.allocations.facts.find((fact) => {
    return fact.allocation_id === "allocation#union";
  });
  if (!scratch || !frozen) {
    throw new Error("Missing scratch and freeze inventory fixtures");
  }
  const nested_scratch = {
    ...scratch,
    id: "allocation#scratch_nested",
    allocation_id: "allocation#scratch_nested",
    scope: "scratch#1",
  };
  input.allocations.facts.push(nested_scratch);
  input.cleanup.steps.push({ ...input.cleanup.steps[0]!, scope: "scratch#1" });
  input.lifetimes.scopes.push({
    id: "scratch#1",
    kind: "scratch",
    parent: "scratch#0",
    boundary: "scratchpad",
    exit_edges: [],
  });
  const second_frozen = {
    ...frozen,
    id: "allocation#union_second",
    allocation_id: "allocation#union_second",
  };
  input.allocations.facts.push(second_frozen);
  const second_subject: CoreExpr = { tag: "var", name: "frozen_second" };
  register_core_allocation_fact(second_frozen, second_subject, "fixture");
  const second_freeze = { ...input.freeze_edges[0]!, id: "freeze#1" };
  record_core_diagnostic_subject(second_freeze, second_subject);
  input.freeze_edges.push(second_freeze);

  const rows = core_value_inventory(input);
  assert_equals(
    rows.find((row) => {
      return row.value_id === "value:allocation#scratch_nested";
    })?.terminal,
    { tag: "missing_temporary_cleanup" },
  );
  assert_equals(
    rows.find((row) => {
      return row.value_id === "value:allocation#union";
    })?.terminal,
    { tag: "freeze", freeze_id: "freeze#0" },
  );
});

Deno.test("Core inventory links an owned child to its parent's exact drop", () => {
  const input = representative_input();
  const child = input.allocations.facts.find((fact) => {
    return fact.allocation_id === "allocation#text";
  });
  const parent = input.allocations.facts.find((fact) => {
    return fact.allocation_id === "allocation#closure";
  });
  const drop = input.drops.steps.find((step) => step.tag === "heap_drop");
  if (!child || !parent || !drop || drop.tag !== "heap_drop") {
    throw new Error("Missing child-drop fixture");
  }
  drop.allocation_id = parent.allocation_id;
  drop.owned_children = [{
    allocation_ids: [child.allocation_id],
    offset: 0,
    ownership: { tag: "unique_heap", reason: "text" },
    layout: "runtime_text.length_prefixed_utf8",
  }];

  const row = core_value_inventory(input).find((candidate) => {
    return candidate.allocation_id === child.allocation_id;
  });
  assert_equals(row?.terminal, { tag: "drop", drop_id: drop.id });
});

Deno.test("Core inventory does not use an unrelated sole freeze as terminal evidence", () => {
  const input = representative_input();
  const frozen = input.allocations.facts.find((fact) => {
    return fact.allocation_id === "allocation#union";
  });
  if (!frozen) {
    throw new Error("Missing freeze allocation fixture");
  }
  const unrelated = {
    ...frozen,
    id: "allocation#unrelated_freeze",
    allocation_id: "allocation#unrelated_freeze",
  };
  register_core_allocation_fact(
    unrelated,
    { tag: "freeze", value: { tag: "var", name: "unrelated" } },
    "fixture",
  );
  input.allocations.facts.push(unrelated);

  const row = core_value_inventory(input).find((candidate) => {
    return candidate.allocation_id === unrelated.allocation_id;
  });
  assert_equals(row?.terminal, { tag: "missing_temporary_cleanup" });
});

Deno.test("Core inventory rejects a final result with multiple exact allocation subjects", () => {
  const input = representative_input();
  const source = input.allocations.facts.find((fact) => {
    return fact.allocation_id === "allocation#union";
  });
  if (!source) {
    throw new Error("Missing final-result allocation fixture");
  }
  const duplicate = {
    ...source,
    id: "allocation#union_duplicate",
    allocation_id: "allocation#union_duplicate",
  };
  const subject = core_allocation_fact_subject(source);
  if (!subject) {
    throw new Error("Missing final-result allocation subject");
  }
  register_core_allocation_fact(duplicate, subject, "fixture");
  input.allocations.facts.push(duplicate);

  const final = core_value_inventory(input)[0];
  assert_equals(final?.terminal, { tag: "missing_temporary_cleanup" });
  assert_equals(final?.source_value_id, undefined);
});

function representative_input(): CoreBaselineProofInput {
  const text_subject: CoreExpr = { tag: "var", name: "text_subject" };
  const aggregate_subject: CoreExpr = { tag: "var", name: "aggregate_subject" };
  const union_subject: CoreExpr = {
    tag: "freeze",
    value: { tag: "var", name: "union" },
  };
  const closure_subject: CoreExpr = { tag: "var", name: "closure_subject" };
  const scratch_subject: CoreExpr = { tag: "var", name: "scratch_subject" };
  const unique = (
    reason: "text" | "runtime_aggregate" | "runtime_union" | "closure",
  ) => ({
    tag: "unique_heap" as const,
    reason,
  });
  const fact = (
    allocation_id: string,
    reason: "runtime_text" | "runtime_aggregate" | "runtime_union" | "closure",
    owner: string | undefined,
    expression: "prim" | "freeze" | "lam",
  ) => {
    let ownership_reason:
      | "text"
      | "runtime_aggregate"
      | "runtime_union"
      | "closure" = "closure";
    if (reason === "runtime_text") {
      ownership_reason = "text";
    }
    if (reason === "runtime_aggregate") {
      ownership_reason = "runtime_aggregate";
    }
    if (reason === "runtime_union") {
      ownership_reason = "runtime_union";
    }
    return {
      id: allocation_id,
      allocation_id,
      scope: "program#0",
      storage: "persistent_unique_heap" as const,
      ownership: unique(ownership_reason),
      reason,
      expression,
      byte_size: { tag: "static" as const, value: 8 },
      alignment: 4 as const,
      layout: "runtime_text.length_prefixed_utf8" as const,
      emission_site: "fixture",
      producer: "internal" as const,
      owner,
    };
  };
  const text = fact("allocation#text", "runtime_text", "text", "prim");
  const aggregate = fact(
    "allocation#aggregate",
    "runtime_aggregate",
    "aggregate",
    "prim",
  );
  const union = fact("allocation#union", "runtime_union", undefined, "freeze");
  const closure = fact("allocation#closure", "closure", "closure", "lam");
  const scratch = {
    ...fact("allocation#scratch", "runtime_text", undefined, "prim"),
    scope: "scratch#0",
    storage: "scratch_arena" as const,
    ownership: { tag: "scratch_backed" as const, source: unique("text") },
  };

  register_core_allocation_fact(text, text_subject, "fixture");
  register_core_allocation_fact(aggregate, aggregate_subject, "fixture");
  register_core_allocation_fact(union, union_subject, "fixture");
  register_core_allocation_fact(closure, closure_subject, "fixture");
  register_core_allocation_fact(scratch, scratch_subject, "fixture");

  const freeze_edge = {
    id: "freeze#0",
    analysis: {
      edge: "freeze" as const,
      ownership: unique("runtime_union"),
      storage: "persistent_unique_heap" as const,
      escapes: true,
      decision: { tag: "allowed" as const, reason: "fixture" },
    },
  };
  record_core_diagnostic_subject(freeze_edge, union_subject);

  const final_result = {
    edge: "final_result" as const,
    ownership: unique("runtime_union"),
    storage: "persistent_unique_heap" as const,
    escapes: true,
    decision: { tag: "allowed" as const, reason: "fixture" },
  };
  record_core_diagnostic_subject(final_result, union_subject);
  const lifetimes = core_lifetime_plan({
    tag: "program",
    statements: [
      { tag: "expr", expr: text_subject },
      { tag: "expr", expr: aggregate_subject },
      { tag: "expr", expr: union_subject },
      { tag: "expr", expr: closure_subject },
      { tag: "expr", expr: { tag: "scratch", body: scratch_subject } },
    ],
  });

  return {
    final_result,
    borrow_plan: { edges: [], barriers: [], skipped_closures: [] },
    borrows: { ok: true, issues: [] },
    freeze_edges: [freeze_edge],
    cleanup: {
      steps: [{
        tag: "scratch_reset",
        scope: "scratch#0",
        exit_edges: [],
        return_value: {
          edge: "scratch_return",
          ownership: unique("text"),
          storage: "persistent_unique_heap",
          escapes: true,
          decision: { tag: "allowed", reason: "fixture" },
        },
      }],
    },
    closure_ownership: { edges: [] },
    drops: {
      steps: [
        heap_drop("drop#text", "text", "allocation#text"),
        heap_drop("drop#closure", "closure", "allocation#closure"),
      ],
    },
    allocations: { facts: [text, aggregate, union, closure, scratch] },
    host_boundaries: { edges: [] },
    capability_method_rows: [],
    runtime_slice_rows: [],
    transfers: {
      transfers: [{
        id: "transfer#0",
        scope: "program#0",
        owner: "aggregate",
        callee: "host.consume",
        argument: 0,
      }],
      issues: [],
    },
    lifetimes,
    unsupported_codegen: [],
  };
}

function heap_drop(
  id: string,
  reason: "text" | "closure",
  allocation_id: string,
) {
  return {
    tag: "heap_drop" as const,
    id,
    edge: "scope_exit" as const,
    scope: "program#0",
    owner: undefined,
    ownership: { tag: "unique_heap" as const, reason },
    storage: "persistent_unique_heap" as const,
    runtime: "reusable_free_list_allocator" as const,
    reason: "fixture",
    allocation_id,
    byte_size: { tag: "static" as const, value: 8 },
    alignment: 4 as const,
    layout: "runtime_text.length_prefixed_utf8" as const,
  };
}
