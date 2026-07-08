import type { FrontExpr, Stmt } from "../ast.ts";
import { linear_param_names } from "../linear.ts";
import { expr_contains_linear } from "./linear_contains.ts";
import { scan_call_only_stmt_tail } from "./call_only_defer_scan.ts";

export function can_defer_call_only_runtime_lam_binding(
  name: string,
  value: FrontExpr,
  stmts: Stmt[],
  index: number,
  is_linear: boolean,
  error: unknown,
): boolean {
  if (!is_call_only_defer_error(error)) {
    return false;
  }

  if (is_linear) {
    return false;
  }

  if (value.tag !== "lam") {
    return false;
  }

  if (linear_param_names(value).size > 0) {
    return false;
  }

  if (expr_contains_linear(value.body)) {
    return false;
  }

  const scan = scan_call_only_stmt_tail(name, stmts, index + 1);

  if (!scan.valid) {
    return false;
  }

  return scan.used;
}

function is_call_only_defer_error(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (
    error.message.startsWith(
      "Cannot lower dynamic if with unknown branches to Ic frontend",
    )
  ) {
    return true;
  }

  if (
    error.message.startsWith(
      "Cannot lower dynamic if let without typed union target to Ic frontend",
    )
  ) {
    return true;
  }

  if (
    error.message.startsWith("No-else if implicit fallback supports ") &&
    error.message.endsWith(", got unknown")
  ) {
    return true;
  }

  return false;
}
