import type { CoreExpr, CoreHostImport } from "../ast.ts";
import { core_host_import_for_app } from "../host_import.ts";
import type { CoreTransferState } from "./types.ts";

type RecordTransfer<ctx> = (
  owner: string,
  scope: string,
  callee: string,
  argument: number,
  subject: CoreExpr,
  state: CoreTransferState<ctx>,
) => void;

export function scan_host_transfer_call<ctx>(
  expr: Extract<CoreExpr, { tag: "app" }>,
  scope: string,
  host_imports: Map<string, CoreHostImport>,
  state: CoreTransferState<ctx>,
  record_transfer: RecordTransfer<ctx>,
): void {
  const host_import = core_host_import_for_app(expr, { host_imports });

  if (!host_import) {
    return;
  }

  for (let index = 0; index < expr.args.length; index += 1) {
    const contract = host_import.args[index];

    if (!contract) {
      continue;
    }

    if (contract.tag !== "ownership_transfer") {
      continue;
    }

    const arg = expr.args[index];
    if (!arg) {
      throw new Error("Missing host transfer argument " + index.toString());
    }

    if (arg.tag !== "var") {
      continue;
    }

    record_transfer(arg.name, scope, host_import.name, index, arg, state);
  }
}
