import type { Ic as IcNode } from "../../ic.ts";

export type FreeNameCount = {
  name: string;
  count: number;
};

export function free_name_counts(ic: IcNode): FreeNameCount[] {
  const counts = new Map<string, number>();
  collect_free_name_counts(ic, new Set(), counts);
  const result: FreeNameCount[] = [];

  for (const [name, count] of counts) {
    result.push({ name, count });
  }

  return result;
}

export function ic_name_use_count(ic: IcNode, name: string): number {
  switch (ic.tag) {
    case "num":
    case "text":
      return 0;

    case "var":
      if (ic.name === name) {
        return 1;
      }

      return 0;

    case "prim": {
      let count = 0;

      for (const arg of ic.args) {
        count += ic_name_use_count(arg, name);
      }

      return count;
    }

    case "lam":
      if (ic.name === name) {
        return 0;
      }

      return ic_name_use_count(ic.body, name);

    case "app":
      return ic_name_use_count(ic.func, name) +
        ic_name_use_count(ic.arg, name);

    case "sup":
      return ic_name_use_count(ic.left, name) +
        ic_name_use_count(ic.right, name);

    case "dup": {
      const expr_count = ic_name_use_count(ic.expr, name);

      if (name === ic.name + "0" || name === ic.name + "1") {
        return expr_count;
      }

      return expr_count + ic_name_use_count(ic.body, name);
    }

    case "era":
      return ic_name_use_count(ic.expr, name) +
        ic_name_use_count(ic.body, name);

    case "fix":
      if (ic.name === name) {
        return 0;
      }

      return ic_name_use_count(ic.expr, name) +
        ic_name_use_count(ic.body, name);
  }
}

function collect_free_name_counts(
  ic: IcNode,
  bound: Set<string>,
  counts: Map<string, number>,
): void {
  switch (ic.tag) {
    case "num":
    case "text":
      return;

    case "var":
      if (bound.has(ic.name)) {
        return;
      }

      counts.set(ic.name, (counts.get(ic.name) || 0) + 1);
      return;

    case "prim":
      for (const arg of ic.args) {
        collect_free_name_counts(arg, bound, counts);
      }

      return;

    case "lam": {
      const body_bound = new Set(bound);
      body_bound.add(ic.name);
      collect_free_name_counts(ic.body, body_bound, counts);
      return;
    }

    case "app":
      collect_free_name_counts(ic.func, bound, counts);
      collect_free_name_counts(ic.arg, bound, counts);
      return;

    case "sup":
      collect_free_name_counts(ic.left, bound, counts);
      collect_free_name_counts(ic.right, bound, counts);
      return;

    case "dup": {
      collect_free_name_counts(ic.expr, bound, counts);
      const body_bound = new Set(bound);
      body_bound.add(ic.name + "0");
      body_bound.add(ic.name + "1");
      collect_free_name_counts(ic.body, body_bound, counts);
      return;
    }

    case "era":
      collect_free_name_counts(ic.expr, bound, counts);
      collect_free_name_counts(ic.body, bound, counts);
      return;

    case "fix": {
      const body_bound = new Set(bound);
      body_bound.add(ic.name);
      collect_free_name_counts(ic.expr, body_bound, counts);
      collect_free_name_counts(ic.body, body_bound, counts);
      return;
    }
  }
}
