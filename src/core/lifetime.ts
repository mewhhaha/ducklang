import type { CoreOwnership } from "./ownership.ts";
import { core_ownership_result_text } from "./ownership.ts";

export type CoreLifetimeDecision =
  | {
    tag: "allowed";
    reason: string;
  }
  | {
    tag: "rejected";
    reason: string;
  };

export function core_borrow_lifetime_decision(
  ownership: CoreOwnership,
): CoreLifetimeDecision {
  switch (ownership.tag) {
    case "scalar_local":
      return {
        tag: "allowed",
        reason: "scalar locals do not create a borrow lifetime",
      };

    case "frozen_shareable":
      return {
        tag: "allowed",
        reason: "frozen_shareable values are immutable and freely shareable",
      };

    case "unique_heap":
      return {
        tag: "rejected",
        reason: "borrow over " + core_ownership_result_text(ownership) +
          " needs lexical lifetime tracking before the owner can be protected",
      };

    case "borrow_view":
      return {
        tag: "rejected",
        reason: "borrow view cannot escape through another borrow without " +
          "lexical lifetime tracking: " + core_ownership_result_text(ownership),
      };

    case "scratch_backed":
      return {
        tag: "rejected",
        reason: "borrow view may reference scratch storage that resets at " +
          "scope exit: " + core_ownership_result_text(ownership),
      };
  }
}

export function core_freeze_lifetime_decision(
  ownership: CoreOwnership,
): CoreLifetimeDecision {
  switch (ownership.tag) {
    case "scalar_local":
      return {
        tag: "allowed",
        reason: "scalar locals need no freeze promotion",
      };

    case "frozen_shareable":
      return {
        tag: "allowed",
        reason: "freeze is idempotent for frozen_shareable values",
      };

    case "unique_heap":
      if (ownership.reason === "text") {
        return {
          tag: "allowed",
          reason: "freeze of unique_heap text consumes the owned buffer as " +
            "immutable shareable storage",
        };
      }

      if (ownership.reason === "runtime_aggregate") {
        return {
          tag: "allowed",
          reason: "freeze of unique_heap runtime_aggregate consumes the " +
            "owned buffer as immutable shareable storage",
        };
      }

      if (ownership.reason === "runtime_union") {
        return {
          tag: "allowed",
          reason: "freeze of unique_heap runtime_union consumes the owned " +
            "buffer as immutable shareable storage",
        };
      }

      if (ownership.reason === "closure") {
        return {
          tag: "allowed",
          reason: "freeze of unique_heap closure consumes the owned " +
            "environment pointer as immutable shareable storage",
        };
      }

      return {
        tag: "rejected",
        reason: "freeze of " + core_ownership_result_text(ownership) +
          " needs an explicit immutable heap copy or promotion",
      };

    case "borrow_view":
      return {
        tag: "rejected",
        reason: "cannot freeze through a borrowed view: " +
          core_ownership_result_text(ownership),
      };

    case "scratch_backed":
      return {
        tag: "rejected",
        reason: "freeze of " + core_ownership_result_text(ownership) +
          " needs explicit scratch-to-heap promotion before scratch reset",
      };
  }
}

export function core_scratch_return_lifetime_decision(
  ownership: CoreOwnership,
): CoreLifetimeDecision {
  switch (ownership.tag) {
    case "scalar_local":
      return {
        tag: "allowed",
        reason: "scalar locals can leave a scratch scope",
      };

    case "frozen_shareable":
      return {
        tag: "allowed",
        reason: "frozen_shareable values do not reference scratch storage",
      };

    case "unique_heap":
      return {
        tag: "rejected",
        reason: core_ownership_result_text(ownership) +
          " cannot leave scratch without freeze or explicit promotion",
      };

    case "borrow_view":
      return {
        tag: "rejected",
        reason: core_ownership_result_text(ownership) +
          " cannot escape its borrowed owner lifetime",
      };

    case "scratch_backed":
      return {
        tag: "rejected",
        reason: core_ownership_result_text(ownership) +
          " may reference storage reset at scratch scope exit",
      };
  }
}

export function core_lifetime_rejection_message(
  prefix: string,
  decision: CoreLifetimeDecision,
): string {
  if (decision.tag === "allowed") {
    return prefix;
  }

  return prefix + ": " + decision.reason;
}
