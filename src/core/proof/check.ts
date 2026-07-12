import type { CoreBaselineProof } from "./types.ts";
import { core_proof_diagnostic_error } from "./diagnostic.ts";

export function core_check_baseline_proof(
  proof: CoreBaselineProof,
): void {
  const issue = proof.issues[0];
  if (!issue) {
    return;
  }

  const diagnostic_error = core_proof_diagnostic_error(issue);
  if (diagnostic_error) {
    throw diagnostic_error;
  }

  throw new Error(issue.message);
}
