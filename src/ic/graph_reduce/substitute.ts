import { expect } from "../../expect.ts";
import { alloc, type GraphCtx, type Ref } from "./context.ts";
import { has_name } from "./scan.ts";

export function subst(
  ctx: GraphCtx,
  ref: Ref,
  name: string,
  value: Ref,
): Ref {
  if (!has_name(ctx, ref, name, new Set(), new Map())) {
    return ref;
  }

  return clone_subst(ctx, ref, name, value, new Map());
}

function clone_subst(
  ctx: GraphCtx,
  ref: Ref,
  name: string,
  value: Ref,
  memo: Map<Ref, Ref>,
): Ref {
  if (!has_name(ctx, ref, name, new Set(), new Map())) {
    return ref;
  }

  const cached = memo.get(ref);

  if (cached !== undefined) {
    return cached;
  }

  const node = ctx.nodes.get(ref);
  expect(node, "Missing substitution node");

  switch (node.tag) {
    case "num":
    case "text":
      return ref;

    case "var":
      if (node.name === name) {
        return value;
      }

      return ref;

    case "prim": {
      const result = alloc(ctx, {
        tag: "prim",
        prim: node.prim,
        args: [],
      });
      memo.set(ref, result);
      const args = node.args.map((arg) =>
        clone_subst(ctx, arg, name, value, memo)
      );
      ctx.nodes.set(result, { tag: "prim", prim: node.prim, args });
      return result;
    }

    case "lam":
      if (node.name === name) {
        return ref;
      }

      {
        const result = alloc(ctx, { tag: "lam", name: node.name, body: ref });
        memo.set(ref, result);
        const body = clone_subst(ctx, node.body, name, value, memo);
        ctx.nodes.set(result, { tag: "lam", name: node.name, body });
        return result;
      }

    case "app": {
      const result = alloc(ctx, { tag: "app", func: ref, arg: ref });
      memo.set(ref, result);
      const func = clone_subst(ctx, node.func, name, value, memo);
      const arg = clone_subst(ctx, node.arg, name, value, memo);
      ctx.nodes.set(result, { tag: "app", func, arg });
      return result;
    }

    case "sup": {
      const result = alloc(ctx, {
        tag: "sup",
        label: node.label,
        left: ref,
        right: ref,
      });
      memo.set(ref, result);
      const left = clone_subst(ctx, node.left, name, value, memo);
      const right = clone_subst(ctx, node.right, name, value, memo);
      ctx.nodes.set(result, {
        tag: "sup",
        label: node.label,
        left,
        right,
      });
      return result;
    }

    case "dup": {
      const result = alloc(ctx, {
        tag: "dup",
        label: node.label,
        name: node.name,
        expr: ref,
        body: ref,
      });
      memo.set(ref, result);
      const expr = clone_subst(ctx, node.expr, name, value, memo);

      if (name === node.name + "0" || name === node.name + "1") {
        ctx.nodes.set(result, {
          tag: "dup",
          label: node.label,
          name: node.name,
          expr,
          body: node.body,
        });
        return result;
      }

      const body = clone_subst(ctx, node.body, name, value, memo);
      ctx.nodes.set(result, {
        tag: "dup",
        label: node.label,
        name: node.name,
        expr,
        body,
      });
      return result;
    }

    case "era": {
      const result = alloc(ctx, { tag: "era", expr: ref, body: ref });
      memo.set(ref, result);
      const expr = clone_subst(ctx, node.expr, name, value, memo);
      const body = clone_subst(ctx, node.body, name, value, memo);
      ctx.nodes.set(result, { tag: "era", expr, body });
      return result;
    }
  }
}
