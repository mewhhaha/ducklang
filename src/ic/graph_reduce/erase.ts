import { expect } from "../../expect.ts";
import { alloc, type GraphCtx, type Ref } from "./context.ts";

export function erase(ctx: GraphCtx, expr: Ref, body: Ref): Ref {
  const node = ctx.nodes.get(expr);
  expect(node, "Missing erasure expression");

  switch (node.tag) {
    case "num":
    case "text":
    case "var":
      return body;

    case "prim":
      return erase_many(ctx, node.args, body);

    case "lam":
      return alloc(ctx, { tag: "era", expr: node.body, body });

    case "app":
      return erase_many(ctx, [node.func, node.arg], body);

    case "sup":
      return erase_many(ctx, [node.left, node.right], body);

    case "dup": {
      const left = alloc(ctx, { tag: "var", name: node.name + "0" });
      const right = alloc(ctx, { tag: "var", name: node.name + "1" });
      const next = erase_many(ctx, [left, right], node.body);
      return erase_many(ctx, [node.expr, next], body);
    }

    case "era":
      return erase_many(ctx, [node.expr, node.body], body);
  }
}

function erase_many(ctx: GraphCtx, items: Ref[], next: Ref): Ref {
  let result = next;

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    expect(item !== undefined, "Missing erasure item " + index);
    result = alloc(ctx, { tag: "era", expr: item, body: result });
  }

  return result;
}
