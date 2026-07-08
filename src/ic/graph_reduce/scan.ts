import { expect } from "../../expect.ts";

type Ref = number;

type GraphScanNode =
  | { tag: "num" }
  | { tag: "text" }
  | { tag: "var"; name: string }
  | { tag: "prim"; args: Ref[] }
  | { tag: "lam"; name: string; body: Ref }
  | { tag: "app"; func: Ref; arg: Ref }
  | { tag: "sup"; left: Ref; right: Ref }
  | { tag: "dup"; name: string; expr: Ref; body: Ref }
  | { tag: "era"; expr: Ref; body: Ref };

type GraphScanCtx<node extends GraphScanNode> = {
  nodes: Map<Ref, node>;
};

export function has_name<node extends GraphScanNode>(
  ctx: GraphScanCtx<node>,
  ref: Ref,
  name: string,
  visiting: Set<Ref>,
  memo: Map<Ref, boolean>,
): boolean {
  const cached = memo.get(ref);

  if (cached !== undefined) {
    return cached;
  }

  if (visiting.has(ref)) {
    return false;
  }

  visiting.add(ref);
  const node = ctx.nodes.get(ref);
  expect(node, "Missing name search node");
  let result = false;

  switch (node.tag) {
    case "num":
    case "text":
      result = false;
      break;

    case "var":
      result = node.name === name;
      break;

    case "prim":
      for (const arg of node.args) {
        if (has_name(ctx, arg, name, visiting, memo)) {
          result = true;
          break;
        }
      }

      break;

    case "lam":
      if (node.name !== name) {
        result = has_name(ctx, node.body, name, visiting, memo);
      }

      break;

    case "app":
      result = has_name(ctx, node.func, name, visiting, memo) ||
        has_name(ctx, node.arg, name, visiting, memo);
      break;

    case "sup":
      result = has_name(ctx, node.left, name, visiting, memo) ||
        has_name(ctx, node.right, name, visiting, memo);
      break;

    case "dup":
      result = has_name(ctx, node.expr, name, visiting, memo);

      if (!result && name !== node.name + "0" && name !== node.name + "1") {
        result = has_name(ctx, node.body, name, visiting, memo);
      }

      break;

    case "era":
      result = has_name(ctx, node.expr, name, visiting, memo) ||
        has_name(ctx, node.body, name, visiting, memo);
      break;
  }

  visiting.delete(ref);
  memo.set(ref, result);
  return result;
}

export function name_use_count<node extends GraphScanNode>(
  ctx: GraphScanCtx<node>,
  ref: Ref,
  name: string,
  visiting: Set<Ref>,
): number {
  if (visiting.has(ref)) {
    return 0;
  }

  visiting.add(ref);
  const node = ctx.nodes.get(ref);
  expect(node, "Missing name count node");
  let count = 0;

  switch (node.tag) {
    case "num":
    case "text":
      count = 0;
      break;

    case "var":
      if (node.name === name) {
        count = 1;
      }

      break;

    case "prim":
      for (const arg of node.args) {
        count += name_use_count(ctx, arg, name, visiting);
      }

      break;

    case "lam":
      if (node.name !== name) {
        count = name_use_count(ctx, node.body, name, visiting);
      }

      break;

    case "app":
      count = name_use_count(ctx, node.func, name, visiting) +
        name_use_count(ctx, node.arg, name, visiting);
      break;

    case "sup":
      count = name_use_count(ctx, node.left, name, visiting) +
        name_use_count(ctx, node.right, name, visiting);
      break;

    case "dup":
      count = name_use_count(ctx, node.expr, name, visiting);

      if (name !== node.name + "0" && name !== node.name + "1") {
        count += name_use_count(ctx, node.body, name, visiting);
      }

      break;

    case "era":
      count = name_use_count(ctx, node.expr, name, visiting) +
        name_use_count(ctx, node.body, name, visiting);
      break;
  }

  visiting.delete(ref);
  return count;
}

export function contains_ref<node extends GraphScanNode>(
  ctx: GraphScanCtx<node>,
  ref: Ref,
  target: Ref,
  visiting: Set<Ref>,
): boolean {
  if (ref === target) {
    return true;
  }

  if (visiting.has(ref)) {
    return false;
  }

  visiting.add(ref);
  const node = ctx.nodes.get(ref);
  expect(node, "Missing graph reference search node");
  let result = false;

  switch (node.tag) {
    case "num":
    case "text":
    case "var":
      result = false;
      break;

    case "prim":
      for (const arg of node.args) {
        if (contains_ref(ctx, arg, target, visiting)) {
          result = true;
          break;
        }
      }

      break;

    case "lam":
      result = contains_ref(ctx, node.body, target, visiting);
      break;

    case "app":
      result = contains_ref(ctx, node.func, target, visiting) ||
        contains_ref(ctx, node.arg, target, visiting);
      break;

    case "sup":
      result = contains_ref(ctx, node.left, target, visiting) ||
        contains_ref(ctx, node.right, target, visiting);
      break;

    case "dup":
      result = contains_ref(ctx, node.expr, target, visiting) ||
        contains_ref(ctx, node.body, target, visiting);
      break;

    case "era":
      result = contains_ref(ctx, node.expr, target, visiting) ||
        contains_ref(ctx, node.body, target, visiting);
      break;
  }

  visiting.delete(ref);
  return result;
}
