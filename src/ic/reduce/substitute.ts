import type { Ic } from "../ast.ts";

export function subst_ic(ic: Ic, name: string, value: Ic): Ic {
  switch (ic.tag) {
    case "num":
    case "text":
      return ic;

    case "var":
      if (ic.name === name) {
        return value;
      }

      return ic;

    case "prim":
      return {
        tag: "prim",
        prim: ic.prim,
        args: ic.args.map((item) => subst_ic(item, name, value)),
      };

    case "lam":
      if (ic.name === name) {
        return ic;
      }

      return {
        tag: "lam",
        name: ic.name,
        body: subst_ic(ic.body, name, value),
      };

    case "app":
      return {
        tag: "app",
        func: subst_ic(ic.func, name, value),
        arg: subst_ic(ic.arg, name, value),
      };

    case "sup":
      return {
        tag: "sup",
        label: ic.label,
        left: subst_ic(ic.left, name, value),
        right: subst_ic(ic.right, name, value),
      };

    case "dup": {
      const expr = subst_ic(ic.expr, name, value);

      if (name === `${ic.name}0` || name === `${ic.name}1`) {
        return {
          tag: "dup",
          label: ic.label,
          name: ic.name,
          expr,
          body: ic.body,
        };
      }

      return {
        tag: "dup",
        label: ic.label,
        name: ic.name,
        expr,
        body: subst_ic(ic.body, name, value),
      };
    }

    case "era":
      return {
        tag: "era",
        expr: subst_ic(ic.expr, name, value),
        body: subst_ic(ic.body, name, value),
      };

    case "fix":
      if (ic.name === name) {
        return ic;
      }

      return {
        tag: "fix",
        name: ic.name,
        expr: subst_ic(ic.expr, name, value),
        body: subst_ic(ic.body, name, value),
      };
  }
}

export function ic_name_use_count(ic: Ic, name: string): number {
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

      if (name === `${ic.name}0` || name === `${ic.name}1`) {
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
