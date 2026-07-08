import { loop_exit_owners, next_loop_scope } from "./state.ts";
import type {
  CoreDropExitOwners,
  CoreDropHooks,
  CoreDropLoopBodyCtx,
  CoreDropOwner,
  CoreDropState,
  CoreExpr,
  CoreStmt,
} from "./types.ts";

type CoreDropExprChildrenScanner<ctx> = (
  expr: CoreExpr,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
) => boolean;

type CoreDropStmtsScanner<ctx> = (
  statements: CoreStmt[],
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  drop_fallthrough_owners?: boolean,
) => boolean;

export function scan_drop_range_loop_stmt<ctx>(
  stmt: Extract<CoreStmt, { tag: "range_loop" }>,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  scan_drop_expr_children: CoreDropExprChildrenScanner<ctx>,
  scan_drop_stmts: CoreDropStmtsScanner<ctx>,
): boolean {
  scan_drop_expr_children(
    stmt.start,
    scope,
    owners,
    exit_owners,
    ctx,
    hooks,
    state,
  );
  scan_drop_expr_children(
    stmt.end,
    scope,
    owners,
    exit_owners,
    ctx,
    hooks,
    state,
  );
  scan_drop_expr_children(
    stmt.step,
    scope,
    owners,
    exit_owners,
    ctx,
    hooks,
    state,
  );
  const loop_scope = next_loop_scope(state);
  const loop_owners = new Map<string, CoreDropOwner>();
  scan_drop_stmts(
    stmt.body,
    loop_scope,
    loop_owners,
    loop_exit_owners(owners, exit_owners),
    ctx,
    hooks,
    state,
  );
  return true;
}

export function scan_drop_collection_loop_stmt<ctx>(
  stmt: Extract<CoreStmt, { tag: "collection_loop" }>,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  scan_drop_expr_children: CoreDropExprChildrenScanner<ctx>,
  scan_drop_stmts: CoreDropStmtsScanner<ctx>,
): boolean {
  scan_drop_expr_children(
    stmt.collection,
    scope,
    owners,
    exit_owners,
    ctx,
    hooks,
    state,
  );
  const body_ctx = drop_collection_loop_body_ctx(stmt, ctx, hooks);
  if (body_ctx.tag === "skip") {
    return true;
  }

  const loop_scope = next_loop_scope(state);
  const loop_owners = new Map<string, CoreDropOwner>();
  scan_drop_stmts(
    stmt.body,
    loop_scope,
    loop_owners,
    loop_exit_owners(owners, exit_owners),
    body_ctx.ctx,
    hooks,
    state,
  );
  return true;
}

function drop_collection_loop_body_ctx<ctx>(
  stmt: Extract<CoreStmt, { tag: "collection_loop" }>,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
): CoreDropLoopBodyCtx<ctx> {
  if (!hooks.collection_loop_body_ctx) {
    return { tag: "scan", ctx };
  }

  return hooks.collection_loop_body_ctx(stmt, ctx);
}
