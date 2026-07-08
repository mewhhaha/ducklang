import { expect } from "../../expect.ts";
import type { Prim } from "../../op.ts";
import type { Ic } from "../ast.ts";

type Ref = number;
type IcNum = Extract<Ic, { tag: "num" }>;

type GraphMaterializeNode =
  | { tag: "num"; type: IcNum["type"]; value: IcNum["value"] }
  | { tag: "text"; value: string }
  | { tag: "var"; name: string }
  | { tag: "prim"; prim: Prim; args: Ref[] }
  | { tag: "lam"; name: string; body: Ref }
  | { tag: "app"; func: Ref; arg: Ref }
  | { tag: "sup"; label: string; left: Ref; right: Ref }
  | { tag: "dup"; label: string; name: string; expr: Ref; body: Ref }
  | { tag: "era"; expr: Ref; body: Ref };

type GraphMaterializeCtx<node extends GraphMaterializeNode> = {
  nodes: Map<Ref, node>;
};

export function materialize_ic<node extends GraphMaterializeNode>(
  ctx: GraphMaterializeCtx<node>,
  ref: Ref,
  visiting: Set<Ref>,
): Ic {
  if (visiting.has(ref)) {
    throw new Error("Cannot materialize cyclic Ic graph after reduction");
  }

  visiting.add(ref);
  const node = ctx.nodes.get(ref);
  expect(node, "Missing Ic graph node during materialization");
  let result: Ic;

  switch (node.tag) {
    case "num":
      result = { tag: "num", type: node.type, value: node.value };
      break;

    case "text":
      result = { tag: "text", value: node.value };
      break;

    case "var":
      result = { tag: "var", name: node.name };
      break;

    case "prim":
      result = {
        tag: "prim",
        prim: node.prim,
        args: node.args.map((arg) => materialize_ic(ctx, arg, visiting)),
      };
      break;

    case "lam":
      result = {
        tag: "lam",
        name: node.name,
        body: materialize_ic(ctx, node.body, visiting),
      };
      break;

    case "app":
      result = {
        tag: "app",
        func: materialize_ic(ctx, node.func, visiting),
        arg: materialize_ic(ctx, node.arg, visiting),
      };
      break;

    case "sup":
      result = {
        tag: "sup",
        label: node.label,
        left: materialize_ic(ctx, node.left, visiting),
        right: materialize_ic(ctx, node.right, visiting),
      };
      break;

    case "dup":
      result = {
        tag: "dup",
        label: node.label,
        name: node.name,
        expr: materialize_ic(ctx, node.expr, visiting),
        body: materialize_ic(ctx, node.body, visiting),
      };
      break;

    case "era":
      result = {
        tag: "era",
        expr: materialize_ic(ctx, node.expr, visiting),
        body: materialize_ic(ctx, node.body, visiting),
      };
      break;
  }

  visiting.delete(ref);
  return result;
}
