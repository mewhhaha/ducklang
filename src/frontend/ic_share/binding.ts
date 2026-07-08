import type { Ic as IcNode } from "../../ic.ts";
import { ic_name_use_count } from "./count.ts";
import { share_ic_value } from "./share.ts";

export function lower_bound_value(
  value: IcNode,
  body: IcNode,
  name: string,
): IcNode {
  const uses = ic_name_use_count(body, name);

  if (uses === 0) {
    return {
      tag: "era",
      expr: value,
      body,
    };
  }

  if (uses > 1) {
    return share_ic_value(value, body, name, uses);
  }

  return {
    tag: "app",
    func: { tag: "lam", name, body },
    arg: value,
  };
}

export function lower_lambda_binding(name: string, body: IcNode): IcNode {
  const uses = ic_name_use_count(body, name);

  if (uses === 0) {
    return {
      tag: "lam",
      name,
      body: {
        tag: "era",
        expr: { tag: "var", name },
        body,
      },
    };
  }

  if (uses > 1) {
    return {
      tag: "lam",
      name,
      body: share_ic_value({ tag: "var", name }, body, name, uses),
    };
  }

  return { tag: "lam", name, body };
}
