import type { Core, CoreExpr, CoreHostImport, CoreStmt } from "./ast.ts";
import {
  core_host_import_arg_decision,
  core_host_import_for_app,
  type CoreHostImportCtx,
} from "./host_import.ts";
import {
  core_expr_ownership,
  core_ownership_result_text,
  type CoreOwnership,
  type CoreOwnershipHooks,
} from "./ownership.ts";

export type CoreHostBoundaryDecision =
  | {
    tag: "allowed";
    reason: string;
  }
  | {
    tag: "rejected";
    reason: string;
  };

export type CoreHostBoundaryArg = {
  index: number;
  ownership: CoreOwnership;
  decision: CoreHostBoundaryDecision;
};

export type CoreHostBoundaryEdge = {
  id: string;
  callee: string;
  signature: CoreHostImport | undefined;
  args: CoreHostBoundaryArg[];
  decision: CoreHostBoundaryDecision;
};

export type CoreHostBoundaryPlan = {
  edges: CoreHostBoundaryEdge[];
};

export type CoreHostBoundaryClosureCtx<ctx> =
  | {
    tag: "scan";
    ctx: ctx;
  }
  | {
    tag: "skip";
  };

export type CoreHostBoundaryHooks<ctx extends CoreHostImportCtx> =
  & CoreOwnershipHooks<ctx>
  & {
    closure_body_ctx: (
      expr: Extract<CoreExpr, { tag: "lam" | "rec" }>,
      ctx: ctx,
    ) => CoreHostBoundaryClosureCtx<ctx>;
    static_core_call_target: (
      expr: CoreExpr,
      ctx: ctx,
    ) => Extract<CoreExpr, { tag: "lam" }> | undefined;
    static_core_call_value: (expr: CoreExpr, ctx: ctx) => CoreExpr | undefined;
    static_core_rec_target: (
      expr: CoreExpr,
      ctx: ctx,
    ) => Extract<CoreExpr, { tag: "rec" }> | undefined;
  };

type CoreHostBoundaryState = {
  next_host: number;
  edges: CoreHostBoundaryEdge[];
  scratch_depth: number;
  scratch_locals: Map<string, CoreOwnership>;
};

export function core_host_boundary_plan<ctx extends CoreHostImportCtx>(
  core: Core,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
): CoreHostBoundaryPlan {
  const state: CoreHostBoundaryState = {
    next_host: 0,
    edges: [],
    scratch_depth: 0,
    scratch_locals: new Map(),
  };

  scan_host_boundary_stmts(core.statements, ctx, hooks, state);

  return {
    edges: state.edges,
  };
}

function scan_host_boundary_stmts<ctx extends CoreHostImportCtx>(
  statements: CoreStmt[],
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  state: CoreHostBoundaryState,
): void {
  for (const stmt of statements) {
    scan_host_boundary_stmt(stmt, ctx, hooks, state);
    collect_host_boundary_stmt_locals(stmt, ctx, hooks, state);
  }
}

function scan_host_boundary_stmt<ctx extends CoreHostImportCtx>(
  stmt: CoreStmt,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  state: CoreHostBoundaryState,
): void {
  switch (stmt.tag) {
    case "bind":
    case "assign":
      scan_host_boundary_expr(stmt.value, ctx, hooks, state);
      return;

    case "index_assign":
      scan_host_boundary_expr(stmt.index, ctx, hooks, state);
      scan_host_boundary_expr(stmt.value, ctx, hooks, state);
      return;

    case "range_loop":
      scan_host_boundary_expr(stmt.start, ctx, hooks, state);
      scan_host_boundary_expr(stmt.end, ctx, hooks, state);
      scan_host_boundary_expr(stmt.step, ctx, hooks, state);
      scan_host_boundary_stmts(stmt.body, ctx, hooks, state);
      return;

    case "collection_loop":
      scan_host_boundary_expr(stmt.collection, ctx, hooks, state);
      scan_host_boundary_stmts(stmt.body, ctx, hooks, state);
      return;

    case "if_stmt":
      scan_host_boundary_expr(stmt.cond, ctx, hooks, state);
      scan_host_boundary_stmts(stmt.body, ctx, hooks, state);
      return;

    case "if_else_stmt":
      scan_host_boundary_expr(stmt.cond, ctx, hooks, state);
      scan_host_boundary_stmts(stmt.then_body, ctx, hooks, state);
      scan_host_boundary_stmts(stmt.else_body, ctx, hooks, state);
      return;

    case "if_let_stmt":
      scan_host_boundary_expr(stmt.target, ctx, hooks, state);
      scan_host_boundary_stmts(stmt.body, ctx, hooks, state);
      return;

    case "type_check":
      scan_host_boundary_expr(stmt.target, ctx, hooks, state);
      return;

    case "return":
      scan_host_boundary_expr(stmt.value, ctx, hooks, state);
      return;

    case "expr":
      scan_host_boundary_expr(stmt.expr, ctx, hooks, state);
      return;

    case "break":
    case "continue":
    case "unsupported":
      return;
  }
}

function scan_host_boundary_expr<ctx extends CoreHostImportCtx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  state: CoreHostBoundaryState,
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

    case "prim":
      for (const arg of expr.args) {
        scan_host_boundary_expr(arg, ctx, hooks, state);
      }
      return;

    case "lam":
    case "rec": {
      const closure = hooks.closure_body_ctx(expr, ctx);

      if (closure.tag === "scan") {
        scan_host_boundary_expr(expr.body, closure.ctx, hooks, state);
      }
      return;
    }

    case "app":
      scan_host_boundary_app(expr, ctx, hooks, state);
      return;

    case "block":
      scan_host_boundary_stmts(expr.statements, ctx, hooks, state);
      return;

    case "comptime":
      scan_host_boundary_expr(expr.expr, ctx, hooks, state);
      return;

    case "borrow":
    case "freeze":
      scan_host_boundary_expr(expr.value, ctx, hooks, state);
      return;

    case "scratch": {
      const scratch_locals = state.scratch_locals;
      state.scratch_locals = new Map(scratch_locals);
      state.scratch_depth += 1;
      scan_host_boundary_expr(expr.body, ctx, hooks, state);
      state.scratch_depth -= 1;
      state.scratch_locals = scratch_locals;
      return;
    }

    case "with":
      scan_host_boundary_expr(expr.base, ctx, hooks, state);
      for (const field of expr.fields) {
        scan_host_boundary_expr(field.value, ctx, hooks, state);
      }
      return;

    case "struct_value":
      scan_host_boundary_expr(expr.type_expr, ctx, hooks, state);
      for (const field of expr.fields) {
        scan_host_boundary_expr(field.value, ctx, hooks, state);
      }
      return;

    case "struct_update":
      scan_host_boundary_expr(expr.base, ctx, hooks, state);
      for (const field of expr.fields) {
        scan_host_boundary_expr(field.value, ctx, hooks, state);
      }
      return;

    case "if":
      scan_host_boundary_expr(expr.cond, ctx, hooks, state);
      scan_host_boundary_expr(expr.then_branch, ctx, hooks, state);
      scan_host_boundary_expr(expr.else_branch, ctx, hooks, state);
      return;

    case "if_let":
      scan_host_boundary_expr(expr.target, ctx, hooks, state);
      scan_host_boundary_expr(expr.then_branch, ctx, hooks, state);
      scan_host_boundary_expr(expr.else_branch, ctx, hooks, state);
      return;

    case "field":
      scan_host_boundary_expr(expr.object, ctx, hooks, state);
      return;

    case "index":
      scan_host_boundary_expr(expr.object, ctx, hooks, state);
      scan_host_boundary_expr(expr.index, ctx, hooks, state);
      return;

    case "union_case":
      if (expr.value) {
        scan_host_boundary_expr(expr.value, ctx, hooks, state);
      }
      if (expr.type_expr) {
        scan_host_boundary_expr(expr.type_expr, ctx, hooks, state);
      }
      return;
  }
}

function scan_host_boundary_app<ctx extends CoreHostImportCtx>(
  expr: Extract<CoreExpr, { tag: "app" }>,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  state: CoreHostBoundaryState,
): void {
  scan_host_boundary_expr(expr.func, ctx, hooks, state);

  for (const arg of expr.args) {
    scan_host_boundary_expr(arg, ctx, hooks, state);
  }

  const signature = core_host_import_for_app(expr, ctx);

  if (core_app_is_known(expr, ctx, hooks, signature)) {
    return;
  }

  if (expr.func.tag !== "var") {
    return;
  }

  const args = host_boundary_args(expr, ctx, hooks, signature, state);
  const decision = host_boundary_decision(expr.func.name, args, signature);
  const id = "host#" + state.next_host.toString();
  state.next_host += 1;

  state.edges.push({
    id,
    callee: expr.func.name,
    signature,
    args,
    decision,
  });
}

function core_app_is_known<ctx extends CoreHostImportCtx>(
  expr: Extract<CoreExpr, { tag: "app" }>,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  signature: CoreHostImport | undefined,
): boolean {
  if (expr.func.tag === "var" && expr.func.name === "rec") {
    return true;
  }

  if (expr.func.tag === "var" && core_builtin_app_name(expr.func.name)) {
    return true;
  }

  if (signature) {
    return false;
  }

  if (hooks.static_core_rec_target(expr.func, ctx)) {
    return true;
  }

  if (hooks.static_core_call_value(expr, ctx)) {
    return true;
  }

  if (hooks.static_core_call_target(expr.func, ctx)) {
    return true;
  }

  if (hooks.closure_fn_type(expr.func, ctx)) {
    return true;
  }

  return false;
}

function core_builtin_app_name(name: string): boolean {
  if (name === "len") {
    return true;
  }

  if (name === "get") {
    return true;
  }

  if (name === "slice") {
    return true;
  }

  if (name === "panic") {
    return true;
  }

  if (name === "append") {
    return true;
  }

  return false;
}

function collect_host_boundary_stmt_locals<ctx extends CoreHostImportCtx>(
  stmt: CoreStmt,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  state: CoreHostBoundaryState,
): void {
  if (!hooks.collect_stmt_locals) {
    return;
  }

  try {
    hooks.collect_stmt_locals(stmt, ctx);
  } catch (_error) {
    return;
  }

  if (state.scratch_depth === 0) {
    return;
  }

  if (stmt.tag !== "bind" && stmt.tag !== "assign") {
    return;
  }

  record_host_boundary_scratch_local(stmt.name, stmt.value, ctx, hooks, state);
}

function host_boundary_args<ctx extends CoreHostImportCtx>(
  expr: Extract<CoreExpr, { tag: "app" }>,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  signature: CoreHostImport | undefined,
  state: CoreHostBoundaryState,
): CoreHostBoundaryArg[] {
  const args: CoreHostBoundaryArg[] = [];

  for (let index = 0; index < expr.args.length; index += 1) {
    const arg = expr.args[index];

    if (!arg) {
      throw new Error("Missing host/import argument " + index.toString());
    }

    const ownership = host_boundary_arg_ownership(arg, ctx, hooks, state);

    args.push({
      index,
      ownership,
      decision: host_boundary_arg_decision(ownership, signature, index),
    });
  }

  return args;
}

function host_boundary_arg_ownership<ctx extends CoreHostImportCtx>(
  arg: CoreExpr,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  state: CoreHostBoundaryState,
): CoreOwnership {
  if (arg.tag === "var") {
    const scratch_local = state.scratch_locals.get(arg.name);

    if (scratch_local) {
      return scratch_local;
    }
  }

  if (arg.tag === "borrow" && arg.value.tag === "var") {
    const scratch_local = state.scratch_locals.get(arg.value.name);

    if (scratch_local) {
      return {
        tag: "borrow_view",
        source: scratch_local,
      };
    }
  }

  const ownership = core_expr_ownership(arg, ctx, hooks);

  if (ownership.tag === "scratch_backed") {
    return ownership;
  }

  if (state.scratch_depth === 0) {
    return ownership;
  }

  if (ownership.tag !== "unique_heap") {
    return ownership;
  }

  if (!host_boundary_expr_allocates_in_scratch(arg, ctx, hooks)) {
    return ownership;
  }

  return {
    tag: "scratch_backed",
    source: ownership,
  };
}

function record_host_boundary_scratch_local<ctx extends CoreHostImportCtx>(
  name: string,
  value: CoreExpr,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  state: CoreHostBoundaryState,
): void {
  if (!host_boundary_expr_allocates_in_scratch(value, ctx, hooks)) {
    state.scratch_locals.delete(name);
    return;
  }

  const ownership = core_expr_ownership(value, ctx, hooks);

  if (ownership.tag !== "unique_heap") {
    state.scratch_locals.delete(name);
    return;
  }

  state.scratch_locals.set(name, {
    tag: "scratch_backed",
    source: ownership,
  });
}

function host_boundary_expr_allocates_in_scratch<
  ctx extends CoreHostImportCtx,
>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
): boolean {
  if (expr.tag === "app") {
    if (core_host_import_for_app(expr, ctx)) {
      return false;
    }

    if (expr.func.tag === "var" && expr.func.name === "append") {
      if (!hooks.closure_fn_type(expr.func, ctx)) {
        return true;
      }
    }

    if (expr.func.tag === "var" && expr.func.name === "slice") {
      return true;
    }

    return false;
  }

  if (expr.tag === "struct_value") {
    return true;
  }

  if (expr.tag === "union_case") {
    return true;
  }

  if (expr.tag === "lam") {
    return hooks.closure_fn_type(expr, ctx) !== undefined;
  }

  if (expr.tag === "block") {
    const last = expr.statements[expr.statements.length - 1];

    if (!last) {
      return false;
    }

    if (last.tag === "expr") {
      return host_boundary_expr_allocates_in_scratch(last.expr, ctx, hooks);
    }

    if (last.tag === "return") {
      return host_boundary_expr_allocates_in_scratch(last.value, ctx, hooks);
    }

    return false;
  }

  return false;
}

function host_boundary_arg_decision(
  ownership: CoreOwnership,
  signature: CoreHostImport | undefined,
  index: number,
): CoreHostBoundaryDecision {
  if (signature) {
    const contract = signature.args[index];

    if (!contract) {
      return {
        tag: "rejected",
        reason: "missing host/import ownership contract for argument " +
          index.toString(),
      };
    }

    return core_host_import_arg_decision(contract, ownership);
  }

  if (ownership.tag === "scalar_local") {
    return {
      tag: "allowed",
      reason: "scalar host/import arguments do not carry ownership",
    };
  }

  if (ownership.tag === "frozen_shareable") {
    return {
      tag: "allowed",
      reason: "frozen/shareable host/import arguments can be read without " +
        "ownership transfer",
    };
  }

  return {
    tag: "rejected",
    reason: "unknown host/import boundary would let " +
      core_ownership_result_text(ownership) +
      " escape without a bounded-borrow or ownership-transfer signature",
  };
}

function host_boundary_decision(
  callee: string,
  args: CoreHostBoundaryArg[],
  signature: CoreHostImport | undefined,
): CoreHostBoundaryDecision {
  if (signature) {
    if (signature.params.length !== args.length) {
      return {
        tag: "rejected",
        reason: "host/import signature for " + callee + " expects " +
          signature.params.length.toString() + " arguments, got " +
          args.length.toString(),
      };
    }

    if (signature.args.length !== args.length) {
      return {
        tag: "rejected",
        reason: "host/import signature for " + callee + " declares " +
          signature.args.length.toString() + " ownership contracts, got " +
          args.length.toString() + " arguments",
      };
    }
  }

  for (const arg of args) {
    if (arg.decision.tag === "allowed") {
      continue;
    }

    return {
      tag: "rejected",
      reason: "argument " + arg.index.toString() + " to " + callee + ": " +
        arg.decision.reason,
    };
  }

  if (signature) {
    return {
      tag: "allowed",
      reason: "host/import signature for " + callee +
        " satisfies ownership boundary checks",
    };
  }

  return {
    tag: "rejected",
    reason: "missing host/import signature for " + callee,
  };
}
