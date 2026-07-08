import type { Ic } from "../ast.ts";

type NameCtx = {
  used: Set<string>;
  next_name: number;
};

export function fresh_name(ctx: NameCtx, prefix: string): string {
  while (true) {
    const name = "_" + prefix + ctx.next_name.toString();
    ctx.next_name += 1;

    if (
      !ctx.used.has(name) &&
      !ctx.used.has(name + "0") &&
      !ctx.used.has(name + "1")
    ) {
      ctx.used.add(name);
      ctx.used.add(name + "0");
      ctx.used.add(name + "1");
      return name;
    }
  }
}

export function fresh_var(ctx: NameCtx, prefix: string): string {
  while (true) {
    const name = "_" + prefix + ctx.next_name.toString();
    ctx.next_name += 1;

    if (!ctx.used.has(name)) {
      ctx.used.add(name);
      return name;
    }
  }
}

export function collect_names(ic: Ic, out = new Set<string>()): Set<string> {
  switch (ic.tag) {
    case "num":
    case "text":
      return out;

    case "var":
      out.add(ic.name);
      return out;

    case "prim":
      for (const item of ic.args) {
        collect_names(item, out);
      }

      return out;

    case "lam":
      out.add(ic.name);
      collect_names(ic.body, out);
      return out;

    case "app":
      collect_names(ic.func, out);
      collect_names(ic.arg, out);
      return out;

    case "sup":
      collect_names(ic.left, out);
      collect_names(ic.right, out);
      return out;

    case "dup":
      out.add(ic.name);
      out.add(ic.name + "0");
      out.add(ic.name + "1");
      collect_names(ic.expr, out);
      collect_names(ic.body, out);
      return out;

    case "era":
      collect_names(ic.expr, out);
      collect_names(ic.body, out);
      return out;

    case "fix":
      out.add(ic.name);
      collect_names(ic.expr, out);
      collect_names(ic.body, out);
      return out;
  }
}
