import type { CoreExpr, CoreStmt } from "../ast.ts";
import type {
  CoreAllocationHooks,
  CoreAllocationScope,
  CoreAllocationState,
} from "./types.ts";

type AllocationStmtScanner<ctx> = (
  stmt: CoreStmt,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
) => void;

type AllocationStmtsScanner<ctx> = (
  statements: CoreStmt[],
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
) => void;

export function scan_allocation_block<ctx>(
  expr: Extract<CoreExpr, { tag: "block" }>,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
  scan_stmt: AllocationStmtScanner<ctx>,
  scan_stmts: AllocationStmtsScanner<ctx>,
): void {
  if (!hooks.block_ctx || !hooks.collect_stmt_locals) {
    scan_stmts(expr.statements, scope, ctx, hooks, state);
    return;
  }

  const block_ctx = hooks.block_ctx(ctx);

  for (let index = 0; index < expr.statements.length; index += 1) {
    const stmt = expr.statements[index];

    if (!stmt) {
      throw new Error("Missing allocation block statement");
    }

    const is_final = index + 1 >= expr.statements.length;
    scan_stmt(stmt, scope, block_ctx, hooks, state);

    if (!is_final) {
      hooks.collect_stmt_locals(stmt, block_ctx);
    }
  }
}
