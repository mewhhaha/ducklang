import type { Stmt } from "./ast.ts";

export function linear_block_exits(stmts: Stmt[]): boolean {
  for (const stmt of stmts) {
    if (
      stmt.tag === "return" || stmt.tag === "break" ||
      stmt.tag === "continue"
    ) {
      return true;
    }
  }

  return false;
}

export function expect_same_linear_state(
  expected: Set<string>,
  actual: Set<string>,
  edge: string,
): void {
  if (!same_name_set(expected, actual)) {
    throw new Error("Linear loop " + edge + " changes carried values");
  }
}

export function same_names(left: string[], right: string[]): boolean {
  return same_name_set(new Set(left), new Set(right));
}

export function same_name_set(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const name of left) {
    if (!right.has(name)) {
      return false;
    }
  }

  return true;
}
