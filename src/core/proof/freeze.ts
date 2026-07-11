import type { Core, CoreExpr, CoreField, CoreStmt } from "../ast.ts";
import { core_escape_analysis, type CoreEscapeAnalysis } from "../escape.ts";
import {
  core_expr_ownership,
  type CoreOwnership,
  type CoreOwnershipHooks,
} from "../ownership.ts";
import { dynamic_if_let_can_match } from "../union_static.ts";

export type CoreFreezeProofEdge = {
  id: string;
  analysis: CoreEscapeAnalysis;
};

type CoreFreezeProofState = {
  next_freeze: number;
  edges: CoreFreezeProofEdge[];
};

export type CoreFreezeProofHooks<ctx> = CoreOwnershipHooks<ctx> & {
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

export function core_freeze_proof_edges<ctx>(
  core: Core,
  ctx: ctx,
  hooks: CoreFreezeProofHooks<ctx>,
): CoreFreezeProofEdge[] {
  const state: CoreFreezeProofState = {
    next_freeze: 0,
    edges: [],
  };

  for (const stmt of core.statements) {
    scan_freeze_stmt(stmt, ctx, hooks, state);
  }

  return state.edges;
}

function scan_freeze_stmt<ctx>(
  stmt: CoreStmt,
  ctx: ctx,
  hooks: CoreFreezeProofHooks<ctx>,
  state: CoreFreezeProofState,
): void {
  switch (stmt.tag) {
    case "bind":
    case "assign":
      if (freeze_stmt_value_is_direct_static_call_target(stmt, ctx, hooks)) {
        return;
      }

      scan_freeze_expr(stmt.value, ctx, hooks, state);
      return;

    case "index_assign":
      scan_freeze_expr(stmt.index, ctx, hooks, state);
      scan_freeze_expr(stmt.value, ctx, hooks, state);
      return;

    case "range_loop":
      scan_freeze_expr(stmt.start, ctx, hooks, state);
      scan_freeze_expr(stmt.end, ctx, hooks, state);
      scan_freeze_expr(stmt.step, ctx, hooks, state);
      scan_freeze_loop_stmts(stmt, ctx, hooks, state);
      return;

    case "collection_loop":
      scan_freeze_expr(stmt.collection, ctx, hooks, state);
      scan_freeze_loop_stmts(stmt, ctx, hooks, state);
      return;

    case "if_stmt":
      scan_freeze_expr(stmt.cond, ctx, hooks, state);
      scan_freeze_scoped_stmts(stmt.body, ctx, hooks, state);
      return;

    case "if_else_stmt":
      scan_freeze_expr(stmt.cond, ctx, hooks, state);
      scan_freeze_scoped_stmts(stmt.then_body, ctx, hooks, state);
      scan_freeze_scoped_stmts(stmt.else_body, ctx, hooks, state);
      return;

    case "if_let_stmt":
      scan_freeze_if_let_stmt(stmt, ctx, hooks, state);
      return;

    case "type_check":
      scan_freeze_expr(stmt.target, ctx, hooks, state);
      return;

    case "return":
      scan_freeze_expr(stmt.value, ctx, hooks, state);
      return;

    case "expr":
      scan_freeze_expr(stmt.expr, ctx, hooks, state);
      return;

    case "break":
      if (stmt.value) {
        scan_freeze_expr(stmt.value, ctx, hooks, state);
      }
      return;
    case "continue":
    case "unsupported":
      return;
  }
}

function freeze_stmt_value_is_direct_static_call_target<ctx>(
  stmt: Extract<CoreStmt, { tag: "bind" | "assign" }>,
  ctx: ctx,
  hooks: CoreFreezeProofHooks<ctx>,
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

function scoped_static_freeze_call_value<ctx>(
  expr: Extract<CoreExpr, { tag: "app" }>,
  ctx: ctx,
  hooks: CoreFreezeProofHooks<ctx>,
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

function scan_freeze_stmts<ctx>(
  statements: CoreStmt[],
  ctx: ctx,
  hooks: CoreFreezeProofHooks<ctx>,
  state: CoreFreezeProofState,
): void {
  for (const stmt of statements) {
    scan_freeze_stmt(stmt, ctx, hooks, state);
  }
}

function scan_freeze_scoped_stmts<ctx>(
  statements: CoreStmt[],
  ctx: ctx,
  hooks: CoreFreezeProofHooks<ctx>,
  state: CoreFreezeProofState,
): void {
  if (!hooks.block_ctx || !hooks.collect_stmt_locals) {
    scan_freeze_stmts(statements, ctx, hooks, state);
    return;
  }

  const scoped_ctx = hooks.block_ctx(ctx);

  for (let index = 0; index < statements.length; index += 1) {
    const stmt = statements[index];

    if (!stmt) {
      throw new Error("Missing freeze-proof scoped statement");
    }

    scan_freeze_stmt(stmt, scoped_ctx, hooks, state);

    if (index + 1 < statements.length) {
      hooks.collect_stmt_locals(stmt, scoped_ctx);
    }
  }
}

function scan_freeze_loop_stmts<ctx>(
  stmt: Extract<CoreStmt, { tag: "range_loop" | "collection_loop" }>,
  ctx: ctx,
  hooks: CoreFreezeProofHooks<ctx>,
  state: CoreFreezeProofState,
): void {
  if (!hooks.block_ctx || !hooks.collect_stmt_locals) {
    scan_freeze_stmts(stmt.body, ctx, hooks, state);
    return;
  }

  const loop_ctx = hooks.block_ctx(ctx);
  hooks.collect_stmt_locals(stmt, loop_ctx);
  scan_freeze_stmts(stmt.body, loop_ctx, hooks, state);
}

function scan_freeze_expr<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreFreezeProofHooks<ctx>,
  state: CoreFreezeProofState,
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
      scan_freeze_closure_body(expr, ctx, hooks, state);
      return;

    case "prim":
      for (const arg of expr.args) {
        scan_freeze_expr(arg, ctx, hooks, state);
      }
      return;

    case "app": {
      scan_freeze_expr(expr.func, ctx, hooks, state);
      for (const arg of expr.args) {
        scan_freeze_expr(arg, ctx, hooks, state);
      }

      const scoped = scoped_static_freeze_call_value(expr, ctx, hooks);

      if (scoped) {
        scan_freeze_expr(scoped.value, scoped.ctx, hooks, state);
      }
      return;
    }

    case "block":
      scan_freeze_block(expr, ctx, hooks, state);
      return;

    case "loop":
      scan_freeze_scoped_stmts(expr.body, ctx, hooks, state);
      return;

    case "comptime":
      scan_freeze_expr(expr.expr, ctx, hooks, state);
      return;

    case "borrow":
      scan_freeze_expr(expr.value, ctx, hooks, state);
      return;

    case "freeze": {
      const ownership = freeze_operand_ownership(expr.value, ctx, hooks);
      const id = "freeze#" + state.next_freeze.toString();
      state.next_freeze += 1;
      state.edges.push({
        id,
        analysis: core_escape_analysis("freeze", ownership),
      });
      scan_freeze_expr(expr.value, ctx, hooks, state);
      return;
    }

    case "scratch":
      scan_freeze_expr(expr.body, ctx, hooks, state);
      return;

    case "with":
      scan_freeze_expr(expr.base, ctx, hooks, state);
      scan_freeze_fields(expr.fields, ctx, hooks, state);
      return;

    case "struct_value":
      scan_freeze_expr(expr.type_expr, ctx, hooks, state);
      scan_freeze_fields(expr.fields, ctx, hooks, state);
      return;

    case "struct_update":
      scan_freeze_expr(expr.base, ctx, hooks, state);
      scan_freeze_fields(expr.fields, ctx, hooks, state);
      return;

    case "if":
      scan_freeze_expr(expr.cond, ctx, hooks, state);
      scan_freeze_expr(expr.then_branch, ctx, hooks, state);
      scan_freeze_expr(expr.else_branch, ctx, hooks, state);
      return;

    case "if_let":
      scan_freeze_if_let_expr(expr, ctx, hooks, state);
      return;

    case "field":
      scan_freeze_expr(expr.object, ctx, hooks, state);
      return;

    case "index":
      scan_freeze_expr(expr.object, ctx, hooks, state);
      scan_freeze_expr(expr.index, ctx, hooks, state);
      return;

    case "union_case":
      if (expr.value) {
        scan_freeze_expr(expr.value, ctx, hooks, state);
      }

      if (expr.type_expr) {
        scan_freeze_expr(expr.type_expr, ctx, hooks, state);
      }
      return;
  }
}

function scan_freeze_closure_body<ctx>(
  expr: Extract<CoreExpr, { tag: "lam" | "rec" }>,
  ctx: ctx,
  hooks: CoreFreezeProofHooks<ctx>,
  state: CoreFreezeProofState,
): void {
  if (!hooks.closure_body_ctx) {
    return;
  }

  const body_ctx = hooks.closure_body_ctx(expr, ctx);

  if (!body_ctx) {
    return;
  }

  scan_freeze_expr(expr.body, body_ctx, hooks, state);
}

function scan_freeze_if_let_stmt<ctx>(
  stmt: Extract<CoreStmt, { tag: "if_let_stmt" }>,
  ctx: ctx,
  hooks: CoreFreezeProofHooks<ctx>,
  state: CoreFreezeProofState,
): void {
  scan_freeze_expr(stmt.target, ctx, hooks, state);

  if (
    !hooks.if_let_branch_ctx ||
    !hooks.static_union_case ||
    !hooks.dynamic_union_if ||
    !hooks.bind_core_if_let_payload_fact ||
    !hooks.bind_dynamic_if_let_payload
  ) {
    scan_freeze_scoped_stmts(stmt.body, ctx, hooks, state);
    return;
  }

  const union_case = hooks.static_union_case(stmt.target, ctx);

  if (union_case) {
    if (union_case.name !== stmt.case_name) {
      return;
    }

    const branch_ctx = hooks.if_let_branch_ctx(ctx);
    hooks.bind_core_if_let_payload_fact(
      stmt.value_name,
      union_case,
      branch_ctx,
    );
    scan_freeze_scoped_stmts(stmt.body, branch_ctx, hooks, state);
    return;
  }

  const dynamic_target = hooks.dynamic_union_if(stmt.target, ctx);

  if (dynamic_target) {
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
    scan_freeze_scoped_stmts(stmt.body, branch_ctx, hooks, state);
    return;
  }

  if (
    hooks.runtime_union_target && hooks.runtime_union_match_info &&
    hooks.static_runtime_union_match_branch_ctx
  ) {
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
      scan_freeze_scoped_stmts(stmt.body, branch_ctx, hooks, state);
      return;
    }
  }

  scan_freeze_scoped_stmts(stmt.body, ctx, hooks, state);
}

function scan_freeze_if_let_expr<ctx>(
  expr: Extract<CoreExpr, { tag: "if_let" }>,
  ctx: ctx,
  hooks: CoreFreezeProofHooks<ctx>,
  state: CoreFreezeProofState,
): void {
  scan_freeze_expr(expr.target, ctx, hooks, state);

  if (
    !hooks.if_let_branch_ctx ||
    !hooks.static_union_case ||
    !hooks.dynamic_union_if ||
    !hooks.bind_core_if_let_payload_fact ||
    !hooks.bind_dynamic_if_let_payload
  ) {
    scan_freeze_expr(expr.then_branch, ctx, hooks, state);
    scan_freeze_expr(expr.else_branch, ctx, hooks, state);
    return;
  }

  const union_case = hooks.static_union_case(expr.target, ctx);

  if (union_case) {
    if (union_case.name === expr.case_name) {
      const branch_ctx = hooks.if_let_branch_ctx(ctx);
      hooks.bind_core_if_let_payload_fact(
        expr.value_name,
        union_case,
        branch_ctx,
      );
      scan_freeze_expr(expr.then_branch, branch_ctx, hooks, state);
      return;
    }

    scan_freeze_expr(expr.else_branch, ctx, hooks, state);
    return;
  }

  const dynamic_target = hooks.dynamic_union_if(expr.target, ctx);

  if (dynamic_target) {
    if (dynamic_if_let_can_match(expr.case_name, dynamic_target)) {
      const branch_ctx = hooks.if_let_branch_ctx(ctx);
      hooks.bind_dynamic_if_let_payload(
        expr.case_name,
        expr.value_name,
        dynamic_target,
        branch_ctx,
      );
      scan_freeze_expr(expr.then_branch, branch_ctx, hooks, state);
    }

    scan_freeze_expr(expr.else_branch, ctx, hooks, state);
    return;
  }

  if (
    hooks.runtime_union_target && hooks.runtime_union_match_info &&
    hooks.static_runtime_union_match_branch_ctx
  ) {
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
      scan_freeze_expr(expr.then_branch, branch_ctx, hooks, state);
      scan_freeze_expr(expr.else_branch, ctx, hooks, state);
      return;
    }
  }

  scan_freeze_expr(expr.then_branch, ctx, hooks, state);
  scan_freeze_expr(expr.else_branch, ctx, hooks, state);
}

function scan_freeze_block<ctx>(
  expr: Extract<CoreExpr, { tag: "block" }>,
  ctx: ctx,
  hooks: CoreFreezeProofHooks<ctx>,
  state: CoreFreezeProofState,
): void {
  if (!hooks.block_ctx || !hooks.collect_stmt_locals) {
    scan_freeze_stmts(expr.statements, ctx, hooks, state);
    return;
  }

  const block_ctx = hooks.block_ctx(ctx);

  for (let index = 0; index < expr.statements.length; index += 1) {
    const stmt = expr.statements[index];

    if (!stmt) {
      throw new Error("Missing freeze-proof block statement");
    }

    const is_final = index + 1 >= expr.statements.length;
    scan_freeze_stmt(stmt, block_ctx, hooks, state);

    if (!is_final) {
      hooks.collect_stmt_locals(stmt, block_ctx);
    }
  }
}

function freeze_operand_ownership<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): CoreOwnership {
  if (expr.tag === "var" && hooks.runtime_aggregate_type_expr) {
    const type_expr = hooks.runtime_aggregate_type_expr(expr, ctx);

    if (type_expr) {
      return core_expr_ownership(expr, ctx, hooks);
    }
  }

  if (freeze_operand_static_aggregate_is_ownerless(expr, ctx, hooks)) {
    return { tag: "frozen_shareable", reason: "freeze" };
  }

  return core_expr_ownership(expr, ctx, hooks);
}

function freeze_operand_static_aggregate_is_ownerless<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): boolean {
  const struct_value = hooks.static_struct_value(expr, ctx);

  if (!struct_value) {
    return false;
  }

  for (const field of struct_value.fields) {
    if (!freeze_operand_static_field_is_ownerless(field.value, ctx, hooks)) {
      return false;
    }
  }

  return true;
}

function freeze_operand_static_field_is_ownerless<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
): boolean {
  if (freeze_operand_static_aggregate_is_ownerless(expr, ctx, hooks)) {
    return true;
  }

  if (hooks.static_text_value(expr, ctx)) {
    return true;
  }

  if (hooks.static_union_case) {
    const union_case = hooks.static_union_case(expr, ctx);

    if (union_case) {
      if (!union_case.value) {
        return true;
      }

      return freeze_operand_static_field_is_ownerless(
        union_case.value,
        ctx,
        hooks,
      );
    }
  }

  const ownership = core_expr_ownership(expr, ctx, hooks);

  if (
    ownership.tag === "scalar_local" ||
    ownership.tag === "frozen_shareable"
  ) {
    return true;
  }

  return false;
}

function scan_freeze_fields<ctx>(
  fields: CoreField[],
  ctx: ctx,
  hooks: CoreFreezeProofHooks<ctx>,
  state: CoreFreezeProofState,
): void {
  for (const field of fields) {
    scan_freeze_expr(field.value, ctx, hooks, state);
  }
}
