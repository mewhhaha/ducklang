import type { CoreExpr, CoreStmt } from "../ast.ts";
import { dynamic_if_let_can_match } from "../union_static.ts";
import type {
  CoreAllocationHooks,
  CoreAllocationScope,
  CoreAllocationState,
} from "./types.ts";

type AllocationExprScanner<ctx> = (
  expr: CoreExpr,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
) => void;

type AllocationStmtScanner<ctx> = (
  statements: CoreStmt[],
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
) => void;

export function scan_allocation_if_let_stmt<ctx>(
  stmt: Extract<CoreStmt, { tag: "if_let_stmt" }>,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
  scan_expr: AllocationExprScanner<ctx>,
  scan_stmts: AllocationStmtScanner<ctx>,
): void {
  if (
    !hooks.if_let_branch_ctx ||
    !hooks.static_union_case ||
    !hooks.dynamic_union_if ||
    !hooks.bind_core_if_let_payload_fact ||
    !hooks.bind_dynamic_if_let_payload
  ) {
    scan_expr(stmt.target, scope, ctx, hooks, state);
    scan_stmts(stmt.body, scope, ctx, hooks, state);
    return;
  }

  const union_case = hooks.static_union_case(stmt.target, ctx);

  if (union_case) {
    if (union_case.name !== stmt.case_name) {
      return;
    }

    scan_static_union_payload_allocations(
      union_case.value,
      scope,
      ctx,
      hooks,
      state,
      scan_expr,
    );

    const branch_ctx = hooks.if_let_branch_ctx(ctx);
    hooks.bind_core_if_let_payload_fact(
      stmt.value_name,
      union_case,
      branch_ctx,
    );
    scan_stmts(stmt.body, scope, branch_ctx, hooks, state);
    return;
  }

  const dynamic_target = hooks.dynamic_union_if(stmt.target, ctx);

  if (dynamic_target) {
    scan_dynamic_union_allocations(
      dynamic_target,
      scope,
      ctx,
      hooks,
      state,
      scan_expr,
    );
    if (!dynamic_if_let_can_match(stmt.case_name, dynamic_target)) {
      return;
    }

    const branch_ctx = hooks.if_let_branch_ctx(ctx);
    hooks.bind_dynamic_if_let_payload(
      stmt.case_name,
      stmt.value_name,
      dynamic_target,
      branch_ctx,
    );
    scan_stmts(stmt.body, scope, branch_ctx, hooks, state);
    return;
  }

  if (
    hooks.runtime_union_target &&
    hooks.runtime_union_match_info &&
    hooks.static_runtime_union_match_branch_ctx
  ) {
    scan_expr(stmt.target, scope, ctx, hooks, state);
    const runtime_target = hooks.runtime_union_target(stmt.target, ctx);

    if (runtime_target) {
      const info = hooks.runtime_union_match_info(
        stmt.case_name,
        runtime_target,
        ctx,
      );
      const branch_ctx = hooks.static_runtime_union_match_branch_ctx(
        stmt.value_name,
        info,
        ctx,
      );
      scan_stmts(stmt.body, scope, branch_ctx, hooks, state);
      return;
    }
  }

  scan_expr(stmt.target, scope, ctx, hooks, state);
  scan_stmts(stmt.body, scope, ctx, hooks, state);
}

export function scan_allocation_if_let_expr<ctx>(
  expr: Extract<CoreExpr, { tag: "if_let" }>,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
  scan_expr: AllocationExprScanner<ctx>,
): void {
  if (
    !hooks.if_let_branch_ctx ||
    !hooks.static_union_case ||
    !hooks.dynamic_union_if ||
    !hooks.bind_core_if_let_payload_fact ||
    !hooks.bind_dynamic_if_let_payload
  ) {
    scan_expr(expr.target, scope, ctx, hooks, state);
    scan_expr(expr.then_branch, scope, ctx, hooks, state);
    scan_expr(expr.else_branch, scope, ctx, hooks, state);
    return;
  }

  const union_case = hooks.static_union_case(expr.target, ctx);

  if (union_case) {
    if (union_case.name === expr.case_name) {
      scan_static_union_payload_allocations(
        union_case.value,
        scope,
        ctx,
        hooks,
        state,
        scan_expr,
      );
      const branch_ctx = hooks.if_let_branch_ctx(ctx);
      hooks.bind_core_if_let_payload_fact(
        expr.value_name,
        union_case,
        branch_ctx,
      );
      scan_expr(expr.then_branch, scope, branch_ctx, hooks, state);
      return;
    }

    scan_expr(expr.else_branch, scope, ctx, hooks, state);
    return;
  }

  const dynamic_target = hooks.dynamic_union_if(expr.target, ctx);

  if (dynamic_target) {
    scan_dynamic_union_allocations(
      dynamic_target,
      scope,
      ctx,
      hooks,
      state,
      scan_expr,
    );
    if (dynamic_if_let_can_match(expr.case_name, dynamic_target)) {
      const branch_ctx = hooks.if_let_branch_ctx(ctx);
      hooks.bind_dynamic_if_let_payload(
        expr.case_name,
        expr.value_name,
        dynamic_target,
        branch_ctx,
      );
      scan_expr(expr.then_branch, scope, branch_ctx, hooks, state);
    }

    scan_expr(expr.else_branch, scope, ctx, hooks, state);
    return;
  }

  if (
    hooks.runtime_union_target &&
    hooks.runtime_union_match_info &&
    hooks.static_runtime_union_match_branch_ctx
  ) {
    scan_expr(expr.target, scope, ctx, hooks, state);
    const runtime_target = hooks.runtime_union_target(expr.target, ctx);

    if (runtime_target) {
      const info = hooks.runtime_union_match_info(
        expr.case_name,
        runtime_target,
        ctx,
      );
      const branch_ctx = hooks.static_runtime_union_match_branch_ctx(
        expr.value_name,
        info,
        ctx,
      );
      scan_expr(expr.then_branch, scope, branch_ctx, hooks, state);
      scan_expr(expr.else_branch, scope, ctx, hooks, state);
      return;
    }
  }

  scan_expr(expr.target, scope, ctx, hooks, state);
  scan_expr(expr.then_branch, scope, ctx, hooks, state);
  scan_expr(expr.else_branch, scope, ctx, hooks, state);
}

function scan_static_union_payload_allocations<ctx>(
  value: CoreExpr | undefined,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
  scan_expr: AllocationExprScanner<ctx>,
): void {
  if (!value) {
    return;
  }
  const existing = state.value_allocations.get(value);
  if (existing && existing.length > 0) {
    return;
  }
  scan_expr(value, scope, ctx, hooks, state);
}

function scan_dynamic_union_allocations<ctx>(
  value: import("../if_let.ts").DynamicUnionIf,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
  scan_expr: AllocationExprScanner<ctx>,
): void {
  scan_expr(value.cond, scope, ctx, hooks, state);
  for (const union_case of [value.then_case, value.else_case]) {
    if (union_case.value) {
      scan_dynamic_union_payload_allocations(
        union_case.value,
        scope,
        ctx,
        hooks,
        state,
        scan_expr,
      );
    }
  }
}

function scan_dynamic_union_payload_allocations<ctx>(
  value: CoreExpr,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
  scan_expr: AllocationExprScanner<ctx>,
): void {
  const struct_value = hooks.static_struct_value(value, ctx);
  if (!struct_value) {
    scan_expr(value, scope, ctx, hooks, state);
    return;
  }

  for (const field of struct_value.fields) {
    scan_dynamic_union_payload_allocations(
      field.value,
      scope,
      ctx,
      hooks,
      state,
      scan_expr,
    );
  }
}
