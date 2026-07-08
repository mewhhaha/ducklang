import type { Core, CoreExpr, CoreParam } from "../ast.ts";
import type { CoreTransferFunction, CoreTransferState } from "./types.ts";

export function top_level_transfer_functions(
  core: Core,
): Map<string, CoreTransferFunction> {
  const functions = new Map<string, CoreTransferFunction>();

  for (const stmt of core.statements) {
    if (stmt.tag !== "bind") {
      continue;
    }

    const fn = static_transfer_function(stmt.value);

    if (!fn) {
      continue;
    }

    functions.set(stmt.name, fn);
  }

  return functions;
}

export function bind_transfer_function<ctx>(
  name: string,
  value: CoreExpr,
  state: CoreTransferState<ctx>,
): void {
  const fn = static_transfer_function_value(value, state);

  if (fn) {
    state.functions.set(name, fn);
    return;
  }

  state.functions.delete(name);
}

export function static_transfer_function_value<ctx>(
  expr: CoreExpr,
  state: CoreTransferState<ctx>,
): CoreTransferFunction | undefined {
  const direct = static_transfer_function(expr);

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
      return static_transfer_function_value(final_stmt.expr, state);
    }

    if (final_stmt.tag === "return") {
      return static_transfer_function_value(final_stmt.value, state);
    }

    return undefined;
  }

  if (expr.tag === "if") {
    const then_target = static_transfer_function_value(expr.then_branch, state);
    const else_target = static_transfer_function_value(expr.else_branch, state);

    if (!then_target) {
      return undefined;
    }

    if (!else_target) {
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
    const then_target = static_transfer_function_value(expr.then_branch, state);
    const else_target = static_transfer_function_value(expr.else_branch, state);

    if (!then_target) {
      return undefined;
    }

    if (!else_target) {
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

export function static_transfer_function(
  expr: CoreExpr,
): CoreTransferFunction | undefined {
  if (expr.tag === "lam") {
    return { tag: "lam", value: expr };
  }

  if (expr.tag === "rec") {
    return { tag: "rec", value: expr };
  }

  if (expr.tag === "block") {
    const final_stmt = expr.statements[expr.statements.length - 1];

    if (!final_stmt) {
      return undefined;
    }

    if (final_stmt.tag === "expr") {
      return static_transfer_function(final_stmt.expr);
    }

    if (final_stmt.tag === "return") {
      return static_transfer_function(final_stmt.value);
    }

    return undefined;
  }

  if (expr.tag === "if") {
    const then_target = static_transfer_function(expr.then_branch);
    const else_target = static_transfer_function(expr.else_branch);

    if (!then_target) {
      return undefined;
    }

    if (!else_target) {
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
    const then_target = static_transfer_function(expr.then_branch);
    const else_target = static_transfer_function(expr.else_branch);

    if (!then_target) {
      return undefined;
    }

    if (!else_target) {
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

export function static_transfer_function_params(
  target: CoreTransferFunction,
): CoreParam[] | undefined {
  if (target.tag === "lam" || target.tag === "rec") {
    return target.value.params;
  }

  const then_params = static_transfer_function_params(target.then_target);
  const else_params = static_transfer_function_params(target.else_target);

  if (!then_params) {
    return undefined;
  }

  if (!else_params) {
    return undefined;
  }

  if (then_params.length !== else_params.length) {
    return undefined;
  }

  return then_params;
}
