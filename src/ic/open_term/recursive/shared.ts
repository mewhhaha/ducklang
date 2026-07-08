import { Prim } from "../../../op.ts";
import type { Ic } from "../../ast.ts";

export function collect_app(ic: Ic): { func: Ic; args: Ic[] } {
  const args: Ic[] = [];
  let cursor = ic;

  while (cursor.tag === "app") {
    args.unshift(cursor.arg);
    cursor = cursor.func;
  }

  return { func: cursor, args };
}

export function is_memory_prim(prim: Prim): boolean {
  if (prim === "i32.load") {
    return true;
  }

  if (prim === "i64.load") {
    return true;
  }

  if (prim === "i32.load8_u") {
    return true;
  }

  if (prim === "i64.load8_u") {
    return true;
  }

  return false;
}
