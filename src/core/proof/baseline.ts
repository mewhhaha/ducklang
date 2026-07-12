import type { CoreCleanupStep } from "../cleanup.ts";
import type { CoreClosureOwnershipEdge } from "../closure_ownership.ts";
import type {
  CoreBaselineProof,
  CoreBaselineProofInput,
  CoreProofIssue,
} from "./types.ts";
import {
  core_validate_value_inventory,
  core_value_inventory,
} from "./inventory.ts";

export function core_baseline_proof(
  input: CoreBaselineProofInput,
): CoreBaselineProof {
  const issues: CoreProofIssue[] = [];
  let inventory_rows = input.inventory_rows;
  if (!inventory_rows) {
    inventory_rows = core_value_inventory(input);
  }

  for (const issue of input.borrows.issues) {
    issues.push({
      tag: "borrow",
      missing_edge: "active_borrow",
      issue,
      message: issue.message,
    });
  }

  for (const edge of input.freeze_edges) {
    if (edge.analysis.decision.tag === "allowed") {
      continue;
    }

    issues.push({
      tag: "freeze",
      missing_edge: "missing_promotion",
      edge,
      message: "Rejected baseline proof " + edge.id + ": " +
        edge.analysis.decision.reason,
    });
  }

  for (const step of input.cleanup.steps) {
    if (step.return_value.decision.tag === "allowed") {
      continue;
    }

    issues.push({
      tag: "scratch_return",
      missing_edge: "scratch_backed_result",
      step,
      message: scratch_return_issue_message(step),
    });
  }

  if (input.final_result.decision.tag === "rejected") {
    issues.push({
      tag: "final_result",
      missing_edge: final_result_missing_edge(input),
      analysis: input.final_result,
      message: "Rejected baseline proof final_result: " +
        input.final_result.decision.reason,
    });
  }

  for (const edge of input.host_boundaries.edges) {
    if (edge.decision.tag === "allowed") {
      continue;
    }

    issues.push({
      tag: "host_boundary",
      missing_edge: "unknown_host_boundary_ownership",
      edge,
      message: "Rejected host/import boundary " + edge.id + " " +
        edge.callee + ": " + edge.decision.reason,
    });
  }

  for (const edge of input.closure_ownership.edges) {
    const reason = closure_capture_rejection_reason(edge);

    if (!reason) {
      continue;
    }

    issues.push({
      tag: "closure_capture",
      missing_edge: "unsupported_ownership_bearing_closure_capture",
      edge,
      message: "Rejected baseline proof " + edge.id + ": " + reason,
    });
  }

  for (const issue of input.transfers.issues) {
    issues.push({
      tag: "transfer",
      missing_edge: "invalid_ownership_transfer",
      issue,
      message: issue.message,
    });
  }

  for (const issue of input.unsupported_codegen) {
    let missing_edge:
      | "unsupported_codegen"
      | "missing_collection_or_text_fact"
      | "missing_collection_fact" = "unsupported_codegen";

    if (issue.missing_edge) {
      missing_edge = issue.missing_edge;
    }

    issues.push({
      tag: "unsupported_codegen",
      missing_edge,
      issue,
      message: issue.message,
    });
  }

  for (const fact of input.allocations.facts) {
    if (allocation_fact_complete(fact)) {
      continue;
    }

    issues.push({
      tag: "allocation_layout",
      missing_edge: "missing_allocation_layout",
      fact,
      message: "Rejected baseline proof " + fact.id +
        ": missing persistent allocation size/alignment/layout facts",
    });
  }

  for (const step of input.drops.steps) {
    if (step.tag !== "heap_drop") {
      continue;
    }

    if (step.storage !== "persistent_unique_heap") {
      continue;
    }

    const reason_candidates = input.allocations.facts.filter((fact) => {
      if (fact.storage !== "persistent_unique_heap") {
        return false;
      }

      if (fact.ownership.tag !== "unique_heap") {
        return false;
      }

      if (fact.ownership.reason !== step.ownership.reason) {
        return false;
      }

      return true;
    });
    let candidates = reason_candidates.filter((fact) => {
      return !step.owner || fact.owner === step.owner;
    });

    if (step.allocation_id || step.allocation_ids) {
      const linked_ids = drop_linked_allocation_ids(step);
      candidates = input.allocations.facts.filter((fact) => {
        return linked_ids.has(fact.allocation_id);
      });
    }

    if (candidates.length === 0) {
      if (step.allocation_id || step.allocation_ids) {
        issues.push(missing_cleanup_link_issue(step));
      }
      continue;
    }

    if (drop_has_complete_allocation_links(step, candidates)) {
      continue;
    }

    issues.push(missing_cleanup_link_issue(step));
  }

  issues.push(...core_validate_value_inventory(
    inventory_rows,
    input,
    issues.length > 0,
  ));

  return {
    target: "core-3-nonweb",
    target_profile: "core-3-nonweb",
    managed_storage: "disabled",
    ok: issues.length === 0,
    storage_rows: [
      { tag: "final_result", analysis: input.final_result },
      ...input.allocations.facts.map((fact) => ({
        tag: "allocation" as const,
        fact,
      })),
    ],
    inventory_rows,
    lifetime_rows: input.lifetimes.scopes,
    borrow_view_rows: input.borrow_plan.edges,
    scratch_result_rows: input.cleanup.steps,
    freeze_promotion_rows: input.freeze_edges,
    cleanup_rows: [...input.cleanup.steps, ...input.drops.steps],
    host_boundary_rows: input.host_boundaries.edges,
    capability_method_rows: input.capability_method_rows,
    runtime_slice_rows: input.runtime_slice_rows,
    final_result: input.final_result,
    borrows: input.borrows,
    freeze_edges: input.freeze_edges,
    cleanup: input.cleanup,
    closure_ownership: input.closure_ownership,
    drops: input.drops,
    allocations: input.allocations,
    host_boundaries: input.host_boundaries,
    transfers: input.transfers,
    lifetimes: input.lifetimes,
    issues,
  };
}

function drop_linked_allocation_ids(
  step: Extract<import("../drop.ts").CoreDropStep, { tag: "heap_drop" }>,
): Set<string> {
  const ids = new Set<string>();

  if (step.allocation_id) {
    ids.add(step.allocation_id);
  }

  if (step.allocation_ids) {
    for (const allocation_id of step.allocation_ids) {
      ids.add(allocation_id);
    }
  }

  if (step.owned_children) {
    for (const child of step.owned_children) {
      for (const allocation_id of child.allocation_ids) {
        ids.add(allocation_id);
      }
    }
  }

  return ids;
}

function drop_has_complete_allocation_links(
  step: Extract<import("../drop.ts").CoreDropStep, { tag: "heap_drop" }>,
  candidates: CoreBaselineProofInput["allocations"]["facts"],
): boolean {
  if (!step.byte_size || !step.alignment || !step.layout) {
    return false;
  }

  const linked = drop_linked_allocation_ids(step);

  if (linked.size !== candidates.length) {
    return false;
  }

  for (const candidate of candidates) {
    if (!linked.has(candidate.allocation_id)) {
      return false;
    }
  }

  return true;
}

function missing_cleanup_link_issue(
  step: Extract<import("../drop.ts").CoreDropStep, { tag: "heap_drop" }>,
): CoreProofIssue {
  return {
    tag: "temporary_cleanup",
    missing_edge: "missing_temporary_cleanup",
    step,
    message: "Rejected baseline proof " + step.id +
      ": missing or ambiguous cleanup-to-allocation link",
  };
}

function allocation_fact_complete(
  fact: CoreBaselineProofInput["allocations"]["facts"][number],
): boolean {
  if (fact.storage !== "persistent_unique_heap") {
    return true;
  }

  if (!fact.allocation_id || !fact.layout) {
    return false;
  }

  if (fact.alignment !== 4 && fact.alignment !== 8) {
    return false;
  }

  if (!fact.byte_size) {
    return false;
  }

  if (fact.byte_size.tag === "static") {
    return fact.byte_size.value > 0;
  }

  return fact.byte_size.formula.length > 0;
}

function final_result_missing_edge(
  input: CoreBaselineProofInput,
): "active_borrow" | "scratch_backed_result" {
  if (input.final_result.ownership.tag === "borrow_view") {
    return "active_borrow";
  }

  return "scratch_backed_result";
}

function scratch_return_issue_message(step: CoreCleanupStep): string {
  const prefix = "Rejected baseline proof " + step.scope + " scratch_return: ";

  if (step.return_detail) {
    return prefix + "unsafe scratch return " + step.return_detail + " and " +
      step.return_value.decision.reason;
  }

  return prefix + step.return_value.decision.reason;
}

function closure_capture_rejection_reason(
  edge: CoreClosureOwnershipEdge,
): string | undefined {
  for (const capture of edge.captures) {
    if (capture.decision.tag === "reserved") {
      return capture.name + ": " + capture.decision.reason;
    }
  }

  return undefined;
}
