import { expect } from "../../expect.ts";
import type { Prim } from "../../op.ts";
import type { Ic } from "../ast.ts";
import type { IcReduceCtx } from "./context.ts";

export function spread_prim(
  prim: Prim,
  args: Ic[],
  index: number,
  sup: Extract<Ic, { tag: "sup" }>,
  ctx: IcReduceCtx,
): Ic {
  const left_args: Ic[] = [];
  const right_args: Ic[] = [];
  const copy_names: string[] = [];
  const copy_exprs: Ic[] = [];

  for (let pos = 0; pos < args.length; pos += 1) {
    const input = args[pos];
    expect(input, "Missing primitive argument " + pos);

    if (pos === index) {
      left_args.push(sup.left);
      right_args.push(sup.right);
    } else {
      const name = ctx.name("p");
      copy_names.push(name);
      copy_exprs.push(input);
      left_args.push({ tag: "var", name: `${name}0` });
      right_args.push({ tag: "var", name: `${name}1` });
    }
  }

  let body: Ic = {
    tag: "sup",
    label: sup.label,
    left: { tag: "prim", prim, args: left_args },
    right: { tag: "prim", prim, args: right_args },
  };

  for (let copy = copy_names.length - 1; copy >= 0; copy -= 1) {
    const name = copy_names[copy];
    const expr = copy_exprs[copy];
    expect(name, "Missing copied primitive name");
    expect(expr, "Missing copied primitive expression");

    body = {
      tag: "dup",
      label: sup.label,
      name,
      expr,
      body,
    };
  }

  return body;
}
