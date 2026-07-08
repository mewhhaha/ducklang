import { bind_drop_owner } from "./bind_owner.ts";
import { emit_drop } from "./emit.ts";
import { expr_consumes_owner_name } from "./ownership.ts";
import { bind_static_drop_function } from "./static_function.ts";
import {
  should_skip_drop_owner_assign,
  should_skip_drop_owner_bind,
} from "./static_owner.ts";
import type {
  CoreDropExitOwners,
  CoreDropHooks,
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

export function scan_drop_bind_stmt<ctx>(
  stmt: Extract<CoreStmt, { tag: "bind" }>,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  scan_drop_expr_children: CoreDropExprChildrenScanner<ctx>,
): boolean {
  scan_drop_expr_children(
    stmt.value,
    scope,
    owners,
    exit_owners,
    ctx,
    hooks,
    state,
  );

  const previous = owners.get(stmt.name);
  if (previous) {
    emit_drop("assignment_replace", scope, previous.name, previous, state);
    owners.delete(stmt.name);
  }

  if (
    should_skip_drop_owner_bind(
      stmt.kind,
      stmt.name,
      stmt.value,
      ctx,
      hooks,
    )
  ) {
    owners.delete(stmt.name);
    bind_static_drop_function(stmt.name, stmt.value, state);
    return true;
  }

  bind_drop_owner(stmt.name, stmt.value, owners, ctx, hooks, state);
  bind_static_drop_function(stmt.name, stmt.value, state);
  return true;
}

export function scan_drop_assign_stmt<ctx>(
  stmt: Extract<CoreStmt, { tag: "assign" }>,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  scan_drop_expr_children: CoreDropExprChildrenScanner<ctx>,
): boolean {
  const previous = owners.get(stmt.name);
  if (
    previous &&
    !expr_consumes_owner_name(stmt.value, stmt.name, owners, state)
  ) {
    emit_drop("assignment_replace", scope, previous.name, previous, state);
    owners.delete(stmt.name);
  }

  scan_drop_expr_children(
    stmt.value,
    scope,
    owners,
    exit_owners,
    ctx,
    hooks,
    state,
  );
  if (should_skip_drop_owner_assign(stmt.name, stmt.value, ctx, hooks)) {
    owners.delete(stmt.name);
    bind_static_drop_function(stmt.name, stmt.value, state);
    return true;
  }

  bind_drop_owner(stmt.name, stmt.value, owners, ctx, hooks, state);
  bind_static_drop_function(stmt.name, stmt.value, state);
  return true;
}

export function scan_drop_index_assign_stmt<ctx>(
  stmt: Extract<CoreStmt, { tag: "index_assign" }>,
  scope: string,
  owners: Map<string, CoreDropOwner>,
  exit_owners: CoreDropExitOwners,
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
  scan_drop_expr_children: CoreDropExprChildrenScanner<ctx>,
): boolean {
  scan_drop_expr_children(
    stmt.index,
    scope,
    owners,
    exit_owners,
    ctx,
    hooks,
    state,
  );
  scan_drop_expr_children(
    stmt.value,
    scope,
    owners,
    exit_owners,
    ctx,
    hooks,
    state,
  );
  return true;
}
