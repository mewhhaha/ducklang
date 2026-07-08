import type { Ic } from "../ast.ts";

export type IcReduceCtx = {
  used: Set<string>;
  next: number;
  name: (prefix: string) => string;
  var: (prefix: string) => string;
};

export function create_ic_reduce_ctx(ic: Ic): IcReduceCtx {
  const ctx: IcReduceCtx = {
    used: collect_ic_names(ic),
    next: 0,
    name(prefix: string): string {
      while (true) {
        const name = "_" + prefix + ctx.next.toString();
        ctx.next += 1;

        if (
          !ctx.used.has(name) &&
          !ctx.used.has(`${name}0`) &&
          !ctx.used.has(`${name}1`)
        ) {
          ctx.used.add(name);
          ctx.used.add(`${name}0`);
          ctx.used.add(`${name}1`);
          return name;
        }
      }
    },
    var(prefix: string): string {
      while (true) {
        const name = "_" + prefix + ctx.next.toString();
        ctx.next += 1;

        if (!ctx.used.has(name)) {
          ctx.used.add(name);
          return name;
        }
      }
    },
  };

  return ctx;
}

function collect_ic_names(ic: Ic, out = new Set<string>()): Set<string> {
  switch (ic.tag) {
    case "num":
    case "text":
      return out;

    case "var":
      out.add(ic.name);
      return out;

    case "prim":
      for (const item of ic.args) {
        collect_ic_names(item, out);
      }

      return out;

    case "lam":
      out.add(ic.name);
      collect_ic_names(ic.body, out);
      return out;

    case "app":
      collect_ic_names(ic.func, out);
      collect_ic_names(ic.arg, out);
      return out;

    case "sup":
      collect_ic_names(ic.left, out);
      collect_ic_names(ic.right, out);
      return out;

    case "dup":
      out.add(ic.name);
      out.add(`${ic.name}0`);
      out.add(`${ic.name}1`);
      collect_ic_names(ic.expr, out);
      collect_ic_names(ic.body, out);
      return out;

    case "era":
      collect_ic_names(ic.expr, out);
      collect_ic_names(ic.body, out);
      return out;

    case "fix":
      out.add(ic.name);
      collect_ic_names(ic.expr, out);
      collect_ic_names(ic.body, out);
      return out;
  }
}
