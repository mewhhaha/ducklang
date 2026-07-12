import type { CoreExpr } from "../ast.ts";
import {
  core_ownership_result_text,
  type CoreOwnership,
} from "../ownership.ts";
import { closure_body_contains_closure_value } from "./contains.ts";
import type {
  CoreClosureCaptureDecision,
  CoreClosureCaptureSlot,
  CoreClosureOwnershipFacts,
} from "./types.ts";

export function closure_capture_decision(
  ownership: CoreOwnership,
  expr: Extract<CoreExpr, { tag: "lam" | "rec" }>,
  facts: CoreClosureOwnershipFacts,
  linear = false,
): CoreClosureCaptureDecision {
  if (linear) {
    return {
      tag: "allowed",
      reason: "source linear capture moves into a one-shot closure " +
        "environment slot",
    };
  }
  if (ownership.tag === "scalar_local") {
    return {
      tag: "allowed",
      reason: "scalar capture is copyable",
    };
  }

  if (ownership.tag === "frozen_shareable") {
    return {
      tag: "allowed",
      reason: "frozen/shareable capture is reusable",
    };
  }

  if (
    ownership.tag === "scratch_backed" &&
    facts.scratch_depth > 0 &&
    facts.direct_call_depth > 0 &&
    !closure_body_contains_closure_value(expr.body)
  ) {
    return {
      tag: "allowed",
      reason: "scratch-backed capture is valid for an immediate non-escaping " +
        "closure call inside scratchpad",
    };
  }

  return {
    tag: "reserved",
    reason: core_ownership_result_text(ownership) +
      " capture requires linear closure ownership support",
  };
}

export function merge_closure_capture_decisions(
  captures: CoreClosureCaptureSlot[],
): CoreClosureCaptureDecision {
  for (const capture of captures) {
    if (capture.decision.tag === "reserved") {
      return {
        tag: "reserved",
        reason: capture.name + ": " + capture.decision.reason,
      };
    }
  }

  for (const capture of captures) {
    if (capture.environment?.transfer === "move") {
      return {
        tag: "allowed",
        reason: "linear captures move into a one-shot closure environment",
      };
    }
  }

  return {
    tag: "allowed",
    reason: "all closure captures are copy/share safe",
  };
}
