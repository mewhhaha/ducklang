import type { CoreBaselineProof } from "./types.ts";

export function core_check_baseline_proof(
  proof: CoreBaselineProof,
): void {
  const issue = proof.issues[0];
  if (!issue) {
    return;
  }

  throw new Error(issue.message);
}
