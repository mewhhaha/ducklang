import type { CoreOwnership } from "./types.ts";

export function core_ownership_result_text(
  ownership: CoreOwnership,
): string {
  switch (ownership.tag) {
    case "scalar_local":
      return "scalar_local " + ownership.type;

    case "unique_heap":
      return "unique_heap " + ownership.reason;

    case "frozen_shareable":
      return "frozen_shareable " + ownership.reason;

    case "borrow_view":
      return "borrow_view over " + core_ownership_result_text(
        ownership.source,
      );

    case "scratch_backed":
      return "scratch_backed over " + core_ownership_result_text(
        ownership.source,
      );
  }
}

export function core_non_scalar_ownership_message(
  prefix: string,
  ownership: CoreOwnership,
): string {
  return prefix + " with non-scalar " +
    core_ownership_result_text(ownership) + " result yet";
}
