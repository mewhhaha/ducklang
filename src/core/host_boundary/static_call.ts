import type { CoreExpr, CoreStmt } from "../ast.ts";
import {
  core_host_import_for_app,
  type CoreHostImportCtx,
} from "../host_import.ts";
import type { StaticCoreCallCtx } from "../static_call.ts";
import {
  host_boundary_arg_alias,
  record_host_boundary_stmt_alias,
} from "./alias.ts";
import { host_import_has_ownership_transfer } from "./decision.ts";
import type {
  CoreHostBoundaryHooks,
  CoreHostBoundaryState,
  StaticHostBoundaryTarget,
} from "./types.ts";
import { static_host_boundary_target_params } from "./types.ts";

export type HostBoundaryExprScanner<
  ctx extends CoreHostImportCtx & StaticCoreCallCtx,
> = (
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  state: CoreHostBoundaryState,
) => void;

export function host_boundary_app_with_func_alias(
  expr: Extract<CoreExpr, { tag: "app" }>,
  state: CoreHostBoundaryState,
): Extract<CoreExpr, { tag: "app" }> {
  if (expr.func.tag !== "var") {
    return expr;
  }

  const alias = host_boundary_arg_alias(expr.func, state);

  if (!alias) {
    return expr;
  }

  return {
    ...expr,
    func: alias,
  };
}

export function bind_host_boundary_stmt_function(
  stmt: CoreStmt,
  state: CoreHostBoundaryState,
): void {
  if (stmt.tag !== "bind" && stmt.tag !== "assign") {
    return;
  }

  const target = static_host_boundary_function_value(stmt.value, state);

  if (target) {
    state.functions.set(stmt.name, target);
    return;
  }

  state.functions.delete(stmt.name);
}

export function scan_static_host_boundary_call<
  ctx extends CoreHostImportCtx & StaticCoreCallCtx,
>(
  expr: Extract<CoreExpr, { tag: "app" }>,
  target: StaticHostBoundaryTarget,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  state: CoreHostBoundaryState,
  scan_expr: HostBoundaryExprScanner<ctx>,
): boolean {
  const params = static_host_boundary_target_params(target);

  if (!params) {
    return false;
  }

  if (params.length !== expr.args.length) {
    return false;
  }

  let call_name: string | undefined;

  if (expr.func.tag === "var") {
    call_name = expr.func.name;

    if (state.active_static_calls.has(call_name)) {
      return true;
    }
  }

  const previous_aliases = state.aliases;
  state.aliases = new Map(previous_aliases);

  for (let index = 0; index < params.length; index += 1) {
    const param = params[index];
    const arg = expr.args[index];

    if (!param) {
      throw new Error("Missing host boundary wrapper parameter");
    }

    if (!arg) {
      throw new Error("Missing host boundary wrapper argument");
    }

    state.aliases.set(param.name, arg);
  }

  if (
    !static_host_boundary_wrapper_target(target, ctx, hooks, state, scan_expr)
  ) {
    state.aliases = previous_aliases;
    return false;
  }

  if (call_name) {
    state.active_static_calls.add(call_name);
  }

  state.static_wrapper_depth += 1;

  try {
    scan_static_host_boundary_target_call(
      target,
      expr.args,
      ctx,
      hooks,
      state,
      scan_expr,
    );
  } finally {
    state.static_wrapper_depth -= 1;

    if (call_name) {
      state.active_static_calls.delete(call_name);
    }

    state.aliases = previous_aliases;
  }

  return true;
}

export function scan_static_host_boundary_wrapper_definition<
  ctx extends CoreHostImportCtx & StaticCoreCallCtx,
>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  state: CoreHostBoundaryState,
  scan_expr: HostBoundaryExprScanner<ctx>,
): boolean {
  const target = static_host_boundary_function_value(expr, state);

  if (!target) {
    return false;
  }

  if (
    !static_host_boundary_wrapper_target(target, ctx, hooks, state, scan_expr)
  ) {
    return false;
  }

  scan_static_host_boundary_wrapper_definition_conditions(
    expr,
    ctx,
    hooks,
    state,
    scan_expr,
  );
  return true;
}

export function static_host_boundary_app_target(
  expr: Extract<CoreExpr, { tag: "app" }>,
  state: CoreHostBoundaryState,
): StaticHostBoundaryTarget | undefined {
  if (expr.func.tag !== "var") {
    return undefined;
  }

  const direct = state.functions.get(expr.func.name);

  if (direct) {
    return direct;
  }

  const alias = host_boundary_arg_alias(expr.func, state);

  if (!alias || alias.tag !== "var") {
    return undefined;
  }

  return state.functions.get(alias.name);
}

function static_host_boundary_wrapper_target<
  ctx extends CoreHostImportCtx & StaticCoreCallCtx,
>(
  target: StaticHostBoundaryTarget,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  state: CoreHostBoundaryState,
  scan_expr: HostBoundaryExprScanner<ctx>,
): boolean {
  if (target.tag === "branch") {
    return static_host_boundary_wrapper_target(
      target.then_target,
      ctx,
      hooks,
      state,
      scan_expr,
    ) &&
      static_host_boundary_wrapper_target(
        target.else_target,
        ctx,
        hooks,
        state,
        scan_expr,
      );
  }

  return static_host_boundary_wrapper_body(
    target.body,
    ctx,
    hooks,
    state,
    scan_expr,
  );
}

function scan_static_host_boundary_target_call<
  ctx extends CoreHostImportCtx & StaticCoreCallCtx,
>(
  target: StaticHostBoundaryTarget,
  args: CoreExpr[],
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  state: CoreHostBoundaryState,
  scan_expr: HostBoundaryExprScanner<ctx>,
): void {
  if (target.tag === "lam" || target.tag === "rec") {
    let body_ctx = ctx;
    const closure = hooks.closure_body_ctx(target, ctx);

    if (closure.tag === "scan") {
      body_ctx = closure.ctx;
    }

    const previous_aliases = state.aliases;
    state.aliases = new Map(previous_aliases);

    for (let index = 0; index < target.params.length; index += 1) {
      const param = target.params[index];
      const arg = args[index];

      if (!param) {
        throw new Error("Missing host boundary target parameter");
      }

      if (!arg) {
        throw new Error("Missing host boundary target argument");
      }

      state.aliases.set(param.name, arg);
    }

    try {
      scan_expr(target.body, body_ctx, hooks, state);
    } finally {
      state.aliases = previous_aliases;
    }
    return;
  }

  scan_static_host_boundary_target_call(
    target.then_target,
    args,
    ctx,
    hooks,
    state,
    scan_expr,
  );
  scan_static_host_boundary_target_call(
    target.else_target,
    args,
    ctx,
    hooks,
    state,
    scan_expr,
  );
}

function scan_static_host_boundary_wrapper_definition_conditions<
  ctx extends CoreHostImportCtx & StaticCoreCallCtx,
>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  state: CoreHostBoundaryState,
  scan_expr: HostBoundaryExprScanner<ctx>,
): void {
  if (expr.tag === "block") {
    const final_stmt = expr.statements[expr.statements.length - 1];

    if (!final_stmt) {
      return;
    }

    if (final_stmt.tag === "expr") {
      scan_static_host_boundary_wrapper_definition_conditions(
        final_stmt.expr,
        ctx,
        hooks,
        state,
        scan_expr,
      );
      return;
    }

    if (final_stmt.tag === "return") {
      scan_static_host_boundary_wrapper_definition_conditions(
        final_stmt.value,
        ctx,
        hooks,
        state,
        scan_expr,
      );
    }

    return;
  }

  if (expr.tag === "if") {
    scan_expr(expr.cond, ctx, hooks, state);
    return;
  }

  if (expr.tag === "if_let") {
    scan_expr(expr.target, ctx, hooks, state);
  }
}

function static_host_boundary_function_value(
  expr: CoreExpr,
  state: CoreHostBoundaryState,
): StaticHostBoundaryTarget | undefined {
  const direct = static_host_boundary_function(expr);

  if (direct) {
    return direct;
  }

  if (expr.tag === "var") {
    return state.functions.get(expr.name);
  }

  if (expr.tag === "block") {
    const final_stmt = expr.statements[expr.statements.length - 1];

    if (!final_stmt) {
      return undefined;
    }

    if (final_stmt.tag === "expr") {
      return static_host_boundary_function_value(final_stmt.expr, state);
    }

    if (final_stmt.tag === "return") {
      return static_host_boundary_function_value(final_stmt.value, state);
    }

    return undefined;
  }

  if (expr.tag === "if") {
    const then_target = static_host_boundary_function_value(
      expr.then_branch,
      state,
    );
    const else_target = static_host_boundary_function_value(
      expr.else_branch,
      state,
    );

    if (!then_target || !else_target) {
      return undefined;
    }

    return {
      tag: "branch",
      kind: "if",
      then_target,
      else_target,
    };
  }

  if (expr.tag === "if_let") {
    const then_target = static_host_boundary_function_value(
      expr.then_branch,
      state,
    );
    const else_target = static_host_boundary_function_value(
      expr.else_branch,
      state,
    );

    if (!then_target || !else_target) {
      return undefined;
    }

    return {
      tag: "branch",
      kind: "if_let",
      then_target,
      else_target,
    };
  }

  return undefined;
}

function static_host_boundary_function(
  expr: CoreExpr,
): StaticHostBoundaryTarget | undefined {
  if (expr.tag === "lam" || expr.tag === "rec") {
    return expr;
  }

  if (expr.tag === "block") {
    const final_stmt = expr.statements[expr.statements.length - 1];

    if (!final_stmt) {
      return undefined;
    }

    if (final_stmt.tag === "expr") {
      return static_host_boundary_function(final_stmt.expr);
    }

    if (final_stmt.tag === "return") {
      return static_host_boundary_function(final_stmt.value);
    }

    return undefined;
  }

  if (expr.tag === "if") {
    const then_target = static_host_boundary_function(expr.then_branch);
    const else_target = static_host_boundary_function(expr.else_branch);

    if (!then_target || !else_target) {
      return undefined;
    }

    return {
      tag: "branch",
      kind: "if",
      then_target,
      else_target,
    };
  }

  if (expr.tag === "if_let") {
    const then_target = static_host_boundary_function(expr.then_branch);
    const else_target = static_host_boundary_function(expr.else_branch);

    if (!then_target || !else_target) {
      return undefined;
    }

    return {
      tag: "branch",
      kind: "if_let",
      then_target,
      else_target,
    };
  }

  return undefined;
}

function static_host_boundary_wrapper_body<
  ctx extends CoreHostImportCtx & StaticCoreCallCtx,
>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  state: CoreHostBoundaryState,
  scan_expr: HostBoundaryExprScanner<ctx>,
): boolean {
  if (expr.tag === "app") {
    return static_host_boundary_wrapper_app(expr, ctx, hooks, state, scan_expr);
  }

  if (expr.tag === "block") {
    if (expr.statements.length === 0) {
      return false;
    }

    const previous_aliases = state.aliases;
    state.aliases = new Map(previous_aliases);

    try {
      for (let index = 0; index + 1 < expr.statements.length; index += 1) {
        const stmt = expr.statements[index];

        if (!stmt) {
          throw new Error("Missing host boundary wrapper statement");
        }

        if (!static_host_boundary_wrapper_prefix_stmt(stmt)) {
          return false;
        }

        record_host_boundary_stmt_alias(stmt, state);
      }

      const final_stmt = expr.statements[expr.statements.length - 1];

      if (!final_stmt) {
        throw new Error("Missing host boundary wrapper final statement");
      }

      if (final_stmt.tag === "expr") {
        return static_host_boundary_wrapper_body(
          final_stmt.expr,
          ctx,
          hooks,
          state,
          scan_expr,
        );
      }

      if (final_stmt.tag === "return") {
        return static_host_boundary_wrapper_body(
          final_stmt.value,
          ctx,
          hooks,
          state,
          scan_expr,
        );
      }
    } finally {
      state.aliases = previous_aliases;
    }
  }

  return false;
}

function static_host_boundary_wrapper_prefix_stmt(stmt: CoreStmt): boolean {
  if (stmt.tag !== "bind" && stmt.tag !== "assign") {
    return false;
  }

  if (stmt.value.tag === "var") {
    return true;
  }

  if (stmt.value.tag === "borrow" && stmt.value.value.tag === "var") {
    return true;
  }

  return false;
}

function static_host_boundary_wrapper_app<
  ctx extends CoreHostImportCtx & StaticCoreCallCtx,
>(
  expr: Extract<CoreExpr, { tag: "app" }>,
  ctx: ctx,
  hooks: CoreHostBoundaryHooks<ctx>,
  state: CoreHostBoundaryState,
  scan_expr: HostBoundaryExprScanner<ctx>,
): boolean {
  const app = host_boundary_app_with_func_alias(expr, state);
  const signature = core_host_import_for_app(app, ctx);

  if (signature) {
    return !host_import_has_ownership_transfer(signature);
  }

  const state_target = static_host_boundary_app_target(app, state);

  if (state_target) {
    return static_host_boundary_wrapper_target(
      state_target,
      ctx,
      hooks,
      state,
      scan_expr,
    );
  }

  const target = hooks.static_core_call_target(app.func, ctx);

  if (!target) {
    return false;
  }

  return static_host_boundary_wrapper_target(
    target,
    ctx,
    hooks,
    state,
    scan_expr,
  );
}
