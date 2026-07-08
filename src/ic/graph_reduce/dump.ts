import { expect } from "../../expect.ts";

type Ref = number;

type GraphDumpNode =
  | { tag: "num"; type: string; value: number | bigint }
  | { tag: "text"; value: string }
  | { tag: "var"; name: string }
  | { tag: "prim"; prim: string; args: Ref[] }
  | { tag: "lam"; name: string; body: Ref }
  | { tag: "app"; func: Ref; arg: Ref }
  | { tag: "sup"; label: string; left: Ref; right: Ref }
  | { tag: "dup"; label: string; name: string; expr: Ref; body: Ref }
  | { tag: "era"; expr: Ref; body: Ref };

export function dump_graph<node extends GraphDumpNode>(
  ctx: { nodes: Map<Ref, node> },
  root: Ref,
): string {
  const refs: Ref[] = [];
  const seen = new Set<Ref>();
  const pending = [root];

  while (pending.length > 0) {
    const ref = pending.shift();
    expect(ref !== undefined, "Missing pending graph ref");

    if (seen.has(ref)) {
      continue;
    }

    seen.add(ref);
    refs.push(ref);
    const node = ctx.nodes.get(ref);
    expect(node, "Missing graph dump node");

    for (const child of child_refs(node)) {
      pending.push(child);
    }
  }

  refs.sort((left, right) => left - right);
  return refs.map((ref) => {
    const node = ctx.nodes.get(ref);
    expect(node, "Missing graph dump node");
    return "#" + ref.toString() + " = " + dump_node(node);
  }).join("\n");
}

function child_refs(node: GraphDumpNode): Ref[] {
  switch (node.tag) {
    case "num":
    case "text":
    case "var":
      return [];

    case "prim":
      return [...node.args];

    case "lam":
      return [node.body];

    case "app":
      return [node.func, node.arg];

    case "sup":
      return [node.left, node.right];

    case "dup":
      return [node.expr, node.body];

    case "era":
      return [node.expr, node.body];
  }
}

function dump_node(node: GraphDumpNode): string {
  switch (node.tag) {
    case "num":
      return node.value.toString() + ":" + node.type;

    case "text":
      return Deno.inspect(node.value);

    case "var":
      return node.name;

    case "prim":
      return node.prim + "(" + node.args.map(dump_ref).join(", ") + ")";

    case "lam":
      return "λ" + node.name + ". " + dump_ref(node.body);

    case "app":
      return "app(" + dump_ref(node.func) + ", " + dump_ref(node.arg) + ")";

    case "sup":
      return "&" + node.label + "{" + dump_ref(node.left) + ", " +
        dump_ref(node.right) + "}";

    case "dup":
      return "! " + node.name + " &" + node.label + " = " +
        dump_ref(node.expr) + "; " + dump_ref(node.body);

    case "era":
      return "~ " + dump_ref(node.expr) + "; " + dump_ref(node.body);
  }
}

function dump_ref(ref: Ref): string {
  return "#" + ref.toString();
}
