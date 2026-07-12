export { core_baseline_proof } from "./proof/baseline.ts";
export {
  core_validate_value_inventory,
  core_value_inventory,
} from "./proof/inventory.ts";
export { core_check_baseline_proof } from "./proof/check.ts";
export {
  core_proof_diagnostic,
  core_proof_diagnostic_error,
} from "./proof/diagnostic.ts";
export { core_freeze_proof_edges } from "./proof/freeze.ts";
export type {
  CoreFreezeProofEdge,
  CoreFreezeProofHooks,
} from "./proof/freeze.ts";
export type {
  CoreBaselineProof,
  CoreBaselineProofInput,
  CoreBaselineTarget,
  CoreCleanupProofRow,
  CoreProofIssue,
  CoreProofMissingEdge,
  CoreStorageProofRow,
  CoreUnsupportedCodegenHooks,
  CoreUnsupportedCodegenIssue,
  CoreValueInventoryRow,
  CoreValueInventoryTerminal,
} from "./proof/types.ts";
export { core_unsupported_codegen_issues } from "./proof/unsupported.ts";
