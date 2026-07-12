import type { Core, CoreExpr, CoreParam } from "../ast.ts";
import type { CoreDropState, StaticDropFunction } from "./types.ts";

export function top_level_drop_functions(
  core: Core,
): Map<string, StaticDropFunction> {
  const functions = new Map<string, StaticDropFunction>();

  for (const stmt of core.statements) {
    if (stmt.tag !== "bind") {
      continue;
    }

    const fn = static_drop_function(stmt.value);

    if (!fn) {
      continue;
    }

    functions.set(stmt.name, fn);
  }

  return functions;
}

export function bind_static_drop_function(
  name: string,
  value: CoreExpr,
  state: CoreDropState,
): void {
  const fn = static_drop_function_value(value, state);

  if (fn) {
    state.functions.set(name, fn);
    return;
  }

  state.functions.delete(name);
}

export function static_drop_function_params(
  target: StaticDropFunction,
): CoreParam[] | undefined {
  if (target.tag === "lam" || target.tag === "rec") {
    return target.value.params;
  }

  const then_params = static_drop_function_params(target.then_target);
  const else_params = static_drop_function_params(target.else_target);

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

export function static_drop_function_terminal_linear_name(
  target: StaticDropFunction,
): string | undefined {
  if (target.tag === "lam" || target.tag === "rec") {
    return terminal_linear_name(target.value.body);
  }

  const then_name = static_drop_function_terminal_linear_name(
    target.then_target,
  );
  const else_name = static_drop_function_terminal_linear_name(
    target.else_target,
  );

  if (!then_name || !else_name) {
    return undefined;
  }

  if (then_name !== else_name) {
    return undefined;
  }

  return then_name;
}

function terminal_linear_name(expr: CoreExpr): string | undefined {
  if (expr.tag === "linear") {
    return expr.name;
  }

  if (expr.tag === "block") {
    const final_stmt = expr.statements[expr.statements.length - 1];

    if (!final_stmt) {
      return undefined;
    }

    if (final_stmt.tag === "expr") {
      return terminal_linear_name(final_stmt.expr);
    }

    if (final_stmt.tag === "return") {
      return terminal_linear_name(final_stmt.value);
    }

    return undefined;
  }

  if (expr.tag === "if" || expr.tag === "if_let") {
    const then_name = terminal_linear_name(expr.then_branch);
    const else_name = terminal_linear_name(expr.else_branch);

    if (!then_name || !else_name) {
      return undefined;
    }

    if (then_name !== else_name) {
      return undefined;
    }

    return then_name;
  }

  return undefined;
}

function static_drop_function_value(
  expr: CoreExpr,
  state: CoreDropState,
): StaticDropFunction | undefined {
  const direct = static_drop_function(expr);

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
      return static_drop_function_value(final_stmt.expr, state);
    }

    if (final_stmt.tag === "return") {
      return static_drop_function_value(final_stmt.value, state);
    }

    return undefined;
  }

  if (expr.tag === "if") {
    const then_target = static_drop_function_value(expr.then_branch, state);
    const else_target = static_drop_function_value(expr.else_branch, state);

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
    const then_target = static_drop_function_value(expr.then_branch, state);
    const else_target = static_drop_function_value(expr.else_branch, state);

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

function static_drop_function(expr: CoreExpr): StaticDropFunction | undefined {
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
      return static_drop_function(final_stmt.expr);
    }

    if (final_stmt.tag === "return") {
      return static_drop_function(final_stmt.value);
    }

    return undefined;
  }

  if (expr.tag === "if") {
    const then_target = static_drop_function(expr.then_branch);
    const else_target = static_drop_function(expr.else_branch);

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
    const then_target = static_drop_function(expr.then_branch);
    const else_target = static_drop_function(expr.else_branch);

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
