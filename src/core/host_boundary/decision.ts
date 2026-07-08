import type { CoreHostImport } from "../ast.ts";
import { core_host_import_arg_decision } from "../host_import.ts";
import {
  core_ownership_result_text,
  type CoreOwnership,
} from "../ownership.ts";
import type { CoreHostBoundaryArg, CoreHostBoundaryDecision } from "./types.ts";

export function host_import_has_ownership_transfer(
  signature: CoreHostImport,
): boolean {
  for (const arg of signature.args) {
    if (arg.tag === "ownership_transfer") {
      return true;
    }
  }

  return false;
}

export function host_boundary_arg_decision(
  ownership: CoreOwnership,
  signature: CoreHostImport | undefined,
  index: number,
): CoreHostBoundaryDecision {
  if (signature) {
    const contract = signature.args[index];

    if (!contract) {
      return {
        tag: "rejected",
        reason: "missing host/import ownership contract for argument " +
          index.toString(),
      };
    }

    return core_host_import_arg_decision(contract, ownership);
  }

  if (ownership.tag === "scalar_local") {
    return {
      tag: "allowed",
      reason: "scalar host/import arguments do not carry ownership",
    };
  }

  if (ownership.tag === "frozen_shareable") {
    return {
      tag: "allowed",
      reason: "frozen/shareable host/import arguments can be read without " +
        "ownership transfer",
    };
  }

  return {
    tag: "rejected",
    reason: "unknown host/import boundary would let " +
      core_ownership_result_text(ownership) +
      " escape without a bounded-borrow or ownership-transfer signature",
  };
}

export function host_boundary_decision(
  callee: string,
  args: CoreHostBoundaryArg[],
  signature: CoreHostImport | undefined,
): CoreHostBoundaryDecision {
  if (signature) {
    if (signature.params.length !== args.length) {
      return {
        tag: "rejected",
        reason: "host/import signature for " + callee + " expects " +
          signature.params.length.toString() + " arguments, got " +
          args.length.toString(),
      };
    }

    if (signature.args.length !== args.length) {
      return {
        tag: "rejected",
        reason: "host/import signature for " + callee + " declares " +
          signature.args.length.toString() + " ownership contracts, got " +
          args.length.toString() + " arguments",
      };
    }
  }

  for (const arg of args) {
    if (arg.decision.tag === "allowed") {
      continue;
    }

    return {
      tag: "rejected",
      reason: "argument " + arg.index.toString() + " to " + callee + ": " +
        arg.decision.reason,
    };
  }

  if (signature) {
    return {
      tag: "allowed",
      reason: "host/import signature for " + callee +
        " satisfies ownership boundary checks",
    };
  }

  return {
    tag: "rejected",
    reason: "missing host/import signature for " + callee,
  };
}
