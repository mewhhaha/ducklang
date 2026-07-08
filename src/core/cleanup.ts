import type { Core, CoreExpr, CoreField, CoreStmt } from "./ast.ts";
import {
  core_scratch_exit_edges,
  type CoreCleanupExitEdge,
} from "./cleanup/exit_edges.ts";
import {
  core_scratch_return_ownership,
  core_scratch_return_rejection_detail,
} from "./cleanup/scratch_return.ts";
import { core_escape_analysis, type CoreEscapeAnalysis } from "./escape.ts";
import type { CoreOwnershipHooks } from "./ownership.ts";

export { core_scratch_exit_edges, type CoreCleanupExitEdge };
export {
  core_scratch_return_ownership,
  core_scratch_return_rejection_detail,
} from "./cleanup/scratch_return.ts";

export type CoreCleanupStep = {
  tag: "scratch_reset";
  scope: string;
  exit_edges: CoreCleanupExitEdge[];
  return_value: CoreEscapeAnalysis;
  return_detail?: string;
};

export type CoreCleanupPlan = {
  steps: CoreCleanupStep[];
};

type CoreCleanupState = {
  next_closure: number;
  next_scratch: number;
  steps: CoreCleanupStep[];
};

type CoreCleanupHooks<ctx> = CoreOwnershipHooks<ctx> & {
  closure_body_ctx?: (
    expr: Extract<CoreExpr, { tag: "lam" | "rec" }>,
    ctx: ctx,
  ) => ctx | undefined;
  scoped_static_core_call_value?: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    target: Extract<CoreExpr, { tag: "lam" }>,
    ctx: ctx,
  ) => { value: CoreExpr; ctx: ctx };
  static_core_call_target?: (
    expr: CoreExpr,
    ctx: ctx,
  ) => Extract<CoreExpr, { tag: "lam" }> | undefined;
  static_core_call_requires_scope?: (
    target: Extract<CoreExpr, { tag: "lam" }>,
  ) => boolean;
};

export function core_cleanup_plan<ctx>(
  core: Core,
  ctx: ctx,
  hooks: CoreCleanupHooks<ctx>,
): CoreCleanupPlan {
  const state: CoreCleanupState = {
    next_closure: 0,
    next_scratch: 0,
    steps: [],
  };

  for (const stmt of core.statements) {
    scan_cleanup_stmt(stmt, ctx, hooks, state);
  }

  return { steps: state.steps };
}

function scan_cleanup_expr<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreCleanupHooks<ctx>,
  state: CoreCleanupState,
): void {
  switch (expr.tag) {
    case "num":
    case "text":
    case "type_name":
    case "var":
    case "linear":
    case "struct_type":
    case "union_type":
    case "unsupported":
      return;

    case "lam":
    case "rec":
      scan_cleanup_closure_body(expr, ctx, hooks, state);
      return;

    case "prim":
      for (const arg of expr.args) {
        scan_cleanup_expr(arg, ctx, hooks, state);
      }
      return;

    case "app": {
      scan_cleanup_expr(expr.func, ctx, hooks, state);
      for (const arg of expr.args) {
        scan_cleanup_expr(arg, ctx, hooks, state);
      }

      const scoped = scoped_static_cleanup_call_value(expr, ctx, hooks);

      if (scoped) {
        scan_cleanup_expr(scoped.value, scoped.ctx, hooks, state);
      }
      return;
    }

    case "block":
      scan_cleanup_block(expr, ctx, hooks, state);
      return;

    case "comptime":
      scan_cleanup_expr(expr.expr, ctx, hooks, state);
      return;

    case "borrow":
    case "freeze":
      scan_cleanup_expr(expr.value, ctx, hooks, state);
      return;

    case "scratch": {
      const ownership = core_scratch_return_ownership(expr.body, ctx, hooks);
      const return_detail = core_scratch_return_rejection_detail(
        expr.body,
        ctx,
        hooks,
      );
      const scope = "scratch#" + state.next_scratch.toString();
      state.next_scratch += 1;
      const step: CoreCleanupStep = {
        tag: "scratch_reset",
        scope,
        exit_edges: core_scratch_exit_edges(expr.body),
        return_value: core_escape_analysis("scratch_return", ownership),
      };
      if (return_detail) {
        step.return_detail = return_detail;
      }
      state.steps.push(step);
      scan_cleanup_expr(expr.body, ctx, hooks, state);
      return;
    }

    case "with":
      scan_cleanup_expr(expr.base, ctx, hooks, state);
      scan_cleanup_fields(expr.fields, ctx, hooks, state);
      return;

    case "struct_value":
      scan_cleanup_expr(expr.type_expr, ctx, hooks, state);
      scan_cleanup_fields(expr.fields, ctx, hooks, state);
      return;

    case "struct_update":
      scan_cleanup_expr(expr.base, ctx, hooks, state);
      scan_cleanup_fields(expr.fields, ctx, hooks, state);
      return;

    case "if":
      scan_cleanup_expr(expr.cond, ctx, hooks, state);
      scan_cleanup_expr(expr.then_branch, ctx, hooks, state);
      scan_cleanup_expr(expr.else_branch, ctx, hooks, state);
      return;

    case "if_let":
      scan_cleanup_expr(expr.target, ctx, hooks, state);
      scan_cleanup_expr(expr.then_branch, ctx, hooks, state);
      scan_cleanup_expr(expr.else_branch, ctx, hooks, state);
      return;

    case "field":
      scan_cleanup_expr(expr.object, ctx, hooks, state);
      return;

    case "index":
      scan_cleanup_expr(expr.object, ctx, hooks, state);
      scan_cleanup_expr(expr.index, ctx, hooks, state);
      return;

    case "union_case":
      if (expr.value) {
        scan_cleanup_expr(expr.value, ctx, hooks, state);
      }

      if (expr.type_expr) {
        scan_cleanup_expr(expr.type_expr, ctx, hooks, state);
      }
      return;
  }
}

function scan_cleanup_stmts<ctx>(
  statements: CoreStmt[],
  ctx: ctx,
  hooks: CoreCleanupHooks<ctx>,
  state: CoreCleanupState,
): void {
  for (const stmt of statements) {
    scan_cleanup_stmt(stmt, ctx, hooks, state);
  }
}

function scan_cleanup_block<ctx>(
  expr: Extract<CoreExpr, { tag: "block" }>,
  ctx: ctx,
  hooks: CoreCleanupHooks<ctx>,
  state: CoreCleanupState,
): void {
  if (!hooks.block_ctx || !hooks.collect_stmt_locals) {
    scan_cleanup_stmts(expr.statements, ctx, hooks, state);
    return;
  }

  const block_ctx = hooks.block_ctx(ctx);

  for (let index = 0; index < expr.statements.length; index += 1) {
    const stmt = expr.statements[index];

    if (!stmt) {
      throw new Error("Missing cleanup block statement");
    }

    const is_final = index + 1 >= expr.statements.length;
    scan_cleanup_stmt(stmt, block_ctx, hooks, state);

    if (!is_final) {
      hooks.collect_stmt_locals(stmt, block_ctx);
    }
  }
}

function scan_cleanup_stmt<ctx>(
  stmt: CoreStmt,
  ctx: ctx,
  hooks: CoreCleanupHooks<ctx>,
  state: CoreCleanupState,
): void {
  switch (stmt.tag) {
    case "bind":
    case "assign":
      if (cleanup_stmt_value_is_direct_static_call_target(stmt, ctx, hooks)) {
        return;
      }

      scan_cleanup_expr(stmt.value, ctx, hooks, state);
      return;

    case "index_assign":
      scan_cleanup_expr(stmt.index, ctx, hooks, state);
      scan_cleanup_expr(stmt.value, ctx, hooks, state);
      return;

    case "range_loop":
      scan_cleanup_expr(stmt.start, ctx, hooks, state);
      scan_cleanup_expr(stmt.end, ctx, hooks, state);
      scan_cleanup_expr(stmt.step, ctx, hooks, state);
      scan_cleanup_stmts(stmt.body, ctx, hooks, state);
      return;

    case "collection_loop":
      scan_cleanup_expr(stmt.collection, ctx, hooks, state);
      scan_cleanup_stmts(stmt.body, ctx, hooks, state);
      return;

    case "if_stmt":
      scan_cleanup_expr(stmt.cond, ctx, hooks, state);
      scan_cleanup_stmts(stmt.body, ctx, hooks, state);
      return;

    case "if_else_stmt":
      scan_cleanup_expr(stmt.cond, ctx, hooks, state);
      scan_cleanup_stmts(stmt.then_body, ctx, hooks, state);
      scan_cleanup_stmts(stmt.else_body, ctx, hooks, state);
      return;

    case "if_let_stmt":
      scan_cleanup_expr(stmt.target, ctx, hooks, state);
      scan_cleanup_stmts(stmt.body, ctx, hooks, state);
      return;

    case "type_check":
      scan_cleanup_expr(stmt.target, ctx, hooks, state);
      return;

    case "return":
      scan_cleanup_expr(stmt.value, ctx, hooks, state);
      return;

    case "expr":
      scan_cleanup_expr(stmt.expr, ctx, hooks, state);
      return;

    case "break":
    case "continue":
    case "unsupported":
      return;
  }
}

function cleanup_stmt_value_is_direct_static_call_target<ctx>(
  stmt: Extract<CoreStmt, { tag: "bind" | "assign" }>,
  ctx: ctx,
  hooks: CoreCleanupHooks<ctx>,
): boolean {
  if (!hooks.static_core_call_target) {
    return false;
  }

  if (!hooks.static_core_call_requires_scope) {
    return false;
  }

  if (stmt.value.tag !== "lam") {
    return false;
  }

  const target = hooks.static_core_call_target(
    { tag: "var", name: stmt.name },
    ctx,
  );

  if (!target) {
    return false;
  }

  if (target !== stmt.value) {
    return false;
  }

  return hooks.static_core_call_requires_scope(target);
}

function scoped_static_cleanup_call_value<ctx>(
  expr: Extract<CoreExpr, { tag: "app" }>,
  ctx: ctx,
  hooks: CoreCleanupHooks<ctx>,
): { value: CoreExpr; ctx: ctx } | undefined {
  if (
    !hooks.static_core_call_target ||
    !hooks.scoped_static_core_call_value ||
    !hooks.static_core_call_requires_scope
  ) {
    return undefined;
  }

  const target = hooks.static_core_call_target(expr.func, ctx);

  if (!target) {
    return undefined;
  }

  if (!hooks.static_core_call_requires_scope(target)) {
    return undefined;
  }

  return hooks.scoped_static_core_call_value(expr, target, ctx);
}

function scan_cleanup_closure_body<ctx>(
  expr: Extract<CoreExpr, { tag: "lam" | "rec" }>,
  ctx: ctx,
  hooks: CoreCleanupHooks<ctx>,
  state: CoreCleanupState,
): void {
  if (!hooks.closure_body_ctx) {
    return;
  }

  const body_ctx = hooks.closure_body_ctx(expr, ctx);

  if (!body_ctx) {
    return;
  }

  state.next_closure += 1;
  scan_cleanup_expr(expr.body, body_ctx, hooks, state);
}

function scan_cleanup_fields<ctx>(
  fields: CoreField[],
  ctx: ctx,
  hooks: CoreCleanupHooks<ctx>,
  state: CoreCleanupState,
): void {
  for (const field of fields) {
    scan_cleanup_expr(field.value, ctx, hooks, state);
  }
}
