import type { Ic } from "./ast.ts";
import {
  create_ctx,
  from_ic,
  type IcReduceStats,
} from "./graph_reduce/context.ts";
import { dump_graph } from "./graph_reduce/dump.ts";
import { materialize_ic } from "./graph_reduce/materialize.ts";
import { reduce_ref } from "./graph_reduce/reduce.ts";

export type { IcReduceStats } from "./graph_reduce/context.ts";

export type IcGraphSnapshot = {
  label: string;
  text: string;
};

export type IcReduceDebug = {
  result: Ic;
  stats: IcReduceStats;
  snapshots: IcGraphSnapshot[];
};

export function reduce_ic_graph(ic: Ic): Ic {
  return reduce_ic_graph_debug(ic).result;
}

export function reduce_ic_graph_debug(ic: Ic): IcReduceDebug {
  const ctx = create_ctx(ic);
  const root = from_ic(ctx, ic, new Map());
  const initial = dump_graph(ctx, root);
  const reduced = reduce_ref(ctx, root);
  const reduced_graph = dump_graph(ctx, reduced);
  const result = materialize_ic(ctx, reduced, new Set());
  return {
    result,
    stats: { ...ctx.stats },
    snapshots: [
      { label: "initial", text: initial },
      { label: "reduced", text: reduced_graph },
    ],
  };
}

export function dump_ic_graph(ic: Ic): string {
  const ctx = create_ctx(ic);
  const root = from_ic(ctx, ic, new Map());
  return dump_graph(ctx, root);
}
