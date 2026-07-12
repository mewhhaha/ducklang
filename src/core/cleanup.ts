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
import { dynamic_if_let_can_match } from "./union_static.ts";
import { record_core_diagnostic_subject } from "./source_origin.ts";

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

    case "loop":
      scan_cleanup_scoped_stmts(expr.body, ctx, hooks, state);
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
      record_core_diagnostic_subject(step, expr);
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
      {
        const branch = cleanup_if_let_branch_ctx(expr, ctx, hooks);

        if (branch.tag === "scan") {
          scan_cleanup_expr(expr.then_branch, branch.ctx, hooks, state);
        } else if (branch.tag === "unknown") {
          scan_cleanup_expr(expr.then_branch, ctx, hooks, state);
        }
      }
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
      scan_cleanup_loop_stmts(stmt, ctx, hooks, state);
      return;

    case "collection_loop":
      scan_cleanup_expr(stmt.collection, ctx, hooks, state);
      scan_cleanup_loop_stmts(stmt, ctx, hooks, state);
      return;

    case "if_stmt":
      scan_cleanup_expr(stmt.cond, ctx, hooks, state);
      scan_cleanup_scoped_stmts(stmt.body, ctx, hooks, state);
      return;

    case "if_else_stmt":
      scan_cleanup_expr(stmt.cond, ctx, hooks, state);
      scan_cleanup_scoped_stmts(stmt.then_body, ctx, hooks, state);
      scan_cleanup_scoped_stmts(stmt.else_body, ctx, hooks, state);
      return;

    case "if_let_stmt":
      scan_cleanup_expr(stmt.target, ctx, hooks, state);
      {
        const branch = cleanup_if_let_stmt_branch_ctx(stmt, ctx, hooks);

        if (branch.tag === "scan") {
          scan_cleanup_scoped_stmts(stmt.body, branch.ctx, hooks, state);
        } else if (branch.tag === "unknown") {
          scan_cleanup_scoped_stmts(stmt.body, ctx, hooks, state);
        }
      }
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
      if (stmt.value) {
        scan_cleanup_expr(stmt.value, ctx, hooks, state);
      }
      return;
    case "continue":
    case "unsupported":
      return;
  }
}

function scan_cleanup_scoped_stmts<ctx>(
  statements: CoreStmt[],
  ctx: ctx,
  hooks: CoreCleanupHooks<ctx>,
  state: CoreCleanupState,
): void {
  if (!hooks.block_ctx || !hooks.collect_stmt_locals) {
    scan_cleanup_stmts(statements, ctx, hooks, state);
    return;
  }

  const scoped_ctx = hooks.block_ctx(ctx);

  for (let index = 0; index < statements.length; index += 1) {
    const stmt = statements[index];

    if (!stmt) {
      throw new Error("Missing cleanup scoped statement");
    }

    scan_cleanup_stmt(stmt, scoped_ctx, hooks, state);

    if (index + 1 < statements.length) {
      hooks.collect_stmt_locals(stmt, scoped_ctx);
    }
  }
}

function scan_cleanup_loop_stmts<ctx>(
  stmt: Extract<CoreStmt, { tag: "range_loop" | "collection_loop" }>,
  ctx: ctx,
  hooks: CoreCleanupHooks<ctx>,
  state: CoreCleanupState,
): void {
  if (!hooks.block_ctx || !hooks.collect_stmt_locals) {
    scan_cleanup_stmts(stmt.body, ctx, hooks, state);
    return;
  }

  const loop_ctx = hooks.block_ctx(ctx);
  hooks.collect_stmt_locals(stmt, loop_ctx);
  scan_cleanup_stmts(stmt.body, loop_ctx, hooks, state);
}

type CleanupBranch<ctx> =
  | { tag: "scan"; ctx: ctx }
  | { tag: "skip" }
  | { tag: "unknown" };

function cleanup_if_let_branch_ctx<ctx>(
  expr: Extract<CoreExpr, { tag: "if_let" }>,
  ctx: ctx,
  hooks: CoreCleanupHooks<ctx>,
): CleanupBranch<ctx> {
  return cleanup_matched_branch_ctx(
    expr.case_name,
    expr.value_name,
    expr.target,
    ctx,
    hooks,
  );
}

function cleanup_if_let_stmt_branch_ctx<ctx>(
  stmt: Extract<CoreStmt, { tag: "if_let_stmt" }>,
  ctx: ctx,
  hooks: CoreCleanupHooks<ctx>,
): CleanupBranch<ctx> {
  return cleanup_matched_branch_ctx(
    stmt.case_name,
    stmt.value_name,
    stmt.target,
    ctx,
    hooks,
  );
}

function cleanup_matched_branch_ctx<ctx>(
  case_name: string,
  value_name: string | undefined,
  target: CoreExpr,
  ctx: ctx,
  hooks: CoreCleanupHooks<ctx>,
): CleanupBranch<ctx> {
  if (
    hooks.static_union_case && hooks.if_let_branch_ctx &&
    hooks.bind_core_if_let_payload_fact
  ) {
    const union_case = hooks.static_union_case(target, ctx);

    if (union_case) {
      if (union_case.name !== case_name) {
        return { tag: "skip" };
      }

      const branch_ctx = hooks.if_let_branch_ctx(ctx);
      hooks.bind_core_if_let_payload_fact(
        value_name,
        union_case,
        branch_ctx,
      );
      return { tag: "scan", ctx: branch_ctx };
    }
  }

  if (
    hooks.dynamic_union_if && hooks.if_let_branch_ctx &&
    hooks.bind_dynamic_if_let_payload
  ) {
    const dynamic_target = hooks.dynamic_union_if(target, ctx);

    if (dynamic_target) {
      if (!dynamic_if_let_can_match(case_name, dynamic_target)) {
        return { tag: "skip" };
      }

      const branch_ctx = hooks.if_let_branch_ctx(ctx);
      hooks.bind_dynamic_if_let_payload(
        case_name,
        value_name,
        dynamic_target,
        branch_ctx,
      );
      return { tag: "scan", ctx: branch_ctx };
    }
  }

  if (
    hooks.runtime_union_target && hooks.runtime_union_match_info &&
    hooks.static_runtime_union_match_branch_ctx
  ) {
    const runtime_target = hooks.runtime_union_target(target, ctx);

    if (runtime_target) {
      const info = hooks.runtime_union_match_info(
        case_name,
        runtime_target,
        ctx,
      );
      return {
        tag: "scan",
        ctx: hooks.static_runtime_union_match_branch_ctx(
          value_name,
          info,
          ctx,
        ),
      };
    }
  }

  return { tag: "unknown" };
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
