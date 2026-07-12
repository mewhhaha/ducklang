import {
  clone_drop_owners,
  loop_exit_owners,
  next_loop_scope,
} from "./state.ts";
import { drop_scope_owners } from "./emit.ts";
import {
  core_runtime_slice_fact,
  runtime_slice_value_local,
} from "../runtime_slice.ts";
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

type CoreDropExprScanner<ctx> = CoreDropExprChildrenScanner<ctx>;

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
  const carried = carried_loop_owners(stmt.carried, owners);
  const loop_owners = clone_drop_owners(carried);
  scan_drop_stmts(
    stmt.body,
    loop_scope,
    loop_owners,
    loop_exit_owners(carried, exit_owners),
    ctx,
    hooks,
    state,
    false,
  );
  drop_loop_local_owners(loop_scope, loop_owners, carried, state);
  merge_carried_loop_owners(owners, loop_owners, stmt.carried);
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
  scan_drop_expr: CoreDropExprScanner<ctx>,
  scan_drop_stmts: CoreDropStmtsScanner<ctx>,
): boolean {
  const loop_scope = next_loop_scope(state);
  const slice = core_runtime_slice_fact(stmt.collection);
  let continues: boolean;
  if (slice) {
    continues = scan_drop_expr(
      stmt.collection,
      scope,
      owners,
      exit_owners,
      ctx,
      hooks,
      state,
    );
  } else {
    continues = scan_drop_expr_children(
      stmt.collection,
      scope,
      owners,
      exit_owners,
      ctx,
      hooks,
      state,
    );
  }
  if (!continues) {
    return false;
  }
  if (slice) {
    const step = state.steps[state.steps.length - 1];
    if (
      step && step.tag === "heap_drop" &&
      step.edge === "discarded_expr" && !step.owner
    ) {
      const loop_id = Number(loop_scope.slice("loop#".length));
      step.edge = "loop_zero_iteration_cleanup";
      step.owner = runtime_slice_value_local(loop_id);
      step.reason = step.reason.replace(
        "discarded expression",
        "loop zero-iteration cleanup",
      );
    }
  }
  const body_ctx = drop_collection_loop_body_ctx(stmt, ctx, hooks);
  if (body_ctx.tag === "skip") {
    return true;
  }

  const carried = carried_loop_owners(stmt.carried, owners);
  const loop_owners = clone_drop_owners(carried);
  scan_drop_stmts(
    stmt.body,
    loop_scope,
    loop_owners,
    loop_exit_owners(carried, exit_owners),
    body_ctx.ctx,
    hooks,
    state,
    false,
  );
  drop_loop_local_owners(loop_scope, loop_owners, carried, state);
  merge_carried_loop_owners(owners, loop_owners, stmt.carried);
  return true;
}

function carried_loop_owners(
  names: string[],
  owners: Map<string, CoreDropOwner>,
): Map<string, CoreDropOwner> {
  const carried = new Map<string, CoreDropOwner>();

  for (const name of names) {
    const owner = owners.get(name);
    if (owner) {
      carried.set(name, owner);
    }
  }

  return carried;
}

export function drop_loop_local_owners(
  scope: string,
  owners: Map<string, CoreDropOwner>,
  carried: Map<string, CoreDropOwner>,
  state: CoreDropState,
): void {
  const locals = new Map(owners);
  for (const name of carried.keys()) {
    locals.delete(name);
  }
  drop_scope_owners(scope, locals, state);
}

export function merge_carried_loop_owners(
  outer: Map<string, CoreDropOwner>,
  loop: Map<string, CoreDropOwner>,
  carried: string[],
): void {
  for (const name of carried) {
    const owner = loop.get(name);
    if (owner) {
      outer.set(name, owner);
    } else {
      outer.delete(name);
    }
  }
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
