import {
  resolve_transfer_owner,
  static_transfer_argument_is_unique,
} from "./ownership.ts";
import { transfer_edge_text } from "./state.ts";
import type { CoreTransferEdge, CoreTransferState } from "./types.ts";

export function record_transfer<ctx>(
  owner: string,
  scope: string,
  callee: string,
  argument: number,
  state: CoreTransferState<ctx>,
): void {
  const resolved_owner = resolve_transfer_owner(owner, state);
  record_transfer_use(resolved_owner, "ownership-transfer argument", state);

  if (
    !static_transfer_argument_is_unique(
      resolved_owner,
      callee,
      argument,
      state,
    )
  ) {
    return;
  }

  const edge: CoreTransferEdge = {
    id: "transfer#" + state.next_transfer.toString(),
    scope,
    owner: resolved_owner,
    callee,
    argument,
  };
  state.next_transfer += 1;
  state.transfers.push(edge);
  state.transferred.set(resolved_owner, edge);
}

export function record_transfer_use<ctx>(
  owner: string,
  use: string,
  state: CoreTransferState<ctx>,
): void {
  const resolved_owner = resolve_transfer_owner(owner, state);
  const transfer = state.transferred.get(resolved_owner);

  if (!transfer) {
    return;
  }

  state.issues.push({
    tag: "use_after_transfer",
    owner: resolved_owner,
    transfer,
    use,
    message: "Use of transferred owner " + resolved_owner + " after " +
      transfer_edge_text(transfer) + " " + transfer.id + " to " +
      transfer.callee,
  });
}
