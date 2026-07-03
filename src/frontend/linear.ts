import type { FrontExpr } from "./ast.ts";

export { contains_reserved_linear_effect } from "./linear_effect.ts";
export { validate_linear_lam, validate_linear_rest } from "./linear_stmt.ts";

export function linear_param_names(
  expr: Extract<FrontExpr, { tag: "lam" }>,
): Set<string> {
  const names = new Set<string>();

  for (const param of expr.params) {
    if (param.is_linear) {
      names.add(param.name);
    }
  }

  return names;
}
