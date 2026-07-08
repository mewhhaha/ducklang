import { expect } from "../../expect.ts";
import type { Prim } from "../../op.ts";
import type { Ic } from "../ast.ts";
import { collect_names } from "./names.ts";
import { clone_node } from "./node.ts";

export type Ref = number;

type IcNum = Extract<Ic, { tag: "num" }>;

export type GraphNode =
  | { tag: "num"; type: IcNum["type"]; value: IcNum["value"] }
  | { tag: "text"; value: string }
  | { tag: "var"; name: string }
  | { tag: "prim"; prim: Prim; args: Ref[] }
  | { tag: "lam"; name: string; body: Ref }
  | { tag: "app"; func: Ref; arg: Ref }
  | { tag: "sup"; label: string; left: Ref; right: Ref }
  | { tag: "dup"; label: string; name: string; expr: Ref; body: Ref }
  | { tag: "era"; expr: Ref; body: Ref };

export type IcReduceStats = {
  steps: number;
  allocs: number;
  max_refs: number;
  app_lam: number;
  app_sup: number;
  dup_sup_same: number;
  dup_sup_diff: number;
  dup_lam: number;
  prim_folds: number;
  prim_spreads: number;
  select_folds: number;
  select_dynamic: number;
  erasures: number;
};

export type GraphCtx = {
  nodes: Map<Ref, GraphNode>;
  next_ref: number;
  used: Set<string>;
  next_name: number;
  max_steps: number;
  stats: IcReduceStats;
};

export function create_ctx(ic: Ic): GraphCtx {
  return {
    nodes: new Map(),
    next_ref: 0,
    used: collect_names(ic),
    next_name: 0,
    max_steps: 1_000_000,
    stats: empty_stats(),
  };
}

function empty_stats(): IcReduceStats {
  return {
    steps: 0,
    allocs: 0,
    max_refs: 0,
    app_lam: 0,
    app_sup: 0,
    dup_sup_same: 0,
    dup_sup_diff: 0,
    dup_lam: 0,
    prim_folds: 0,
    prim_spreads: 0,
    select_folds: 0,
    select_dynamic: 0,
    erasures: 0,
  };
}

export function alloc(ctx: GraphCtx, node: GraphNode): Ref {
  const ref = ctx.next_ref;
  ctx.next_ref += 1;
  ctx.nodes.set(ref, node);
  ctx.stats.allocs += 1;

  if (ctx.nodes.size > ctx.stats.max_refs) {
    ctx.stats.max_refs = ctx.nodes.size;
  }

  return ref;
}

export function from_ic(
  ctx: GraphCtx,
  ic: Ic,
  env: Map<string, Ref>,
): Ref {
  switch (ic.tag) {
    case "num":
      return alloc(ctx, { tag: "num", type: ic.type, value: ic.value });

    case "text":
      return alloc(ctx, { tag: "text", value: ic.value });

    case "var": {
      const bound = env.get(ic.name);

      if (bound !== undefined) {
        return bound;
      }

      return alloc(ctx, { tag: "var", name: ic.name });
    }

    case "prim":
      return alloc(ctx, {
        tag: "prim",
        prim: ic.prim,
        args: ic.args.map((arg) => from_ic(ctx, arg, env)),
      });

    case "lam":
      return alloc(ctx, {
        tag: "lam",
        name: ic.name,
        body: from_ic(ctx, ic.body, env),
      });

    case "app":
      return alloc(ctx, {
        tag: "app",
        func: from_ic(ctx, ic.func, env),
        arg: from_ic(ctx, ic.arg, env),
      });

    case "sup":
      return alloc(ctx, {
        tag: "sup",
        label: ic.label,
        left: from_ic(ctx, ic.left, env),
        right: from_ic(ctx, ic.right, env),
      });

    case "dup":
      return alloc(ctx, {
        tag: "dup",
        label: ic.label,
        name: ic.name,
        expr: from_ic(ctx, ic.expr, env),
        body: from_ic(ctx, ic.body, env),
      });

    case "era":
      return alloc(ctx, {
        tag: "era",
        expr: from_ic(ctx, ic.expr, env),
        body: from_ic(ctx, ic.body, env),
      });

    case "fix": {
      const self = alloc(ctx, { tag: "var", name: ic.name });
      const local = new Map(env);
      local.set(ic.name, self);
      const expr = from_ic(ctx, ic.expr, local);
      expect(expr !== self, "Recursive binding cannot directly equal itself");
      const expr_node = ctx.nodes.get(expr);
      expect(expr_node, "Missing recursive Ic graph node");
      ctx.nodes.set(self, clone_node(expr_node));
      return from_ic(ctx, ic.body, local);
    }
  }
}
