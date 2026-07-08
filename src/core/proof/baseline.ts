import type { CoreCleanupStep } from "../cleanup.ts";
import type { CoreClosureOwnershipEdge } from "../closure_ownership.ts";
import type {
  CoreBaselineProof,
  CoreBaselineProofInput,
  CoreProofIssue,
} from "./types.ts";

export function core_baseline_proof(
  input: CoreBaselineProofInput,
): CoreBaselineProof {
  const issues: CoreProofIssue[] = [];

  for (const issue of input.borrows.issues) {
    issues.push({
      tag: "borrow",
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
      step,
      message: scratch_return_issue_message(step),
    });
  }

  if (input.final_result.decision.tag === "rejected") {
    issues.push({
      tag: "final_result",
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
      edge,
      message: "Rejected baseline proof " + edge.id + ": " + reason,
    });
  }

  for (const issue of input.transfers.issues) {
    issues.push({
      tag: "transfer",
      issue,
      message: issue.message,
    });
  }

  for (const issue of input.unsupported_codegen) {
    issues.push({
      tag: "unsupported_codegen",
      issue,
      message: issue.message,
    });
  }

  return {
    target: "core-3-nonweb",
    managed_storage: "disabled",
    ok: issues.length === 0,
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
