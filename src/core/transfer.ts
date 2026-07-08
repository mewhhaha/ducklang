import type { Core } from "./ast.ts";
import { core_host_import_map } from "./host_import.ts";
import { scan_transfer_stmts } from "./transfer/scan.ts";
import { top_level_transfer_functions } from "./transfer/static_function.ts";
export type {
  CoreTransferEdge,
  CoreTransferFunction,
  CoreTransferHooks,
  CoreTransferState,
  CoreTransferValidation,
  CoreTransferValidationIssue,
} from "./transfer/types.ts";
import type {
  CoreTransferHooks,
  CoreTransferState,
  CoreTransferValidation,
} from "./transfer/types.ts";

export function core_transfer_validation<ctx>(
  core: Core,
  ctx: ctx,
  hooks: CoreTransferHooks<ctx>,
): CoreTransferValidation {
  const state: CoreTransferState<ctx> = {
    next_transfer: 0,
    next_temporary: 0,
    transfers: [],
    issues: [],
    transferred: new Map(),
    functions: top_level_transfer_functions(core),
    aliases: new Map(),
    alias_ownership: new Map(),
    alias_rejection_reasons: new Map(),
    active_functions: new Set(),
    ctx,
    hooks,
  };
  const host_imports = core_host_import_map(core);

  scan_transfer_stmts(core.statements, "program#0", host_imports, state);

  return {
    transfers: state.transfers,
    issues: state.issues,
  };
}
