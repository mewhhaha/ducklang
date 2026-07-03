import type { Env, FrontType, Stmt } from "./ast.ts";
import { infer_front_expr } from "./infer/expr.ts";
import { infer_stmt_result_with } from "./infer/stmt.ts";
import type { InferHooks } from "./infer/types.ts";

export { infer_front_expr };
export type { InferHooks };

export function infer_stmt_result(
  stmt: Stmt | undefined,
  env: Env,
  hooks: InferHooks,
): FrontType {
  return infer_stmt_result_with(stmt, env, hooks, infer_front_expr);
}
