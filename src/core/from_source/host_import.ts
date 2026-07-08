import type {
  FrontHostImportArgContract,
  FrontHostImportResultContract,
} from "../../frontend/ast.ts";
import type {
  CoreHostImportArgContract,
  CoreHostImportResultContract,
} from "../ast.ts";
import {
  core_host_import_owner_reason,
  type CoreFromSourceCtx,
} from "./context.ts";

export function core_host_import_arg_contract(
  arg: FrontHostImportArgContract,
  ctx: CoreFromSourceCtx,
): CoreHostImportArgContract {
  switch (arg.tag) {
    case "scalar":
      return { tag: "scalar" };

    case "bounded_borrow":
      core_host_import_owner_reason(arg.reason, ctx);
      return { tag: "bounded_borrow" };

    case "frozen_shareable":
      core_host_import_owner_reason(arg.reason, ctx);
      return { tag: "frozen_shareable" };

    case "ownership_transfer":
      core_host_import_owner_reason(arg.reason, ctx);
      return { tag: "ownership_transfer" };
  }
}

export function core_host_import_result_contract(
  owner: FrontHostImportResultContract | undefined,
  ctx: CoreFromSourceCtx,
): CoreHostImportResultContract | undefined {
  if (!owner) {
    return undefined;
  }

  switch (owner.tag) {
    case "scalar":
      return { tag: "scalar" };

    case "unique_heap":
      return {
        tag: "unique_heap",
        reason: core_host_import_owner_reason(owner.reason, ctx),
      };

    case "frozen_shareable":
      if (owner.reason === "freeze") {
        return {
          tag: "frozen_shareable",
          reason: "freeze",
        };
      }

      return {
        tag: "frozen_shareable",
        reason: core_host_import_owner_reason(owner.reason, ctx),
      };
  }
}
