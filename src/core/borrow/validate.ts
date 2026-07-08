import type {
  CoreBorrowPlan,
  CoreBorrowValidation,
  CoreBorrowValidationIssue,
} from "./types.ts";

export function core_validate_borrow_plan(
  plan: CoreBorrowPlan,
): CoreBorrowValidation {
  const issues: CoreBorrowValidationIssue[] = [];

  for (const edge of plan.edges) {
    if (edge.decision.tag === "allowed") {
      continue;
    }

    issues.push({
      tag: "rejected_borrow",
      edge,
      message: "Rejected borrow " + edge.id + " in " + edge.target_scope +
        ": " + edge.decision.reason,
    });
  }

  for (const skipped of plan.skipped_closures) {
    issues.push({
      tag: "skipped_closure",
      scope: skipped.scope,
      message: "Skipped closure borrow analysis in " + skipped.scope + ": " +
        skipped.reason,
    });
  }

  for (const barrier of plan.barriers) {
    issues.push({
      tag: "borrowed_owner_barrier",
      barrier,
      message: barrier.message,
    });
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function core_check_borrow_plan(plan: CoreBorrowPlan): void {
  const validation = core_validate_borrow_plan(plan);

  if (validation.ok) {
    return;
  }

  const issue = validation.issues[0];

  if (!issue) {
    throw new Error("Core borrow validation failed without an issue");
  }

  throw new Error(issue.message);
}
