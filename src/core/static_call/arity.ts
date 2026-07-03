import type { CoreExpr } from "../ast.ts";

export function check_static_core_call_arity(
  expr: Extract<CoreExpr, { tag: "app" }>,
  target: Extract<CoreExpr, { tag: "lam" }>,
): void {
  if (expr.args.length !== target.params.length) {
    throw new Error(
      "Core static call expected " + target.params.length.toString() +
        " arguments, got " + expr.args.length.toString(),
    );
  }
}
