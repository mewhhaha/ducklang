import type { Ic as IcNode } from "../../ic.ts";
import { free_name_counts } from "./count.ts";
import { share_ic_value } from "./share.ts";

export function share_free_variables(ic: IcNode): IcNode {
  let result = ic;
  const counts = free_name_counts(ic);

  for (const item of counts) {
    if (item.count > 1) {
      result = share_ic_value(
        { tag: "var", name: item.name },
        result,
        item.name,
        item.count,
      );
    }
  }

  return result;
}
