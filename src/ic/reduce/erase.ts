import { expect } from "../../expect.ts";
import type { Ic } from "../ast.ts";

export function erase_ic(expr: Ic, body: Ic): Ic {
  switch (expr.tag) {
    case "num":
    case "text":
    case "var":
      return body;

    case "prim":
      return erase_ic_many(expr.args, body);

    case "lam":
      return { tag: "era", expr: expr.body, body };

    case "app":
      return erase_ic_many([expr.func, expr.arg], body);

    case "sup":
      return erase_ic_many([expr.left, expr.right], body);

    case "dup": {
      const left: Ic = { tag: "var", name: `${expr.name}0` };
      const right: Ic = { tag: "var", name: `${expr.name}1` };
      const next = erase_ic_many([left, right], expr.body);
      return erase_ic_many([expr.expr, next], body);
    }

    case "era":
      return erase_ic_many([expr.expr, expr.body], body);

    case "fix":
      return erase_ic_many([expr.expr, expr.body], body);
  }
}

function erase_ic_many(items: Ic[], next: Ic): Ic {
  let result = next;

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    expect(item, "Missing erasure item " + index);
    result = { tag: "era", expr: item, body: result };
  }

  return result;
}
