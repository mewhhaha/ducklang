import { expect } from "../../expect.ts";
import type { Prim } from "../../op.ts";
import type { Ic } from "../ast.ts";

type Ref = number;
type IcNum = Extract<Ic, { tag: "num" }>;

type GraphCloneNode =
  | { tag: "num"; type: IcNum["type"]; value: IcNum["value"] }
  | { tag: "text"; value: string }
  | { tag: "var"; name: string }
  | { tag: "prim"; prim: Prim; args: Ref[] }
  | { tag: "lam"; name: string; body: Ref }
  | { tag: "app"; func: Ref; arg: Ref }
  | { tag: "sup"; label: string; left: Ref; right: Ref }
  | { tag: "dup"; label: string; name: string; expr: Ref; body: Ref }
  | { tag: "era"; expr: Ref; body: Ref };

export function replace_ref(
  ctx: { nodes: Map<Ref, GraphCloneNode> },
  target: Ref,
  source: Ref,
): Ref {
  if (target === source) {
    return target;
  }

  const source_node = ctx.nodes.get(source);
  expect(source_node, "Missing replacement source");
  ctx.nodes.set(target, clone_node(source_node));
  return target;
}

export function clone_node(node: GraphCloneNode): GraphCloneNode {
  switch (node.tag) {
    case "num":
      return { tag: "num", type: node.type, value: node.value };

    case "text":
      return { tag: "text", value: node.value };

    case "var":
      return { tag: "var", name: node.name };

    case "prim":
      return { tag: "prim", prim: node.prim, args: [...node.args] };

    case "lam":
      return { tag: "lam", name: node.name, body: node.body };

    case "app":
      return { tag: "app", func: node.func, arg: node.arg };

    case "sup":
      return {
        tag: "sup",
        label: node.label,
        left: node.left,
        right: node.right,
      };

    case "dup":
      return {
        tag: "dup",
        label: node.label,
        name: node.name,
        expr: node.expr,
        body: node.body,
      };

    case "era":
      return { tag: "era", expr: node.expr, body: node.body };
  }
}

export function node_to_num(
  node: Extract<GraphCloneNode, { tag: "num" }>,
): IcNum {
  return { tag: "num", type: node.type, value: node.value };
}
