import type { Env, FrontExpr, Stmt } from "../ast.ts";
import type { FrontEvalHooks } from "./types.ts";

export type FrontSimpleBlockEvalApi = {
  eval_front_block: (
    stmts: Stmt[],
    env: Env,
    hooks: FrontEvalHooks,
  ) => FrontExpr;
};

export function eval_simple_front_block_impl(
  expr: Extract<FrontExpr, { tag: "block" }>,
  env: Env,
  hooks: FrontEvalHooks,
  api: FrontSimpleBlockEvalApi,
): FrontExpr | undefined {
  if (!can_eval_simple_front_block(expr.statements)) {
    return undefined;
  }

  try {
    return api.eval_front_block(expr.statements, env, hooks);
  } catch (error) {
    if (
      error instanceof Error &&
      is_simple_block_non_foldable_error(error.message)
    ) {
      return undefined;
    }

    throw error;
  }
}

function is_simple_block_non_foldable_error(message: string): boolean {
  if (message.startsWith("Cannot lower dynamic module ")) {
    return true;
  }

  if (message.startsWith("Cannot evaluate dynamic module ")) {
    return true;
  }

  if (message === "Module block has no result expression") {
    return true;
  }

  if (
    message.startsWith("Const parameter ") &&
    message.includes(" requires compile-time argument")
  ) {
    return true;
  }

  return false;
}

function can_eval_simple_front_block(stmts: Stmt[]): boolean {
  if (stmts.length <= 1) {
    return false;
  }

  for (const stmt of stmts) {
    if (stmt.tag === "bind") {
      continue;
    }

    if (stmt.tag === "assign") {
      continue;
    }

    if (stmt.tag === "index_assign") {
      continue;
    }

    if (stmt.tag === "return") {
      continue;
    }

    if (stmt.tag === "expr") {
      continue;
    }

    return false;
  }

  return true;
}
