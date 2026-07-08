import { unique_heap_ownership } from "./ownership.ts";
import { static_drop_function_params } from "./static_function.ts";
import { resolve_drop_owner } from "./state.ts";
import type {
  CoreDropHooks,
  CoreDropState,
  CoreExpr,
  CoreStmt,
  StaticDropCallBinding,
  StaticDropCallTransferBody,
  StaticDropFunction,
} from "./types.ts";

export function static_drop_call_transfer_body(
  body: CoreExpr,
): StaticDropCallTransferBody | undefined {
  if (body.tag !== "block") {
    return { tag: "expr", expr: body, scope_suffix: "" };
  }

  return { tag: "block", statements: body.statements, scope_suffix: "/block" };
}

export function static_drop_call_transfer_body_returns_closure(
  body: StaticDropCallTransferBody,
): boolean {
  if (body.tag === "expr") {
    return static_drop_transfer_body_returns_closure(body.expr);
  }

  if (body.statements.length === 0) {
    return false;
  }

  const stmt = body.statements[body.statements.length - 1];

  if (!stmt) {
    throw new Error("Missing static drop call closure block result");
  }

  if (stmt.tag === "expr") {
    return static_drop_transfer_body_returns_closure(stmt.expr);
  }

  if (stmt.tag === "return") {
    return static_drop_transfer_body_returns_closure(stmt.value);
  }

  return false;
}

function static_drop_transfer_body_returns_closure(expr: CoreExpr): boolean {
  if (expr.tag === "lam") {
    return true;
  }

  if (expr.tag === "borrow" || expr.tag === "freeze") {
    return static_drop_transfer_body_returns_closure(expr.value);
  }

  if (expr.tag === "block") {
    return static_drop_block_returns_closure(expr.statements);
  }

  if (expr.tag === "if") {
    return static_drop_transfer_body_returns_closure(expr.then_branch) &&
      static_drop_transfer_body_returns_closure(expr.else_branch);
  }

  if (expr.tag === "if_let") {
    return static_drop_transfer_body_returns_closure(expr.then_branch) &&
      static_drop_transfer_body_returns_closure(expr.else_branch);
  }

  return false;
}

function static_drop_block_returns_closure(statements: CoreStmt[]): boolean {
  if (statements.length === 0) {
    return false;
  }

  const stmt = statements[statements.length - 1];

  if (!stmt) {
    throw new Error("Missing static drop call closure block result");
  }

  if (stmt.tag === "expr") {
    return static_drop_transfer_body_returns_closure(stmt.expr);
  }

  if (stmt.tag === "return") {
    return static_drop_transfer_body_returns_closure(stmt.value);
  }

  return false;
}

export function static_drop_call_bindings<ctx>(
  target: StaticDropFunction,
  args: CoreExpr[],
  ctx: ctx,
  hooks: CoreDropHooks<ctx>,
  state: CoreDropState,
): Map<string, StaticDropCallBinding> | undefined {
  const params = static_drop_function_params(target);

  if (!params) {
    return undefined;
  }

  if (params.length !== args.length) {
    return undefined;
  }

  const bindings = new Map<string, StaticDropCallBinding>();

  for (let index = 0; index < params.length; index += 1) {
    const param = params[index];
    const arg = args[index];

    if (!param) {
      throw new Error("Missing static drop call parameter");
    }

    if (!arg) {
      throw new Error("Missing static drop call argument");
    }

    if (arg.tag === "borrow") {
      return undefined;
    }

    if (arg.tag !== "var") {
      const ownership = unique_heap_ownership(arg, ctx, hooks);

      if (!ownership) {
        return undefined;
      }

      bindings.set(param.name, { tag: "temporary", ownership });
      continue;
    }

    bindings.set(param.name, {
      tag: "owner",
      owner: resolve_drop_owner(arg.name, state),
    });
  }

  return bindings;
}

export function static_drop_call_function_aliases(
  target: StaticDropFunction,
  args: CoreExpr[],
  state: CoreDropState,
): Map<string, StaticDropFunction> {
  const params = static_drop_function_params(target);
  const aliases = new Map<string, StaticDropFunction>();

  if (!params) {
    return aliases;
  }

  if (params.length !== args.length) {
    return aliases;
  }

  for (let index = 0; index < params.length; index += 1) {
    const param = params[index];
    const arg = args[index];

    if (!param) {
      throw new Error("Missing static drop call parameter");
    }

    if (!arg) {
      throw new Error("Missing static drop call argument");
    }

    if (!param.is_const) {
      continue;
    }

    if (arg.tag !== "var") {
      continue;
    }

    const target_fn = state.functions.get(arg.name);

    if (!target_fn) {
      continue;
    }

    aliases.set(param.name, target_fn);
  }

  return aliases;
}
