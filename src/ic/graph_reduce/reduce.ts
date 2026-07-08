import { expect } from "../../expect.ts";
import { Prim } from "../../op.ts";
import { Callable } from "../../trait.ts";
import {
  alloc,
  from_ic,
  type GraphCtx,
  type GraphNode,
  type Ref,
} from "./context.ts";
import { erase } from "./erase.ts";
import { materialize_ic } from "./materialize.ts";
import { fresh_name, fresh_var } from "./names.ts";
import { node_to_num, replace_ref } from "./node.ts";
import { contains_ref, name_use_count } from "./scan.ts";
import { subst } from "./substitute.ts";
import { fold_prim, fold_select, is_binary_prim } from "../prim_reduce.ts";

export function reduce_ref(ctx: GraphCtx, ref: Ref): Ref {
  ctx.stats.steps += 1;
  expect(
    ctx.stats.steps <= ctx.max_steps,
    "Ic graph reduction step limit exceeded",
  );

  const current = ctx.nodes.get(ref);
  expect(current, "Missing Ic graph node " + ref.toString());

  switch (current.tag) {
    case "num":
    case "text":
    case "var":
      return ref;

    case "lam":
      if (contains_ref(ctx, current.body, ref, new Set())) {
        return ref;
      }

      {
        const body = reduce_ref(ctx, current.body);
        ctx.nodes.set(ref, { tag: "lam", name: current.name, body });
        return ref;
      }

    case "prim":
      return reduce_prim(ctx, ref, current);

    case "app":
      return reduce_app(ctx, ref, current);

    case "sup": {
      const left = reduce_ref(ctx, current.left);
      const right = reduce_ref(ctx, current.right);
      ctx.nodes.set(ref, {
        tag: "sup",
        label: current.label,
        left,
        right,
      });
      return ref;
    }

    case "dup":
      return reduce_dup(ctx, ref, current);

    case "era":
      return reduce_era(ctx, ref, current);
  }
}

function reduce_prim(
  ctx: GraphCtx,
  ref: Ref,
  current: Extract<GraphNode, { tag: "prim" }>,
): Ref {
  const expected = Callable.arity(Prim, current.prim);
  expect(
    current.args.length === expected,
    "Primitive " + current.prim + " expects " + expected + " arguments",
  );

  if (current.prim === "i32.select" || current.prim === "i64.select") {
    return reduce_select(ctx, ref, current);
  }

  const args: Ref[] = [];

  for (let index = 0; index < current.args.length; index += 1) {
    const arg = current.args[index];
    expect(arg !== undefined, "Missing primitive argument " + index);
    args.push(reduce_ref(ctx, arg));
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    expect(arg !== undefined, "Missing primitive argument " + index);
    const arg_node = ctx.nodes.get(arg);
    expect(arg_node, "Missing primitive argument node " + index);

    if (arg_node.tag === "sup") {
      ctx.stats.prim_spreads += 1;
      const spread = spread_prim(ctx, current.prim, args, index, arg_node);
      const reduced = reduce_ref(ctx, spread);
      return replace_ref(ctx, ref, reduced);
    }
  }

  if (expected !== 2) {
    ctx.nodes.set(ref, { tag: "prim", prim: current.prim, args });
    return ref;
  }

  expect(
    is_binary_prim(current.prim),
    "Expected binary primitive: " + current.prim,
  );
  const left_ref = args[0];
  const right_ref = args[1];
  expect(left_ref !== undefined, "Missing primitive argument 0");
  expect(right_ref !== undefined, "Missing primitive argument 1");
  const left = ctx.nodes.get(left_ref);
  const right = ctx.nodes.get(right_ref);
  expect(left, "Missing primitive left argument");
  expect(right, "Missing primitive right argument");

  if (left.tag === "num" && right.tag === "num") {
    ctx.stats.prim_folds += 1;
    const folded = fold_prim(
      current.prim,
      node_to_num(left),
      node_to_num(right),
    );
    const folded_ref = from_ic(ctx, folded, new Map());
    return replace_ref(ctx, ref, folded_ref);
  }

  ctx.nodes.set(ref, { tag: "prim", prim: current.prim, args });
  return ref;
}

function reduce_select(
  ctx: GraphCtx,
  ref: Ref,
  current: Extract<GraphNode, { tag: "prim" }>,
): Ref {
  const then_ref = current.args[0];
  const else_ref = current.args[1];
  const cond_ref = current.args[2];
  expect(then_ref !== undefined, "Missing select then branch");
  expect(else_ref !== undefined, "Missing select else branch");
  expect(cond_ref !== undefined, "Missing select condition");

  const cond = reduce_ref(ctx, cond_ref);
  const cond_node = ctx.nodes.get(cond);
  expect(cond_node, "Missing select condition node");

  if (cond_node.tag === "num") {
    ctx.stats.select_folds += 1;
    expect(cond_node.type === "i32", "Select condition must be i32");
    const value = cond_node.value;
    expect(typeof value === "number", "Expected i32 select condition");

    if (value !== 0) {
      const result = reduce_ref(ctx, then_ref);
      return replace_ref(ctx, ref, result);
    }

    const result = reduce_ref(ctx, else_ref);
    return replace_ref(ctx, ref, result);
  }

  ctx.stats.select_dynamic += 1;
  const then_value = reduce_ref(ctx, then_ref);
  const else_value = reduce_ref(ctx, else_ref);
  const args = [
    materialize_ic(ctx, then_value, new Set()),
    materialize_ic(ctx, else_value, new Set()),
    materialize_ic(ctx, cond, new Set()),
  ];
  const folded = fold_select(current.prim, args);
  const folded_ref = from_ic(ctx, folded, new Map());
  return replace_ref(ctx, ref, folded_ref);
}

function reduce_app(
  ctx: GraphCtx,
  ref: Ref,
  current: Extract<GraphNode, { tag: "app" }>,
): Ref {
  const func = reduce_ref(ctx, current.func);
  const arg = reduce_ref(ctx, current.arg);
  const func_node = ctx.nodes.get(func);
  expect(func_node, "Missing application function");

  if (func_node.tag === "lam") {
    ctx.stats.app_lam += 1;
    const body = subst(ctx, func_node.body, func_node.name, arg);
    const result = reduce_ref(ctx, body);
    return replace_ref(ctx, ref, result);
  }

  if (func_node.tag === "sup") {
    ctx.stats.app_sup += 1;
    const name = fresh_name(ctx, "x");
    const left_arg = alloc(ctx, { tag: "var", name: name + "0" });
    const right_arg = alloc(ctx, { tag: "var", name: name + "1" });
    const left_app = alloc(ctx, {
      tag: "app",
      func: func_node.left,
      arg: left_arg,
    });
    const right_app = alloc(ctx, {
      tag: "app",
      func: func_node.right,
      arg: right_arg,
    });
    const body = alloc(ctx, {
      tag: "sup",
      label: func_node.label,
      left: left_app,
      right: right_app,
    });
    const dup = alloc(ctx, {
      tag: "dup",
      label: func_node.label,
      name,
      expr: arg,
      body,
    });
    const result = reduce_ref(ctx, dup);
    return replace_ref(ctx, ref, result);
  }

  ctx.nodes.set(ref, { tag: "app", func, arg });
  return ref;
}

function reduce_dup(
  ctx: GraphCtx,
  ref: Ref,
  current: Extract<GraphNode, { tag: "dup" }>,
): Ref {
  const expr = reduce_ref(ctx, current.expr);
  const expr_node = ctx.nodes.get(expr);
  expect(expr_node, "Missing duplication expression");

  if (expr_node.tag === "sup") {
    const result = reduce_dup_sup(ctx, current, expr_node);
    const reduced = reduce_ref(ctx, result);
    return replace_ref(ctx, ref, reduced);
  }

  if (expr_node.tag === "lam") {
    ctx.stats.dup_lam += 1;
    const result = reduce_dup_lam(ctx, current, expr_node);
    const reduced = reduce_ref(ctx, result);
    return replace_ref(ctx, ref, reduced);
  }

  if (expr_node.tag === "num" || expr_node.tag === "text") {
    const left = subst(ctx, current.body, current.name + "0", expr);
    const right = subst(ctx, left, current.name + "1", expr);
    const result = reduce_ref(ctx, right);
    return replace_ref(ctx, ref, result);
  }

  const body = reduce_ref(ctx, current.body);
  const left_name = current.name + "0";
  const right_name = current.name + "1";
  const left_uses = name_use_count(ctx, body, left_name, new Set());
  const right_uses = name_use_count(ctx, body, right_name, new Set());

  if (left_uses === 0 && right_uses === 0) {
    const era = alloc(ctx, { tag: "era", expr, body });
    const result = reduce_ref(ctx, era);
    return replace_ref(ctx, ref, result);
  }

  if (left_uses === 0 && right_uses === 1) {
    const result = reduce_ref(ctx, subst(ctx, body, right_name, expr));
    return replace_ref(ctx, ref, result);
  }

  if (left_uses === 1 && right_uses === 0) {
    const result = reduce_ref(ctx, subst(ctx, body, left_name, expr));
    return replace_ref(ctx, ref, result);
  }

  ctx.nodes.set(ref, {
    tag: "dup",
    label: current.label,
    name: current.name,
    expr,
    body,
  });
  return ref;
}

function reduce_era(
  ctx: GraphCtx,
  ref: Ref,
  current: Extract<GraphNode, { tag: "era" }>,
): Ref {
  ctx.stats.erasures += 1;
  const expr = reduce_ref(ctx, current.expr);
  const body = erase(ctx, expr, current.body);
  const result = reduce_ref(ctx, body);
  return replace_ref(ctx, ref, result);
}

function reduce_dup_sup(
  ctx: GraphCtx,
  dup: Extract<GraphNode, { tag: "dup" }>,
  sup: Extract<GraphNode, { tag: "sup" }>,
): Ref {
  if (sup.label === dup.label) {
    ctx.stats.dup_sup_same += 1;
    const left = subst(ctx, dup.body, dup.name + "0", sup.left);
    return subst(ctx, left, dup.name + "1", sup.right);
  }

  ctx.stats.dup_sup_diff += 1;
  const left_name = fresh_name(ctx, "a");
  const right_name = fresh_name(ctx, "b");
  const left_projection = alloc(ctx, {
    tag: "sup",
    label: sup.label,
    left: alloc(ctx, { tag: "var", name: left_name + "0" }),
    right: alloc(ctx, { tag: "var", name: right_name + "0" }),
  });
  const right_projection = alloc(ctx, {
    tag: "sup",
    label: sup.label,
    left: alloc(ctx, { tag: "var", name: left_name + "1" }),
    right: alloc(ctx, { tag: "var", name: right_name + "1" }),
  });
  const left = subst(ctx, dup.body, dup.name + "0", left_projection);
  const right = subst(ctx, left, dup.name + "1", right_projection);
  const right_dup = alloc(ctx, {
    tag: "dup",
    label: dup.label,
    name: right_name,
    expr: sup.right,
    body: right,
  });
  return alloc(ctx, {
    tag: "dup",
    label: dup.label,
    name: left_name,
    expr: sup.left,
    body: right_dup,
  });
}

function reduce_dup_lam(
  ctx: GraphCtx,
  dup: Extract<GraphNode, { tag: "dup" }>,
  lam: Extract<GraphNode, { tag: "lam" }>,
): Ref {
  const body_name = fresh_name(ctx, "b");
  const left_name = fresh_var(ctx, lam.name);
  const right_name = fresh_var(ctx, lam.name);
  const shared_arg = alloc(ctx, {
    tag: "sup",
    label: dup.label,
    left: alloc(ctx, { tag: "var", name: left_name }),
    right: alloc(ctx, { tag: "var", name: right_name }),
  });
  const shared_body = subst(ctx, lam.body, lam.name, shared_arg);
  const left_func = alloc(ctx, {
    tag: "lam",
    name: left_name,
    body: alloc(ctx, { tag: "var", name: body_name + "0" }),
  });
  const right_func = alloc(ctx, {
    tag: "lam",
    name: right_name,
    body: alloc(ctx, { tag: "var", name: body_name + "1" }),
  });
  const left = subst(ctx, dup.body, dup.name + "0", left_func);
  const right = subst(ctx, left, dup.name + "1", right_func);
  return alloc(ctx, {
    tag: "dup",
    label: dup.label,
    name: body_name,
    expr: shared_body,
    body: right,
  });
}

function spread_prim(
  ctx: GraphCtx,
  prim: Prim,
  args: Ref[],
  index: number,
  sup: Extract<GraphNode, { tag: "sup" }>,
): Ref {
  const left_args: Ref[] = [];
  const right_args: Ref[] = [];
  const copy_names: string[] = [];
  const copy_exprs: Ref[] = [];

  for (let pos = 0; pos < args.length; pos += 1) {
    const input = args[pos];
    expect(input !== undefined, "Missing primitive argument " + pos);

    if (pos === index) {
      left_args.push(sup.left);
      right_args.push(sup.right);
    } else {
      const name = fresh_name(ctx, "p");
      copy_names.push(name);
      copy_exprs.push(input);
      left_args.push(alloc(ctx, { tag: "var", name: name + "0" }));
      right_args.push(alloc(ctx, { tag: "var", name: name + "1" }));
    }
  }

  let body = alloc(ctx, {
    tag: "sup",
    label: sup.label,
    left: alloc(ctx, { tag: "prim", prim, args: left_args }),
    right: alloc(ctx, { tag: "prim", prim, args: right_args }),
  });

  for (let copy = copy_names.length - 1; copy >= 0; copy -= 1) {
    const name = copy_names[copy];
    const expr = copy_exprs[copy];
    expect(name, "Missing copied primitive name");
    expect(expr !== undefined, "Missing copied primitive expression");
    body = alloc(ctx, {
      tag: "dup",
      label: sup.label,
      name,
      expr,
      body,
    });
  }

  return body;
}
